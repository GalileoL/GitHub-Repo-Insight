import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import { useThemeStore, type ThemeMode } from '../../store/theme';

const themeOptions: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
  {
    value: 'light',
    label: 'Light',
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
      </svg>
    ),
  },
  {
    value: 'system',
    label: 'System',
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
      </svg>
    ),
  },
];

const triggerIcon = {
  light: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
    </svg>
  ),
  dark: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
    </svg>
  ),
  system: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
    </svg>
  ),
};

export function Navbar() {
  const { user, token, logout } = useAuthStore();
  const { mode, setMode } = useThemeStore();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const isAuthenticated = !!token;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-border-default bg-bg-surface/80 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-accent-blue to-accent-teal flex items-center justify-center">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <span className="text-lg font-semibold text-text-primary group-hover:text-accent-blue transition-colors">
              Repo Insight
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setOpen(!open)}
                className="rounded-lg p-2 text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
                aria-label="Theme"
              >
                {triggerIcon[mode]}
              </button>
              {open && (
                <div className="absolute right-0 mt-1 w-36 rounded-lg border border-border-default bg-bg-surface shadow-lg py-1 z-50">
                  {themeOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => { setMode(opt.value); setOpen(false); }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors ${
                        mode === opt.value
                          ? 'text-accent-blue bg-accent-blue/10'
                          : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                      }`}
                    >
                      {opt.icon}
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {isAuthenticated ? (
              <>
                <div className="flex items-center gap-2 rounded-full bg-accent-green/10 px-3 py-1.5 border border-accent-green/20">
                  <div className="h-2 w-2 rounded-full bg-accent-green animate-pulse" />
                  <span className="text-sm text-accent-green">Authenticated</span>
                </div>
                <img
                  src={user?.avatar_url}
                  alt={user?.login}
                  className="h-8 w-8 rounded-full ring-2 ring-border-default"
                />
                <button
                  onClick={handleLogout}
                  className="rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 rounded-full bg-accent-yellow/10 px-3 py-1.5 border border-accent-yellow/20">
                  <div className="h-2 w-2 rounded-full bg-accent-yellow" />
                  <span className="text-sm text-accent-yellow">Anonymous</span>
                </div>
                <a
                  href={`https://github.com/login/oauth/authorize?client_id=${import.meta.env.VITE_GITHUB_CLIENT_ID || ''}&redirect_uri=${encodeURIComponent(window.location.origin + '/auth/callback')}&scope=read:user`}
                  className="rounded-lg bg-accent-blue/10 border border-accent-blue/20 px-4 py-1.5 text-sm font-medium text-accent-blue hover:bg-accent-blue/20 transition-colors"
                >
                  Sign in with GitHub
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
