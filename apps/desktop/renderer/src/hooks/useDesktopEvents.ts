import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { client } from '@/ipc/client';
import { keys } from './useWorkspace';
import type { LogEntry } from '@/types/domain';
export function useDesktopEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    let disposed = false;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    const cleanup = client.subscribe((event) => {
      if (disposed) return;
      if (event.type === 'data.changed') {
        if (refresh) clearTimeout(refresh);
        refresh = setTimeout(() => void qc.invalidateQueries({ queryKey: keys.workspace }), 100);
      }
      if (event.type === 'log.created' && event.log) {
        qc.setQueryData<LogEntry[]>(keys.logs, (old) =>
          old ? [...old.filter((x) => x.id !== event.log!.id), event.log!].slice(-500) : undefined,
        );
      }
    });
    return () => {
      disposed = true;
      if (refresh) clearTimeout(refresh);
      cleanup();
    };
  }, [qc]);
}
