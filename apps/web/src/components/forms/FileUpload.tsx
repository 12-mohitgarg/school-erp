/**
 * File upload controls backed by Cloudinary.
 *
 * Two components, one mechanism:
 *   * `FileUpload` — drop zone for documents, reports progress per file.
 *   * `ImageUpload` — square avatar/logo picker with an inline preview.
 *
 * Both upload directly to Cloudinary and hand the caller the resulting asset;
 * persisting the URL against a record is the caller's job, because only it
 * knows which endpoint that is.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Upload, X, FileText, ImageIcon, Loader2, AlertCircle, Check } from 'lucide-react';
import { toast } from 'sonner';
import {
  uploadToCloudinary,
  cloudinaryThumb,
  formatBytes,
  getStorageConfig,
  UploadError,
  type UploadedAsset,
} from '@/lib/cloudinary';
import { cn } from '@/lib/utils';
import { Alert, Button } from '@/components/ui';

interface PendingUpload {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

export interface FileUploadProps {
  /** Fired once per file, as soon as that file finishes. */
  onUploaded: (asset: UploadedAsset) => void | Promise<void>;
  /** Sub-folder within the configured Cloudinary root. */
  folder?: string;
  /** `accept` attribute — e.g. `image/*,application/pdf`. */
  accept?: string;
  multiple?: boolean;
  label?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}

export function FileUpload({
  onUploaded,
  folder,
  accept = 'image/*,application/pdf',
  multiple = true,
  label = 'Upload files',
  hint,
  disabled,
  className,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const inputId = useId();

  const config = getStorageConfig();

  // Abort anything still in flight if the form is closed mid-upload, rather
  // than letting the request complete and call back into an unmounted tree.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;

      const controller = new AbortController();
      abortRef.current = controller;

      const chosen = multiple ? [...files] : files[0] ? [files[0]] : [];

      // Uploaded one at a time on purpose: a school's uplink is the bottleneck,
      // and five parallel uploads make all five slow rather than finishing the
      // first quickly.
      for (const file of chosen) {
        const id = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        setPending((prev) => [
          ...prev,
          { id, name: file.name, size: file.size, progress: 0, status: 'uploading' },
        ]);

        try {
          const asset = await uploadToCloudinary(file, {
            ...(folder ? { folder } : {}),
            signal: controller.signal,
            onProgress: (progress) =>
              setPending((prev) => prev.map((p) => (p.id === id ? { ...p, progress } : p))),
          });

          await onUploaded(asset);

          setPending((prev) =>
            prev.map((p) => (p.id === id ? { ...p, status: 'done', progress: 100 } : p)),
          );

          // Clear the completed row after a beat — long enough to register as
          // "done", short enough not to accumulate.
          setTimeout(() => setPending((prev) => prev.filter((p) => p.id !== id)), 2_500);
        } catch (err) {
          const message = err instanceof UploadError ? err.message : 'Upload failed';
          setPending((prev) =>
            prev.map((p) => (p.id === id ? { ...p, status: 'error', error: message } : p)),
          );
          toast.error(`Could not upload ${file.name}`, { description: message });
        }
      }
    },
    [folder, multiple, onUploaded],
  );

  if (!config.configured) {
    return (
      <Alert tone="warning" title="File storage is not configured">
        Add a Cloudinary cloud name and unsigned upload preset before uploading files.
      </Alert>
    );
  }

  return (
    <div className={className}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) void handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          'rounded-xl border-2 border-dashed p-6 text-center transition-colors',
          dragging
            ? 'border-brand-500 bg-brand-500/5'
            : 'border-hairline bg-surface-sunken/40 hover:border-brand-500/50',
          disabled && 'pointer-events-none opacity-60',
        )}
      >
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600">
          <Upload className="h-5 w-5" aria-hidden="true" />
        </div>

        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          {hint ?? `Drag and drop, or browse. Up to ${config.maxFileSizeMb}MB per file.`}
        </p>

        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          className="sr-only"
          onChange={(e) => {
            void handleFiles(e.target.files);
            // Reset so choosing the same file twice still fires a change.
            e.target.value = '';
          }}
        />

        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          Choose {multiple ? 'files' : 'a file'}
        </Button>
      </div>

      {pending.length > 0 && (
        <ul className="mt-3 space-y-2">
          {pending.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-lg border border-hairline bg-surface px-3 py-2"
            >
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                  item.status === 'error'
                    ? 'bg-danger/10 text-danger'
                    : item.status === 'done'
                      ? 'bg-success/10 text-success'
                      : 'bg-brand-500/10 text-brand-600',
                )}
              >
                {item.status === 'uploading' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {item.status === 'done' && <Check className="h-4 w-4" aria-hidden="true" />}
                {item.status === 'error' && <AlertCircle className="h-4 w-4" aria-hidden="true" />}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-ink">{item.name}</p>
                {item.status === 'error' ? (
                  <p className="truncate text-2xs text-danger">{item.error}</p>
                ) : (
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-sunken">
                    <div
                      className={cn(
                        'h-full rounded-full transition-[width] duration-200',
                        item.status === 'done' ? 'bg-success' : 'bg-brand-500',
                      )}
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}
              </div>

              <span className="shrink-0 text-2xs text-ink-subtle nums">{formatBytes(item.size)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface ImageUploadProps {
  value: string | null | undefined;
  onChange: (asset: UploadedAsset | null) => void | Promise<void>;
  folder?: string;
  label?: string;
  hint?: string;
  /** Rendered preview size in pixels. */
  size?: number;
  rounded?: 'full' | 'lg';
  disabled?: boolean;
}

/** Single-image picker with an inline preview — avatars, logos, student photos. */
export function ImageUpload({
  value,
  onChange,
  folder,
  label = 'Image',
  hint,
  size = 96,
  rounded = 'lg',
  disabled,
}: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const config = getStorageConfig();
  // Request a right-sized derivative rather than shipping the original.
  const preview = cloudinaryThumb(value, size * 2);

  async function pick(file: File | undefined) {
    if (!file) return;

    setProgress(0);
    try {
      const asset = await uploadToCloudinary(file, {
        ...(folder ? { folder } : {}),
        resourceType: 'image',
        onProgress: setProgress,
      });
      await onChange(asset);
      toast.success('Image uploaded');
    } catch (err) {
      toast.error('Could not upload', {
        description: err instanceof UploadError ? err.message : 'Please try again.',
      });
    } finally {
      setProgress(null);
    }
  }

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-ink-muted">{label}</p>

      <div className="flex items-center gap-4">
        <div
          className={cn(
            'relative flex shrink-0 items-center justify-center overflow-hidden border border-hairline bg-surface-sunken',
            rounded === 'full' ? 'rounded-full' : 'rounded-xl',
          )}
          style={{ width: size, height: size }}
        >
          {preview ? (
            <img src={preview} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="h-6 w-6 text-ink-subtle" aria-hidden="true" />
          )}

          {progress !== null && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-950/60 text-white">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span className="text-2xs nums">{progress}%</span>
            </div>
          )}
        </div>

        <div className="min-w-0">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={disabled || !config.configured}
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || progress !== null || !config.configured}
              onClick={() => inputRef.current?.click()}
              leftIcon={<Upload className="h-3.5 w-3.5" />}
            >
              {value ? 'Replace' : 'Upload'}
            </Button>

            {value && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled || progress !== null}
                onClick={() => void onChange(null)}
                leftIcon={<X className="h-3.5 w-3.5" />}
              >
                Remove
              </Button>
            )}
          </div>

          <p className="mt-1.5 text-2xs text-ink-subtle">
            {config.configured
              ? (hint ?? `PNG or JPG, up to ${config.maxFileSizeMb}MB.`)
              : 'File storage is not configured.'}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Icon matching a stored document's type, for file lists. */
export function FileTypeIcon({ mimeType }: { mimeType?: string | null }) {
  const isImage = mimeType?.startsWith('image/');
  const Icon = isImage ? ImageIcon : FileText;

  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-ink-subtle">
      <Icon className="h-4 w-4" aria-hidden="true" />
    </span>
  );
}
