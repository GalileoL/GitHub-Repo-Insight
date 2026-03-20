# ReleaseTimeline Variable-Height Virtual List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert ReleaseTimeline from a fixed-height virtual list to a true variable-height virtual list by surfacing release notes (`body`) as a per-item summary and relying on ResizeObserver-based measurement instead of a hardcoded height constant.

**Architecture:** Add `body` to the `ReleaseTimelineData` interface and pass it through `transformReleases`. In the component, remove the `ITEM_HEIGHT` constant, update `estimateSize` to 80 (median estimate), add a module-scope `stripMarkdown` helper, and render a `line-clamp-2` body summary below the date row. TanStack Virtual v3's `measureElement` ref (already wired) handles all actual height measurement via ResizeObserver.

**Tech Stack:** React, TypeScript, `@tanstack/react-virtual` v3, Tailwind CSS v4

**Spec:** `docs/superpowers/specs/2026-03-20-release-timeline-variable-height-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/utils/transformers.ts` | Modify | Add `body` field to `ReleaseTimelineData`; pass through in `transformReleases` |
| `src/components/charts/ReleaseTimeline.tsx` | Modify | Remove `ITEM_HEIGHT`; update `estimateSize`; add `stripMarkdown`; render body row |

---

## Task 1: Add `body` to the data layer

**Files:**
- Modify: `src/utils/transformers.ts:34-40` (interface) and `:153-165` (transform function)

- [ ] **Step 1: Add `body` field to `ReleaseTimelineData` interface**

  In `src/utils/transformers.ts`, update the interface (currently at line 34):

  ```ts
  export interface ReleaseTimelineData {
    tag: string;
    name: string;
    date: string;
    url: string;
    prerelease: boolean;
    body?: string | null;
  }
  ```

- [ ] **Step 2: Pass `body` through in `transformReleases`**

  In the same file, update the `.map()` call inside `transformReleases` (currently at line ~158):

  ```ts
  .map((release) => ({
    tag: release.tag_name,
    name: release.name || release.tag_name,
    date: dayjs(release.published_at).format('MMM DD, YYYY'),
    url: release.html_url,
    prerelease: release.prerelease,
    body: release.body,
  }));
  ```

  `release.body` is typed `string | null` in `GitHubRelease` (`src/types/github.ts:47`) — no type assertion needed.

- [ ] **Step 3: Verify TypeScript compiles**

  Run: `npm run build -- --noEmit` (or `npx tsc --noEmit`)

  Expected: no type errors

- [ ] **Step 4: Commit**

  ```bash
  git add src/utils/transformers.ts
  git commit -m "feat: add body field to ReleaseTimelineData and pass through in transformReleases"
  ```

---

## Task 2: Update component — remove fixed height, add `stripMarkdown`

**Files:**
- Modify: `src/components/charts/ReleaseTimeline.tsx`

- [ ] **Step 1: Delete the `ITEM_HEIGHT` constant**

  Remove line 15 from `src/components/charts/ReleaseTimeline.tsx`:

  ```ts
  // DELETE this line:
  const ITEM_HEIGHT = 64;
  ```

- [ ] **Step 2: Update `estimateSize` in `useVirtualizer`**

  Change `estimateSize: () => ITEM_HEIGHT` to use a numeric literal:

  ```ts
  const virtualizer = useVirtualizer({
    count: data?.length ?? 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 5,
  });
  ```

  80px is the median of the two expected rendered heights:
  - No body: ~60-64px (`py-3` + tag line + date line)
  - With body: ~92-96px (above + `mt-1` + two `text-xs` lines)

  TanStack Virtual v3 will override this estimate with real measurements via the `measureElement` ref already attached to each item.

- [ ] **Step 3: Add `stripMarkdown` at module scope**

  Add this function **before** the `export default function ReleaseTimeline` declaration (i.e., at module scope, not inside the component):

  ```ts
  function stripMarkdown(text: string): string {
    return text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]*`/g, '')
      .replace(/\*\*|__|[*_#>-]/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }
  ```

  Note: hyphen is at the **end** of the character class `[*_#>-]` to be treated as a literal, not a range.

- [ ] **Step 4: Verify TypeScript compiles**

  Run: `npx tsc --noEmit`

  Expected: no errors (the only reference to `ITEM_HEIGHT` was `estimateSize`, which is now replaced)

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/charts/ReleaseTimeline.tsx
  git commit -m "refactor: remove ITEM_HEIGHT constant and add stripMarkdown helper for variable-height list"
  ```

---

## Task 3: Render body summary in each list item

**Files:**
- Modify: `src/components/charts/ReleaseTimeline.tsx`

- [ ] **Step 1: Add body summary row below the date row**

  In `ReleaseTimeline.tsx`, find the date row block (currently around line 106-111):

  ```tsx
  <div className="flex items-center gap-2 mt-0.5">
    <span className="text-xs text-text-muted">{release.date}</span>
    {release.name !== release.tag && (
      <span className="text-xs text-text-secondary truncate">{release.name}</span>
    )}
  </div>
  ```

  Add the body row immediately **after** this closing `</div>`:

  ```tsx
  {release.body && (
    <p className="text-xs text-text-muted mt-1 line-clamp-2">
      {[...stripMarkdown(release.body)].slice(0, 160).join('')}
    </p>
  )}
  ```

  Key implementation notes:
  - `[...text].slice(0, 160).join('')` iterates Unicode code points (not UTF-16 code units), so emoji like 🚀 are not split at the boundary
  - `line-clamp-2` is a built-in Tailwind v4 utility — no plugin needed
  - The conditional `release.body &&` means tag-only releases (no notes) render the shorter item — this height variation is the whole point

- [ ] **Step 2: Verify TypeScript compiles**

  Run: `npx tsc --noEmit`

  Expected: no errors

- [ ] **Step 3: Smoke test in the browser**

  Start dev server: `npm run dev`

  Open a repo with releases (e.g., `facebook/react` or `vercel/next.js`). In the dashboard, scroll the Release Timeline and confirm:
  - Releases with body text show a 2-line grey summary below the date
  - Releases without body text are visibly shorter
  - Scrolling is smooth with no layout jumps after initial measurement
  - Lazy-load still triggers (spinner appears when scrolling near bottom)

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/charts/ReleaseTimeline.tsx
  git commit -m "feat: render release notes summary in ReleaseTimeline for variable-height virtual list"
  ```

---

## Done

All three tasks together deliver:
- `body` field flowing from GitHub API → transformer → component
- True variable-height virtual list via ResizeObserver measurement
- Release notes displayed as a truncated 2-line summary, emoji-safe
