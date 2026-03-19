import { useState, useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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

  const safeSources = useMemo(() => (Array.isArray(sources) ? sources : []), [sources]);

  const maxSourcesToShow = 500;
  const shouldTruncate = safeSources.length > maxSourcesToShow;

  const displaySources = useMemo(
    () => (shouldTruncate ? safeSources.slice(0, maxSourcesToShow) : safeSources),
    [safeSources, shouldTruncate],
  );

  const parentRef = useRef<HTMLDivElement | null>(null);

  // `useVirtualizer` returns functions that React Compiler cannot memoize, but this is okay for our usage.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: displaySources.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 92,
    overscan: 5,
  });

  if (displaySources.length === 0) return null;

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
        Sources ({safeSources.length})
      </button>

      {open && (
        <div className="space-y-2">
          {shouldTruncate && (
            <div className="text-xs text-text-muted">
              Showing first {maxSourcesToShow} of {safeSources.length} sources.
            </div>
          )}

          <div
            ref={parentRef}
            className="max-h-64 overflow-y-auto rounded-lg border border-border-default bg-bg-surface"
          >
            <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const source = displaySources[virtualRow.index];
                return (
                  <div
                    key={virtualRow.key}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
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
                      <svg
                        className="h-4 w-4 text-text-muted shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        />
                      </svg>
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
