import { useState, type ReactNode } from 'react';
import { AlertTriangle, Info, LogOut, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Modal, Button } from './index';
import { errorMessage } from '@/lib/api';

type Tone = 'danger' | 'warning' | 'info';

const TONES: Record<Tone, { icon: ReactNode; wrap: string; confirm: 'danger' | 'primary' }> = {
  danger: {
    icon: <Trash2 className="h-5 w-5" aria-hidden="true" />,
    wrap: 'bg-danger/10 text-danger',
    confirm: 'danger',
  },
  warning: {
    icon: <AlertTriangle className="h-5 w-5" aria-hidden="true" />,
    wrap: 'bg-warning/10 text-warning',
    confirm: 'danger',
  },
  info: {
    icon: <Info className="h-5 w-5" aria-hidden="true" />,
    wrap: 'bg-brand-500/10 text-brand-600',
    confirm: 'primary',
  },
};

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
  icon?: ReactNode;
  /** Runs on confirm. Throwing surfaces the error as a toast and keeps it open. */
  onConfirm: () => void | Promise<void>;
  successMessage?: string;
}

/**
 * Confirmation for actions that are hard to undo.
 *
 * Owns its own busy state so the caller cannot double-fire, and reports
 * failures rather than closing silently as if the action had succeeded.
 */
export function ConfirmDialog({
  open, onClose, title, message,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  tone = 'danger', icon, onConfirm, successMessage,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const palette = TONES[tone];

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      if (successMessage) toast.success(successMessage);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, 'That did not work. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{cancelLabel}</Button>
          <Button variant={palette.confirm} onClick={confirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3.5">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${palette.wrap}`}>
          {icon ?? palette.icon}
        </span>
        <div className="min-w-0 pt-0.5 text-sm text-ink-muted">{message}</div>
      </div>
    </Modal>
  );
}

/** Pre-configured sign-out confirmation, used by the app shell. */
export function SignOutDialog({
  open, onClose, onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      tone="info"
      icon={<LogOut className="h-5 w-5" aria-hidden="true" />}
      title="Sign out?"
      message="You will need to sign in again to get back to your dashboard. Any unsaved changes on this page will be lost."
      confirmLabel="Sign out"
      cancelLabel="Stay signed in"
      onConfirm={onConfirm}
    />
  );
}
