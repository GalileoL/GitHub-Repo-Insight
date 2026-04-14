import { create } from 'zustand';

interface AuthState {
  user: { login: string; avatar_url: string } | null;
  setUser: (user: { login: string; avatar_url: string } | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  logout: () => set({ user: null }),
}));
