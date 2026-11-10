import { create } from 'zustand';
export const useLogView = create<{
  search: string;
  level: string;
  category: string;
  following: boolean;
  setSearch: (v: string) => void;
  setLevel: (v: string) => void;
  setCategory: (v: string) => void;
  toggleFollowing: () => void;
}>((set) => ({
  search: '',
  level: 'all',
  category: 'all',
  following: true,
  setSearch: (search) => set({ search }),
  setLevel: (level) => set({ level }),
  setCategory: (category) => set({ category }),
  toggleFollowing: () => set((s) => ({ following: !s.following })),
}));
