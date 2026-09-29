/**
 * Overwatch proof verification (`GET /evidence/proof`, ARCHITECTURE §10.3). Public: anonymous
 * callers must supply the code; callers with proof:view_code additionally receive the expected
 * code. A valid proof establishes session identity only — it never proves cheating (R6).
 */
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';

import { Permission, ProofQuerySchema, type ProofQuery, type ProofResponse } from '@scpsl-trust/shared';

import { verifyProof } from '../../api/proof';
import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CodeBlock } from '../../components/CodeBlock';
import { DateTime } from '../../components/DateTime';
import { ErrorState } from '../../components/ErrorState';
import { Input } from '../../components/FormField';
import { KeyValueList } from '../../components/KeyValueList';
import { PageHeader } from '../../components/PageHeader';
import { zodIssuesToErrors } from '../../components/useZodForm';
import { datetimeLocalToMs, msToDatetimeLocal, parseUnixMs } from './proofTime';

interface ProofFormValues {
  server_id: string;
  player_id: string;
  spectator_id: string;
  /** datetime-local value, interpreted as UTC. */
  timestamp_local: string;
  /** unix milliseconds (kept in sync with `timestamp_local`). */
  timestamp_ms: string;
  code: string;
  session_id: string;
}

function initialValues(params: URLSearchParams): ProofFormValues {
  const ms = params.get('timestamp');
  const parsedMs = ms === null ? null : parseUnixMs(ms);
  return {
    server_id: params.get('server_id') ?? '',
    player_id: params.get('player_id') ?? '',
    spectator_id: params.get('spectator_id') ?? '',
    timestamp_local: parsedMs === null ? '' : msToDatetimeLocal(parsedMs),
    timestamp_ms: parsedMs === null ? '' : String(parsedMs),
    code: params.get('code') ?? '',
    session_id: params.get('session_id') ?? '',
  };
}

function ProofResult({ result, canViewCode }: { result: ProofResponse; canViewCode: boolean }) {
  return (
    <div className="stack-sm">
      <div className={result.valid ? 'alert alert-success' : 'alert alert-danger'} role="status">
        <div className="alert-title">{result.valid ? 'Valid proof' : 'Invalid or unknown proof'}</div>
        {result.valid
          ? 'The code belongs to an Overwatch session of this server, target and spectator covering the given time.'
          : 'No session of this server/target/spectator produced this code around the given time. The response deliberately does not say which field was wrong.'}
      </div>
      <KeyValueList
        items={[
          { label: 'Result', value: <Badge tone={result.valid ? 'success' : 'danger'} dot>{result.valid ? 'valid' : 'invalid'}</Badge> },
          { label: 'Server', value: <span className="mono">{result.server_id}</span> },
          { label: 'Target player', value: <span className="mono">{result.player_id}</span> },
          { label: 'Spectator', value: <span className="mono">{result.spectator_id}</span> },
          {
            label: 'Time window',
            value: (
              <span>
                <DateTime value={result.timestamp_window.start} /> → <DateTime value={result.timestamp_window.end} format="time" />
                {result.window_offset !== undefined && result.window_offset !== 0 && (
                  <span className="text-xs text-muted"> (matched the {result.window_offset === -1 ? 'previous' : 'next'} window — clock drift)</span>
                )}
              </span>
            ),
          },
          {
            label: 'Session',
            value:
              result.session_id === undefined ? null : (
                <Link to={`/overwatch/${encodeURIComponent(result.session_id)}`} className="mono text-xs">
                  {result.session_id}
                </Link>
              ),
          },
          ...(result.code !== undefined
            ? [
                {
                  key: 'expected',
                  label: 'Expected code',
                  value: (
                    <span className="stack-sm" style={{ gap: 2 }}>
                      <CodeBlock value={result.code} inline />
                      <span className="text-xs text-muted">Visible to reviewers only (proof:view_code); this access is audited.</span>
                    </span>
                  ),
                },
              ]
            : []),
        ]}
      />
      {canViewCode && result.code === undefined && <p className="text-xs text-muted">The backend did not return an expected code for this request.</p>}
      <p className="text-xs text-muted" style={{ margin: 0 }}>
        A valid proof shows that a recording was made by this spectator of this player during a verified Overwatch session. It proves <strong>identity</strong>{' '}
        only — it does not prove cheating and never changes a verdict (R6).
      </p>
    </div>
  );
}

export function ProofPage() {
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const [values, setValues] = useState<ProofFormValues>(() => initialValues(searchParams));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const canViewCode = auth.status === 'authenticated' && auth.hasPermission(Permission.PROOF_VIEW_CODE);

  const verify = useMutation({ mutationFn: (query: ProofQuery) => verifyProof(query) });

  const update = (patch: Partial<ProofFormValues>) => {
    setValues((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key];
      return next;
    });
  };

  const onLocalChange = (value: string) => {
    const ms = datetimeLocalToMs(value);
    update({ timestamp_local: value, timestamp_ms: ms === null ? values.timestamp_ms : String(ms) });
  };
  const onMsChange = (value: string) => {
    const ms = parseUnixMs(value);
    update({ timestamp_ms: value, timestamp_local: ms === null ? values.timestamp_local : msToDatetimeLocal(ms) });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const fieldErrors: Record<string, string> = {};
    const ms = parseUnixMs(values.timestamp_ms) ?? datetimeLocalToMs(values.timestamp_local);
    if (ms === null) fieldErrors.timestamp_ms = 'Enter the time as UTC date/time or unix milliseconds.';
    if (!canViewCode && values.code.trim() === '') fieldErrors.code = 'The proof code is required.';
    const parsed = ProofQuerySchema.safeParse({
      server_id: values.server_id.trim(),
      player_id: values.player_id.trim(),
      spectator_id: values.spectator_id.trim(),
      timestamp: ms === null ? '' : String(ms),
      code: values.code.trim() === '' ? undefined : values.code.trim(),
      session_id: values.session_id.trim() === '' ? undefined : values.session_id.trim(),
    });
    if (!parsed.success) {
      const mapped = zodIssuesToErrors(parsed.error.issues);
      for (const [key, message] of Object.entries(mapped)) {
        if (key === 'timestamp') fieldErrors.timestamp_ms ??= message;
        else fieldErrors[key] ??= message;
      }
    }
    if (Object.keys(fieldErrors).length > 0 || !parsed.success) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    verify.mutate(parsed.data);
  };

  return (
    <>
      <PageHeader
        title="Proof verification"
        subtitle="Check whether an Overwatch proof code shown in a recording belongs to a verified spectator session. No account needed."
      />
      <div className="grid-2">
        <Card title="Verify a proof code">
          <form className="form" onSubmit={submit} noValidate aria-label="Verify proof">
            <Input
              id="proof-server"
              label="Server id"
              mono
              value={values.server_id}
              onChange={(event) => update({ server_id: event.target.value })}
              placeholder="srv_7k4x92m8pq174kf9"
              hint="Shown in the proof overlay (srv_ + 16 characters)."
              error={errors.server_id}
              required
              autoComplete="off"
              spellCheck={false}
            />
            <div className="form-grid">
              <Input
                id="proof-player"
                label="Target player user id"
                mono
                value={values.player_id}
                onChange={(event) => update({ player_id: event.target.value })}
                placeholder="76561198000000001@steam"
                error={errors.player_id}
                required
                autoComplete="off"
                spellCheck={false}
              />
              <Input
                id="proof-spectator"
                label="Spectator user id"
                mono
                value={values.spectator_id}
                onChange={(event) => update({ spectator_id: event.target.value })}
                placeholder="76561198000000002@steam"
                error={errors.spectator_id}
                required
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="form-grid">
              <Input
                id="proof-timestamp-local"
                label="Timestamp (UTC)"
                type="datetime-local"
                step={1}
                value={values.timestamp_local}
                onChange={(event) => onLocalChange(event.target.value)}
                hint="The time shown in the overlay, in UTC."
                error={errors.timestamp_local}
              />
              <Input
                id="proof-timestamp-ms"
                label="Unix milliseconds"
                mono
                value={values.timestamp_ms}
                onChange={(event) => onMsChange(event.target.value)}
                placeholder="1790000000000"
                hint="Alternative to the date field; both stay in sync."
                error={errors.timestamp_ms}
                autoComplete="off"
              />
            </div>
            <div className="form-grid">
              <Input
                id="proof-code"
                label={canViewCode ? 'Proof code (optional for reviewers)' : 'Proof code'}
                mono
                value={values.code}
                onChange={(event) => update({ code: event.target.value.toUpperCase() })}
                placeholder="7K4-X92"
                hint="Six characters, e.g. 7K4-X92 (the dash is optional)."
                error={errors.code}
                required={!canViewCode}
                autoComplete="off"
                spellCheck={false}
                maxLength={7}
              />
              <Input
                id="proof-session"
                label="Session id (optional)"
                mono
                value={values.session_id}
                onChange={(event) => update({ session_id: event.target.value })}
                placeholder="uuid"
                hint="Narrows the check to one session."
                error={errors.session_id}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="form-actions">
              <Button type="submit" variant="primary" loading={verify.isPending}>
                Verify
              </Button>
            </div>
          </form>
        </Card>
        <Card title="Result">
          {verify.isError ? (
            <ErrorState error={verify.error} title="Verification failed" onRetry={() => verify.reset()} />
          ) : verify.data !== undefined ? (
            <ProofResult result={verify.data} canViewCode={canViewCode} />
          ) : (
            <div className="stack-sm text-sm text-muted">
              <p style={{ margin: 0 }}>
                While a staff member spectates a player in Overwatch mode, the plugin shows a rotating 6-character code (new one every few seconds)
                derived from a secret that only the backend and that server know. Anyone with a recording can verify the code here.
              </p>
              <p style={{ margin: 0 }}>
                The check accepts the neighbouring time windows to allow for small clock drift. Requests are rate limited (about 20 per minute).
              </p>
              <p style={{ margin: 0 }}>
                <strong>A valid proof does not prove cheating.</strong> It only proves who recorded whom, and when. Reviewers assess cheating separately from
                the evidence itself.
              </p>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

export default ProofPage;
