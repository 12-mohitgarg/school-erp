/**
 * Runtime configuration.
 *
 * Values come from `app.config.ts` → `extra`, which reads them from the
 * environment at build time. Nothing here is a secret: the API URL and the
 * socket path are public by nature, and every privileged operation is
 * authorised server-side against the bearer token, never against anything the
 * client knows.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

type Extra = {
  variant?: 'parent' | 'student' | 'driver' | 'all';
  apiUrl?: string;
  wsUrl?: string;
  wsPath?: string;
  eas?: { projectId?: string };
};

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

/**
 * `localhost` means the device itself, not the developer's machine. The
 * Android emulator reaches the host on 10.0.2.2; a real handset needs the
 * machine's LAN address, which Expo already knows because it served the
 * bundle — so we borrow the host from the packager URL rather than making
 * every developer edit a file.
 */
function resolveDevHost(url: string): string {
  if (!__DEV__) return url;
  if (!/\/\/(localhost|127\.0\.0\.1)/.test(url)) return url;

  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  const lanHost = hostUri?.split(':')[0];

  if (lanHost && lanHost !== 'localhost' && lanHost !== '127.0.0.1') {
    return url.replace(/\/\/(localhost|127\.0\.0\.1)/, `//${lanHost}`);
  }

  if (Platform.OS === 'android') {
    return url.replace(/\/\/(localhost|127\.0\.0\.1)/, '//10.0.2.2');
  }

  return url;
}

export const env = {
  /** Which product this binary is. `all` routes by role at login. */
  variant: extra.variant ?? 'all',

  apiUrl: resolveDevHost(extra.apiUrl ?? 'http://localhost:4000/api/v1'),
  wsUrl: resolveDevHost(extra.wsUrl ?? 'http://localhost:4000'),
  wsPath: extra.wsPath ?? '/socket.io',

  /** Required by `expo-notifications` to mint a push token on a real build. */
  easProjectId: extra.eas?.projectId ?? Constants.easConfig?.projectId,

  isDev: __DEV__,
} as const;

/**
 * PRD §6.1 — devices report every 10–15 seconds. The driver app matches the
 * server's own `GPS_PING_INTERVAL_SECONDS`, which is 12.
 */
export const GPS_REPORT_INTERVAL_MS = 12_000;

/** Distance the bus must move before an extra ping is worth sending. */
export const GPS_REPORT_DISTANCE_M = 25;

/** How often the parent map falls back to REST if the socket is down. */
export const LIVE_POLL_INTERVAL_MS = 30_000;
