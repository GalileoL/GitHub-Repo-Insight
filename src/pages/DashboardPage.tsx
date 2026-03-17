import { useParams } from 'react-router-dom';
import { lazy, Suspense, useState, useCallback, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useRepo, useLanguages, useContributors, useCommitActivity, useReleases, useIssues } from '../hooks';
import { GitHubApiError } from '../api/github';
import { RepoOverview } from '../components/repo/RepoOverview';
import { SectionCard, LoadingSkeleton, ErrorState } from '../components/common';

const LanguagePieChart = lazy(() => import('../components/charts/LanguagePieChart'));
const ContributorBarChart = lazy(() => import('../components/charts/ContributorBarChart'));
const CommitTrendChart = lazy(() => import('../components/charts/CommitTrendChart'));
const IssuePrTrendChart = lazy(() => import('../components/charts/IssuePrTrendChart'));
const ReleaseTimeline = lazy(() => import('../components/charts/ReleaseTimeline'));
const CommitHeatmap = lazy(() => import('../components/charts/CommitHeatmap'));

function ChartSkeleton() {
  return <LoadingSkeleton className="h-80" />;
}

const STORAGE_KEY = 'dashboard-card-order';
const DEFAULT_ORDER = ['languages', 'contributors', 'commits', 'issues', 'releases', 'heatmap'];

function isValidStoredOrder(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length !== DEFAULT_ORDER.length) return false;
  const expected = new Set(DEFAULT_ORDER);
  const actual = new Set(value);
  if (actual.size !== expected.size) return false;
  return DEFAULT_ORDER.every((id) => actual.has(id));
}

function getStoredOrder(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (isValidStoredOrder(stored)) return stored;
  } catch { /* ignore */ }
  return DEFAULT_ORDER;
}

/** A wrapper that makes its children sortable via drag handle */
function SortableCard({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.8 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative group/drag">
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="absolute top-3 right-3 z-10 p-1.5 rounded-md text-text-muted opacity-0 group-hover/drag:opacity-100 hover:bg-bg-elevated hover:text-text-secondary transition-all cursor-grab active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </button>
      {children}
    </div>
  );
}

export default function DashboardPage() {
  const { owner = '', repo = '' } = useParams<{ owner: string; repo: string }>();
  const repoQuery = useRepo(owner, repo);
  const languagesQuery = useLanguages(owner, repo);
  const contributorsQuery = useContributors(owner, repo);
  const commitActivityQuery = useCommitActivity(owner, repo);
  const releasesQuery = useReleases(owner, repo);
  const issuesQuery = useIssues(owner, repo);

  const [cardOrder, setCardOrder] = useState<string[]>(getStoredOrder);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setCardOrder((prev) => {
      const oldIndex = prev.indexOf(active.id as string);
      const newIndex = prev.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const next = [...prev];
      next.splice(oldIndex, 1);
      next.splice(newIndex, 0, active.id as string);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    setCardOrder(DEFAULT_ORDER);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const isCustomOrder = useMemo(
    () => JSON.stringify(cardOrder) !== JSON.stringify(DEFAULT_ORDER),
    [cardOrder],
  );

  const cardMap = useMemo(() => ({
    languages: (
      <SectionCard title="Language Distribution" description="Breakdown by bytes of code">
        <Suspense fallback={<ChartSkeleton />}>
          <LanguagePieChart
            data={languagesQuery.data}
            loading={languagesQuery.isLoading}
            error={languagesQuery.error}
          />
        </Suspense>
      </SectionCard>
    ),
    contributors: (
      <SectionCard title="Top Contributors" description="By number of commits">
        <Suspense fallback={<ChartSkeleton />}>
          <ContributorBarChart
            data={contributorsQuery.data}
            loading={contributorsQuery.isLoading}
            error={contributorsQuery.error}
          />
        </Suspense>
      </SectionCard>
    ),
    commits: (
      <SectionCard title="Commit Activity" description="Weekly commit trend over the past year">
        <Suspense fallback={<ChartSkeleton />}>
          <CommitTrendChart
            data={commitActivityQuery.data?.trend}
            loading={commitActivityQuery.isLoading}
            error={commitActivityQuery.error}
          />
        </Suspense>
      </SectionCard>
    ),
    issues: (
      <SectionCard title="Issues & Pull Requests" description="Monthly creation trend">
        <Suspense fallback={<ChartSkeleton />}>
          <IssuePrTrendChart
            data={issuesQuery.data}
            loading={issuesQuery.isLoading}
            error={issuesQuery.error}
          />
        </Suspense>
      </SectionCard>
    ),
    releases: (
      <SectionCard title="Releases" description="Recent release history">
        <Suspense fallback={<ChartSkeleton />}>
          <ReleaseTimeline
            data={releasesQuery.data?.pages.flat()}
            loading={releasesQuery.isLoading}
            error={releasesQuery.error}
            hasNextPage={releasesQuery.hasNextPage}
            isFetchingNextPage={releasesQuery.isFetchingNextPage}
            fetchNextPage={releasesQuery.fetchNextPage}
          />
        </Suspense>
      </SectionCard>
    ),
    heatmap: (
      <SectionCard title="Commit Heatmap" description="Daily commit activity">
        <Suspense fallback={<ChartSkeleton />}>
          <CommitHeatmap
            data={commitActivityQuery.data?.heatmap}
            loading={commitActivityQuery.isLoading}
            error={commitActivityQuery.error}
          />
        </Suspense>
      </SectionCard>
    ),
  }), [languagesQuery, contributorsQuery, commitActivityQuery, issuesQuery, releasesQuery]);

  if (repoQuery.isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 space-y-6">
        <LoadingSkeleton className="h-48" />
        <div className="grid grid-cols-2 gap-4">
          <LoadingSkeleton className="h-80" />
          <LoadingSkeleton className="h-80" />
        </div>
      </div>
    );
  }

  if (repoQuery.error) {
    const isRateLimit = repoQuery.error instanceof GitHubApiError && repoQuery.error.isRateLimit;
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <ErrorState
          message={repoQuery.error.message}
          isRateLimit={isRateLimit}
          onRetry={() => repoQuery.refetch()}
        />
      </div>
    );
  }

  if (!repoQuery.data) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <RepoOverview repo={repoQuery.data} />

      {/* Reset order button */}
      {isCustomOrder && (
        <div className="flex justify-end">
          <button
            onClick={handleReset}
            className="text-xs text-text-muted hover:text-accent-teal transition-colors"
          >
            Reset card order
          </button>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={cardOrder} strategy={verticalListSortingStrategy}>
          <div className="space-y-6">
            {cardOrder.map((id) => (
              <SortableCard key={id} id={id}>
                {cardMap[id as keyof typeof cardMap]}
              </SortableCard>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
