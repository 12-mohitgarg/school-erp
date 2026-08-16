import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Shared chrome so inputs, selects and textareas stay visually identical. */
const FIELD_BASE =
  'w-full rounded-lg border bg-surface px-3 text-ink placeholder:text-ink-subtle ' +
  'transition-colors duration-150 disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-60';

const FIELD_OK = 'border-hairline hover:border-ink-subtle/60 focus:border-brand-500';
const FIELD_ERROR = 'border-danger focus:border-danger focus-visible:ring-danger';

interface FieldWrapperProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}

function FieldWrapper({ label, hint, error, required, htmlFor, children, className }: FieldWrapperProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
          {label}
          {required && (
            <span className="ml-0.5 text-danger" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {children}
      {/* `role="alert"` so screen readers announce validation failures. */}
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-danger">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
  wrapperClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, hint, error, leftIcon, rightSlot, required, id, wrapperClassName, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <FieldWrapper
      label={label}
      hint={hint}
      error={error}
      required={required}
      htmlFor={fieldId}
      className={wrapperClassName}
    >
      <div className="relative">
        {leftIcon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle">
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          className={cn(
            FIELD_BASE,
            'h-9 text-sm',
            error ? FIELD_ERROR : FIELD_OK,
            leftIcon && 'pl-9',
            rightSlot && 'pr-10',
            className,
          )}
          {...props}
        />
        {rightSlot && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2">{rightSlot}</span>
        )}
      </div>
    </FieldWrapper>
  );
});

// ---------------------------------------------------------------------------

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
  wrapperClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, label, hint, error, options, placeholder, required, id, wrapperClassName, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <FieldWrapper
      label={label}
      hint={hint}
      error={error}
      required={required}
      htmlFor={fieldId}
      className={wrapperClassName}
    >
      <select
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        className={cn(
          FIELD_BASE,
          'h-9 cursor-pointer appearance-none bg-no-repeat pr-9 text-sm',
          error ? FIELD_ERROR : FIELD_OK,
          className,
        )}
        style={{
          // Inline chevron avoids shipping an icon just for the select arrow.
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
          backgroundPosition: 'right 0.6rem center',
          backgroundSize: '1rem',
        }}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldWrapper>
  );
});

// ---------------------------------------------------------------------------

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  wrapperClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, label, hint, error, required, id, rows = 4, wrapperClassName, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <FieldWrapper
      label={label}
      hint={hint}
      error={error}
      required={required}
      htmlFor={fieldId}
      className={wrapperClassName}
    >
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        className={cn(FIELD_BASE, 'resize-y py-2 text-sm', error ? FIELD_ERROR : FIELD_OK, className)}
        {...props}
      />
    </FieldWrapper>
  );
});

// ---------------------------------------------------------------------------

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
  description?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, label, description, id, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <div className="flex items-start gap-2.5">
      <input
        ref={ref}
        id={fieldId}
        type="checkbox"
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-hairline text-brand-600',
          'focus:ring-2 focus:ring-brand-500 focus:ring-offset-0',
          className,
        )}
        {...props}
      />
      {(label || description) && (
        <div className="min-w-0">
          {label && (
            <label htmlFor={fieldId} className="cursor-pointer text-sm text-ink">
              {label}
            </label>
          )}
          {description && <p className="text-xs text-ink-subtle">{description}</p>}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
  const id = useId();

  return (
    <div className="flex items-start justify-between gap-4">
      {(label || description) && (
        <div className="min-w-0">
          {label && (
            <label htmlFor={id} className="text-sm font-medium text-ink">
              {label}
            </label>
          )}
          {description && <p className="text-xs text-ink-subtle">{description}</p>}
        </div>
      )}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-brand-600' : 'bg-ink-subtle/40',
        )}
      >
        <span
          className={cn(
            'pointer-events-none absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
            checked ? 'translate-x-4.5' : 'translate-x-0.5',
          )}
          style={{ transform: checked ? 'translateX(1.125rem)' : 'translateX(0.125rem)' }}
        />
      </button>
    </div>
  );
}
