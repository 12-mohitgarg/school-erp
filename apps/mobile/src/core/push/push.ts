/**
 * Push notifications.
 *
 * The API's `push.channel.ts` sends through Expo's service and routes anything
 * marked EMERGENCY to a channel called `emergency`, so that channel has to
 * exist on the device with the right importance — otherwise an SOS arrives as
 * a silent banner, which is the one failure mode this feature cannot have.
 */

import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { env } from '@/config/env';
import { authApi } from '@/core/api/endpoints';

const TOKEN_KEY = 'edusphere.pushToken';

/**
 * Foreground presentation. Alerts still show while the app is open — a parent
 * staring at the live map is exactly who needs to see "your child got off the
 * bus" the instant it happens.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('default', {
    name: 'School updates',
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    vibrationPattern: [0, 200],
  });

  // Matches `channelId: 'emergency'` in the server's Expo payload.
  await Notifications.setNotificationChannelAsync('emergency', {
    name: 'Emergency & safety alerts',
    description: 'SOS alerts, geofence exits and bus safety warnings. Cannot be silenced.',
    importance: Notifications.AndroidImportance.MAX,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    vibrationPattern: [0, 400, 200, 400, 200, 400],
    bypassDnd: true,
    sound: 'default',
  });
}

export interface PushRegistration {
  token: string | null;
  granted: boolean;
}

/**
 * Ask for permission, mint a token and hand it to the API.
 *
 * Every step is allowed to fail quietly: a simulator has no push capability, a
 * user may decline, and a project without an EAS id cannot mint a token at
 * all. None of those should stop the app working — they only mean the school
 * reaches this person through the in-app inbox instead.
 */
export async function registerForPush(): Promise<PushRegistration> {
  try {
    if (!Device.isDevice) return { token: null, granted: false };

    await ensureAndroidChannels();

    const existing = await Notifications.getPermissionsAsync();
    let finalStatus = existing.status;

    if (finalStatus !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      finalStatus = asked.status;
    }

    if (finalStatus !== 'granted') return { token: null, granted: false };

    const projectId = env.easProjectId;
    if (!projectId) {
      if (__DEV__) {
        console.warn('[push] No EAS project id — skipping token registration.');
      }
      return { token: null, granted: true };
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    // Re-registering the same token on every launch is wasted writes; the
    // server keys on the token string so nothing breaks, but nothing is gained.
    const previous = await AsyncStorage.getItem(TOKEN_KEY);
    if (previous !== token) {
      await authApi.registerPushToken(
        token,
        Platform.OS === 'ios' ? 'ios' : 'android',
        Device.deviceName ?? undefined,
      );
      await AsyncStorage.setItem(TOKEN_KEY, token);
    }

    return { token, granted: true };
  } catch (err) {
    if (__DEV__) console.warn('[push] registration failed', err);
    return { token: null, granted: false };
  }
}

/** Retire this device's token so a signed-out handset stops receiving alerts. */
export async function unregisterPush(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return;

  await authApi.removePushToken(token).catch(() => undefined);
  await AsyncStorage.removeItem(TOKEN_KEY);
  await Notifications.setBadgeCountAsync(0).catch(() => undefined);
}

export async function setBadgeCount(count: number): Promise<void> {
  await Notifications.setBadgeCountAsync(count).catch(() => undefined);
}
