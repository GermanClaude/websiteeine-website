import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';

import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

function buttonClasses(variant: ButtonVariant, size: ButtonSize, block: boolean, className?: string): string {
  return [
    'btn',
    variant === 'secondary' ? '' : `btn-${variant}`,
    size === 'md' ? '' : `btn-${size}`,
    block ? 'btn-block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', block = false, loading = false, icon, className, children, disabled, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={buttonClasses(variant, size, block, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : icon}
      {children}
    </button>
  );
});

export interface LinkButtonProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  icon?: ReactNode;
}

/** A router link styled as a button. */
export function LinkButton({ variant = 'secondary', size = 'md', block = false, icon, className, children, ...rest }: LinkButtonProps) {
  return (
    <Link className={buttonClasses(variant, size, block, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name (the button has no visible text). */
  label: string;
  children: ReactNode;
}

export function IconButton({ label, className, children, type, ...rest }: IconButtonProps) {
  return (
    <button type={type ?? 'button'} className={['icon-btn', className ?? ''].filter(Boolean).join(' ')} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}
