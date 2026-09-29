import type { ServerSummary } from '@scpsl-trust/shared';

import { Badge } from '../../components/Badge';
import { isServerOnline } from './serverUtils';

/** "Online" when the plugin heart-beated recently; only meaningful for active servers. */
export function OnlineIndicator({ lastSeenAt, status }: { lastSeenAt: string | null; status: ServerSummary['status'] }) {
  if (status !== 'active') return null;
  const online = isServerOnline(lastSeenAt);
  return (
    <Badge tone={online ? 'success' : 'muted'} dot title={online ? 'Heartbeat received recently' : 'No recent heartbeat'}>
      {online ? 'Online' : 'Offline'}
    </Badge>
  );
}
