import { useParams, Link } from 'react-router-dom';
import AskRepoPanel from '../features/rag/components/AskRepoPanel';

export default function AnalyzePage() {
  const { owner = '', repo = '' } = useParams<{ owner: string; repo: string }>();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* Back link */}
      <Link
        to={`/repo/${owner}/${repo}`}
        className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-accent-teal transition-colors mb-6"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to Dashboard
      </Link>

      <AskRepoPanel owner={owner} repo={repo} />
    </div>
  );
}
