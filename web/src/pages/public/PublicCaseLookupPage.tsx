/**
 * Public case lookup form (no session required): navigates to the limited public view.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { isCaseNumber } from '@scpsl-trust/shared';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Input } from '../../components/FormField';
import { publicCasePath } from '../../components/Links';
import { PageHeader } from '../../components/PageHeader';

export function PublicCaseLookupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [value, setValue] = useState(searchParams.get('case') ?? '');
  const [error, setError] = useState<string | undefined>(undefined);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const caseNumber = value.trim().toUpperCase();
    if (!isCaseNumber(caseNumber)) {
      setError('Enter a case number in the form CASE-YYYY-NNNNNN, e.g. CASE-2026-001337.');
      return;
    }
    setError(undefined);
    void navigate(publicCasePath(caseNumber));
  };

  return (
    <>
      <PageHeader title="Public case lookup" subtitle="Look up the public status of a case by its number. No account needed." />
      <div className="grid-2">
        <Card title="Find a case">
          <form className="form" onSubmit={submit} noValidate>
            <Input
              id="public-case-number"
              label="Case number"
              mono
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setError(undefined);
              }}
              placeholder="CASE-2026-001337"
              error={error}
              autoComplete="off"
              spellCheck={false}
              required
            />
            <div className="form-actions">
              <Button type="submit" variant="primary">
                Look up
              </Button>
            </div>
          </form>
        </Card>
        <Card title="What the public view shows">
          <ul className="text-sm" style={{ margin: 0, paddingLeft: '1.2em' }}>
            <li>Case number, player identity, verdict and status, plus the public summary if a reviewer wrote one.</li>
            <li>Counts only: reports, evidence (verified of total) and independent server confirmations.</li>
            <li>No reports, no evidence files, no reviewer identities and no internal notes.</li>
            <li>A verdict is set by a reviewer based on verified evidence — reports and confirmations never change it automatically.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}

export default PublicCaseLookupPage;
