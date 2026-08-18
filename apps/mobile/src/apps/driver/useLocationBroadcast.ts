/**
 * GPS broadcast — the driver app's core duty.
 *
 * PRD §2.8: *automatically transmits live GPS location every 10–15 seconds.*
 * The server's own `GPS_PING_INTERVAL_SECONDS` is 12, so that is the cadence.
 *
 * Design decisions worth stating, because each one is a failure mode avoided:
 *
 *  * **Reports only while a trip is running.** The server refuses a position
 *    from a driver with no active trip (`Start a trip before reporting
 *    location`), and more importantly a bus that reports off-shift is
 *    tracking a *person*, not a vehicle. The watcher starts and stops with
 *    the trip, and the permission copy says exactly that.
 *
 *  * **Background updates, not just foreground.** A driver puts the phone in a
 *    cradle and it locks. Foreground-only tracking would go dark for the whole
 *    journey — the one time it matters. `expo-task-manager` keeps it running.
 *
 *  * **Every ping is queued first, sent second.** On a rural route the network
 *    disappears for minutes at a time. A ping that fails to send is written to
 *    the offline queue and flushed as a batch on reconnect, in chronological
 *    order, so geofence transitions still fire in sequence.
 *
 *  * **Distance filter as well as an interval.** A bus idling at a stop for ten
 *    minutes does not need fifty identical positions, and each one costs the
 *    driver's data allowance and the server a geofence evaluation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';
import { GPS_REPORT_DISTANCE_M, GPS_REPORT_INTERVAL_MS } from '@/config/env';
import { trackingApi } from '@/core/api/endpoints';
import { enqueuePing, flushQueue, type QueuedPing } from '@/core/offline/queue';

export const LOCATION_TASK = 'edusphere-driver-location';

/**
 * Background task.
 *
 * Registered at module scope, as `expo-task-manager` requires — the JS context
 * that handles a background wake-up has not mounted any React tree, so the
 * handler cannot live inside a component.
 *
 * It does the same thing the foreground watcher does: try to send, and queue on
 * failure. It deliberately does *not* try to be clever about batching here,
 * because a background invocation may be killed at any moment and a ping that
 * is on disk survives that; a ping held in memory does not.
 */
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;

  const { locations } = data as { locations: Location.LocationObject[] };

  for (const location of locations) {
    const ping = toPing(location);
    try {
      await trackingApi.pushLocation({
        latitude: ping.latitude,
        longitude: ping.longitude,
        speed: ping.speed,
        heading: ping.heading,
        accuracy: ping.accuracy,
        recordedAt: ping.recordedAt,
      });
    } catch {
      await enqueuePing(ping);
    }
  }
});

function toPing(location: Location.LocationObject): QueuedPing {
  const { coords, timestamp } = location;

  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    // `speed` is metres/second and may be -1 when unknown; the API wants km/h.
    speed: coords.speed !== null && coords.speed >= 0 ? coords.speed * 3.6 : 0,
    heading: coords.heading !== null && coords.heading >= 0 ? coords.heading : 0,
    ...(coords.accuracy !== null ? { accuracy: coords.accuracy } : {}),
    recordedAt: new Date(timestamp).toISOString(),
  };
}

export type PermissionState = 'unknown' | 'granted' | 'foregroundOnly' | 'denied';

export interface BroadcastState {
  broadcasting: boolean;
  permission: PermissionState;
  /** The last position we successfully handed to the API. */
  lastSentAt: string | null;
  lastError: string | null;
  requestPermissions: () => Promise<PermissionState>;
}

/**
 * Starts and stops the broadcast in step with `active`.
 *
 * The hook owns the lifecycle so a screen cannot leave a watcher running after
 * unmount — a bus that keeps reporting after the driver closes the trip screen
 * is exactly the privacy problem the whole design is trying to avoid.
 */
export function useLocationBroadcast(active: boolean): BroadcastState {
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [broadcasting, setBroadcasting] = useState(false);
  const [lastSentAt, setLastSentAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const watcher = useRef<Location.LocationSubscription | null>(null);
  /** Guards against overlapping sends when a slow request outlives the interval. */
  const sending = useRef(false);

  const requestPermissions = useCallback(async (): Promise<PermissionState> => {
    const foreground = await Location.requestForegroundPermissionsAsync();

    if (!foreground.granted) {
      setPermission('denied');
      return 'denied';
    }

    // Background is requested *separately* and after foreground, which is what
    // both platforms require — asking for "always" cold is routinely denied.
    const background = await Location.requestBackgroundPermissionsAsync();
    const state: PermissionState = background.granted ? 'granted' : 'foregroundOnly';

    setPermission(state);
    return state;
  }, []);

  const send = useCallback(async (location: Location.LocationObject) => {
    if (sending.current) return;
    sending.current = true;

    const ping = toPing(location);

    try {
      await trackingApi.pushLocation({
        latitude: ping.latitude,
        longitude: ping.longitude,
        speed: ping.speed,
        heading: ping.heading,
        accuracy: ping.accuracy,
        recordedAt: ping.recordedAt,
      });

      setLastSentAt(ping.recordedAt);
      setLastError(null);

      // A successful send means the network is back; drain anything queued
      // while it was not.
      void flushQueue();
    } catch (err) {
      await enqueuePing(ping);
      setLastError(
        err instanceof Error ? err.message : 'Position saved offline and will be sent later.',
      );
    } finally {
      sending.current = false;
    }
  }, []);

  // --- Foreground watcher --------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      const current = await Location.getForegroundPermissionsAsync();
      if (!current.granted) {
        setPermission((prev) => (prev === 'unknown' ? 'denied' : prev));
        return;
      }

      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: GPS_REPORT_INTERVAL_MS,
          distanceInterval: GPS_REPORT_DISTANCE_M,
        },
        (location) => {
          void send(location);
        },
      );

      if (cancelled) {
        subscription.remove();
        return;
      }

      watcher.current = subscription;
      setBroadcasting(true);
    };

    if (active) {
      void start();
    } else {
      watcher.current?.remove();
      watcher.current = null;
      setBroadcasting(false);
    }

    return () => {
      cancelled = true;
      watcher.current?.remove();
      watcher.current = null;
    };
  }, [active, send]);

  // --- Background task -----------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(
        () => false,
      );

      if (active && !running) {
        const background = await Location.getBackgroundPermissionsAsync().catch(() => null);
        if (!background?.granted || cancelled) return;

        await Location.startLocationUpdatesAsync(LOCATION_TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: GPS_REPORT_INTERVAL_MS,
          distanceInterval: GPS_REPORT_DISTANCE_M,
          // Android will kill a background location service without a visible
          // notification, and hiding it from the driver would be wrong anyway:
          // they are entitled to see that the bus is reporting.
          foregroundService: {
            notificationTitle: 'Trip in progress',
            notificationBody: 'Sharing the bus position with the school and parents.',
            notificationColor: '#0F766E',
          },
          pausesUpdatesAutomatically: false,
          ...(Platform.OS === 'ios' ? { activityType: Location.ActivityType.AutomotiveNavigation } : {}),
          showsBackgroundLocationIndicator: true,
        }).catch(() => undefined);
      }

      if (!active && running) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
      }
    };

    void sync();

    return () => {
      cancelled = true;
      // Not stopped here: unmounting the trip screen while a trip is still
      // running must not silence the bus. `active` going false is the signal.
    };
  }, [active]);

  /** Stop for good when the trip ends, even if the screen never unmounted. */
  useEffect(() => {
    if (active) return;
    void Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)
      .then((running) => (running ? Location.stopLocationUpdatesAsync(LOCATION_TASK) : undefined))
      .catch(() => undefined);
  }, [active]);

  // --- Permission bootstrap ------------------------------------------------

  useEffect(() => {
    const check = async () => {
      const foreground = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (!foreground?.granted) {
        setPermission('denied');
        return;
      }

      const background = await Location.getBackgroundPermissionsAsync().catch(() => null);
      setPermission(background?.granted ? 'granted' : 'foregroundOnly');
    };

    void check();

    // Permissions can be changed in Settings while the app is backgrounded.
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void check();
    });

    return () => sub.remove();
  }, []);

  return { broadcasting, permission, lastSentAt, lastError, requestPermissions };
}
