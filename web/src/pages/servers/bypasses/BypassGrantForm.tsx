/**
 * Direct bypass grant (server scope: POST /servers/{id}/bypasses; global: POST /admin/bypasses).
 */
import { z } from 'zod';

import {
  BYPASS_TYPES,
  BypassCreateRequestSchema,
  LIMITS,
  PLAYER_ID_TYPES,
  PlayerIdTypeSchema,
  BypassTypeSchema,
  isValidPlayerId,
  type BypassCreateRequest,
} from '@scpsl-trust/shared';

import { Button } from '../../../components/Button';
import { FormError } from '../../../components/ErrorState';
import { Input, Select, Textarea } from '../../../components/FormField';
import { humanizeEnum } from '../../../components/StatusBadge';
import { useZodForm } from '../../../components/useZodForm';
import { futureDateTimeInput } from '../lib/forms';

const BYPASS_TYPE_HINTS: Readonly<Record<string, string>> = {
  vpn_whitelist: 'Exempts the player from VPN rules.',
  account_age_whitelist: 'Exempts the player from account-age rules.',
  alt_account_whitelist: 'Exempts the player from alt-account rules.',
  verdict_override: 'Exempts the player from global-verdict and open-report rules. Use with care: it does not change any verdict.',
};

const GrantFormSchema = z
  .object({
    player_type: PlayerIdTypeSchema,
    player_id: z.string().trim().min(1, 'Player id is required'),
    type: BypassTypeSchema,
    reason: z.string().trim().min(LIMITS.BYPASS_REASON_MIN, `At least ${LIMITS.BYPASS_REASON_MIN} characters`).max(LIMITS.BYPASS_REASON_MAX),
    expires_at: futureDateTimeInput('Expiry'),
  })
  .refine((values) => isValidPlayerId(values.player_type, values.player_id), {
    message: 'Invalid id for the selected type (steam: 17 digits, discord: 17–20 digits, northwood: lowercase name)',
    path: ['player_id'],
  });

export interface BypassGrantFormProps {
  scopeLabel: string;
  onSubmit: (body: BypassCreateRequest) => Promise<void>;
}

export function BypassGrantForm({ scopeLabel, onSubmit }: BypassGrantFormProps) {
  const form = useZodForm({
    schema: GrantFormSchema,
    initialValues: { player_type: 'steam', player_id: '', type: 'vpn_whitelist', reason: '', expires_at: '' },
    onSubmit: async (values) => {
      const body = BypassCreateRequestSchema.parse({
        player: { type: values.player_type, id: values.player_id },
        type: values.type,
        reason: values.reason,
        expires_at: values.expires_at,
      });
      await onSubmit(body);
      form.reset();
    },
  });

  return (
    <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate aria-label={`Grant ${scopeLabel} bypass`}>
      <div className="form-grid">
        <Select label="Id type" options={PLAYER_ID_TYPES.map((type) => ({ value: type, label: humanizeEnum(type) }))} {...form.field('player_type')} />
        <Input label="Player id" mono required placeholder="76561198000000001" {...form.field('player_id')} />
        <Select
          label="Bypass type"
          options={BYPASS_TYPES.map((type) => ({ value: type, label: humanizeEnum(type) }))}
          hint={BYPASS_TYPE_HINTS[form.values.type]}
          {...form.field('type')}
        />
        <Input label="Expires (optional)" type="datetime-local" hint="Empty = no expiry." {...form.field('expires_at')} />
      </div>
      <Textarea label="Reason" required rows={2} maxLength={LIMITS.BYPASS_REASON_MAX} {...form.field('reason')} />
      <FormError error={form.formError} />
      <div className="form-actions">
        <Button type="submit" variant="primary" loading={form.submitting}>
          Grant {scopeLabel} bypass
        </Button>
      </div>
    </form>
  );
}
