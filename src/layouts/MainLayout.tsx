import { Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { Navbar } from '../components/common/Navbar';
import { useAuthStore } from '../store/auth';

export default function MainLayout() {
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    let mounted = true;

    const syncSession = async () => {
      try {
        const res = await fetch('/api/auth/session');
        if (!res.ok) return;
        const data = (await res.json()) as {
          authenticated: boolean;
          user: { login: string; avatar_url: string } | null;
        };
        if (!mounted) return;
        if (data.authenticated) {
          setUser(data.user);
        } else {
          logout();
        }
      } catch {
        if (mounted) {
          logout();
        }
      }
    };

    void syncSession();
    return () => {
      mounted = false;
    };
  }, [setUser, logout]);

  return (
    <div className="min-h-screen bg-bg-primary">
      <Navbar />
      <main>
        <Outlet />
      </main>
    </div>
  );
}
