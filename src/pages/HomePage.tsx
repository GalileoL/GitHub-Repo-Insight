import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { SearchBar } from '../components/common/SearchBar';
import { EXAMPLE_REPOS } from '../constants';

export default function HomePage() {
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem('repo-history') || '[]');
    setHistory(stored);
  }, []);

  const clearHistory = () => {
    localStorage.removeItem('repo-history');
    setHistory([]);
  };

  return (
    <div className="flex flex-col items-center px-4 pt-20 pb-16">
      {/* Hero */}
      <div className="relative mb-12 text-center">
        <div className="absolute -top-20 left-1/2 -translate-x-1/2 h-64 w-64 rounded-full bg-accent-blue/10 blur-3xl" />
        <div className="relative">
          <h1 className="text-5xl font-bold tracking-tight text-text-primary sm:text-6xl">
            GitHub Repo{' '}
            <span className="bg-gradient-to-r from-accent-blue to-accent-teal bg-clip-text text-transparent">
              Insight
            </span>
          </h1>
          <p className="mt-4 text-lg text-text-secondary max-w-xl mx-auto">
            Explore any GitHub repository with detailed analytics, charts, and insights.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="w-full max-w-2xl mb-16">
        <SearchBar size="large" />
      </div>

      {/* Example Repos */}
      <div className="w-full max-w-4xl mb-12">
        <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-4">Popular Repositories</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {EXAMPLE_REPOS.map(({ owner, repo, description }) => (
            <Link
              key={`${owner}/${repo}`}
              to={`/repo/${owner}/${repo}`}
              className="group rounded-xl border border-border-default bg-bg-surface p-4 hover:border-accent-blue/30 hover:shadow-lg hover:shadow-accent-blue/5 transition-all"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="h-6 w-6 rounded-full bg-bg-elevated flex items-center justify-center">
                  <svg className="h-3.5 w-3.5 text-text-muted" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9z" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-accent-blue group-hover:underline">
                  {owner}/{repo}
                </span>
              </div>
              <p className="text-xs text-text-secondary line-clamp-2">{description}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent History */}
      {history.length > 0 && (
        <div className="w-full max-w-4xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">Recent Searches</h2>
            <button
              onClick={clearHistory}
              className="text-xs text-text-muted hover:text-accent-red transition-colors"
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {history.map((item) => (
              <Link
                key={item}
                to={`/repo/${item}`}
                className="rounded-lg border border-border-default bg-bg-surface px-3 py-1.5 text-sm text-text-secondary hover:text-accent-blue hover:border-accent-blue/30 transition-colors"
              >
                {item}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
