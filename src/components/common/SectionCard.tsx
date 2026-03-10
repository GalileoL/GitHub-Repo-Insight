interface SectionCardProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function SectionCard({ title, description, children, className = '' }: SectionCardProps) {
  return (
    <div className={`rounded-xl border border-border-default bg-bg-surface overflow-hidden ${className}`}>
      <div className="border-b border-border-default px-6 py-4">
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
        {description && <p className="mt-1 text-sm text-text-secondary">{description}</p>}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}
