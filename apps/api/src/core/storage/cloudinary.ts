/**
 * Cloud storage — Cloudinary.
 *
 * Upload path: the browser posts the file straight to Cloudinary using an
 * unsigned upload preset, then sends us the resulting secure URL and public id.
 * Nothing binary passes through the API, which keeps request bodies small and
 * means a slow upload never occupies a Node worker.
 *
 * That design puts one obligation on the server: a client could send *any*
 * URL, so every stored file reference is validated to be a Cloudinary URL
 * belonging to our own cloud before it is written to the database. Without
 * that check the document tables become an open redirect / SSRF surface.
 *
 * Deletion is the one operation that must be signed, so it happens here.
 */

import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../errors/AppError.js';
import { moduleLogger } from '../logger.js';

const log = moduleLogger('storage');

export interface StorageConfig {
  provider: 'cloudinary';
  configured: boolean;
  cloudName: string | null;
  uploadPreset: string | null;
  folder: string;
  maxFileSizeMb: number;
  /** Endpoints the browser posts to, one per Cloudinary resource type. */
  endpoints: { image: string; raw: string; video: string; auto: string } | null;
}

export function isStorageConfigured(): boolean {
  return Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_UPLOAD_PRESET);
}

/** Public configuration handed to the browser so it can upload directly. */
export function storageConfig(): StorageConfig {
  const cloud = env.CLOUDINARY_CLOUD_NAME ?? null;

  return {
    provider: 'cloudinary',
    configured: isStorageConfigured(),
    cloudName: cloud,
    uploadPreset: env.CLOUDINARY_UPLOAD_PRESET ?? null,
    folder: env.CLOUDINARY_FOLDER,
    maxFileSizeMb: env.UPLOAD_MAX_MB,
    endpoints: cloud
      ? {
          image: `https://api.cloudinary.com/v1_1/${cloud}/image/upload`,
          raw: `https://api.cloudinary.com/v1_1/${cloud}/raw/upload`,
          video: `https://api.cloudinary.com/v1_1/${cloud}/video/upload`,
          auto: `https://api.cloudinary.com/v1_1/${cloud}/auto/upload`,
        }
      : null,
  };
}

/**
 * Is this a delivery URL from our own Cloudinary cloud?
 *
 * Parsed with `URL` rather than matched with a regex: a prefix match would
 * accept `https://res.cloudinary.com.attacker.test/...`.
 */
export function isCloudinaryUrl(value: string): boolean {
  const cloud = env.CLOUDINARY_CLOUD_NAME;
  if (!cloud) return false;

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (url.hostname !== 'res.cloudinary.com') return false;
    // Path is always /<cloud-name>/<resource-type>/<delivery-type>/...
    return url.pathname.startsWith(`/${cloud}/`);
  } catch {
    return false;
  }
}

/**
 * Validate a URL that is about to be persisted as a file reference.
 *
 * When storage is not configured at all we accept any https URL, so a
 * deployment that has not set Cloudinary up yet can still record links to
 * files hosted elsewhere. Once configured, the check is strict.
 */
export function assertStorableUrl(value: string, field = 'fileUrl'): string {
  if (!isStorageConfigured()) {
    if (/^https:\/\//i.test(value)) return value;
    throw AppError.badRequest(`${field} must be an https URL`);
  }

  if (!isCloudinaryUrl(value)) {
    throw AppError.badRequest(
      `${field} must be a Cloudinary URL uploaded through this application`,
    );
  }
  return value;
}

/**
 * Recover the public id from a delivery URL.
 *
 * Cloudinary URLs look like:
 *   https://res.cloudinary.com/<cloud>/image/upload/v1712345678/folder/name.jpg
 * The version segment is optional, and the extension is not part of the id
 * for image/video (but *is* for raw), so callers should prefer the public id
 * the upload response gave them. This is a fallback for older rows.
 */
export function publicIdFromUrl(value: string): string | null {
  if (!isCloudinaryUrl(value)) return null;

  try {
    const { pathname } = new URL(value);
    const segments = pathname.split('/').filter(Boolean);
    // [cloud, resourceType, deliveryType, ...rest]
    const rest = segments.slice(3);
    if (rest.length === 0) return null;

    // Drop a leading version marker such as `v1712345678`.
    if (/^v\d+$/.test(rest[0]!)) rest.shift();
    if (rest.length === 0) return null;

    const joined = rest.join('/');
    const resourceType = segments[1];
    // Raw assets keep their extension as part of the id; images do not.
    return resourceType === 'raw' ? joined : joined.replace(/\.[^./]+$/, '');
  } catch {
    return null;
  }
}

export type ResourceType = 'image' | 'raw' | 'video';

/**
 * Delete an asset. Signed with the API secret, so it never runs in a browser.
 *
 * Returns false rather than throwing when credentials are absent: a missing
 * secret should not block deleting the database row that pointed at the file.
 */
export async function destroyAsset(
  publicId: string,
  resourceType: ResourceType = 'image',
): Promise<boolean> {
  const cloud = env.CLOUDINARY_CLOUD_NAME;
  const apiKey = env.CLOUDINARY_API_KEY;
  const apiSecret = env.CLOUDINARY_API_SECRET;

  if (!cloud || !apiKey || !apiSecret) {
    log.warn({ publicId }, 'Cloudinary delete skipped — API credentials not configured');
    return false;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  // Cloudinary signs the alphabetically-sorted parameter string plus the secret.
  const signature = crypto
    .createHash('sha1')
    .update(`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`)
    .digest('hex');

  const body = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    api_key: apiKey,
    signature,
  });

  try {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloud}/${resourceType}/destroy`,
      { method: 'POST', body },
    );

    const result = (await response.json()) as { result?: string };
    const ok = result.result === 'ok' || result.result === 'not found';

    if (!ok) log.warn({ publicId, result: result.result }, 'Cloudinary delete failed');
    return ok;
  } catch (err) {
    log.error({ err, publicId }, 'Cloudinary delete threw');
    return false;
  }
}
