/**
 * Limited public case view (`GET /public/cases/{caseNumber}`), accessible without a session.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';

import { Permission, isCaseNumber } from '@scpsl-trust/shared';

import { ApiError } from '../../api/client';
import { getPublicCase, publicKeys } from '../../api/public';
import { useAuth } from '../../auth/useAuth';
import { LinkButton } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { UserIdLink, casePath } from '../../components/Links';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/Spinner';
import { StatusBadge } from '../../components/StatusBadge';
import { PublicCaseView } from './PublicCaseView';

const LOOKUP_PATH = '/tools/case-lookup';

export function PublicCasePage() {
  const params = useParams<{ caseNumber: string }>();
  const caseNumber = decodeURIComponent(params.caseNumber ?? '').toUpperCase();
  const auth = useAuth();
  const valid = isCaseNumber(caseNumber);
  const publicCase = useQuery({ queryKey: publicKeys.detail(caseNumber), queryFn: () => getPublicCase(caseNumber), enabled: valid });
  const breadcrumbs = [{ label: 'Public case lookup', to: LOOKUP_PATH }, { label: caseNumber === '' ? 'Case' : caseNumber }];
  const staffLinkVisible = auth.status === 'authenticated' && (auth.hasPermission(Permission.CASE_VIEW_STAFF) || auth.hasServerMembership);

  if (!valid) {
    return (
      <>
        <PageHeader title="Public case" breadcrumbs={breadcrumbs} />
        <ErrorState error={new ApiError({ status: 404, code: 'NOT_FOUND', message: `"${caseNumber}" is not a valid case number (expected CASE-YYYY-NNNNNN).` })}>
          <p className="text-sm">
            <Link to={LOOKUP_PATH}>Look up another case</Link>
          </p>
        </ErrorState>
      </>
    );
  }
  if (publicCase.isPending) {
    return (
      <>
        <PageHeader title={caseNumber} breadcrumbs={breadcrumbs} />
        <LoadingState />
      </>
    );
  }
  if (publicCase.isError) {
    const notFound = ApiError.is(publicCase.error) && publicCase.error.isNotFound;
    return (
      <>
        <PageHeader title={caseNumber} breadcrumbs={breadcrumbs} />
        <ErrorState
          error={publicCase.error}
          title={notFound ? 'Case not found' : undefined}
          onRetry={notFound ? undefined : () => void publicCase.refetch()}
        >
          <p className="text-sm">
            {notFound && 'There is no case with this number, or public lookup is disabled on this instance. '}
            <Link to={LOOKUP_PATH}>Look up another case</Link>
          </p>
        </ErrorState>
      </>
    );
  }

  const data = publicCase.data;
  const playerLink =
    auth.status === 'authenticated' ? <UserIdLink userId={data.player.user_id} displayName={data.player.display_name} /> : undefined;

  return (
    <>
      <PageHeader
        title={data.case_number}
        documentTitle={`${data.case_number} (public)`}
        breadcrumbs={breadcrumbs}
        badges={
          <span className="row" style={{ marginLeft: 8, display: 'inline-flex' }}>
            <StatusBadge kind="verdict" value={data.verdict} dot />
            <StatusBadge kind="caseStatus" value={data.status} />
          </span>
        }
        subtitle="Public view — limited information. Reports, evidence files and reviewer identities are not shown."
        actions={
          staffLinkVisible ? (
            <LinkButton to={casePath(data.case_number)} variant="secondary">
              Open staff view
            </LinkButton>
          ) : (
            <LinkButton to={LOOKUP_PATH} variant="ghost">
              Look up another case
            </LinkButton>
          )
        }
      />
      <PublicCaseView data={data} playerLink={playerLink} />
    </>
  );
}

export default PublicCasePage;
