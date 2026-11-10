import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
export function EmptyState({
  title = 'Nothing here yet',
  description = 'Change your filters or create your first record.',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Inbox size={28} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
