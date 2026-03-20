# ReleaseTimeline Variable-Height Virtual List

**Date**: 2026-03-20
**Status**: Approved

## Goal

Convert `ReleaseTimeline` from a fixed-height virtual list (`ITEM_HEIGHT = 64`) to a true variable-height virtual list by:
1. Surfacing GitHub release notes (`body`) as a truncated summary per item
2. Removing the hardcoded height constant and relying on `measureElement` for real DOM measurement

## Data Layer

### `ReleaseTimelineData` (`src/utils/transformers.ts`)

Add one optional field:

```ts
export interface ReleaseTimelineData {
  tag: string;
  name: string;
  date: string;
  url: string;
  prerelease: boolean;
  body?: string | null;   // NEW
}
```

### `transformReleases` (`src/utils/transformers.ts`)

Include `body` in the mapping:

```ts
.map((release) => ({
  tag: release.tag_name,
  name: release.name || release.tag_name,
  date: dayjs(release.published_at).format('MMM DD, YYYY'),
  url: release.html_url,
  prerelease: release.prerelease,
  body: release.body,   // NEW
}));
```

No changes needed to the API layer — `GitHubRelease.body` is already typed in `src/types/github.ts`.

## Virtualization Architecture

### Remove fixed height constant

```ts
// DELETE:
const ITEM_HEIGHT = 64;
```

### Update `useVirtualizer`

```ts
const virtualizer = useVirtualizer({
  count: data?.length ?? 0,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 80,   // initial estimate only; overridden by real measurement
  overscan: 5,
});
```

The item `ref={virtualizer.measureElement}` and `data-index={virtualItem.index}` are already present in the current code. TanStack Virtual v3 uses a ResizeObserver internally to measure each item's actual rendered height after mount and update `virtualItem.start` accordingly — this is the mechanism that enables variable-height positioning.

## Component Rendering

### Markdown strip helper (inside component file)

```ts
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\*\*|__|[*_#>\-]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
```

### Body summary row

Added below the existing date row inside each virtual item:

```tsx
{release.body && (
  <p className="text-xs text-text-muted mt-1 line-clamp-2">
    {stripMarkdown(release.body).slice(0, 160)}
  </p>
)}
```

- `line-clamp-2` caps display at two lines; `slice(0, 160)` is a secondary safeguard
- Releases with no body (tag-only releases) skip this row entirely — this is the primary source of height variation
- Container `max-h-96` is unchanged

## Files Changed

| File | Change |
|------|--------|
| `src/utils/transformers.ts` | Add `body` to `ReleaseTimelineData`; pass through in `transformReleases` |
| `src/components/charts/ReleaseTimeline.tsx` | Remove `ITEM_HEIGHT`; update `estimateSize`; add `stripMarkdown`; render body summary |

## What Does Not Change

- API call layer (`src/api/github.ts`, `src/hooks/useReleases.ts`)
- Lazy-load scroll logic
- Timeline visual design (dots, vertical line, badges)
- `max-h-96` container height
