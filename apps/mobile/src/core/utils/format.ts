/**
 * Display formatting.
 *
 * All of it is India-first because that is who the product serves: rupees with
 * lakh/crore grouping, 12-hour clocks, and day-first dates. `Intl` is available
 * in Hermes with the full ICU build Expo ships, so this uses the platform
 * rather than hand-rolling separators.
 */

import {
  differenceInCalendarDays,
  format,
  formatDistanceToNowStrict,
  isToday,
  isTomorrow,
  isValid,
  isYesterday,
  parseISO,
} from 'date-fns';

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === 'string' ? parseISO(value) : value;
  return isValid(date) ? date : null;
}

/** `17 Aug 2026` */
export function formatDate(value: string | Date | null | undefined, fallback = '—'): string {
  const date = toDate(value);
  return date ? format(date, 'd MMM yyyy') : fallback;
}

/** `17 Aug` — for dense lists where the year is implied by context. */
export function formatDateShort(value: string | Date | null | undefined, fallback = '—'): string {
  const date = toDate(value);
  return date ? format(date, 'd MMM') : fallback;
}

/** `4:05 pm` */
export function formatTime(value: string | Date | null | undefined, fallback = '—'): string {
  const date = toDate(value);
  return date ? format(date, 'h:mm a').toLowerCase() : fallback;
}

export function formatDateTime(value: string | Date | null | undefined, fallback = '—'): string {
  const date = toDate(value);
  return date ? `${format(date, 'd MMM')} · ${format(date, 'h:mm a').toLowerCase()}` : fallback;
}

/**
 * `Today`, `Yesterday`, `Tomorrow`, else the date.
 *
 * Worth the branch: a parent scanning an attendance list reads "Today" far
 * faster than "18 Aug 2026", and the relative words are what they would use
 * out loud.
 */
export function formatDayLabel(value: string | Date | null | undefined, fallback = '—'): string {
  const date = toDate(value);
  if (!date) return fallback;
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  if (isTomorrow(date)) return 'Tomorrow';
  return format(date, 'd MMM yyyy');
}

/** `3 minutes ago` */
export function formatRelative(value: string | Date | null | undefined, fallback = '—'): string {
  const date = toDate(value);
  if (!date) return fallback;
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

/**
 * How overdue, or how long left. Positive = days remaining.
 * Returns null when there is no date to compare.
 */
export function daysUntil(value: string | Date | null | undefined): number | null {
  const date = toDate(value);
  return date ? differenceInCalendarDays(date, new Date()) : null;
}

/** `Due in 3 days` / `Overdue by 2 days` / `Due today` */
export function formatDueLabel(value: string | Date | null | undefined): string {
  const days = daysUntil(value);
  if (days === null) return '—';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days > 1) return `Due in ${days} days`;
  if (days === -1) return 'Overdue by 1 day';
  return `Overdue by ${Math.abs(days)} days`;
}

/** `07:45` stored as a time-of-day column, shown as `7:45 am`. */
export function formatClock(value: string | null | undefined, fallback = '—'): string {
  if (!value) return fallback;

  // The column may arrive as `HH:mm`, `HH:mm:ss` or a full ISO timestamp.
  const isoTime = value.includes('T') ? toDate(value) : null;
  if (isoTime) return format(isoTime, 'h:mm a').toLowerCase();

  const [rawHour, rawMinute] = value.split(':');
  const hour = Number(rawHour);
  const minute = rawMinute ?? '00';
  if (Number.isNaN(hour)) return fallback;

  const suffix = hour < 12 ? 'am' : 'pm';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minute.padStart(2, '0')} ${suffix}`;
}

/** `PT12M` is nobody's idea of readable. `12 min`, `1 h 20 min`. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '—';
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `${Math.round(minutes)} min`;

  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

// ---------------------------------------------------------------------------
// Numbers & money
// ---------------------------------------------------------------------------

const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const rupeesPrecise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const plain = new Intl.NumberFormat('en-IN');

/**
 * Money arrives from Prisma as a string so it never round-trips through a
 * float. Parse at the edge, here, and nowhere else.
 */
export function toAmount(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** `₹12,500` — whole rupees, which is how fee amounts are actually quoted. */
export function formatCurrency(value: string | number | null | undefined): string {
  return rupees.format(toAmount(value));
}

/** `₹12,500.00` — for receipts and ledgers, where the paise must be visible. */
export function formatCurrencyPrecise(value: string | number | null | undefined): string {
  return rupeesPrecise.format(toAmount(value));
}

export function formatNumber(value: number | string | null | undefined): string {
  return plain.format(toAmount(value));
}

export function formatPercent(value: number | string | null | undefined, digits = 0): string {
  const n = toAmount(value);
  return `${n.toFixed(digits)}%`;
}

/** Formats a dashboard stat according to the `format` hint the API sends. */
export function formatStat(
  value: number | string,
  hint: 'number' | 'currency' | 'percent' | undefined,
): string {
  if (typeof value === 'string' && hint !== 'currency' && hint !== 'number') return value;
  if (hint === 'currency') return formatCurrency(value);
  if (hint === 'percent') return formatPercent(value);
  if (hint === 'number') return formatNumber(value);
  return String(value);
}

// ---------------------------------------------------------------------------
// Distance & speed
// ---------------------------------------------------------------------------

export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || Number.isNaN(meters)) return '—';
  if (meters < 950) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatSpeed(kmph: number | null | undefined): string {
  if (kmph === null || kmph === undefined || Number.isNaN(kmph)) return '—';
  return `${Math.round(kmph)} km/h`;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** `PARTIALLY_PAID` → `Partially paid`. Enum values are not user-facing copy. */
export function humanise(value: string | null | undefined, fallback = '—'): string {
  if (!value) return fallback;
  const words = value.replace(/[_-]+/g, ' ').toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function initials(...parts: Array<string | null | undefined>): string {
  const letters = parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .map((p) => p.trim()[0]!.toUpperCase());

  return letters.slice(0, 2).join('') || '?';
}

export function fullName(
  first: string | null | undefined,
  last: string | null | undefined,
): string {
  return [first, last].filter(Boolean).join(' ').trim() || 'Unknown';
}

/** Truncate on a word boundary so a preview never ends mid-syllable. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
