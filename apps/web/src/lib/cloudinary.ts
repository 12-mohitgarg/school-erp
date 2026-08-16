/**
 * Cloudinary uploads.
 *
 * Files go from the browser straight to Cloudinary using an unsigned upload
 * preset — they never pass through our API. Two reasons that matter here:
 * a 10MB scan of a birth certificate does not occupy a Node worker for the
 * duration of the upload, and the browser gets real byte-level progress
 * instead of a spinner that sits at nothing until the whole request completes.
 *
 * What the API *does* do is verify, on the way in, that any URL we are asked to
 * store belongs to this cloud. That check is the reason a client-side upload is
 * safe: the browser can send us any string, so the server refuses anything that
 * is not ours.
 *
 * Configuration is fetched from `/settings/storage` rather than read from
 * `import.meta.env`, so storage can be re-pointed without rebuilding the app.
 * The Vite variables are kept as a fallback for a cold start before the API
 * answers, and for local development.
 */

export interface StorageConfig {
  provider: 'cloudinary';
  configured: boolean;
  cloudName: string | null;
  uploadPreset: string | null;
  folder: string;
  maxFileSizeMb: number;
  endpoints: { image: string; raw: string; video: string; auto: string } | null;
}

export type ResourceType = 'image' | 'raw' | 'video' | 'auto';

export interface UploadedAsset {
  /** Secure delivery URL — this is what gets persisted. */
  url: string;
  publicId: string;
  resourceType: 'image' | 'raw' | 'video';
  format: string | null;
  bytes: number;
  originalFilename: string;
  width: number | null;
  height: number | null;
}

/** Build-time fallback, used until the API's `/settings/storage` responds. */
const FALLBACK: StorageConfig = (() => {
  const cloudName = (import.meta.env['VITE_CLOUDINARY_CLOUD_NAME'] as string | undefined) ?? null;
  const uploadPreset =
    (import.meta.env['VITE_CLOUDINARY_UPLOAD_PRESET'] as string | undefined) ?? null;

  return {
    provider: 'cloudinary',
    configured: Boolean(cloudName && uploadPreset),
    cloudName,
    uploadPreset,
    folder: 'school-erp',
    maxFileSizeMb: 10,
    endpoints: cloudName
      ? {
          image: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
          raw: `https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`,
          video: `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`,
          auto: `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
        }
      : null,
  };
})();

let resolved: StorageConfig = FALLBACK;

/** Called once by the storage-config query, so uploads use live settings. */
export function setStorageConfig(config: StorageConfig | undefined): void {
  if (config?.configured) resolved = config;
}

export function getStorageConfig(): StorageConfig {
  return resolved;
}

/**
 * Which Cloudinary resource type suits this file?
 *
 * `raw` matters: PDFs and Office documents uploaded as `image` get mangled by
 * Cloudinary's image pipeline and come back undownloadable.
 */
export function resourceTypeFor(file: File): ResourceType {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return 'raw';
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadError';
  }
}

export interface UploadOptions {
  /** Sub-folder inside the configured root, e.g. `students/documents`. */
  folder?: string;
  resourceType?: ResourceType;
  /** 0-100, fired as the bytes go out. */
  onProgress?: (percent: number) => void;
  /** Abort an in-flight upload when the component unmounts. */
  signal?: AbortSignal;
  /** Tags recorded on the asset, useful for bulk cleanup in the Cloudinary UI. */
  tags?: string[];
}

/**
 * Upload one file and resolve with the stored asset.
 *
 * Uses `XMLHttpRequest` rather than `fetch` purely for upload progress:
 * `fetch` still has no portable way to observe request-body progress, and on a
 * school's connection a 10MB document is a genuinely long wait that needs a
 * real progress bar behind it.
 */
export function uploadToCloudinary(file: File, options: UploadOptions = {}): Promise<UploadedAsset> {
  const config = resolved;

  if (!config.configured || !config.endpoints || !config.uploadPreset) {
    return Promise.reject(
      new UploadError(
        'File storage is not configured. Add the Cloudinary cloud name and upload preset in Settings.',
      ),
    );
  }

  const maxBytes = config.maxFileSizeMb * 1024 * 1024;
  if (file.size > maxBytes) {
    return Promise.reject(
      new UploadError(
        `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is ${config.maxFileSizeMb}MB.`,
      ),
    );
  }
  if (file.size === 0) {
    return Promise.reject(new UploadError(`${file.name} is empty.`));
  }

  const resourceType = options.resourceType ?? resourceTypeFor(file);
  const endpoint = config.endpoints[resourceType];

  const form = new FormData();
  form.append('file', file);
  form.append('upload_preset', config.uploadPreset);
  form.append('folder', options.folder ? `${config.folder}/${options.folder}` : config.folder);
  if (options.tags?.length) form.append('tags', options.tags.join(','));

  return new Promise<UploadedAsset>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', endpoint);

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        options.onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };

    request.onload = () => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(request.responseText) as Record<string, unknown>;
      } catch {
        reject(new UploadError('Storage returned an unreadable response.'));
        return;
      }

      if (request.status < 200 || request.status >= 300) {
        // Cloudinary reports the actual cause here — usually a preset that is
        // signed rather than unsigned, which is worth surfacing verbatim.
        const detail = (payload['error'] as { message?: string } | undefined)?.message;
        reject(new UploadError(detail ?? `Upload failed (${request.status}).`));
        return;
      }

      options.onProgress?.(100);

      resolve({
        url: String(payload['secure_url']),
        publicId: String(payload['public_id']),
        resourceType: (payload['resource_type'] as UploadedAsset['resourceType']) ?? 'image',
        format: (payload['format'] as string | undefined) ?? null,
        bytes: Number(payload['bytes'] ?? file.size),
        originalFilename: (payload['original_filename'] as string | undefined) ?? file.name,
        width: (payload['width'] as number | undefined) ?? null,
        height: (payload['height'] as number | undefined) ?? null,
      });
    };

    request.onerror = () =>
      reject(new UploadError('Could not reach file storage. Check your connection.'));
    request.ontimeout = () => reject(new UploadError('The upload timed out.'));
    request.onabort = () => reject(new UploadError('Upload cancelled.'));

    options.signal?.addEventListener('abort', () => request.abort(), { once: true });

    request.send(form);
  });
}

/**
 * Rewrite a delivery URL to request a resized, auto-formatted image.
 *
 * Cloudinary applies transformations from the URL path, so a thumbnail costs
 * nothing extra to produce and avoids shipping a 4MB original into a 40px
 * avatar. Non-Cloudinary and non-image URLs are returned untouched.
 */
export function cloudinaryThumb(
  url: string | null | undefined,
  width: number,
  height = width,
): string | null {
  if (!url) return null;

  const marker = '/image/upload/';
  const at = url.indexOf(marker);
  if (at === -1) return url;

  const transform = `c_fill,g_auto,w_${width},h_${height},q_auto,f_auto`;
  return `${url.slice(0, at + marker.length)}${transform}/${url.slice(at + marker.length)}`;
}

/** Human-readable file size for upload lists. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
