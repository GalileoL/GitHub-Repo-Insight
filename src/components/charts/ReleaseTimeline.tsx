import { useRef, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChartContainer } from '../common/ChartContainer';
import type { ReleaseTimelineData } from '../../utils/transformers';

interface ReleaseTimelineProps {
  data: ReleaseTimelineData[] | undefined;
  loading: boolean;
  error: Error | null;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\*\*|__|[*_#>-]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function ReleaseTimeline({
  data,
  loading,
  error,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: ReleaseTimelineProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is safe here
  const virtualizer = useVirtualizer({
    count: data?.length ?? 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 5,
  });

  // Lazy load: fetch next page when scrolling near bottom
  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el || !hasNextPage || isFetchingNextPage) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight - scrollTop - clientHeight < 200) {
      fetchNextPage?.();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  return (
    <ChartContainer loading={loading} error={error} isEmpty={data?.length === 0} emptyMessage="No releases found" height="h-auto">
      <div ref={parentRef} className="relative max-h-96 overflow-y-auto pr-2">
        <div className="absolute left-[19px] top-0 bottom-0 w-px bg-border-default" />
        <div
          style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const release = data![virtualItem.index];
            const isFirst = virtualItem.index === 0;
            return (
              <div
                key={release.tag}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <div className="flex items-start gap-4 py-3 group">
                  <div
                    className={`relative z-10 mt-1 h-[10px] w-[10px] rounded-full border-2 flex-shrink-0
                      ${release.prerelease
                        ? 'border-accent-yellow bg-bg-surface'
                        : isFirst
                          ? 'border-accent-green bg-accent-green'
                          : 'border-accent-blue bg-bg-surface'
                      }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={release.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-sm font-medium text-accent-blue hover:underline"
                      >
                        {release.tag}
                      </a>
                      {release.prerelease && (
                        <span className="rounded-full bg-accent-yellow/10 border border-accent-yellow/20 px-2 py-0.5 text-xs text-accent-yellow">
                          pre-release
                        </span>
                      )}
                      {isFirst && !release.prerelease && (
                        <span className="rounded-full bg-accent-green/10 border border-accent-green/20 px-2 py-0.5 text-xs text-accent-green">
                          latest
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-text-muted">{release.date}</span>
                      {release.name !== release.tag && (
                        <span className="text-xs text-text-secondary truncate">{release.name}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {isFetchingNextPage && (
          <div className="flex justify-center py-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
          </div>
        )}
      </div>
    </ChartContainer>
  );
}
