/**
 * One-time registration token with step-by-step plugin instructions (ARCHITECTURE §5.2).
 * The token is shown exactly once; the user must confirm they saved it before it disappears.
 */
import { DEFAULTS } from '@scpsl-trust/shared';

import { CodeBlock, SecretDisplay } from '../../components/CodeBlock';
import { DateTime } from '../../components/DateTime';

export interface RegistrationTokenPanelProps {
  serverId: string;
  serverName: string;
  token: string;
  expiresAt: string;
  onAcknowledge: () => void;
  acknowledgeLabel?: string;
}

function apiBaseUrl(): string {
  if (typeof window === 'undefined') return 'https://<this panel>';
  return window.location.origin;
}

export function RegistrationTokenPanel({ serverId, serverName, token, expiresAt, onAcknowledge, acknowledgeLabel = 'I have saved the token' }: RegistrationTokenPanelProps) {
  return (
    <div className="stack">
      <SecretDisplay
        title={`Registration token for ${serverName}`}
        values={token}
        description={
          <>
            Valid until <DateTime value={expiresAt} /> (about {DEFAULTS.REGISTRATION_TOKEN_TTL_HOURS} hours), single use. Creating a new token
            revokes this one.
          </>
        }
        onAcknowledge={onAcknowledge}
        acknowledgeLabel={acknowledgeLabel}
      />
      <div>
        <h3 className="text-sm mb-2">Register the SCP:SL server</h3>
        <ol className="stack-sm text-sm">
          <li>
            Install the Trust Network plugin (LabAPI) on the game server and set <code>api_base_url</code> in its config to{' '}
            <code>{apiBaseUrl()}</code>.
          </li>
          <li>
            Start the server, then run this command in the server console (or put the token into <code>registration_token</code> in the plugin
            config before the first start):
            <div className="mt-2">
              <CodeBlock value={`trust register ${token}`} inline />
            </div>
          </li>
          <li>
            The plugin generates its Ed25519 key pair locally and proves possession of it; the private key never leaves the game server. On success
            the server becomes <strong>active</strong> and its key fingerprint appears on this page.
          </li>
          <li>
            Check the status with <code>trust status</code> in the console. Server id: <code>{serverId}</code>.
          </li>
        </ol>
      </div>
    </div>
  );
}
