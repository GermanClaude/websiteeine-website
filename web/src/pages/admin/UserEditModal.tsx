/**
 * Edit a user's role / status (PATCH /admin/users/{id}). Assignable roles are limited by the
 * shared canAssignRole matrix (user:manage → up to moderator; user:manage_admins → every role);
 * the backend enforces the same rule (R10).
 */
import { useQueryClient } from '@tanstack/react-query';

import {
  AdminUserUpdateRequestSchema,
  LIMITS,
  USER_ROLES,
  USER_STATUSES,
  canAssignRole,
  canChangeUserRole,
  type AdminUser,
  type UserRole,
} from '@scpsl-trust/shared';

import { adminUserKeys, updateUser } from '../../api/admin';
import { Button } from '../../components/Button';
import { FormError } from '../../components/ErrorState';
import { Select, Textarea } from '../../components/FormField';
import { Modal } from '../../components/Modal';
import { StatusBadge, humanizeEnum } from '../../components/StatusBadge';
import { useToast } from '../../components/Toasts';
import { useZodForm } from '../../components/useZodForm';

export interface UserEditModalProps {
  user: AdminUser;
  /** Global role of the acting user. */
  actorRole: UserRole;
  actorId: string;
  onClose: () => void;
}

/** Roles the actor may assign to a user who currently has `currentRole`. */
export function assignableRoles(actorRole: UserRole, currentRole: UserRole): readonly UserRole[] {
  return USER_ROLES.filter((role) => role === currentRole || canChangeUserRole(actorRole, currentRole, role));
}

const ROLE_HINTS: Readonly<Record<UserRole, string>> = {
  player: 'Reports, appeals, whitelist requests and account linking only.',
  server_admin: 'Can create servers; server actions come from team membership.',
  reviewer: 'Reviews cases and evidence, decides appeals; 2FA required.',
  moderator: 'Reviewer plus case creation, report management, appeal assignment and user listing; 2FA required.',
  admin: 'Full administration except managing admins and conflict overrides; 2FA required.',
  super_admin: 'Everything, including managing admins and appeal conflict overrides; 2FA required.',
};

export function UserEditModal({ user, actorRole, actorId, onClose }: UserEditModalProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const roles = assignableRoles(actorRole, user.role);
  const self = user.id === actorId;
  const form = useZodForm({
    schema: AdminUserUpdateRequestSchema,
    initialValues: { role: user.role, status: user.status, reason: '' },
    onSubmit: async (values) => {
      const body = {
        role: values.role !== undefined && values.role !== user.role ? values.role : undefined,
        status: values.status !== undefined && values.status !== user.status ? values.status : undefined,
        reason: values.reason,
      };
      if (body.role === undefined && body.status === undefined) {
        form.setFormError('Nothing changed.');
        return;
      }
      const updated = await updateUser(user.id, body);
      toast.success(`${updated.username} updated.`);
      onClose();
      await queryClient.invalidateQueries({ queryKey: adminUserKeys.all });
    },
  });
  const nextRole = form.values.role ?? user.role;
  const nextStatus = form.values.status ?? user.status;

  return (
    <Modal open title={`Edit ${user.username}`} onClose={onClose} locked={form.submitting}>
      <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate aria-label={`Edit user ${user.username}`}>
        <div className="text-sm row">
          <span className="text-muted">{user.email}</span>
          <StatusBadge kind="userRole" value={user.role} />
          <StatusBadge kind="userStatus" value={user.status} />
        </div>
        <Select
          label="Role"
          options={USER_ROLES.map((role) => ({ value: role, label: humanizeEnum(role), disabled: !roles.includes(role) }))}
          hint={ROLE_HINTS[nextRole]}
          disabled={roles.length <= 1}
          {...form.field('role')}
        />
        {!canAssignRole(actorRole, user.role) && (
          <div className="alert alert-warning">You cannot change this user: their current role is above what you may manage.</div>
        )}
        {nextRole !== user.role && (
          <div className="alert alert-info">
            Changing the role signs the user out of every session. Roles from reviewer upwards must enrol two-factor authentication before they can use their
            permissions.
          </div>
        )}
        <Select
          label="Status"
          options={USER_STATUSES.map((status) => ({ value: status, label: humanizeEnum(status) }))}
          hint={nextStatus === 'disabled' ? 'Disabled users cannot sign in; their sessions are revoked.' : undefined}
          disabled={self || !canAssignRole(actorRole, user.role)}
          {...form.field('status')}
        />
        {self && <div className="text-xs text-muted">You cannot disable your own account.</div>}
        <Textarea label="Reason (optional, audited)" rows={2} maxLength={LIMITS.REVOKE_REASON_MAX} {...form.field('reason')} />
        <FormError error={form.formError} />
        <div className="form-actions">
          <Button type="submit" variant={nextStatus === 'disabled' && user.status !== 'disabled' ? 'danger' : 'primary'} loading={form.submitting} disabled={!canAssignRole(actorRole, user.role)}>
            Save changes
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={form.submitting}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
