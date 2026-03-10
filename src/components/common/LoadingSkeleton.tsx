interface LoadingSkeletonProps {
  className?: string;
  variant?: 'chart' | 'card' | 'text';
}

export function LoadingSkeleton({ className = 'h-80', variant = 'chart' }: LoadingSkeletonProps) {
  if (variant === 'card') {
    return (
      <div className={`animate-pulse rounded-xl bg-bg-surface border border-border-default p-5 ${className}`}>
        <div className="h-4 w-24 rounded bg-bg-elevated mb-3" />
        <div className="h-8 w-16 rounded bg-bg-elevated" />
      </div>
    );
  }

  if (variant === 'text') {
    return (
      <div className={`animate-pulse space-y-2 ${className}`}>
        <div className="h-4 w-3/4 rounded bg-bg-elevated" />
        <div className="h-4 w-1/2 rounded bg-bg-elevated" />
      </div>
    );
  }

  return (
    <div className={`animate-pulse rounded-xl bg-bg-surface border border-border-default flex items-center justify-center ${className}`}>
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 rounded-full border-2 border-border-default border-t-accent-blue animate-spin" />
        <span className="text-sm text-text-muted">Loading...</span>
      </div>
    </div>
  );
}
