import { useParams, Link } from 'react-router-dom';
import { lazy, Suspense } from 'react';
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

export default function DashboardPage() {
  const { owner = '', repo = '' } = useParams<{ owner: string; repo: string }>();
  const repoQuery = useRepo(owner, repo);
  const languagesQuery = useLanguages(owner, repo);
  const contributorsQuery = useContributors(owner, repo);
  const commitActivityQuery = useCommitActivity(owner, repo);
  const releasesQuery = useReleases(owner, repo);
  const issuesQuery = useIssues(owner, repo);

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

      {/* AI Agent — coming soon */}
      <Link
        to={`/repo/${owner}/${repo}/analyze`}
        className="flex items-center gap-2 w-fit rounded-lg border border-accent-teal/30 bg-accent-teal/10 px-4 py-2 text-sm font-medium text-accent-teal hover:bg-accent-teal/20 transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
        </svg>
        AI Analysis
        <span className="text-xs opacity-60">(Coming soon)</span>
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="Language Distribution" description="Breakdown by bytes of code">
          <Suspense fallback={<ChartSkeleton />}>
            <LanguagePieChart
              data={languagesQuery.data}
              loading={languagesQuery.isLoading}
              error={languagesQuery.error}
            />
          </Suspense>
        </SectionCard>

        <SectionCard title="Top Contributors" description="By number of commits">
          <Suspense fallback={<ChartSkeleton />}>
            <ContributorBarChart
              data={contributorsQuery.data}
              loading={contributorsQuery.isLoading}
              error={contributorsQuery.error}
            />
          </Suspense>
        </SectionCard>
      </div>

      <SectionCard title="Commit Activity" description="Weekly commit trend over the past year">
        <Suspense fallback={<ChartSkeleton />}>
          <CommitTrendChart
            data={commitActivityQuery.data?.trend}
            loading={commitActivityQuery.isLoading}
            error={commitActivityQuery.error}
          />
        </Suspense>
      </SectionCard>

      <SectionCard title="Issues & Pull Requests" description="Monthly creation trend">
        <Suspense fallback={<ChartSkeleton />}>
          <IssuePrTrendChart
            data={issuesQuery.data}
            loading={issuesQuery.isLoading}
            error={issuesQuery.error}
          />
        </Suspense>
      </SectionCard>

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

      <SectionCard title="Commit Heatmap" description="Daily commit activity">
        <Suspense fallback={<ChartSkeleton />}>
          <CommitHeatmap
            data={commitActivityQuery.data?.heatmap}
            loading={commitActivityQuery.isLoading}
            error={commitActivityQuery.error}
          />
        </Suspense>
      </SectionCard>
    </div>
  );
}
