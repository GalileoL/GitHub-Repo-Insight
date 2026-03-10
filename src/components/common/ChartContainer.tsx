import { LoadingSkeleton } from './LoadingSkeleton';
import { ErrorState } from './ErrorState';
import { EmptyState } from './EmptyState';

interface ChartContainerProps {
  loading: boolean;
  error: Error | null;
  isEmpty?: boolean;
  emptyMessage?: string;
  height?: string;
  children: React.ReactNode;
}

export function ChartContainer({ loading, error, isEmpty, emptyMessage, height = 'h-80', children }: ChartContainerProps) {
  if (loading) return <LoadingSkeleton className={height} />;
  if (error) return <ErrorState message={error.message} />;
  if (isEmpty) return <EmptyState message={emptyMessage || 'No data available'} />;
  return <div className={height}>{children}</div>;
}
