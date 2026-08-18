/**
 * React Query configuration.
 *
 * Tuned for a phone on mobile data against a hosted database, where a round
 * trip costs 150–400ms. Two deliberate departures from the defaults:
 *
 *  * `retry` never fires on a 4xx. Retrying a 403 three times is three more
 *    audit-log rows for an access attempt that was already refused, and the
 *    user waits four times as long to be told the same thing.
 *  * `refetchOnWindowFocus` is on — unlike the web app, where it was too
 *    aggressive. On mobile, "focus" means the user actually returned to the
 *    app, which is exactly when a stale fee balance or bus position matters.
 */

import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 15 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && !error.isTransient) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
    mutations: {
      retry: 0,
    },
  },
});

/**
 * Query keys.
 *
 * Centralised because invalidation is the part that goes wrong: a fee payment
 * has to refresh the dashboard, the fee summary *and* the invoice, and that is
 * only reliable if all three are named in one place.
 */
export const qk = {
  dashboard: () => ['dashboard'] as const,

  student: (id: string) => ['student', id] as const,

  live: (studentId: string) => ['tracking', 'live', studentId] as const,
  tripHistory: (studentId: string, days: number) =>
    ['tracking', 'history', studentId, days] as const,
  alerts: () => ['tracking', 'alerts'] as const,

  attendance: (studentId: string, from?: string, to?: string) =>
    ['attendance', studentId, from ?? 'all', to ?? 'all'] as const,

  reportCards: (studentId: string) => ['examination', 'reportCards', studentId] as const,
  assignments: (scope: string) => ['examination', 'assignments', scope] as const,

  fees: (studentId: string) => ['fees', studentId] as const,
  invoice: (invoiceId: string) => ['fees', 'invoice', invoiceId] as const,

  loans: (studentId: string | 'self') => ['library', 'loans', studentId] as const,

  timetable: (sectionId: string) => ['academic', 'timetable', sectionId] as const,
  calendar: (from: string, to: string) => ['academic', 'calendar', from, to] as const,

  announcements: () => ['communication', 'announcements'] as const,
  notifications: () => ['communication', 'notifications'] as const,
  preferences: () => ['communication', 'preferences'] as const,
  contacts: () => ['communication', 'contacts'] as const,
  conversations: () => ['communication', 'conversations'] as const,
  messages: (conversationId: string) => ['communication', 'messages', conversationId] as const,

  myTrip: () => ['transport', 'myTrip'] as const,
  manifest: (tripId: string) => ['transport', 'manifest', tripId] as const,
  routes: () => ['transport', 'routes'] as const,
} as const;

/**
 * Drop everything on sign-out.
 *
 * Not a nicety: a guardian and a driver can share a handset, and the next
 * person to sign in must never see a frame of the previous session's children.
 * The web app clears its whole RTK cache on a school switch for the same reason.
 */
export function resetQueryCache(): void {
  queryClient.clear();
}
