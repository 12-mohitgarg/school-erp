/**
 * File uploads.
 *
 * The same architecture the web app uses: the file goes **from the device
 * straight to Cloudinary** with an unsigned upload preset, and only the
 * resulting URL is sent to our API. A 10MB photo of a handwritten answer sheet
 * never occupies a Node worker, and the student sees real byte-level progress
 * rather than a button that sits frozen until the whole request completes.
 *
 * The safety of that arrangement rests entirely on the server: because the
 * client controls the URL string it submits, `assertStorableUrl` on the API
 * refuses any URL that is not from this cloud — including look-alike hosts like
 * `res.cloudinary.com.attacker.test` and other accounts on the real host. So
 * this module never needs to be trusted; it only needs to be convenient.
 *
 * Configuration comes from `GET /settings/storage` rather than a build-time
 * constant, so storage can be re-pointed without shipping a new binary.
 */

import { request } from '@/core/api/client';

export interface StorageConfig {
  provider: 'cloudinary';
  configured: boolean;
  cloudName: string | null;
  uploadPreset: string | null;
  folder: string;
  maxFileSizeMb: number;
  endpoints: { image: string; raw: string; video: string; auto: string } | null;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface UploadableFile {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
}

let cached: StorageConfig | null = null;
let inFlight: Promise<StorageConfig> | null = null;

/** Fetched once per launch; the values change about as often as the deployment. */
export async function storageConfig(): Promise<StorageConfig> {
  if (cached) return cached;

  inFlight ??= request<StorageConfig>('/settings/storage')
    .then((config) => {
      cached = config;
      return config;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * Upload a file and return its secure delivery URL.
 *
 * `XMLHttpRequest` rather than `fetch`, purely because it is the only thing in
 * React Native that reports upload progress. `fetch` resolves once, at the end,
 * which for a 10MB file over school Wi-Fi is a minute of nothing happening.
 */
export async function uploadToCloudinary(
  file: UploadableFile,
  onProgress?: (progress: UploadProgress) => void,
): Promise<string> {
  const config = await storageConfig();

  if (!config.configured || !config.endpoints || !config.uploadPreset) {
    throw new Error('File uploads are not configured for this school.');
  }

  const limitBytes = config.maxFileSizeMb * 1024 * 1024;
  if (file.size && file.size > limitBytes) {
    throw new Error(`Files must be under ${config.maxFileSizeMb} MB.`);
  }

  // `auto` lets Cloudinary classify images, PDFs and documents itself, which
  // matters because a student may attach any of the three.
  const endpoint = config.endpoints.auto;

  const form = new FormData();
  form.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  } as unknown as Blob);
  form.append('upload_preset', config.uploadPreset);
  form.append('folder', config.folder);

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open('POST', endpoint);
    xhr.timeout = 120_000;

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return;
      onProgress({
        loaded: event.loaded,
        total: event.total,
        percent: Math.round((event.loaded / event.total) * 100),
      });
    };

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Upload failed (${xhr.status}).`));
        return;
      }

      try {
        const payload = JSON.parse(xhr.responseText) as { secure_url?: string };
        if (!payload.secure_url) {
          reject(new Error('Upload succeeded but returned no URL.'));
          return;
        }
        resolve(payload.secure_url);
      } catch {
        reject(new Error('Upload returned an unreadable response.'));
      }
    };

    xhr.onerror = () => reject(new Error('Upload failed. Check your connection.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out. Try a smaller file.'));

    xhr.send(form);
  });
}
