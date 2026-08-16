import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names, letting later Tailwind utilities win over earlier ones.
 * Without `twMerge`, `cn('p-2', 'p-4')` would emit both and the outcome would
 * depend on stylesheet order.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | string, currency = 'INR'): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  }).format(n);
}

/** Compact form for stat tiles: 12.4L, 1.2Cr — the units Indian schools use. */
export function formatCompactCurrency(value: number | string): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';

  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  if (Math.abs(n) >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

export function formatNumber(value: number | string): string {
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? new Intl.NumberFormat('en-IN').format(n) : '—';
}

export function formatDate(value: string | Date | null | undefined, style: 'short' | 'medium' | 'long' = 'medium'): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: style }).format(d);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' }).format(d);
}

/** "just now", "4m ago", "3d ago" — for live feeds and audit rows. */
export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);

  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(d, 'short');
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Deterministic avatar colour from a name, so the same person always gets the
 * same swatch across sessions and devices.
 */
export function avatarColor(seed: string): string {
  const palette = [
    'bg-indigo-500', 'bg-violet-500', 'bg-sky-500', 'bg-emerald-500',
    'bg-amber-500', 'bg-rose-500', 'bg-teal-500', 'bg-fuchsia-500',
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length]!;
}

export function percentage(part: number, whole: number, decimals = 1): number {
  if (!whole) return 0;
  return Number(((part / whole) * 100).toFixed(decimals));
}

/** Group an array by a derived key, preserving insertion order. */
export function groupBy<T, K extends string | number>(
  items: T[],
  keyOf: (item: T) => K,
): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = out.get(key);
    if (bucket) bucket.push(item);
    else out.set(key, [item]);
  }
  return out;
}

/** Trailing-edge debounce — for search inputs. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms = 300) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function downloadBlob(data: BlobPart, filename: string, type = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Minimal CSV export with correct quoting. */
export function toCsv(rows: Array<Record<string, unknown>>, columns?: string[]): string {
  if (rows.length === 0) return '';
  const keys = columns ?? Object.keys(rows[0]!);

  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  return [keys.join(','), ...rows.map((r) => keys.map((k) => escape(r[k])).join(','))].join('\n');
}
