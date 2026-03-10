import { useParams } from 'react-router-dom';
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
            data={releasesQuery.data}
            loading={releasesQuery.isLoading}
            error={releasesQuery.error}
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
