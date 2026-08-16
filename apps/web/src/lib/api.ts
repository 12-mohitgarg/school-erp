/**
 * RTK Query base API.
 *
 * Handles the one piece of cross-cutting logic every request needs: when the
 * short-lived access token expires, transparently refresh it and replay the
 * original request. Concurrent 401s share a single refresh so a dashboard
 * firing eight queries at once does not trigger eight rotations — which would
 * trip the server's token-reuse detection and sign the user out.
 */

import {
  createApi,
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react';
import type { RootState } from '@/store';
import { credentialsUpdated, signedOut } from '@/store/authSlice';

const API_BASE = import.meta.env['VITE_API_URL'] ?? '/api/v1';

const rawBaseQuery = fetchBaseQuery({
  baseUrl: API_BASE,
  // Sends the httpOnly refresh cookie.
  credentials: 'include',
  prepareHeaders: (headers, { getState }) => {
    const token = (getState() as RootState).auth.accessToken;
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return headers;
  },
});

/** In-flight refresh, shared by every request that 401s while it runs. */
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(
  api: Parameters<BaseQueryFn>[1],
  extraOptions: object,
): Promise<string | null> {
  const result = await rawBaseQuery(
    { url: '/auth/refresh', method: 'POST', body: {} },
    api,
    extraOptions,
  );

  const data = result.data as
    | { data?: { tokens?: { accessToken: string; expiresIn: number } } }
    | undefined;

  const token = data?.data?.tokens?.accessToken ?? null;
  if (token) {
    api.dispatch(credentialsUpdated({ accessToken: token }));
  }
  return token;
}

const baseQueryWithReauth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  let result = await rawBaseQuery(args, api, extraOptions);

  if (result.error?.status !== 401) return result;

  // The refresh endpoint itself returning 401 means the session is genuinely
  // gone — retrying would loop forever.
  const url = typeof args === 'string' ? args : args.url;
  if (url.includes('/auth/refresh') || url.includes('/auth/login')) {
    api.dispatch(signedOut());
    return result;
  }

  refreshPromise ??= refreshAccessToken(api, extraOptions ?? {}).finally(() => {
    refreshPromise = null;
  });

  const token = await refreshPromise;

  if (!token) {
    api.dispatch(signedOut());
    return result;
  }

  // Replay the original request with the fresh token.
  result = await rawBaseQuery(args, api, extraOptions);
  return result;
};

/**
 * Cache tags. Mutations invalidate by tag so a fee payment refreshes the
 * invoice list, the dashboard and the student profile without manual wiring.
 */
export const TAGS = [
  'Auth', 'Dashboard', 'Student', 'Guardian', 'Class', 'Section', 'Subject',
  'Timetable', 'AcademicYear', 'Attendance', 'Exam', 'Mark', 'ReportCard',
  'Assignment', 'FeeHead', 'FeeStructure', 'Invoice', 'Payment', 'Concession',
  'Employee', 'Leave', 'Payroll', 'Book', 'Loan', 'Vehicle', 'Route', 'Trip',
  'Tracking', 'Geofence', 'Sos', 'Alert', 'Inventory', 'Asset', 'Vendor',
  'Announcement', 'Notification', 'Conversation', 'Report', 'User', 'Role',
  'Integration', 'Settings', 'Audit',
] as const;

export type ApiTag = (typeof TAGS)[number];

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: TAGS,
  /*
    Tuned for a hosted database, where every request costs 150-400ms of
    round trip. The defaults refetched aggressively, so navigating back to a
    page you had just visited showed skeletons again for no benefit.

    Mutations still invalidate by tag, so anything the user actually changes
    updates immediately — this only affects passive revisits.
  */
  keepUnusedDataFor: 300,
  refetchOnMountOrArgChange: 120,
  refetchOnReconnect: true,
  refetchOnFocus: false,
  endpoints: () => ({}),
});

/** Unwrap the `{ success, data, meta }` envelope the API always returns. */
export interface Envelope<T> {
  success: true;
  data: T;
  meta?: PaginationMeta & Record<string, unknown>;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface Paged<T> {
  items: T[];
  meta: PaginationMeta;
  extra?: Record<string, unknown>;
}

/** Standard `transformResponse` for list endpoints. */
export function unwrapPaged<T>(response: Envelope<T[]>): Paged<T> {
  const { page = 1, limit = 25, total = 0, totalPages = 0, hasNext = false, hasPrev = false, ...extra } =
    response.meta ?? {};

  return {
    items: response.data,
    meta: { page, limit, total, totalPages, hasNext, hasPrev },
    extra: extra as Record<string, unknown>,
  };
}

/** Standard `transformResponse` for single-object endpoints. */
export function unwrap<T>(response: Envelope<T>): T {
  return response.data;
}

/** Pull a human-readable message out of an RTK Query error. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (!error || typeof error !== 'object') return fallback;

  const fetchError = error as FetchBaseQueryError;

  if ('data' in fetchError && fetchError.data && typeof fetchError.data === 'object') {
    const body = fetchError.data as { error?: { message?: string; details?: Record<string, string[]> } };

    if (body.error?.details) {
      // Surface the first field-level message; it is more actionable than
      // a generic "Validation failed".
      const first = Object.values(body.error.details)[0];
      if (first?.[0]) return first[0];
    }
    if (body.error?.message) return body.error.message;
  }

  if ('status' in fetchError && fetchError.status === 'FETCH_ERROR') {
    return 'Cannot reach the server. Check your connection.';
  }

  return fallback;
}

/** Build a query string, dropping empty values so URLs stay clean. */
export function queryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}
