import { ChartContainer } from '../common/ChartContainer';
import type { ReleaseTimelineData } from '../../utils/transformers';

interface ReleaseTimelineProps {
  data: ReleaseTimelineData[] | undefined;
  loading: boolean;
  error: Error | null;
}

export default function ReleaseTimeline({ data, loading, error }: ReleaseTimelineProps) {
  return (
    <ChartContainer loading={loading} error={error} isEmpty={data?.length === 0} emptyMessage="No releases found" height="h-auto">
      <div className="relative max-h-96 overflow-y-auto pr-2">
        <div className="absolute left-[19px] top-0 bottom-0 w-px bg-border-default" />
        <div className="space-y-0">
          {data?.slice(0, 15).map((release, i) => (
            <div key={release.tag} className="relative flex items-start gap-4 py-3 group">
              <div className={`relative z-10 mt-1 h-[10px] w-[10px] rounded-full border-2 flex-shrink-0
                ${release.prerelease
                  ? 'border-accent-yellow bg-bg-surface'
                  : i === 0
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
                  {i === 0 && !release.prerelease && (
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
          ))}
        </div>
      </div>
    </ChartContainer>
  );
}
