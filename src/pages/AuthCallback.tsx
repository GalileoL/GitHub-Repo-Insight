import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/auth';

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const setUser = useAuthStore((s) => s.setUser);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!code || !state) {
      setError('Missing authorization code or state');
      return;
    }

    async function exchangeToken(code: string, state: string) {
      try {
        const tokenRes = await fetch('/api/auth/github', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state }),
        });

        const tokenData = await tokenRes.json();
        if (!tokenRes.ok) throw new Error(tokenData.error);

        if (!tokenData.user?.login || !tokenData.user?.avatar_url) {
          throw new Error('Authentication response missing user profile');
        }

        setUser({
          login: tokenData.user.login,
          avatar_url: tokenData.user.avatar_url,
        });

        const returnTo = tokenData.returnTo || sessionStorage.getItem('auth-return-to') || '/';
        sessionStorage.removeItem('auth-return-to');
        navigate(returnTo, { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Authentication failed');
      }
    }

    exchangeToken(code, state);
  }, [searchParams, setUser, navigate]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="h-12 w-12 rounded-full bg-accent-red/10 flex items-center justify-center mb-4">
          <svg className="h-6 w-6 text-accent-red" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-text-primary mb-2">Authentication Failed</h2>
        <p className="text-text-secondary mb-4">{error}</p>
        <button onClick={() => navigate('/')} className="rounded-lg bg-accent-blue px-4 py-2 text-sm text-white hover:bg-accent-blue/90 transition-colors">
          Go Home
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <div className="h-10 w-10 rounded-full border-2 border-border-default border-t-accent-blue animate-spin mb-4" />
      <p className="text-text-secondary">Authenticating with GitHub...</p>
    </div>
  );
}
