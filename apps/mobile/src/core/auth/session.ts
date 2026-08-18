/**
 * Persisted session.
 *
 * Tokens live in the platform keystore (`expo-secure-store` → iOS Keychain /
 * Android EncryptedSharedPreferences), never in AsyncStorage. The cached user
 * profile is *not* secret and goes to AsyncStorage, which lets the app paint a
 * correct-looking shell on cold start before `/auth/me` returns — a spinner on
 * every launch is the single most common way a mobile ERP feels cheap.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import type { AuthUser } from '@erp/shared';

const ACCESS_KEY = 'edusphere.accessToken';
const REFRESH_KEY = 'edusphere.refreshToken';
const USER_KEY = 'edusphere.user';
const DEVICE_KEY = 'edusphere.deviceId';
const CHILD_KEY = 'edusphere.activeChildId';

/**
 * SecureStore throws on some Android OEM builds when the keystore is in a bad
 * state. Losing the session is recoverable — the user signs in again — but a
 * crash on launch is not, so every read is defensive.
 */
async function secureGet(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function secureSet(key: string, value: string | null): Promise<void> {
  try {
    if (value === null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // Deliberately swallowed: an unwritable keystore must not break sign-in.
  }
}

export interface StoredSession {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
}

export async function loadSession(): Promise<StoredSession> {
  const [accessToken, refreshToken, rawUser] = await Promise.all([
    secureGet(ACCESS_KEY),
    secureGet(REFRESH_KEY),
    AsyncStorage.getItem(USER_KEY),
  ]);

  let user: AuthUser | null = null;
  if (rawUser) {
    try {
      user = JSON.parse(rawUser) as AuthUser;
    } catch {
      user = null;
    }
  }

  return { accessToken, refreshToken, user };
}

export async function saveTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    secureSet(ACCESS_KEY, accessToken),
    secureSet(REFRESH_KEY, refreshToken),
  ]);
}

export async function saveAccessToken(accessToken: string): Promise<void> {
  await secureSet(ACCESS_KEY, accessToken);
}

export async function saveUser(user: AuthUser): Promise<void> {
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    secureSet(ACCESS_KEY, null),
    secureSet(REFRESH_KEY, null),
    AsyncStorage.multiRemove([USER_KEY, CHILD_KEY]),
  ]);
}

/**
 * A stable per-installation id. The API scopes each refresh-token *family* to
 * it, which is what makes "sign out my other devices" mean something and what
 * lets reuse detection tell a stolen token from a second phone.
 *
 * Android's `getAndroidId` and iOS's vendor id both survive app restarts but
 * reset on reinstall, which is the right lifetime for this.
 */
export async function getDeviceId(): Promise<string> {
  const cached = await AsyncStorage.getItem(DEVICE_KEY);
  if (cached) return cached;

  let native: string | null = null;
  try {
    native =
      Platform.OS === 'android'
        ? Application.getAndroidId()
        : await Application.getIosIdForVendorAsync();
  } catch {
    native = null;
  }

  const id = native ?? `rn-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  await AsyncStorage.setItem(DEVICE_KEY, id);
  return id;
}

/** Which child the guardian was last looking at, so the app reopens on them. */
export async function loadActiveChildId(): Promise<string | null> {
  return AsyncStorage.getItem(CHILD_KEY);
}

export async function saveActiveChildId(studentId: string): Promise<void> {
  await AsyncStorage.setItem(CHILD_KEY, studentId);
}
