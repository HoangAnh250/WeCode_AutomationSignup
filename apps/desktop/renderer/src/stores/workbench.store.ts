import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PageId } from '@/types/domain';
const pages: PageId[] = [
  'dashboard',
  'tasks',
  'proxies',
  'profiles',
  'accounts',
  'email',
  'logs',
  'settings',
];
interface WorkbenchState {
  page: PageId;
  collapsed: boolean;
  density: 'comfortable' | 'compact';
  navigate: (page: PageId) => void;
  toggleSidebar: () => void;
  setDensity: (density: WorkbenchState['density']) => void;
}
export const useWorkbench = create<WorkbenchState>()(
  persist(
    (set) => ({
      page: 'dashboard',
      collapsed: false,
      density: 'comfortable',
      navigate: (page) => set({ page }),
      toggleSidebar: () => set((s) => ({ collapsed: !s.collapsed })),
      setDensity: (density) => set({ density }),
    }),
    {
      name: 'wecode.workbench.v1',
      version: 1,
      partialize: (s) => ({ page: s.page, collapsed: s.collapsed, density: s.density }),
      merge: (saved, current) => {
        const s = saved as Partial<WorkbenchState> | undefined;
        return {
          ...current,
          page: s?.page && pages.includes(s.page) ? s.page : 'dashboard',
          collapsed: typeof s?.collapsed === 'boolean' ? s.collapsed : false,
          density: s?.density === 'compact' ? 'compact' : 'comfortable',
        };
      },
    },
  ),
);
