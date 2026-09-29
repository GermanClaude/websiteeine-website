/**
 * Player identity input: id type + raw id. Pasting a canonical user id such as
 * `76561198000000001@steam` into the id box fills both fields.
 */
import { PLAYER_ID_TYPES, isPlayerIdType, parseUserId, type PlayerIdType } from '@scpsl-trust/shared';

import { Input, Select } from '../../components/FormField';
import { humanizeEnum } from '../../components/StatusBadge';

export interface PlayerRefValue {
  type: PlayerIdType;
  id: string;
}

export interface PlayerRefFieldProps {
  value: PlayerRefValue;
  onChange: (value: PlayerRefValue) => void;
  /** Field-level errors keyed `player`, `player.type`, `player.id`. */
  errors?: Readonly<Record<string, string>>;
  disabled?: boolean;
  required?: boolean;
  idPrefix?: string;
}

const TYPE_OPTIONS = PLAYER_ID_TYPES.map((type) => ({ value: type, label: humanizeEnum(type) }));

const ID_HINTS: Readonly<Record<PlayerIdType, string>> = {
  steam: 'SteamID64 (17 digits), e.g. 76561198000000001',
  discord: 'Discord user id (17–20 digits)',
  northwood: 'Northwood account name (lowercase letters, digits, _ . -)',
};

export function PlayerRefField({ value, onChange, errors = {}, disabled = false, required = true, idPrefix = 'player-ref' }: PlayerRefFieldProps) {
  const idError = errors['player.id'] ?? errors['player'];
  const typeError = errors['player.type'];

  const onIdChange = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed.includes('@')) {
      const parsed = parseUserId(trimmed);
      if (parsed !== null) {
        onChange({ type: parsed.type, id: parsed.id });
        return;
      }
    }
    onChange({ type: value.type, id: raw });
  };

  return (
    <div className="form-grid">
      <Select
        id={`${idPrefix}-type`}
        label="Identity type"
        options={TYPE_OPTIONS}
        value={value.type}
        onChange={(event) => {
          const next = event.target.value;
          if (isPlayerIdType(next)) onChange({ type: next, id: value.id });
        }}
        error={typeError}
        disabled={disabled}
        required={required}
      />
      <Input
        id={`${idPrefix}-id`}
        label="Player id"
        mono
        value={value.id}
        onChange={(event) => onIdChange(event.target.value)}
        placeholder={value.type === 'steam' ? '76561198000000001' : value.type === 'discord' ? '123456789012345678' : 'name'}
        hint={`${ID_HINTS[value.type]}. You can also paste a full user id like 76561198000000001@steam.`}
        error={idError}
        disabled={disabled}
        required={required}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}
