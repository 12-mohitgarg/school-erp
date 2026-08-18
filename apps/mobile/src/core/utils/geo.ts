/**
 * Geometry the map screens need.
 *
 * The polyline codec is the same algorithm the API uses in
 * `apps/api/src/modules/tracking/polyline.ts` — routes are stored as a Google
 * encoded polyline, so the client has to decode the identical format. It is
 * duplicated rather than shared because `@erp/shared` is transport contracts
 * only, and pulling a codec into it would make every consumer carry it.
 */

import type { GeoPoint } from '@erp/shared';

/** Decode a Google-encoded polyline into coordinates. */
export function decodePolyline(encoded: string, precision = 5): GeoPoint[] {
  const points: GeoPoint[] = [];
  const factor = 10 ** precision;

  let index = 0;
  let lat = 0;
  let lng = 0;

  /**
   * Each value is a chunked, zig-zag encoded varint: 5 bits per character,
   * continuation flagged by 0x20, sign carried in the low bit.
   */
  const decodeValue = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);

    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += decodeValue();
    lng += decodeValue();
    points.push({ latitude: lat / factor, longitude: lng / factor });
  }

  return points;
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * `[west, south, east, north]` — the flat, GeoJSON-RFC order MapLibre's
 * `LngLatBounds` uses. Declared here rather than imported so this module stays
 * free of a native dependency and remains testable in plain Node.
 */
export type Bounds = [west: number, south: number, east: number, north: number];

/**
 * Bounding box that contains every supplied point, padded so markers near the
 * edge are not clipped by the map's own chrome.
 *
 * Returns null for an empty set — the caller then falls back to a fixed camera
 * rather than fitting to nothing, which MapLibre renders as a view of the
 * middle of the Atlantic.
 */
export function boundsOf(points: GeoPoint[], padDegrees = 0.004): Bounds | null {
  if (points.length === 0) return null;

  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLng = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;

  for (const p of points) {
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
    minLng = Math.min(minLng, p.longitude);
    maxLng = Math.max(maxLng, p.longitude);
  }

  if (!Number.isFinite(minLat)) return null;

  // A single point has zero extent, which fits to an infinite zoom.
  const pad = Math.max(padDegrees, (maxLat - minLat) * 0.15, (maxLng - minLng) * 0.15);

  return [minLng - pad, minLat - pad, maxLng + pad, maxLat + pad];
}

/** GeoJSON wants `[lng, lat]`; every domain type here is `{latitude, longitude}`. */
export function toLngLat(point: GeoPoint): [number, number] {
  return [point.longitude, point.latitude];
}

export function toLineString(points: GeoPoint[]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: points.map(toLngLat) },
  };
}

export function toPointFeature(
  point: GeoPoint,
  properties: Record<string, unknown> = {},
): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'Point', coordinates: toLngLat(point) },
  };
}

export function toFeatureCollection(
  features: Array<GeoJSON.Feature<GeoJSON.Point>>,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return { type: 'FeatureCollection', features };
}

/** True when a coordinate pair is usable — guards against `0,0` placeholders. */
export function isRealCoordinate(point: GeoPoint | null | undefined): point is GeoPoint {
  if (!point) return false;
  const { latitude, longitude } = point;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return false;
  return !(latitude === 0 && longitude === 0);
}
