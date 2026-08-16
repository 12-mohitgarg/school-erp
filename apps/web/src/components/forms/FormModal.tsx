/**
 * Declarative create/edit form in a modal.
 *
 * Pages describe their fields as data and hand over a submit function; this
 * component owns state, validation display, server-error mapping and the
 * busy/disabled behaviour. That keeps every form in the app behaving
 * identically instead of each page re-implementing the same plumbing.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Alert, Button, Checkbox, Input, Modal, Select, Textarea } from '@/components/ui';
import { errorMessage } from '@/lib/api';

export type FieldType =
  | 'text' | 'textarea' | 'number' | 'email' | 'tel' | 'date' | 'time'
  | 'select' | 'checkbox' | 'password' | 'color' | 'url';

export interface Option {
  value: string;
  label: string;
}

export interface Field {
  name: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  /**
   * Static list, or a function of the current values for a dependent select
   * (sections that depend on the chosen class, for instance).
   */
  options?: Option[] | ((values: Record<string, unknown>) => Option[]);
  /**
   * Field names to clear when this one changes. Without it, picking class A,
   * choosing a section, then switching to class B would submit a section that
   * belongs to the wrong class.
   */
  resets?: string[];
  /** Half-width on desktop, so related fields sit side by side. */
  half?: boolean;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: string | number | boolean;
  /** Hide conditionally, based on the current values. */
  visibleWhen?: (values: Record<string, unknown>) => boolean;
}

export interface FormModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  fields: Field[];
  submitLabel?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Rendered above the fields — for context or a warning. */
  banner?: ReactNode;
  /**
   * Perform the write. Throw to surface an error; the modal stays open and the
   * message is shown inline.
   */
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  successMessage?: string;
}

/** Resolve a field's options, whether static or dependent on current values. */
function resolveOptions(field: Field, values: Record<string, unknown>): Option[] {
  if (!field.options) return [];
  return typeof field.options === 'function' ? field.options(values) : field.options;
}

function initialValues(fields: Field[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.defaultValue !== undefined) {
      values[field.name] = field.defaultValue;
      continue;
    }
    if (field.type === 'checkbox') {
      values[field.name] = false;
      continue;
    }
    // Selects default to their first option, except a dependent one whose
    // options are not known until another field is chosen.
    if (field.type === 'select' && Array.isArray(field.options)) {
      values[field.name] = field.options[0]?.value ?? '';
      continue;
    }
    values[field.name] = '';
  }
  return values;
}

export function FormModal({
  open, onClose, title, description, fields,
  submitLabel = 'Save', size = 'md', banner, onSubmit, successMessage,
}: FormModalProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(fields));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset on open so a previous attempt's values and errors never linger.
  useEffect(() => {
    if (open) {
      setValues(initialValues(fields));
      setErrors({});
      setFormError(null);
    }
    // `fields` is a literal defined inline by callers, so comparing it by
    // identity would reset on every render. Keyed on `open` only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const visibleFields = fields.filter((f) => !f.visibleWhen || f.visibleWhen(values));

  function setValue(name: string, value: unknown) {
    const field = fields.find((f) => f.name === name);

    setValues((prev) => {
      const next = { ...prev, [name]: value };
      // Clear any field that depends on this one, so a stale child selection
      // cannot be submitted against a changed parent.
      for (const dependent of field?.resets ?? []) next[dependent] = '';
      return next;
    });

    // Clear the field error as soon as the user edits it.
    setErrors((prev) => (prev[name] ? { ...prev, [name]: '' } : prev));
  }

  function validate(): boolean {
    const next: Record<string, string> = {};

    for (const field of visibleFields) {
      const value = values[field.name];

      if (field.required && (value === '' || value === undefined || value === null)) {
        next[field.name] = `${field.label} is required`;
        continue;
      }
      if (value === '' || value === undefined) continue;

      if (field.type === 'number') {
        const n = Number(value);
        if (!Number.isFinite(n)) next[field.name] = 'Enter a number';
        else if (field.min !== undefined && n < field.min) next[field.name] = `Must be at least ${field.min}`;
        else if (field.max !== undefined && n > field.max) next[field.name] = `Must be at most ${field.max}`;
      }

      if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
        next[field.name] = 'Enter a valid email address';
      }

      if (field.type === 'tel' && !/^\+?[1-9]\d{9,14}$/.test(String(value).replace(/[\s-]/g, ''))) {
        next[field.name] = 'Enter a valid phone number, e.g. +919876543210';
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit() {
    setFormError(null);
    if (!validate()) return;

    // Send only what is visible, and drop empty optional values so the server
    // sees an absent field rather than an empty string.
    const payload: Record<string, unknown> = {};
    for (const field of visibleFields) {
      const value = values[field.name];
      if (value === '' || value === undefined || value === null) continue;
      payload[field.name] = field.type === 'number' ? Number(value) : value;
    }

    setSaving(true);
    try {
      await onSubmit(payload);
      toast.success(successMessage ?? `${title} saved`);
      onClose();
    } catch (err) {
      setFormError(errorMessage(err, 'Could not save. Please check the form and try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} loading={saving}>{submitLabel}</Button>
        </>
      }
    >
      {banner}

      {formError && (
        <Alert tone="danger" className="mb-4" onDismiss={() => setFormError(null)}>
          {formError}
        </Alert>
      )}

      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
      >
        {visibleFields.map((field) => {
          /**
           * `key` is deliberately NOT part of this object. Spreading a `key`
           * into JSX makes React treat the element as un-keyed, so it
           * remounted on every keystroke and the input lost focus after a
           * single character. The key is passed explicitly on each element.
           */
          const common = {
            label: field.label,
            required: field.required,
            hint: field.hint,
            error: errors[field.name] || undefined,
            wrapperClassName: field.half ? 'sm:col-span-1' : 'sm:col-span-2',
          };

          if (field.type === 'select') {
            return (
              <Select
                key={field.name}
                {...common}
                value={String(values[field.name] ?? '')}
                onChange={(e) => setValue(field.name, e.target.value)}
                options={resolveOptions(field, values)}
                placeholder={field.placeholder}
              />
            );
          }

          if (field.type === 'textarea') {
            return (
              <Textarea
                key={field.name}
                {...common}
                value={String(values[field.name] ?? '')}
                onChange={(e) => setValue(field.name, e.target.value)}
                placeholder={field.placeholder}
              />
            );
          }

          if (field.type === 'checkbox') {
            return (
              <div key={field.name} className={field.half ? 'sm:col-span-1' : 'sm:col-span-2'}>
                <Checkbox
                  label={field.label}
                  description={field.hint}
                  checked={Boolean(values[field.name])}
                  onChange={(e) => setValue(field.name, e.target.checked)}
                />
              </div>
            );
          }

          return (
            <Input
              key={field.name}
              {...common}
              type={field.type ?? 'text'}
              value={String(values[field.name] ?? '')}
              onChange={(e) => setValue(field.name, e.target.value)}
              placeholder={field.placeholder}
              min={field.min}
              max={field.max}
              step={field.step}
            />
          );
        })}

        {/* Lets Enter submit without rendering a visible duplicate button. */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
      </form>
    </Modal>
  );
}
