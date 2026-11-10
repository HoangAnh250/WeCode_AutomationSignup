import { cn } from '@/lib/utils';
export function Badge({ value, label }: { value: string; label?: string }) {
  return (
    <span className={cn('badge', `badge-${value}`)}>
      <span className="badge-dot" />
      {label ?? value.replaceAll('_', ' ')}
    </span>
  );
}
