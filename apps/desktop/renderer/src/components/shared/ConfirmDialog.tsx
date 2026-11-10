import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  onConfirm,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && !pending && onClose()}
      title={title}
      description={description}
    >
      <div className="dialog-footer">
        <Button onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={onConfirm} disabled={pending}>
          {pending ? 'Deleting...' : 'Delete'}
        </Button>
      </div>
    </Dialog>
  );
}
