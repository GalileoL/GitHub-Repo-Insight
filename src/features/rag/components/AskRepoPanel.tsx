import { useState } from 'react';
import { useAskRepo } from '../hooks/useAskRepo';
import { useIngestStatus, useIngestRepo } from '../hooks/useIngestStatus';
import { useAuthStore } from '../../../store/auth';
import SuggestedQuestions from './SuggestedQuestions';
import AnswerCard from './AnswerCard';
import SourceList from './SourceList';
import type { AskHistoryEntry } from '../hooks/useAskHistory';

interface AskRepoPanelProps {
  owner: string;
  repo: string;
}

export default function AskRepoPanel({ owner, repo }: AskRepoPanelProps) {
  const fullRepo = `${owner}/${repo}`;
  const [question, setQuestion] = useState('');

  const token = useAuthStore((s) => s.token);
  const isLoggedIn = !!token;

  const status = useIngestStatus(fullRepo);
  const ingest = useIngestRepo(fullRepo);
  const ask = useAskRepo(fullRepo);

  const isIndexed = status.data?.indexed ?? false;
  const isIngesting = ingest.isPending;
  const isAsking = ask.isPending || ask.isStreaming;

  const handleAsk = (q?: string) => {
    const text = q ?? question;
    if (!text.trim()) return;
    setQuestion(text);
    ask.ask(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  // Loading state for initial status check
  if (status.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 rounded-full border-2 border-border-default border-t-accent-teal animate-spin" />
      </div>
    );
  }

  if (status.isError) {
    return (
      <div className="rounded-xl border border-accent-red/30 bg-accent-red/5 p-6 text-center">
        <h3 className="text-base font-medium text-accent-red mb-2">Failed to load Ask Repo status</h3>
        <p className="text-sm text-text-muted mb-4">
          {status.error instanceof Error ? status.error.message : 'Please try again.'}
        </p>
        <button
          onClick={() => status.refetch()}
          className="inline-flex items-center gap-2 rounded-lg bg-accent-teal px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-teal/90"
        >
          Retry
        </button>
      </div>
    );
  }

  // Login gate
  if (!isLoggedIn) {
    const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID ?? '';
    const redirectUri = encodeURIComponent(window.location.origin + '/auth/callback');
    const oauthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=read:user`;

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-teal/10">
            <svg className="h-5 w-5 text-accent-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Ask Repo</h2>
            <p className="text-sm text-text-muted">AI-powered repository Q&A</p>
          </div>
        </div>

        {/* Login prompt */}
        <div className="rounded-xl border border-border-default bg-bg-surface p-8 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent-teal/10 mb-4">
            <svg className="h-7 w-7 text-accent-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h3 className="text-base font-medium text-text-primary mb-2">Sign in to use Ask Repo</h3>
          <p className="text-sm text-text-muted mb-6 max-w-sm mx-auto">
            This AI feature requires a GitHub account. Sign in to ask natural-language questions about any repository.
          </p>
          <a
            href={oauthUrl}
            className="inline-flex items-center gap-2 rounded-lg bg-accent-teal px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-teal/90"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            Sign in with GitHub
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-teal/10">
            <svg className="h-5 w-5 text-accent-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Ask Repo</h2>
            <p className="text-sm text-text-muted">
              Ask questions about <span className="font-medium text-text-secondary">{fullRepo}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Not indexed — show index prompt */}
      {!isIndexed && (
        <div className="rounded-xl border border-border-default bg-bg-surface p-6 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent-teal/10 mb-4">
            <svg className="h-6 w-6 text-accent-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <h3 className="text-base font-medium text-text-primary mb-2">Index this repository first</h3>
          <p className="text-sm text-text-muted mb-5 max-w-md mx-auto">
            We'll analyze the README, issues, pull requests, releases, and recent commits to build a knowledge base you can query.
          </p>
          <button
            onClick={() => ingest.mutate()}
            disabled={isIngesting}
            className="inline-flex items-center gap-2 rounded-lg bg-accent-teal px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-teal/90 disabled:opacity-60"
          >
            {isIngesting ? (
              <>
                <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Indexing…
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                Index Repository
              </>
            )}
          </button>
          {ingest.isError && (
            <p className="text-sm text-accent-red mt-3">{ingest.error.message}</p>
          )}
          {ingest.isSuccess && (
            <p className="text-sm text-accent-green mt-3">
              Indexed {ingest.data.chunksIndexed} chunks successfully!
            </p>
          )}
        </div>
      )}

      {/* Indexed — show question UI */}
      {isIndexed && (
        <>
          {/* Status bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <div className="h-2 w-2 rounded-full bg-accent-green" />
              <span>{status.data?.chunkCount ?? 0} chunks indexed</span>
            </div>
            <button
              onClick={() => ingest.mutate()}
              disabled={isIngesting}
              className="text-xs text-text-muted hover:text-accent-teal transition-colors disabled:opacity-50"
            >
              {isIngesting ? 'Re-indexing…' : 'Re-index'}
            </button>
          </div>

          {/* Question input */}
          <div className="relative">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about this repository..."
              disabled={isAsking}
              className="w-full rounded-xl border border-border-default bg-bg-surface px-4 py-3 pr-24 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-teal transition-colors disabled:opacity-60"
            />
            <button
              onClick={() => handleAsk()}
              disabled={isAsking || !question.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-accent-teal px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-teal/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAsking ? '...' : 'Ask'}
            </button>
          </div>

          {/* Suggested questions */}
          {!ask.streamingAnswer && !ask.isPending && !ask.isStreaming && (
            <SuggestedQuestions
              onSelect={(q) => handleAsk(q)}
              disabled={isAsking}
            />
          )}

          {/* Error */}
          {ask.isError && (
            <div className="rounded-xl border border-accent-red/30 bg-accent-red/5 p-4">
              <p className="text-sm text-accent-red">{ask.error?.message}</p>
            </div>
          )}

          {/* Answer + sources */}
          {(ask.isPending || ask.isStreaming || ask.streamingAnswer) && (
            <div className="space-y-4">
              <AnswerCard
                answer={ask.streamingAnswer}
                isLoading={ask.isPending && !ask.streamingAnswer}
                streamStatus={ask.streamStatus}
                onCancel={ask.cancel}
                onRetry={ask.retry}
              />
              {ask.sources.length > 0 && <SourceList sources={ask.sources} />}
              {ask.streamStatus === 'cancelled' && ask.streamError && (
                <div className="rounded-lg border border-accent-red/30 bg-accent-red/5 p-3">
                  <p className="text-xs text-accent-red">{ask.streamError}</p>
                </div>
              )}
            </div>
          )}

          {/* History */}
          {ask.history.length > 0 && (
            <HistorySection
              history={ask.history}
              onSelect={(entry) => {
                setQuestion(entry.question);
                ask.showCached(entry);
              }}
              onClear={ask.clearHistory}
            />
          )}
        </>
      )}
    </div>
  );
}

function HistorySection({
  history,
  onSelect,
  onClear,
}: {
  history: AskHistoryEntry[];
  onSelect: (entry: AskHistoryEntry) => void;
  onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = expanded ? history : history.slice(0, 3);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">
          Recent Questions
        </h3>
        <button
          onClick={onClear}
          className="text-xs text-text-muted hover:text-accent-red transition-colors"
        >
          Clear
        </button>
      </div>
      <div className="space-y-2">
        {items.map((entry, i) => (
          <button
            key={`${entry.timestamp}-${i}`}
            onClick={() => onSelect(entry)}
            className="w-full text-left rounded-lg border border-border-default bg-bg-surface px-4 py-3 hover:border-accent-teal/40 transition-colors group"
          >
            <p className="text-sm text-text-primary group-hover:text-accent-teal transition-colors truncate">
              {entry.question}
            </p>
            <p className="text-xs text-text-muted mt-1 line-clamp-2">
              {entry.answer.slice(0, 120)}…
            </p>
          </button>
        ))}
      </div>
      {history.length > 3 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-text-muted hover:text-accent-teal transition-colors"
        >
          {expanded ? 'Show less' : `Show all (${history.length})`}
        </button>
      )}
    </div>
  );
}
