import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'success' | 'link';
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-600/50',
  secondary:
    'bg-surface-sunken text-ink hover:bg-hairline active:bg-hairline/80 border border-hairline',
  outline:
    'border border-hairline bg-surface text-ink hover:bg-surface-sunken active:bg-hairline/60',
  ghost: 'text-ink-muted hover:bg-surface-sunken hover:text-ink active:bg-hairline/60',
  danger: 'bg-danger text-white shadow-sm hover:brightness-95 active:brightness-90',
  success: 'bg-success text-white shadow-sm hover:brightness-95 active:brightness-90',
  link: 'text-brand-600 underline-offset-4 hover:underline p-0 h-auto',
};

const SIZES: Record<Size, string> = {
  xs: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-9 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-6 text-base gap-2 rounded-xl',
  icon: 'h-9 w-9 rounded-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    loading = false,
    leftIcon,
    rightIcon,
    fullWidth,
    disabled,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      // A loading button must not be clickable, or a double-submit slips through.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium',
        'transition-[background-color,color,box-shadow,transform] duration-150',
        'disabled:pointer-events-none disabled:opacity-60',
        'active:scale-[0.985]',
        VARIANTS[variant],
        variant !== 'link' && SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
      ) : (
        leftIcon
      )}
      {children}
      {!loading && rightIcon}
    </button>
  );
});
