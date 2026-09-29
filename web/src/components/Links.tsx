import { Link } from 'react-router';

import { parseUserId } from '@scpsl-trust/shared';

import { StatusBadge } from './StatusBadge';

/** Route of a player page for a canonical `<id>@<type>` user id. */
export function playerPath(userId: string): string {
  return `/players/${encodeURIComponent(userId)}`;
}

/** Route of a case page (staff view; the page falls back to the public view when not permitted). */
export function casePath(caseNumber: string): string {
  return `/cases/${encodeURIComponent(caseNumber)}`;
}

export function publicCasePath(caseNumber: string): string {
  return `/public/cases/${encodeURIComponent(caseNumber)}`;
}

export function serverPath(serverId: string): string {
  return `/servers/${encodeURIComponent(serverId)}`;
}

export interface UserIdLinkProps {
  userId: string;
  displayName?: string | null;
  /** Show the id type as a badge. */
  showType?: boolean;
}

/** Player link: display name (if any) plus the canonical id in monospace. */
export function UserIdLink({ userId, displayName, showType = false }: UserIdLinkProps) {
  const ref = parseUserId(userId);
  return (
    <span className="row" style={{ gap: '6px', display: 'inline-flex' }}>
      <Link to={playerPath(userId)} className="nowrap">
        {displayName !== null && displayName !== undefined && displayName !== '' ? (
          <>
            {displayName} <span className="mono text-muted text-xs">{userId}</span>
          </>
        ) : (
          <span className="mono">{userId}</span>
        )}
      </Link>
      {showType && ref !== null && <StatusBadge kind="playerIdType" value={ref.type} />}
    </span>
  );
}

export interface CaseLinkProps {
  caseNumber: string;
  /** Link to the public view instead of the staff view. */
  publicView?: boolean;
}

export function CaseLink({ caseNumber, publicView = false }: CaseLinkProps) {
  return (
    <Link to={publicView ? publicCasePath(caseNumber) : casePath(caseNumber)} className="mono nowrap">
      {caseNumber}
    </Link>
  );
}

export interface ServerLinkProps {
  serverId: string;
  name?: string | null;
}

export function ServerLink({ serverId, name }: ServerLinkProps) {
  return (
    <Link to={serverPath(serverId)} className="nowrap">
      {name !== null && name !== undefined && name !== '' ? name : <span className="mono">{serverId}</span>}
    </Link>
  );
}
