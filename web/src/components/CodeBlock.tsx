import { useId, useState, type ReactNode } from 'react';

import { Button } from './Button';
import { CopyButton } from './CopyButton';

export interface CodeBlockProps {
  value: string;
  /** Shows a copy button. */
  copy?: boolean;
  /** Single-line variant with the copy button on the right. */
  inline?: boolean;
  className?: string;
}

export function CodeBlock({ value, copy = true, inline = false, className }: CodeBlockProps) {
  if (inline) {
    return (
      <div className={['code-block code-block-inline', className ?? ''].filter(Boolean).join(' ')}>
        <code>{value}</code>
        {copy && <CopyButton value={value} />}
      </div>
    );
  }
  return (
    <div className={['code-block', className ?? ''].filter(Boolean).join(' ')}>
      {copy && (
        <div className="row-between mb-2">
          <span className="text-xs text-muted">Code</span>
          <CopyButton value={value} />
        </div>
      )}
      <pre>{value}</pre>
    </div>
  );
}

export interface SecretDisplayProps {
  title: string;
  /** A single secret or a list (e.g. recovery codes). */
  values: string | readonly string[];
  description?: ReactNode;
  /** Called after the user confirmed they saved the secret. */
  onAcknowledge?: () => void;
  acknowledgeLabel?: string;
  /** Name of the download file offered next to copy (optional). */
  downloadFilename?: string;
}

/**
 * One-time secret (registration token, recovery codes): copy button, optional download,
 * and an explicit "I saved it" confirmation before the value can be dismissed.
 */
export function SecretDisplay({
  title,
  values,
  description,
  onAcknowledge,
  acknowledgeLabel = 'Continue',
  downloadFilename,
}: SecretDisplayProps) {
  const [saved, setSaved] = useState(false);
  const checkboxId = useId();
  const list = typeof values === 'string' ? [values] : values;
  const copyValue = list.join('\n');

  const download = () => {
    const blob = new Blob([`${copyValue}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadFilename ?? 'secret.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="secret-display stack-sm" role="group" aria-label={title}>
      <div className="row-between">
        <strong>{title}</strong>
        <div className="row">
          <CopyButton value={copyValue} label={list.length > 1 ? 'Copy all' : 'Copy'} />
          {downloadFilename !== undefined && (
            <Button size="sm" onClick={download}>
              Download
            </Button>
          )}
        </div>
      </div>
      {description !== undefined && <div className="text-sm">{description}</div>}
      {typeof values === 'string' ? (
        <div className="secret-value">{values}</div>
      ) : (
        <ul className="secret-list">
          {values.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      )}
      <div className="text-xs">This is shown only once. It cannot be retrieved later.</div>
      {onAcknowledge !== undefined && (
        <div className="row-between mt-2">
          <label className="checkbox-field" htmlFor={checkboxId}>
            <input id={checkboxId} type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
            <span>I have saved this in a safe place</span>
          </label>
          <Button variant="primary" size="sm" disabled={!saved} onClick={onAcknowledge}>
            {acknowledgeLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
