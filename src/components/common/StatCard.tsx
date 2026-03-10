import { memo } from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}

export const StatCard = memo(function StatCard({ label, value, icon }: StatCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border-default bg-bg-surface p-5 transition-all hover:border-border-muted hover:shadow-lg hover:shadow-accent-blue/5">
      <div className="absolute inset-0 bg-gradient-to-br from-accent-blue/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-secondary">{label}</span>
          <div className="text-text-muted">{icon}</div>
        </div>
        <p className="mt-2 text-2xl font-bold text-text-primary">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
      </div>
    </div>
  );
});
