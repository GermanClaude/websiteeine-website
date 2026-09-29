import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

interface FieldChromeProps {
  id: string;
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: string | undefined;
  className?: string;
  children: ReactNode;
}

function FieldChrome({ id, label, required, hint, error, className, children }: FieldChromeProps) {
  return (
    <div className={['field', className ?? ''].filter(Boolean).join(' ')}>
      <label className="field-label" htmlFor={id}>
        {label}
        {required === true && (
          <span className="field-required" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {error !== undefined && error !== '' ? (
        <div className="field-error" id={`${id}-error`} role="alert">
          {error}
        </div>
      ) : (
        hint !== undefined && (
          <div className="field-hint" id={`${id}-hint`}>
            {hint}
          </div>
        )
      )}
    </div>
  );
}

function describedBy(id: string, error: string | undefined, hint: ReactNode): string | undefined {
  if (error !== undefined && error !== '') return `${id}-error`;
  if (hint !== undefined) return `${id}-hint`;
  return undefined;
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: ReactNode;
  error?: string | undefined;
  hint?: ReactNode;
  id?: string;
  /** Monospace input (codes, ids). */
  mono?: boolean;
  fieldClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, id, mono = false, fieldClassName, className, required, ...rest },
  ref,
) {
  const generated = useId();
  const inputId = id ?? generated;
  const invalid = error !== undefined && error !== '';
  return (
    <FieldChrome id={inputId} label={label} required={required} hint={hint} error={error} className={fieldClassName}>
      <input
        ref={ref}
        id={inputId}
        className={['input', mono ? 'input-mono' : '', className ?? ''].filter(Boolean).join(' ')}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy(inputId, error, hint)}
        required={required}
        {...rest}
      />
    </FieldChrome>
  );
});

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: ReactNode;
  options: readonly SelectOption[];
  /** Adds an empty first option with this label. */
  placeholder?: string;
  error?: string | undefined;
  hint?: ReactNode;
  id?: string;
  fieldClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, placeholder, error, hint, id, fieldClassName, className, required, ...rest },
  ref,
) {
  const generated = useId();
  const selectId = id ?? generated;
  const invalid = error !== undefined && error !== '';
  return (
    <FieldChrome id={selectId} label={label} required={required} hint={hint} error={error} className={fieldClassName}>
      <select
        ref={ref}
        id={selectId}
        className={['input', className ?? ''].filter(Boolean).join(' ')}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy(selectId, error, hint)}
        required={required}
        {...rest}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldChrome>
  );
});

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: ReactNode;
  error?: string | undefined;
  hint?: ReactNode;
  id?: string;
  fieldClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, id, fieldClassName, className, required, ...rest },
  ref,
) {
  const generated = useId();
  const areaId = id ?? generated;
  const invalid = error !== undefined && error !== '';
  return (
    <FieldChrome id={areaId} label={label} required={required} hint={hint} error={error} className={fieldClassName}>
      <textarea
        ref={ref}
        id={areaId}
        className={['input', className ?? ''].filter(Boolean).join(' ')}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy(areaId, error, hint)}
        required={required}
        {...rest}
      />
    </FieldChrome>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  label: ReactNode;
  error?: string | undefined;
  hint?: ReactNode;
  id?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, error, hint, id, ...rest }, ref) {
  const generated = useId();
  const inputId = id ?? generated;
  const invalid = error !== undefined && error !== '';
  return (
    <div className="field">
      <label className="checkbox-field" htmlFor={inputId}>
        <input ref={ref} id={inputId} type="checkbox" aria-invalid={invalid || undefined} aria-describedby={describedBy(inputId, error, hint)} {...rest} />
        <span>{label}</span>
      </label>
      {invalid ? (
        <div className="field-error" id={`${inputId}-error`} role="alert">
          {error}
        </div>
      ) : (
        hint !== undefined && (
          <div className="field-hint" id={`${inputId}-hint`}>
            {hint}
          </div>
        )
      )}
    </div>
  );
});
