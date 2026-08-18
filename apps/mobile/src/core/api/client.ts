/**
 * HTTP client.
 *
 * The one piece of cross-cutting logic every request needs: when the 15-minute
 * access token expires, refresh it and replay the original request. Concurrent
 * 401s share a *single* refresh — the API rotates refresh tokens and treats a
 * second use of the same one as theft, so eight parallel refreshes would sign
 * the user out rather than keep them in.
 *
 * Unlike the web app, which lets the browser carry an httpOnly refresh cookie,
 * the mobile client holds the refresh token itself and presents it in the body.
 * The API supports both — see `auth.controller.ts`.
 */

import type { ApiFailure, AuthTokens, AuthUser, PaginationMeta } from '@erp/shared';
import { env } from '@/config/env';
import {
  clearSession,
  getDeviceId,
  loadSession,
  saveAccessToken,
  saveTokens,
} from '@/core/auth/session';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Field-level messages from a 422, keyed by field name. */
  readonly details: Record<string, string[]> | undefined;
  readonly requestId: string | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, string[]>,
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /**
   * True when retrying later could plausibly succeed. Drives whether the UI
   * offers "Try again" or explains that the request itself was wrong.
   */
  get isTransient(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }

  /** No connection at all, as opposed to a server that answered with an error. */
  get isOffline(): boolean {
    return this.status === 0;
  }
}

// ---------------------------------------------------------------------------
// Session bridge
// ---------------------------------------------------------------------------

/**
 * The client owns the token in memory so it does not hit the keystore on every
 * request; `AuthProvider` keeps it in step with React state.
 */
let accessToken: string | null = null;
let refreshToken: string | null = null;
let onSignedOut: (() => void) | null = null;

export function primeTokens(access: string | null, refresh: string | null): void {
  accessToken = access;
  refreshToken = refresh;
}

export function setSignedOutHandler(handler: (() => void) | null): void {
  onSignedOut = handler;
}

export function currentAccessToken(): string | null {
  return accessToken;
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface Paged<T> {
  items: T[];
  meta: PaginationMeta;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Query;
  /** Milliseconds before the request is abandoned. */
  timeoutMs?: number;
  /** Set for `/auth/*` calls that must not recurse into a refresh. */
  skipAuth?: boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export function buildQuery(query: Query | undefined): string {
  if (!query) return '';
  const parts = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/** In-flight refresh, shared by every request that 401s while it runs. */
let refreshInFlight: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  if (!refreshToken) return null;

  try {
    const response = await rawFetch('/auth/refresh', {
      method: 'POST',
      body: { refreshToken, deviceId: await getDeviceId() },
      skipAuth: true,
      timeoutMs: 15_000,
    });

    const envelope = (await response.json()) as
      | { success: true; data: { tokens: AuthTokens; user: AuthUser } }
      | ApiFailure;

    if (!response.ok || !envelope.success) return null;

    accessToken = envelope.data.tokens.accessToken;
    refreshToken = envelope.data.tokens.refreshToken;
    await saveTokens(accessToken, refreshToken);
    return accessToken;
  } catch {
    return null;
  }
}

async function rawFetch(path: string, options: RequestOptions): Promise<Response> {
  const { method = 'GET', body, query, timeoutMs = 25_000, skipAuth, headers, signal } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Honour a caller's cancellation (screen unmounted) as well as the timeout.
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    return await fetch(`${env.apiUrl}${path}${buildQuery(query)}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(!skipAuth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Issue a request and unwrap the `{ success, data, meta }` envelope the API
 * always returns.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { envelope } = await requestWithMeta<T>(path, options);
  return envelope;
}

export async function requestWithMeta<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ envelope: T; meta: PaginationMeta | undefined }> {
  let response: Response;

  try {
    response = await rawFetch(path, options);
  } catch (err) {
    // fetch rejects only on network failure or abort — never on an HTTP error.
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new ApiError(
      0,
      aborted ? 'TIMEOUT' : 'NETWORK',
      aborted
        ? 'The server took too long to respond.'
        : 'No connection. Check your network and try again.',
    );
  }

  if (response.status === 401 && !options.skipAuth) {
    refreshInFlight ??= performRefresh().finally(() => {
      refreshInFlight = null;
    });

    const fresh = await refreshInFlight;

    if (!fresh) {
      await clearSession();
      accessToken = null;
      refreshToken = null;
      onSignedOut?.();
      throw new ApiError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
    }

    // Replay once with the new token. A second 401 means the account itself
    // lost access — retrying again would loop.
    response = await rawFetch(path, options);
  }

  if (response.status === 204) {
    return { envelope: undefined as T, meta: undefined };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const failure = payload as ApiFailure | null;
    throw new ApiError(
      response.status,
      failure?.error?.code ?? 'UNKNOWN',
      failure?.error?.message ?? `Request failed (${response.status})`,
      failure?.error?.details,
      failure?.error?.requestId,
    );
  }

  const success = payload as { success: true; data: T; meta?: PaginationMeta } | null;

  if (!success || success.success !== true) {
    throw new ApiError(response.status, 'MALFORMED', 'The server sent an unexpected response.');
  }

  return { envelope: success.data, meta: success.meta };
}

/** GET a paginated collection, returning items and pagination metadata together. */
export async function requestPaged<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Paged<T>> {
  const { envelope, meta } = await requestWithMeta<T[]>(path, options);
  return {
    items: envelope ?? [],
    meta: meta ?? {
      page: 1,
      limit: envelope?.length ?? 0,
      total: envelope?.length ?? 0,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/** Load persisted tokens into the client before the first request goes out. */
export async function hydrateClient(): Promise<{
  accessToken: string | null;
  user: AuthUser | null;
}> {
  const stored = await loadSession();
  primeTokens(stored.accessToken, stored.refreshToken);
  return { accessToken: stored.accessToken, user: stored.user };
}

/** Used by the auth flow after a successful login. */
export async function adoptTokens(tokens: AuthTokens): Promise<void> {
  accessToken = tokens.accessToken;
  refreshToken = tokens.refreshToken;
  await saveTokens(tokens.accessToken, tokens.refreshToken);
}

export async function forgetTokens(): Promise<void> {
  accessToken = null;
  refreshToken = null;
  await clearSession();
}

export function currentRefreshToken(): string | null {
  return refreshToken;
}

export { saveAccessToken };
