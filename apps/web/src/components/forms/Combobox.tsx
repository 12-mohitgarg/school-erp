/**
 * Searchable single-select.
 *
 * A plain `<select>` is unusable once a list runs to hundreds of entries —
 * picking a student out of 300 is the motivating case. This filters as you
 * type, supports keyboard navigation, and shows a secondary line so entries
 * that share a name stay distinguishable.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ComboboxItem {
  value: string;
  label: string;
  /** Secondary line — admission number, invoice total, and so on. */
  detail?: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  items: ComboboxItem[];
  placeholder?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  loading?: boolean;
  emptyMessage?: string;
  className?: string;
}

export function Combobox({
  label, value, onChange, items, placeholder = 'Search…',
  hint, error, required, loading, emptyMessage = 'No matches', className,
}: ComboboxProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = items.find((item) => item.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 100);
    return items
      .filter((item) =>
        item.label.toLowerCase().includes(q) || item.detail?.toLowerCase().includes(q),
      )
      // Cap the rendered list; typing narrows it further.
      .slice(0, 100);
  }, [items, query]);

  // Close when focus or a click leaves the component.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function choose(item: ComboboxItem) {
    if (item.disabled) return;
    onChange(item.value);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = filtered[highlighted];
      if (item) choose(item);
    } else if (event.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }

  return (
    <div className={cn('space-y-1.5', className)} ref={containerRef}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          {label}
          {required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
        </label>
      )}

      <div className="relative">
        <button
          id={id}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-lg border bg-surface px-3 text-left text-sm transition-colors',
            error ? 'border-danger' : 'border-hairline hover:border-ink-subtle/60',
          )}
        >
          <span className={cn('min-w-0 flex-1 truncate', selected ? 'text-ink' : 'text-ink-subtle')}>
            {loading ? 'Loading…' : (selected?.label ?? placeholder)}
          </span>

          {selected && !required && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear selection"
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
              className="rounded p-0.5 text-ink-subtle hover:text-ink"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
        </button>

        {open && (
          <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-hairline bg-surface shadow-lg animate-scale-in">
            <div className="flex items-center gap-2 border-b border-hairline px-3">
              <Search className="h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setHighlighted(0); }}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                className="h-9 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
              />
            </div>

            <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <li className="px-3 py-4 text-center text-sm text-ink-subtle">{emptyMessage}</li>
              ) : (
                filtered.map((item, index) => (
                  <li key={item.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={item.value === value}
                      disabled={item.disabled}
                      onClick={() => choose(item)}
                      onMouseEnter={() => setHighlighted(index)}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                        index === highlighted && 'bg-surface-sunken',
                        item.disabled && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ink">{item.label}</span>
                        {item.detail && (
                          <span className="block truncate text-xs text-ink-subtle">{item.detail}</span>
                        )}
                      </span>
                      {item.value === value && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden="true" />
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
