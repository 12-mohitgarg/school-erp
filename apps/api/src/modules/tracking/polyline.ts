/**
 * Google encoded-polyline codec.
 *
 * Routes are stored as an encoded polyline string (the format the Directions
 * API returns and the Maps SDK consumes), so we decode it here for the
 * route-deviation check rather than storing thousands of coordinate rows.
 *
 * Format reference: developers.google.com/maps/documentation/utilities/polylinealgorithm
 */

import type { GeoPoint } from '@erp/shared';

export function decodePolyline(encoded: string, precision = 5): GeoPoint[] {
  const points: GeoPoint[] = [];
  const factor = 10 ** precision;

  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    lat += decodeValue();
    lng += decodeValue();
    points.push({ latitude: lat / factor, longitude: lng / factor });
  }

  return points;

  /**
   * Each value is a chunked, zig-zag encoded varint: 5 bits per character,
   * continuation flagged by bit 0x20, and the sign carried in the low bit.
   */
  function decodeValue(): number {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);

    return result & 1 ? ~(result >> 1) : result >> 1;
  }
}

export function encodePolyline(points: GeoPoint[], precision = 5): string {
  const factor = 10 ** precision;
  let output = '';
  let prevLat = 0;
  let prevLng = 0;

  for (const point of points) {
    const lat = Math.round(point.latitude * factor);
    const lng = Math.round(point.longitude * factor);

    output += encodeValue(lat - prevLat) + encodeValue(lng - prevLng);

    prevLat = lat;
    prevLng = lng;
  }

  return output;

  function encodeValue(value: number): string {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let chunk = '';

    while (v >= 0x20) {
      chunk += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    chunk += String.fromCharCode(v + 63);

    return chunk;
  }
}
