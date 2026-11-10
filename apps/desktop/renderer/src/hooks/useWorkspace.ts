import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { workspaceService } from '@/services/workspace-service';
import { useNotifications } from '@/stores/notification.store';
export const keys = {
  workspace: ['workspace', 'local'] as const,
  logs: ['logs', 'local'] as const,
};
export function useWorkspace() {
  return useQuery({
    queryKey: keys.workspace,
    queryFn: workspaceService.load,
    staleTime: 30000,
    retry: false,
  });
}
export function useCommand<T>(fn: (input: T) => Promise<unknown>, message?: string) {
  const qc = useQueryClient();
  const push = useNotifications((s) => s.push);
  return useMutation({
    mutationFn: fn,
    retry: false,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workspace });
      if (message) push(message);
    },
    onError: (error) =>
      push(error instanceof Error ? error.message : 'The operation failed. Try again.', 'error'),
  });
}
