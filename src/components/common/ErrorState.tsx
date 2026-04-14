import { useAuthStore } from '../../store/auth';

interface ErrorStateProps {
  message: string;
  isRateLimit?: boolean;
  onRetry?: () => void;
}

export function ErrorState({ message, isRateLimit, onRetry }: ErrorStateProps) {
  const isAuthenticated = !!useAuthStore((s) => s.user);

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="h-12 w-12 rounded-full bg-accent-red/10 flex items-center justify-center mb-3">
        <svg className="h-6 w-6 text-accent-red" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <p className="text-text-secondary mb-4">{message}</p>
      {isRateLimit && !isAuthenticated && (
        <p className="text-sm text-accent-yellow mb-4">
          Sign in with GitHub to increase your API rate limit (60 to 5,000 requests/hour)
        </p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-lg border border-border-default px-4 py-2 text-sm text-text-primary hover:bg-bg-elevated transition-colors"
        >
          Try Again
        </button>
      )}
    </div>
  );
}
