export type LoadingSkeletonVariant =
  | 'chart'
  | 'line-chart'
  | 'bar-chart'
  | 'pie'
  | 'heatmap'
  | 'list'
  | 'card'
  | 'text';

interface LoadingSkeletonProps {
  className?: string;
  variant?: LoadingSkeletonVariant;
}

export function LoadingSkeleton({ className = 'h-80', variant = 'chart' }: LoadingSkeletonProps) {
  // ── Card variant ──────────────────────────────────────────────────────────
  if (variant === 'card') {
    return (
      <div className={`animate-pulse rounded-xl bg-bg-surface border border-border-default p-5 ${className}`}>
        <div className="h-4 w-24 rounded bg-bg-elevated mb-3" />
        <div className="h-8 w-16 rounded bg-bg-elevated" />
      </div>
    );
  }

  // ── Text variant ──────────────────────────────────────────────────────────
  if (variant === 'text') {
    return (
      <div className={`animate-pulse space-y-2 ${className}`}>
        <div className="h-4 w-3/4 rounded bg-bg-elevated" />
        <div className="h-4 w-1/2 rounded bg-bg-elevated" />
      </div>
    );
  }

  // ── Line chart (area/line chart with axes, grid, two-series legend) ───────
  if (variant === 'line-chart') {
    const barHeights = [38, 55, 45, 72, 62, 80, 58, 70, 48, 65, 75, 42];
    return (
      <div className={`animate-pulse rounded-xl bg-bg-surface border border-border-default overflow-hidden ${className}`}>
        <div className="h-full flex flex-col pt-2 pb-1 px-2">
          {/* Legend row */}
          <div className="flex items-center gap-4 mb-2 pl-10">
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-bg-elevated" />
              <div className="h-2 w-12 rounded bg-bg-elevated" />
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-bg-elevated" />
              <div className="h-2 w-16 rounded bg-bg-elevated" />
            </div>
          </div>
          {/* Chart body */}
          <div className="flex flex-1 min-h-0">
            {/* Y-axis label placeholders */}
            <div className="w-10 flex flex-col justify-between pb-6 items-end pr-1.5 flex-shrink-0">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-2 w-7 rounded bg-bg-elevated" />
              ))}
            </div>
            {/* Plot area */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex-1 relative border-l border-b border-bg-elevated">
                {/* Horizontal grid lines */}
                <div className="absolute left-0 right-0 h-px bg-bg-elevated/40" style={{ top: '33%' }} />
                <div className="absolute left-0 right-0 h-px bg-bg-elevated/40" style={{ top: '66%' }} />
                {/* Data bars simulating the line shape */}
                <div className="absolute inset-0 flex items-end gap-[2px] px-1 pb-0">
                  {barHeights.map((h, i) => (
                    <div
                      key={i}
                      className="flex-1 min-w-0 rounded-t-[2px] bg-bg-elevated"
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
              </div>
              {/* X-axis label placeholders */}
              <div className="flex justify-between mt-1.5 px-0">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-2 w-7 rounded bg-bg-elevated" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Horizontal bar chart (contributors, with name labels on left) ─────────
  if (variant === 'bar-chart') {
    const nameWidths = [70, 55, 80, 62, 45, 68, 52, 75];
    const barWidths  = [90, 75, 55, 85, 45, 70, 35, 65];
    return (
      <div className={`animate-pulse rounded-xl bg-bg-surface border border-border-default overflow-hidden ${className}`}>
        <div className="h-full flex pt-2 pb-6 pl-2 pr-3">
          {/* Name column */}
          <div className="w-24 flex flex-col justify-around flex-shrink-0 pr-2">
            {nameWidths.map((w, i) => (
              <div key={i} className="h-2.5 rounded bg-bg-elevated" style={{ width: `${w}px` }} />
            ))}
          </div>
          {/* Bars + X-axis */}
          <div className="flex-1 flex flex-col">
            <div className="flex-1 flex flex-col justify-around border-l border-b border-bg-elevated pl-1">
              {barWidths.map((w, i) => (
                <div key={i} className="h-3 rounded-r-sm bg-bg-elevated" style={{ width: `${w}%` }} />
              ))}
            </div>
            <div className="flex justify-between mt-1.5">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-2 w-7 rounded bg-bg-elevated" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Pie / donut chart ──────────────────────────────────────────────────────
  if (variant === 'pie') {
    const legendWidths = [55, 70, 45, 60, 50, 65];
    return (
      <div className={`animate-pulse rounded-xl bg-bg-surface border border-border-default overflow-hidden ${className}`}>
        <div className="h-full flex items-center justify-center gap-8 px-6">
          {/* Donut ring */}
          <div className="relative flex-shrink-0 h-36 w-36 rounded-full bg-bg-elevated">
            <div className="absolute inset-[23%] rounded-full bg-bg-surface" />
          </div>
          {/* Legend items */}
          <div className="flex flex-col gap-3">
            {legendWidths.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-bg-elevated flex-shrink-0" />
                <div className="h-2 rounded bg-bg-elevated" style={{ width: `${w}px` }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Commit heatmap (calendar grid) ────────────────────────────────────────
  if (variant === 'heatmap') {
    const COLS = 20;
    const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
    return (
      <div className={`animate-pulse rounded-xl bg-bg-surface border border-border-default p-3 ${className}`}>
        <div className="flex flex-col items-center gap-2 overflow-x-auto">
          {/* Month label placeholders */}
          <div className="flex gap-1 self-start pl-8">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-2 w-8 rounded bg-bg-elevated mr-8" />
            ))}
          </div>
          {/* Day labels + grid */}
          <div className="flex gap-1">
            <div className="flex flex-col gap-[3px] w-7 mr-1">
              {DAY_LABELS.map((label, i) => (
                <div key={i} className="h-3 flex items-center justify-end">
                  {label && <div className="h-2 w-6 rounded bg-bg-elevated" />}
                </div>
              ))}
            </div>
            <div className="flex gap-[3px]">
              {Array.from({ length: COLS }, (_, col) => (
                <div key={col} className="flex flex-col gap-[3px]">
                  {Array.from({ length: 7 }, (_, row) => {
                    const opacity = 0.15 + ((col * 7 + row) % 5) * 0.14;
                    return (
                      <div
                        key={row}
                        className="h-3 w-3 rounded-sm bg-bg-elevated"
                        style={{ opacity }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-1.5 self-end">
            <div className="h-2 w-6 rounded bg-bg-elevated" />
            {[0.2, 0.4, 0.6, 0.8, 1.0].map((o, i) => (
              <div key={i} className="h-3 w-3 rounded-sm bg-bg-elevated" style={{ opacity: o }} />
            ))}
            <div className="h-2 w-6 rounded bg-bg-elevated" />
          </div>
        </div>
      </div>
    );
  }

  // ── Release timeline list ─────────────────────────────────────────────────
  if (variant === 'list') {
    const contentWidths = [
      { title: 35, body: 60 },
      { title: 50, body: 70 },
      { title: 40, body: 55 },
      { title: 45, body: 65 },
      { title: 38, body: 58 },
    ];
    return (
      <div className={`animate-pulse rounded-xl bg-bg-surface border border-border-default overflow-hidden ${className}`}>
        {/* Vertical timeline line */}
        <div className="relative px-4 py-3 space-y-0">
          <div className="absolute left-[29px] top-3 bottom-3 w-px bg-border-default" />
          {contentWidths.map((w, i) => (
            <div key={i} className="flex items-start gap-3 py-3 border-b border-border-default last:border-0">
              {/* Timeline dot */}
              <div className="h-3 w-3 rounded-full bg-bg-elevated flex-shrink-0 mt-1 ring-2 ring-bg-surface" />
              {/* Version badge */}
              <div className="h-5 w-14 rounded-full bg-bg-elevated flex-shrink-0" />
              {/* Content lines */}
              <div className="flex-1 space-y-1.5">
                <div className="h-2.5 rounded bg-bg-elevated" style={{ width: `${w.title}%` }} />
                <div className="h-2 rounded bg-bg-elevated" style={{ width: `${w.body}%` }} />
              </div>
              {/* Date */}
              <div className="h-2 w-16 rounded bg-bg-elevated flex-shrink-0 mt-1" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Default generic chart (spinner) ───────────────────────────────────────
  return (
    <div className={`animate-pulse rounded-xl bg-bg-surface border border-border-default flex items-center justify-center ${className}`}>
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 rounded-full border-2 border-border-default border-t-accent-blue animate-spin" />
        <span className="text-sm text-text-muted">Loading...</span>
      </div>
    </div>
  );
}
