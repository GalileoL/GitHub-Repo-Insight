import { useState } from 'react';
import type { Source } from '../types';

const TYPE_ICON: Record<string, string> = {
  readme: '📄',
  issue: '🐛',
  pr: '🔀',
  release: '📦',
  commit: '💬',
};

const TYPE_LABEL: Record<string, string> = {
  readme: 'README',
  issue: 'Issue',
  pr: 'Pull Request',
  release: 'Release',
  commit: 'Commits',
};

interface SourceListProps {
  sources: Source[];
}

export default function SourceList({ sources }: SourceListProps) {
  const [open, setOpen] = useState(false);

  if (sources.length === 0) return null;

  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-medium text-text-muted uppercase tracking-wider hover:text-text-secondary transition-colors group"
      >
        <svg
          className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        Sources ({sources.length})
      </button>
      {open && (
        <ul className="space-y-1.5">
          {sources.map((source, i) => (
            <li key={i}>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2.5 rounded-lg border border-border-default bg-bg-surface p-3 transition-colors hover:border-accent-teal group"
              >
                <span className="text-base leading-none mt-0.5">
                  {TYPE_ICON[source.type] ?? '📎'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-text-primary group-hover:text-accent-teal transition-colors truncate">
                    {source.title}
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {TYPE_LABEL[source.type] ?? source.type}
                    {source.issueNumber ? ` #${source.issueNumber}` : ''}
                    {source.prNumber ? ` #${source.prNumber}` : ''}
                    {source.releaseName ? ` — ${source.releaseName}` : ''}
                  </div>
                  {source.snippet && (
                    <p className="text-xs text-text-muted mt-1 line-clamp-2">{source.snippet}</p>
                  )}
                </div>
                <svg className="h-4 w-4 text-text-muted shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
