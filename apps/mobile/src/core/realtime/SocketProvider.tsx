/**
 * Socket.IO connection.
 *
 * The server places every socket in `tenant:{id}` and `user:{id}` on connect,
 * and adds `student:{id}` for each of a guardian's children automatically —
 * the guardian link *is* the authorisation, so the app never asks for those.
 * Anything beyond that (a specific vehicle) must be requested and is checked
 * server-side; naming a room does not join it.
 *
 * Connection state is exposed because "is this live, or has it silently
 * stopped?" is the question a parent watching a bus actually has, and the only
 * honest answer comes from the transport itself.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { WS_EVENTS } from '@erp/shared';
import { env } from '@/config/env';
import { currentAccessToken } from '@/core/api/client';
import { useAuth } from '@/core/auth/AuthProvider';

export type ConnectionState = 'connecting' | 'live' | 'offline';

interface SocketState {
  socket: Socket | null;
  connection: ConnectionState;
  /** Seconds since the last inbound event; drives the "last updated" line. */
  lastEventAt: number | null;
}

const SocketContext = createContext<SocketState>({
  socket: null,
  connection: 'offline',
  lastEventAt: null,
});

export function SocketProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [connection, setConnection] = useState<ConnectionState>('offline');
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (status !== 'signedIn') {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnection('offline');
      return;
    }

    const socket = io(env.wsUrl, {
      path: env.wsPath,
      transports: ['websocket'],
      // The handshake reads `auth.token`; a callback rather than a value so a
      // reconnect after a token rotation presents the *current* token instead
      // of the one that was valid when the socket was first created.
      auth: (cb) => cb({ token: currentAccessToken() }),
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
      timeout: 20_000,
    });

    socketRef.current = socket;
    setConnection('connecting');
    forceRender((n) => n + 1);

    socket.on('connect', () => setConnection('live'));
    socket.on('disconnect', () => setConnection('offline'));
    socket.on('connect_error', () => setConnection('offline'));

    socket.onAny(() => setLastEventAt(Date.now()));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [status]);

  /**
   * Reconnect the moment the app comes back to the foreground. iOS suspends
   * the socket on background and Socket.IO's own backoff can be several
   * seconds behind the user, which reads as a frozen map.
   */
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next !== 'active') return;
      const socket = socketRef.current;
      if (socket && !socket.connected) socket.connect();
    };

    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  const value = useMemo<SocketState>(
    () => ({ socket: socketRef.current, connection, lastEventAt }),
    [connection, lastEventAt],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketState {
  return useContext(SocketContext);
}

/**
 * Subscribe to one server event for as long as the screen is mounted.
 *
 * `handler` is held in a ref so a caller can pass an inline arrow function
 * without tearing down and re-adding the listener on every render.
 */
export function useSocketEvent<T = unknown>(
  event: string,
  handler: (payload: T) => void,
  enabled = true,
): void {
  const { socket } = useSocket();
  const saved = useRef(handler);
  saved.current = handler;

  useEffect(() => {
    if (!socket || !enabled) return;

    const listener = (payload: T) => saved.current(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [socket, event, enabled]);
}

/**
 * Join a vehicle's live feed for the lifetime of the screen.
 *
 * A guardian is only admitted if one of their children is currently allocated
 * to that vehicle's route; the request is simply refused otherwise, which is
 * the privacy boundary in PRD §6.3 and is enforced by the server, never here.
 */
export function useVehicleSubscription(vehicleId: string | null | undefined): void {
  const { socket, connection } = useSocket();

  useEffect(() => {
    if (!socket || !vehicleId || connection !== 'live') return;

    socket.emit(WS_EVENTS.SUBSCRIBE_VEHICLE, vehicleId);
    return () => {
      socket.emit(WS_EVENTS.UNSUBSCRIBE, `vehicle:${vehicleId}`);
    };
  }, [socket, vehicleId, connection]);
}
