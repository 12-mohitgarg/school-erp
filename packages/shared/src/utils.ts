/** Small pure helpers shared across API, web and mobile. */

import type { GeoPoint } from './types.js';

// ---------------------------------------------------------------------------
// Geospatial
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Great-circle distance between two points, in metres. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Initial bearing from `a` to `b`, in degrees clockwise from north. */
export function bearingDegrees(a: GeoPoint, b: GeoPoint): number {
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Is `point` inside a circular geofence? */
export function isInsideCircle(
  point: GeoPoint,
  center: GeoPoint,
  radiusMeters: number,
): boolean {
  return haversineMeters(point, center) <= radiusMeters;
}

/** Ray-casting point-in-polygon test for polygonal geofences. */
export function isInsidePolygon(point: GeoPoint, polygon: GeoPoint[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const intersects =
      pi.longitude > point.longitude !== pj.longitude > point.longitude &&
      point.latitude <
        ((pj.latitude - pi.latitude) * (point.longitude - pi.longitude)) /
          (pj.longitude - pi.longitude) +
          pi.latitude;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Shortest distance from `point` to the polyline `path`, in metres.
 * Used for route-deviation detection.
 */
export function distanceToPathMeters(point: GeoPoint, path: GeoPoint[]): number {
  if (path.length === 0) return Number.POSITIVE_INFINITY;
  if (path.length === 1) return haversineMeters(point, path[0]!);

  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < path.length - 1; i++) {
    min = Math.min(min, distanceToSegmentMeters(point, path[i]!, path[i + 1]!));
  }
  return min;
}

/**
 * Distance from a point to a segment. Latitude/longitude are projected onto a
 * local flat plane first — accurate enough at the sub-kilometre scale we care
 * about, and far cheaper than a geodesic solution per ping.
 */
function distanceToSegmentMeters(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const latScale = 111_320;
  const lonScale = 111_320 * Math.cos(toRad(p.latitude));

  const px = p.longitude * lonScale;
  const py = p.latitude * latScale;
  const ax = a.longitude * lonScale;
  const ay = a.latitude * latScale;
  const bx = b.longitude * lonScale;
  const by = b.latitude * latScale;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) return Math.hypot(px - ax, py - ay);

  // Clamp the projection so we measure against the segment, not the infinite line.
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Estimated arrival in minutes given a remaining distance and current speed.
 * Falls back to a conservative average when the vehicle is stationary.
 */
export function estimateEtaMinutes(
  distanceMeters: number,
  speedKmph: number,
  fallbackSpeedKmph = 25,
): number {
  const effective = speedKmph > 5 ? speedKmph : fallbackSpeedKmph;
  return Math.max(1, Math.round((distanceMeters / 1000 / effective) * 60));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatCurrency(amount: number, currency = 'INR', locale = 'en-IN'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(value: number, locale = 'en-IN'): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function initials(firstName: string, lastName?: string): string {
  const a = firstName.trim().charAt(0);
  const b = lastName?.trim().charAt(0) ?? '';
  return (a + b).toUpperCase();
}

/** "2m ago", "3h ago", "5d ago" — used on live dashboards. */
export function relativeTime(from: string | Date, now: Date = new Date()): string {
  const then = typeof from === 'string' ? new Date(from) : from;
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/**
 * Sequential, human-readable document numbers: `INV/2026-27/000042`.
 * Callers supply the sequence; uniqueness is enforced by a DB constraint.
 */
export function documentNumber(prefix: string, sessionLabel: string, seq: number): string {
  return `${prefix}/${sessionLabel}/${String(seq).padStart(6, '0')}`;
}

/** Indian academic sessions run April-March, so 2026 -> "2026-27". */
export function academicSessionLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

export interface GradeBand {
  grade: string;
  minPercent: number;
  maxPercent: number;
  points: number;
}

/** CBSE-style default bands; tenants may override these in settings. */
export const DEFAULT_GRADE_BANDS: GradeBand[] = [
  { grade: 'A1', minPercent: 91, maxPercent: 100, points: 10 },
  { grade: 'A2', minPercent: 81, maxPercent: 90.99, points: 9 },
  { grade: 'B1', minPercent: 71, maxPercent: 80.99, points: 8 },
  { grade: 'B2', minPercent: 61, maxPercent: 70.99, points: 7 },
  { grade: 'C1', minPercent: 51, maxPercent: 60.99, points: 6 },
  { grade: 'C2', minPercent: 41, maxPercent: 50.99, points: 5 },
  { grade: 'D', minPercent: 33, maxPercent: 40.99, points: 4 },
  { grade: 'E', minPercent: 0, maxPercent: 32.99, points: 0 },
];

export function resolveGrade(
  percent: number,
  bands: GradeBand[] = DEFAULT_GRADE_BANDS,
): GradeBand {
  const hit = bands.find((b) => percent >= b.minPercent && percent <= b.maxPercent);
  // A percentage outside every band means the bands are misconfigured; fall back
  // to the lowest band rather than throwing mid-result-publication.
  return hit ?? bands[bands.length - 1]!;
}

export function calculateGpa(
  results: Array<{ percent: number; credits?: number }>,
  bands: GradeBand[] = DEFAULT_GRADE_BANDS,
): number {
  if (results.length === 0) return 0;
  let weighted = 0;
  let totalCredits = 0;
  for (const r of results) {
    const credits = r.credits ?? 1;
    weighted += resolveGrade(r.percent, bands).points * credits;
    totalCredits += credits;
  }
  return totalCredits === 0 ? 0 : Number((weighted / totalCredits).toFixed(2));
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function percentage(part: number, whole: number, decimals = 1): number {
  if (whole === 0) return 0;
  return Number(((part / whole) * 100).toFixed(decimals));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Strip keys whose value is `undefined` — handy before a Prisma update. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/** Mask all but the last 4 characters — for logging phone numbers and account ids. */
export function maskTail(value: string, visible = 4): string {
  if (value.length <= visible) return '*'.repeat(value.length);
  return '*'.repeat(value.length - visible) + value.slice(-visible);
}
