import { useParams, Link } from 'react-router-dom';

export default function AnalyzePage() {
  const { owner = '', repo = '' } = useParams<{ owner: string; repo: string }>();

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-teal/10">
        <svg className="h-8 w-8 text-accent-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
        </svg>
      </div>
      <h1 className="text-2xl font-bold text-text-primary mb-3">AI Repository Analysis</h1>
      <p className="text-text-secondary mb-2">
        <span className="font-medium text-text-primary">{owner}/{repo}</span>
      </p>
      <p className="text-text-muted mb-8">
        This feature is under development. Soon you'll be able to ask an AI agent to analyze
        code patterns, architecture decisions, dependency health, and more for any GitHub repository.
      </p>
      <Link
        to={`/repo/${owner}/${repo}`}
        className="rounded-lg bg-accent-blue/10 border border-accent-blue/20 px-5 py-2.5 text-sm font-medium text-accent-blue hover:bg-accent-blue/20 transition-colors"
      >
        ← Back to Dashboard
      </Link>
    </div>
  );
}
