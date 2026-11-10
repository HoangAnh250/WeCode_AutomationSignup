import { create } from 'zustand';
interface Notice {
  id: string;
  message: string;
  tone: 'success' | 'error' | 'info';
}
export const useNotifications = create<{
  notices: Notice[];
  push: (message: string, tone?: Notice['tone']) => void;
  dismiss: (id: string) => void;
}>((set) => ({
  notices: [],
  push: (message, tone = 'success') => {
    const id = crypto.randomUUID();
    set((s) => ({ notices: [...s.notices.slice(-3), { id, message, tone }] }));
    setTimeout(() => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })), 5500);
  },
  dismiss: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
}));
