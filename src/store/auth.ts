import { create } from 'zustand';

interface AuthState {
  token: string | null;
  user: { login: string; avatar_url: string } | null;
  setUser: (user: { login: string; avatar_url: string } | null) => void;
  setAuth: (token: string | null, user: { login: string; avatar_url: string }) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  token: null,
  user: null,
  setUser: (user) => set({ user }),
  setAuth: (token, user) => set({ token, user }),
  logout: () => set({ token: null, user: null }),
}));
