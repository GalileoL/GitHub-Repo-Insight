import { memo } from 'react';
import dayjs from 'dayjs';
import { StatCard } from '../common/StatCard';
import type { GitHubRepo } from '../../types/github';

interface RepoOverviewProps {
  repo: GitHubRepo;
}

export const RepoOverview = memo(function RepoOverview({ repo }: RepoOverviewProps) {
  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <img src={repo.owner.avatar_url} alt={repo.owner.login} className="h-10 w-10 rounded-full ring-2 ring-border-default" />
          <div>
            <h1 className="text-2xl font-bold text-text-primary">{repo.full_name}</h1>
            {repo.description && <p className="text-text-secondary mt-1">{repo.description}</p>}
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-text-muted mt-3 flex-wrap">
          {repo.language && (
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-full bg-accent-blue" />
              {repo.language}
            </span>
          )}
          {repo.license && <span>{repo.license.spdx_id}</span>}
          <span>Created {dayjs(repo.created_at).format('MMM DD, YYYY')}</span>
          <span>Updated {dayjs(repo.updated_at).fromNow()}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard
          label="Stars"
          value={repo.stargazers_count}
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" /></svg>}
        />
        <StatCard
          label="Forks"
          value={repo.forks_count}
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" /></svg>}
        />
        <StatCard
          label="Watchers"
          value={repo.watchers_count}
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
        />
        <StatCard
          label="Open Issues"
          value={repo.open_issues_count}
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>}
        />
        <StatCard
          label="Default Branch"
          value={repo.default_branch}
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>}
        />
      </div>
    </div>
  );
});
