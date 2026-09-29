/**
 * /admin/users (user:view): user table with q/role/status filters; role/status editing limited by
 * canManageUser / canAssignRole from the shared permission matrix.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Permission, USER_ROLES, USER_STATUSES, canManageUser, type AdminUser } from '@scpsl-trust/shared';

import { adminUserKeys, listUsers } from '../../api/admin';
import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { DateTime, RelativeTime } from '../../components/DateTime';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { FilterBar, FilterSelect, SearchField } from '../../components/FilterBar';
import { UserIdLink } from '../../components/Links';
import { PageHeader } from '../../components/PageHeader';
import { Pagination } from '../../components/Pagination';
import { StatusBadge, humanizeEnum } from '../../components/StatusBadge';
import { useUrlFilters } from '../../components/useUrlFilters';
import { pickEnum } from '../servers/lib/forms';
import { UserEditModal } from './UserEditModal';

const FILTER_DEFAULTS = { q: '', role: '', status: '' };
const ROLE_OPTIONS = USER_ROLES.map((role) => ({ value: role, label: humanizeEnum(role) }));
const STATUS_OPTIONS = USER_STATUSES.map((status) => ({ value: status, label: humanizeEnum(status) }));

function isLocked(user: AdminUser, now = Date.now()): boolean {
  return user.locked_until !== null && Date.parse(user.locked_until) > now;
}

export function AdminUsersPage() {
  const auth = useAuth();
  const filters = useUrlFilters(FILTER_DEFAULTS);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const actorRole = auth.user?.role ?? null;
  const canManage = auth.hasAnyPermission([Permission.USER_MANAGE, Permission.USER_MANAGE_ADMINS]);

  const query = { ...filters.query, role: pickEnum(USER_ROLES, filters.values.role), status: pickEnum(USER_STATUSES, filters.values.status) };
  const users = useQuery({ queryKey: adminUserKeys.list(query), queryFn: () => listUsers(query), placeholderData: (previous) => previous });

  const columns: Column<AdminUser>[] = [
    { key: 'username', header: 'Username', render: (row) => <strong>{row.username}</strong>, sortValue: (row) => row.username },
    {
      key: 'email',
      header: 'Email',
      render: (row) => (
        <span className="row" style={{ gap: 6 }}>
          <span className="break-all">{row.email}</span>
          {row.email_verified_at === null && <Badge tone="warning">unverified</Badge>}
        </span>
      ),
    },
    { key: 'role', header: 'Role', render: (row) => <StatusBadge kind="userRole" value={row.role} />, sortValue: (row) => row.role },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <span className="row" style={{ gap: 6 }}>
          <StatusBadge kind="userStatus" value={row.status} dot />
          {isLocked(row) && (
            <Badge tone="warning" title={`Locked until ${row.locked_until ?? ''}`}>
              locked
            </Badge>
          )}
        </span>
      ),
      sortValue: (row) => row.status,
    },
    { key: 'mfa', header: '2FA', render: (row) => (row.mfa_enabled ? <Badge tone="success">on</Badge> : <Badge tone="muted">off</Badge>) },
    { key: 'reviewer', header: 'Reviewer #', render: (row) => (row.reviewer_number === null ? <span className="text-faint">—</span> : `#${row.reviewer_number}`) },
    {
      key: 'player',
      header: 'Linked player',
      render: (row) => (row.linked_player === null ? <span className="text-faint">—</span> : <UserIdLink userId={row.linked_player.user_id} displayName={row.linked_player.display_name} />),
    },
    { key: 'last_login', header: 'Last sign-in', render: (row) => <RelativeTime value={row.last_login_at} empty="never" />, sortValue: (row) => row.last_login_at },
    { key: 'created', header: 'Created', render: (row) => <DateTime value={row.created_at} format="date" />, sortValue: (row) => row.created_at },
  ];
  if (canManage && actorRole !== null) {
    columns.push({
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) =>
        canManageUser(actorRole, row.role) ? (
          <Button size="sm" onClick={() => setEditing(row)} aria-label={`Edit ${row.username}`}>
            Edit
          </Button>
        ) : (
          <span className="text-xs text-faint" title="Above your management scope">
            —
          </span>
        ),
    });
  }

  return (
    <>
      <PageHeader title="Users" subtitle="Accounts of this panel. Server-team memberships are managed on each server's Members tab." />
      <Card flush>
        <FilterBar onReset={filters.reset} isFiltered={filters.isFiltered}>
          <SearchField value={filters.values.q} onChange={(value) => filters.set('q', value)} placeholder="Username or email" />
          <FilterSelect id="user-role" label="Role" value={filters.values.role} onChange={(value) => filters.set('role', value)} options={ROLE_OPTIONS} />
          <FilterSelect id="user-status" label="Status" value={filters.values.status} onChange={(value) => filters.set('status', value)} options={STATUS_OPTIONS} />
        </FilterBar>
        <DataTable
          columns={columns}
          rows={users.data?.items ?? []}
          rowKey={(row) => row.id}
          loading={users.isPending}
          error={users.isError ? <ErrorState error={users.error} compact onRetry={() => void users.refetch()} /> : undefined}
          emptyState={<EmptyState title="No users" description={filters.isFiltered ? 'No user matches the filters.' : undefined} />}
        />
        {users.data !== undefined && (
          <Pagination
            page={users.data.page}
            pageSize={users.data.page_size}
            total={users.data.total}
            loaded={users.data.items.length}
            onPageChange={filters.setPage}
            onPageSizeChange={filters.setPageSize}
          />
        )}
      </Card>
      {editing !== null && actorRole !== null && auth.user !== null && (
        <UserEditModal key={editing.id} user={editing} actorRole={actorRole} actorId={auth.user.id} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

export default AdminUsersPage;
