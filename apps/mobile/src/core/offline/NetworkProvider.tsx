/**
 * Connectivity, and the thing that actually matters: whether the queue is
 * draining.
 *
 * "Online" here means *reachable*, not merely "Wi-Fi associated" — a bus
 * pulling out of a depot is often attached to an access point that routes
 * nowhere, and telling a driver they are online while nothing sends is worse
 * than telling them nothing.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import NetInfo from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';
import {
  flushQueue,
  hydrateQueue,
  queueSnapshot,
  subscribeToQueue,
  type QueueSnapshot,
} from './queue';

interface NetworkState extends QueueSnapshot {
  isOnline: boolean;
  /** Force a flush now — the "Sync now" button on the driver's trip screen. */
  syncNow: () => Promise<boolean>;
}

const NetworkContext = createContext<NetworkState | null>(null);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [queue, setQueue] = useState<QueueSnapshot>(queueSnapshot);

  useEffect(() => {
    void hydrateQueue();
    return subscribeToQueue(setQueue);
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      // `isInternetReachable` is null while NetInfo is still probing; treat
      // that as connected so the UI does not flicker "offline" on every
      // network change.
      const reachable = state.isInternetReachable ?? true;
      const online = Boolean(state.isConnected) && reachable;

      setIsOnline((was) => {
        // Rising edge only. Flushing on every NetInfo tick would re-send a
        // batch that is already in flight on a flaky connection.
        if (!was && online) void flushQueue();
        return online;
      });
    });

    return unsubscribe;
  }, []);

  /** Coming back to the foreground is the other moment worth retrying. */
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === 'active') void flushQueue();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  const value = useMemo<NetworkState>(
    () => ({ ...queue, isOnline, syncNow: flushQueue }),
    [queue, isOnline],
  );

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkState {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error('useNetwork must be used inside <NetworkProvider>');
  return ctx;
}
