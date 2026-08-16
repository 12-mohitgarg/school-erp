/**
 * Design-system primitives.
 *
 * Kept in one module because they are small, share vocabulary, and are almost
 * always imported together — `import { Card, Badge, Table } from '@/components/ui'`.
 * Button and Input live in their own files as they carry more logic.
 */

import {
  Fragment,
  useEffect,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, Inbox, X, XCircle, ChevronRight } from 'lucide-react';
import { cn, initials, avatarColor } from '@/lib/utils';

export { Button, type ButtonProps } from './Button';
export { Input, Select, Textarea, Checkbox, Switch } from './Input';

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({
  className,
  accent,
  interactive,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  /** Hairline gradient along the top edge, for the primary card on a page. */
  accent?: boolean;
  /** Lifts on hover — only for cards that are actually clickable. */
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-hairline bg-surface shadow-sm',
        accent && 'card-accent',
        interactive && 'card-interactive',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-hairline px-5 py-4', className)}>
      <div className="min-w-0">
        <h3 className="truncate text-base font-semibold text-ink">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center justify-end gap-2 border-t border-hairline bg-surface-sunken/50 px-5 py-3', className)}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-ink-muted ring-hairline',
  brand: 'bg-brand-500/10 text-brand-600 ring-brand-500/20',
  success: 'bg-success/10 text-success ring-success/20',
  warning: 'bg-warning/10 text-warning ring-warning/20',
  danger: 'bg-danger/10 text-danger ring-danger/20',
  info: 'bg-info/10 text-info ring-info/20',
};

export function Badge({
  tone = 'neutral',
  dot,
  className,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        BADGE_TONES[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

/**
 * Map a domain status onto a badge tone, so status colours stay consistent
 * across every table in the app rather than being chosen ad hoc per screen.
 */
export function statusTone(status: string): BadgeTone {
  const s = status.toUpperCase();
  if (['ACTIVE', 'PAID', 'PRESENT', 'APPROVED', 'PUBLISHED', 'COMPLETED', 'RESOLVED', 'AVAILABLE', 'SUCCESS', 'RETURNED', 'AC'].includes(s)) return 'success';
  if (['PENDING', 'PARTIALLY_PAID', 'LATE', 'HALF_DAY', 'PROCESSING', 'IN_PROGRESS', 'SCHEDULED', 'ISSUED', 'DRAFT', 'EVALUATION', 'ACKNOWLEDGED', 'MAINTENANCE'].includes(s)) return 'warning';
  if (['OVERDUE', 'ABSENT', 'REJECTED', 'CANCELLED', 'FAILED', 'SUSPENDED', 'LOST', 'ACTIVE_SOS', 'CRITICAL', 'INACTIVE'].includes(s)) return 'danger';
  if (['EXCUSED', 'INFO', 'RESERVED', 'TRANSFERRED', 'GRADUATED'].includes(s)) return 'info';
  return 'neutral';
}

/** `PARTIALLY_PAID` -> `Partially paid`. */
export function humanise(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge tone={statusTone(status)} dot className={className}>
      {humanise(status)}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

export function Avatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name: string;
  src?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const sizes = {
    xs: 'h-6 w-6 text-2xs',
    sm: 'h-8 w-8 text-xs',
    md: 'h-9 w-9 text-xs',
    lg: 'h-12 w-12 text-sm',
    xl: 'h-16 w-16 text-lg',
  };

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn('shrink-0 rounded-full object-cover ring-1 ring-hairline', sizes[size], className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      title={name}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white',
        avatarColor(name),
        sizes[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell renderer. Receives the row and its index. */
  render: (row: T, index: number) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Hidden below `md` — use for secondary columns so mobile stays readable. */
  hideOnMobile?: boolean;
  width?: string;
}

export function Table<T>({
  columns,
  rows,
  keyOf,
  loading,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyAction,
  onRowClick,
  className,
}: {
  columns: Array<Column<T>>;
  rows: T[];
  keyOf: (row: T, index: number) => string;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  onRowClick?: (row: T) => void;
  className?: string;
}) {
  if (loading) return <TableSkeleton columns={columns.length} />;

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  }

  const alignment = { left: 'text-left', right: 'text-right', center: 'text-center' };

  return (
    // Wide tables scroll inside their own container so the page never does.
    <div className={cn('scroll-x table-sticky-head', className)}>
      <table className="w-full min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-hairline">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                style={col.width ? { width: col.width } : undefined}
                className={cn(
                  'whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-subtle',
                  alignment[col.align ?? 'left'],
                  col.hideOnMobile && 'hidden md:table-cell',
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {rows.map((row, index) => (
            <tr
              key={keyOf(row, index)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              // Rows are reachable by keyboard when they act as links.
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              // Stagger only the first screenful; animating row 400 is wasted work.
              style={index < 12 ? { animationDelay: `${index * 22}ms` } : undefined}
              className={cn(
                'group transition-colors',
                index < 12 && 'animate-fade-in [animation-fill-mode:backwards]',
                onRowClick && 'row-focus cursor-pointer hover:bg-brand-500/[0.04]',
              )}
            >
              {columns.map((col, colIndex) => (
                <td
                  key={col.key}
                  className={cn(
                    'relative px-3 py-2.5 text-ink',
                    alignment[col.align ?? 'left'],
                    col.hideOnMobile && 'hidden md:table-cell',
                  )}
                >
                  {/* A brand rule slides in on the first cell to mark the hovered row. */}
                  {onRowClick && colIndex === 0 && (
                    <span
                      className="absolute inset-y-0 left-0 w-0.5 origin-top scale-y-0 rounded-r bg-brand-500 transition-transform duration-150 group-hover:scale-y-100"
                      aria-hidden="true"
                    />
                  )}
                  {col.render(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableSkeleton({ columns }: { columns: number }) {
  return (
    <div className="space-y-2 p-1" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 6 }, (_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: columns }, (_, c) => (
            <div key={c} className="skeleton h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export function Pagination({
  page,
  totalPages,
  total,
  limit,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-5 py-3">
      <p className="text-xs text-ink-muted nums">
        Showing <span className="font-medium text-ink">{from}</span>–
        <span className="font-medium text-ink">{to}</span> of{' '}
        <span className="font-medium text-ink">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          className="rounded-md px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-sunken disabled:pointer-events-none disabled:opacity-40"
        >
          Previous
        </button>
        <span className="px-2 text-xs text-ink-muted nums">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          className="rounded-md px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-sunken disabled:pointer-events-none disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty & error states
// ---------------------------------------------------------------------------

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="relative flex flex-col items-center justify-center overflow-hidden px-6 py-16 text-center">
      {/* Faint grid gives an otherwise blank panel some structure. */}
      <div className="grid-texture pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />

      <div className="relative mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-surface-sunken to-hairline/60 text-ink-subtle ring-1 ring-hairline">
        {icon ?? <Inbox className="h-5 w-5" aria-hidden="true" />}
      </div>
      <p className="relative text-sm font-medium text-ink">{title}</p>
      {description && (
        <p className="relative mt-1 max-w-sm text-sm text-ink-muted text-balance">{description}</p>
      )}
      {action && <div className="relative mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={<XCircle className="h-5 w-5 text-danger" aria-hidden="true" />}
      title="Could not load this"
      description={message}
      action={
        onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-hairline px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-surface-sunken"
          >
            Try again
          </button>
        )
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Alert
// ---------------------------------------------------------------------------

const ALERT_STYLES = {
  info: { wrap: 'border-info/25 bg-info/5 text-info', Icon: Info },
  success: { wrap: 'border-success/25 bg-success/5 text-success', Icon: CheckCircle2 },
  warning: { wrap: 'border-warning/25 bg-warning/5 text-warning', Icon: AlertTriangle },
  danger: { wrap: 'border-danger/25 bg-danger/5 text-danger', Icon: XCircle },
} as const;

export function Alert({
  tone = 'info',
  title,
  children,
  onDismiss,
  className,
}: {
  tone?: keyof typeof ALERT_STYLES;
  title?: string;
  children?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const { wrap, Icon } = ALERT_STYLES[tone];

  return (
    <div role="alert" className={cn('flex gap-3 rounded-lg border p-3.5', wrap, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className="text-sm font-semibold">{title}</p>}
        {children && <div className={cn('text-sm', title && 'mt-0.5 opacity-90')}>{children}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-m-1 h-fit rounded p-1 opacity-60 transition-opacity hover:opacity-100"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  /*
    `onClose` is almost always an inline arrow from the caller, so its identity
    changes on every render. Holding it in a ref keeps the Escape listener
    current without making the effects below depend on it — depending on it
    made them tear down and re-run on every keystroke, and the re-run pulled
    focus back to the dialog, so typing in any field stopped after one
    character.
  */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Escape to close, and lock body scroll. Keyed on `open` alone.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Move focus into the dialog exactly once, when it opens, so keyboard users
  // are not left behind it. Never on subsequent renders.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'relative z-10 flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-surface shadow-xl outline-none animate-slide-up sm:rounded-2xl',
          sizes[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-1 rounded-lg p-1.5 text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-hairline px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Page furniture
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  /** Soft brand wash behind the title — for landing screens like the dashboard. */
  aurora,
}: {
  title: string;
  description?: string;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  actions?: ReactNode;
  aurora?: boolean;
}) {
  return (
    <header className={cn('mb-5 animate-slide-up', aurora && 'aurora')}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-1.5 flex items-center gap-1 text-xs text-ink-subtle">
          {breadcrumbs.map((crumb, i) => (
            <Fragment key={crumb.label}>
              {i > 0 && <ChevronRight className="h-3 w-3" aria-hidden="true" />}
              {crumb.href ? (
                <a href={crumb.href} className="transition-colors hover:text-ink">
                  {crumb.label}
                </a>
              ) : (
                <span>{crumb.label}</span>
              )}
            </Fragment>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-ink-muted text-balance">{description}</p>
          )}
        </div>
        {/* Actions wrap onto their own line rather than squeezing the title. */}
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden="true" />;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}

/** Horizontal tab bar driven by controlled state. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('scroll-x border-b border-hairline', className)} role="tablist">
      <div className="flex gap-1">
        {tabs.map((tab) => {
          const active = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(tab.value)}
              className={cn(
                'relative whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors',
                active ? 'text-brand-600' : 'text-ink-muted hover:text-ink',
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="ml-1.5 rounded-full bg-surface-sunken px-1.5 py-0.5 text-2xs nums">
                  {tab.count}
                </span>
              )}
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-600" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
