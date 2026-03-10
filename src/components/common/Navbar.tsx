import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';

export function Navbar() {
  const { user, token, logout } = useAuthStore();
  const navigate = useNavigate();
  const isAuthenticated = !!token;

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-border-default bg-bg-surface/80 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-accent-blue to-accent-purple flex items-center justify-center">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <span className="text-lg font-semibold text-text-primary group-hover:text-accent-blue transition-colors">
              Repo Insight
            </span>
          </Link>

          <div className="flex items-center gap-3">
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
