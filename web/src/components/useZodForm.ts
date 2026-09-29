/**
 * Minimal form state hook: values, per-field errors, validation with a shared zod schema and
 * mapping of server validation issues (`ApiError.details[]`) onto fields.
 */
import { useCallback, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { z } from 'zod';

import { ApiError, getErrorMessage } from '../api/client';

export type FieldErrors = Readonly<Record<string, string>>;

type StringKeys<T> = { [K in keyof T]: T[K] extends string | null | undefined ? K & string : never }[keyof T];
type BooleanKeys<T> = { [K in keyof T]: T[K] extends boolean | undefined ? K & string : never }[keyof T];

export interface FieldBinding {
  id: string;
  name: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
  error: string | undefined;
}

export interface CheckboxBinding {
  id: string;
  name: string;
  checked: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  error: string | undefined;
}

export interface UseZodFormOptions<S extends z.ZodType> {
  schema: S;
  initialValues: z.input<S>;
  /** Called with the parsed (validated) values. Thrown ApiErrors are mapped to fields automatically. */
  onSubmit?: (values: z.output<S>) => Promise<void> | void;
  /** Prefix stripped from server issue paths (default "body."). */
  serverPathPrefix?: string;
}

export interface ZodForm<S extends z.ZodType> {
  values: z.input<S>;
  errors: FieldErrors;
  /** Non-field error (root refine, unmapped server error). */
  formError: unknown;
  submitting: boolean;
  dirty: boolean;
  setValue: <K extends keyof z.input<S> & string>(name: K, value: z.input<S>[K]) => void;
  setValues: (patch: Partial<z.input<S>>) => void;
  setFieldError: (name: string, message: string | undefined) => void;
  setFormError: (error: unknown) => void;
  clearErrors: () => void;
  /** Validates and returns the parsed values, or null after populating `errors`. */
  validate: () => z.output<S> | null;
  /** Validate → onSubmit → map errors. Pass to `<form onSubmit>`. */
  handleSubmit: (event?: FormEvent) => Promise<void>;
  /** Maps `ApiError.details` issues to fields; returns true if at least one field matched. */
  applyApiError: (error: unknown) => boolean;
  reset: (values?: z.input<S>) => void;
  /** Props for text-like inputs/selects/textareas. */
  field: (name: StringKeys<z.input<S>>) => FieldBinding;
  /** Props for checkboxes. */
  checkbox: (name: BooleanKeys<z.input<S>>) => CheckboxBinding;
}

function issuePath(path: ReadonlyArray<PropertyKey>): string {
  return path.map((segment) => String(segment)).join('.');
}

/** Errors keyed by dotted path; the first message per path wins. Root issues go to `''`. */
export function zodIssuesToErrors(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issuePath(issue.path);
    if (errors[key] === undefined) errors[key] = issue.message;
  }
  return errors;
}

export function useZodForm<S extends z.ZodType>(options: UseZodFormOptions<S>): ZodForm<S> {
  const { schema, onSubmit, serverPathPrefix = 'body.' } = options;
  const initialRef = useRef(options.initialValues);
  const [values, setValuesState] = useState<z.input<S>>(options.initialValues);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormErrorState] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const idPrefix = useMemo(() => `f${Math.random().toString(36).slice(2, 8)}`, []);

  const setValue = useCallback(<K extends keyof z.input<S> & string>(name: K, value: z.input<S>[K]) => {
    setValuesState((current) => ({ ...(current as object), [name]: value }) as z.input<S>);
    setErrors((current) => {
      if (current[name] === undefined) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
    setDirty(true);
  }, []);

  const setValues = useCallback((patch: Partial<z.input<S>>) => {
    setValuesState((current) => ({ ...(current as object), ...(patch as object) }) as z.input<S>);
    setDirty(true);
  }, []);

  const setFieldError = useCallback((name: string, message: string | undefined) => {
    setErrors((current) => {
      const next = { ...current };
      if (message === undefined) delete next[name];
      else next[name] = message;
      return next;
    });
  }, []);

  const setFormError = useCallback((error: unknown) => setFormErrorState(error ?? null), []);

  const clearErrors = useCallback(() => {
    setErrors({});
    setFormErrorState(null);
  }, []);

  const validate = useCallback((): z.output<S> | null => {
    const result = schema.safeParse(values);
    if (result.success) {
      setErrors({});
      setFormErrorState(null);
      return result.data as z.output<S>;
    }
    const mapped = zodIssuesToErrors(result.error.issues);
    const root = mapped[''];
    delete mapped[''];
    setErrors(mapped);
    setFormErrorState(root ?? null);
    return null;
  }, [schema, values]);

  const applyApiError = useCallback(
    (error: unknown): boolean => {
      if (!ApiError.is(error)) {
        setFormErrorState(getErrorMessage(error));
        return false;
      }
      const issues = error.validationIssues;
      if (issues.length === 0) {
        setFormErrorState(error);
        return false;
      }
      const known = new Set(Object.keys(values as object));
      const fieldErrors: Record<string, string> = {};
      const unmatched: string[] = [];
      for (const issue of issues) {
        let path = issue.path;
        if (path.startsWith(serverPathPrefix)) path = path.slice(serverPathPrefix.length);
        const [head] = path.split('.');
        const target = known.has(path) ? path : head !== undefined && known.has(head) ? head : null;
        if (target === null) {
          unmatched.push(path.length > 0 ? `${path}: ${issue.message}` : issue.message);
        } else if (fieldErrors[target] === undefined) {
          fieldErrors[target] = issue.message;
        }
      }
      const matched = Object.keys(fieldErrors).length > 0;
      if (matched) setErrors((current) => ({ ...current, ...fieldErrors }));
      setFormErrorState(unmatched.length > 0 ? unmatched.join('; ') : matched ? null : error);
      return matched;
    },
    [values, serverPathPrefix],
  );

  const handleSubmit = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (submitting) return;
      const parsed = validate();
      if (parsed === null || onSubmit === undefined) return;
      setSubmitting(true);
      try {
        await onSubmit(parsed);
      } catch (error) {
        applyApiError(error);
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, validate, onSubmit, applyApiError],
  );

  const reset = useCallback((next?: z.input<S>) => {
    const target = next ?? initialRef.current;
    if (next !== undefined) initialRef.current = next;
    setValuesState(target);
    setErrors({});
    setFormErrorState(null);
    setDirty(false);
  }, []);

  const field = useCallback(
    (name: StringKeys<z.input<S>>): FieldBinding => {
      const raw = (values as Record<string, unknown>)[name];
      return {
        id: `${idPrefix}-${name}`,
        name,
        value: raw === null || raw === undefined ? '' : String(raw),
        onChange: (event) => setValue(name, event.target.value as z.input<S>[typeof name]),
        error: errors[name],
      };
    },
    [values, errors, idPrefix, setValue],
  );

  const checkbox = useCallback(
    (name: BooleanKeys<z.input<S>>): CheckboxBinding => ({
      id: `${idPrefix}-${name}`,
      name,
      checked: Boolean((values as Record<string, unknown>)[name]),
      onChange: (event) => setValue(name, event.target.checked as z.input<S>[typeof name]),
      error: errors[name],
    }),
    [values, errors, idPrefix, setValue],
  );

  return {
    values,
    errors,
    formError,
    submitting,
    dirty,
    setValue,
    setValues,
    setFieldError,
    setFormError,
    clearErrors,
    validate,
    handleSubmit,
    applyApiError,
    reset,
    field,
    checkbox,
  };
}
