/**
 * WebSocket lifecycle.
 *
 * Opens one socket per session and routes server events into the Redux cache:
 * an SOS raises the global banner, location pings invalidate the tracking
 * query, and new notifications bump the unread badge. Components subscribe to
 * store state rather than to the socket, so nothing needs to know it exists.
 */

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';
import { WS_EVENTS } from '@erp/shared';
import { useAppDispatch, useAppSelector } from '@/store';
import { sosRaised } from '@/store/uiSlice';
import { api } from '@/lib/api';

interface SosPayload {
  alertId: string;
  raisedByName: string;
  message: string | null;
  location: { latitude: number; longitude: number };
}

interface NotificationPayload {
  id: string;
  title: string;
  body: string;
  priority: string;
}

interface SafetyAlertPayload {
  alertId: string;
  type: string;
  severity: string;
  message: string;
}

/**
 * The one live socket for this session.
 *
 * Chat needs to *append* an incoming message, not refetch the thread — a
 * refetch against a database 300ms away makes a conversation feel laggy and
 * loses scroll position. Sharing the connection avoids opening a second one
 * just for the chat screen.
 */
let liveSocket: Socket | null = null;

export function getLiveSocket(): Socket | null {
  return liveSocket;
}

export function useRealtime(): void {
  const dispatch = useAppDispatch();
  const accessToken = useAppSelector((s) => s.auth.accessToken);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!accessToken) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    const socket = io({
      path: '/socket.io',
      auth: { token: accessToken },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on(WS_EVENTS.SOS_ALERT, (payload: SosPayload) => {
      dispatch(
        sosRaised({
          alertId: payload.alertId,
          raisedByName: payload.raisedByName,
          message: payload.message,
          latitude: payload.location.latitude,
          longitude: payload.location.longitude,
        }),
      );
      // Duration 0 = sticky. An emergency should not dismiss itself.
      toast.error(`Emergency SOS from ${payload.raisedByName}`, {
        description: payload.message ?? 'Open Live Tracking for the location.',
        duration: Number.POSITIVE_INFINITY,
      });
      dispatch(api.util.invalidateTags(['Sos', 'Dashboard']));
    });

    socket.on(WS_EVENTS.SOS_UPDATE, () => {
      dispatch(api.util.invalidateTags(['Sos', 'Dashboard']));
    });

    socket.on(WS_EVENTS.SAFETY_ALERT, (payload: SafetyAlertPayload) => {
      if (payload.severity === 'CRITICAL') {
        toast.warning(payload.message);
      }
      dispatch(api.util.invalidateTags(['Alert']));
    });

    socket.on(WS_EVENTS.NOTIFICATION, (payload: NotificationPayload) => {
      toast(payload.title, { description: payload.body });
      dispatch(api.util.invalidateTags(['Notification']));
    });

    // Location pings arrive every ~12s per vehicle. Invalidating the RTK cache
    // on each one would refetch constantly, so the tracking page subscribes to
    // the socket directly for the map and this only nudges summary views.
    socket.on(WS_EVENTS.TRIP_UPDATE, () => {
      dispatch(api.util.invalidateTags(['Trip', 'Tracking']));
    });

    socket.on(WS_EVENTS.ATTENDANCE_UPDATE, () => {
      dispatch(api.util.invalidateTags(['Attendance']));
    });

    socket.on(WS_EVENTS.CHAT_MESSAGE, () => {
      dispatch(api.util.invalidateTags(['Conversation', 'Notification']));
    });

    // Expose the live socket so the chat screen can append messages directly
    // rather than refetching the thread on every incoming message.
    liveSocket = socket;

    socket.on('connect_error', (err) => {
      // An auth failure here means the token expired; the next REST call will
      // refresh it and the socket reconnects with the new one.
      if (import.meta.env.DEV) console.warn('Socket connection error:', err.message);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      liveSocket = null;
    };
  }, [accessToken, dispatch]);
}

/**
 * Subscribe to one conversation's live messages.
 *
 * Joins the room server-side (which re-checks membership), then hands each
 * incoming message to the caller so it can be appended immediately.
 */
export function useConversationStream(
  conversationId: string | null,
  onMessage: (message: Record<string, unknown>) => void,
): void {
  const accessToken = useAppSelector((s) => s.auth.accessToken);
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    if (!conversationId || !accessToken) return;

    // Ask the server to put this socket in the conversation room. Membership
    // is verified there — naming a room is not enough to join it.
    void fetch(`/api/v1/communication/conversations/${conversationId}/subscribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => undefined);

    const socket = getLiveSocket();
    if (!socket) return;

    const listener = (message: Record<string, unknown>) => {
      if (String(message['conversationId']) === conversationId) {
        handlerRef.current(message);
      }
    };

    socket.on(WS_EVENTS.CHAT_MESSAGE, listener);
    return () => {
      socket.off(WS_EVENTS.CHAT_MESSAGE, listener);
    };
  }, [conversationId, accessToken]);
}

export interface LivePosition {
  vehicleId?: string;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  timestamp: string;
}

/**
 * Subscribe to one vehicle's live position.
 *
 * Uses the session's existing socket rather than opening its own. The previous
 * version created a second connection every time the selected bus changed,
 * which meant an admin clicking through a fleet of twenty left twenty
 * handshakes and twenty authenticated sockets behind them.
 */
export function useVehicleSubscription(
  vehicleId: string | null,
  onLocation: (payload: LivePosition) => void,
): void {
  const accessToken = useAppSelector((s) => s.auth.accessToken);
  const handlerRef = useRef(onLocation);
  handlerRef.current = onLocation;

  useEffect(() => {
    if (!accessToken || !vehicleId) return;

    const socket = getLiveSocket();
    if (!socket) return;

    const join = () => socket.emit(WS_EVENTS.SUBSCRIBE_VEHICLE, vehicleId);

    // Join now if already connected, and again after any reconnect — room
    // membership lives on the server side of a connection and does not survive
    // one dropping.
    if (socket.connected) join();
    socket.on('connect', join);

    const listener = (payload: LivePosition) => {
      // The room is per vehicle, but a socket may be in several at once.
      if (!payload.vehicleId || payload.vehicleId === vehicleId) {
        handlerRef.current(payload);
      }
    };

    socket.on(WS_EVENTS.LOCATION_UPDATE, listener);

    return () => {
      socket.off('connect', join);
      socket.off(WS_EVENTS.LOCATION_UPDATE, listener);
      socket.emit(WS_EVENTS.UNSUBSCRIBE, `vehicle:${vehicleId}`);
    };
  }, [accessToken, vehicleId]);
}

/**
 * Stream every vehicle in the school — the admin safety dashboard.
 *
 * Without this the map only moved for the one bus an operator had selected and
 * relied on a 20-second poll for the rest, so a fleet view was a fleet of
 * stale pins. The server authorises the fleet room on `tracking:view` plus a
 * branch-or-wider scope, so a guardian joining it is refused.
 *
 * Positions are collected into a keyed record rather than a list, so a ping
 * for one bus re-renders one marker instead of the whole fleet.
 */
export function useFleetStream(enabled = true): Record<string, LivePosition> {
  const accessToken = useAppSelector((s) => s.auth.accessToken);
  const [positions, setPositions] = useState<Record<string, LivePosition>>({});

  useEffect(() => {
    if (!enabled || !accessToken) return;

    const socket = getLiveSocket();
    if (!socket) return;

    const join = () => socket.emit(WS_EVENTS.SUBSCRIBE_FLEET);
    if (socket.connected) join();
    socket.on('connect', join);

    const listener = (payload: LivePosition) => {
      if (!payload.vehicleId) return;
      setPositions((prev) => ({ ...prev, [payload.vehicleId!]: payload }));
    };

    socket.on(WS_EVENTS.LOCATION_UPDATE, listener);

    return () => {
      socket.off('connect', join);
      socket.off(WS_EVENTS.LOCATION_UPDATE, listener);
    };
  }, [enabled, accessToken]);

  return positions;
}
