/**
 * Push notifications.
 *
 * The mobile apps are Expo-managed React Native, so Expo's push service is the
 * primary transport; raw FCM is supported as a fallback for bare builds.
 */

import { env } from '../../../config/env.js';
import { moduleLogger } from '../../logger.js';

const log = moduleLogger('push');

export interface PushInput {
  token: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** EMERGENCY alerts should bypass the device's notification grouping. */
  priority?: 'default' | 'high';
  sound?: string;
  badge?: number;
}

export async function sendPush(input: PushInput): Promise<string> {
  // Expo tokens are self-identifying, which lets one call site serve both.
  if (input.token.startsWith('ExponentPushToken') || input.token.startsWith('ExpoPushToken')) {
    return sendViaExpo(input);
  }

  if (env.FCM_SERVER_KEY) {
    return sendViaFcm(input);
  }

  log.info({ title: input.title }, '[stub] Push not sent — no push provider configured');
  return `stub-${Date.now()}`;
}

async function sendViaExpo(input: PushInput): Promise<string> {
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(env.EXPO_ACCESS_TOKEN
        ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      to: input.token,
      title: input.title,
      body: input.body,
      data: input.data ?? {},
      priority: input.priority ?? 'high',
      sound: input.sound ?? 'default',
      badge: input.badge,
      channelId: input.priority === 'high' ? 'emergency' : 'default',
    }),
  });

  if (!response.ok) {
    throw new Error(`Expo push responded ${response.status}`);
  }

  const result = (await response.json()) as {
    data?: { status: string; id?: string; message?: string };
  };

  if (result.data?.status === 'error') {
    throw new Error(`Expo push error: ${result.data.message ?? 'unknown'}`);
  }

  return result.data?.id ?? `expo-${Date.now()}`;
}

async function sendViaFcm(input: PushInput): Promise<string> {
  const response = await fetch('https://fcm.googleapis.com/fcm/send', {
    method: 'POST',
    headers: {
      Authorization: `key=${env.FCM_SERVER_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: input.token,
      notification: { title: input.title, body: input.body, sound: input.sound ?? 'default' },
      data: input.data ?? {},
      priority: input.priority === 'high' ? 'high' : 'normal',
    }),
  });

  if (!response.ok) {
    throw new Error(`FCM responded ${response.status}`);
  }

  const result = (await response.json()) as { success?: number; results?: Array<{ error?: string; message_id?: string }> };

  if (result.success === 0) {
    throw new Error(`FCM delivery failed: ${result.results?.[0]?.error ?? 'unknown'}`);
  }

  return result.results?.[0]?.message_id ?? `fcm-${Date.now()}`;
}
