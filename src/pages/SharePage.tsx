import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import AnswerCard from '../features/rag/components/AnswerCard';
import SourceList from '../features/rag/components/SourceList';

interface ShareEntry {
  id: string;
  repo: string;
  question: string;
  answer: string;
  sources: Array<Record<string, unknown>>;
  createdAt: number;
}

export default function SharePage() {
  const { id } = useParams();
  const [entry, setEntry] = useState<ShareEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);

    fetch(`/api/rag/share/${id}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? 'Failed to load share');
        }
        return res.json();
      })
      .then((data) => setEntry(data))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [id]);

  if (!id) {
    return (
      <div className="p-10 text-center">
        <h1 className="text-xl font-semibold">Invalid share link</h1>
        <p className="text-sm text-text-muted mt-2">This share link does not contain a valid id.</p>
        <div className="mt-4">
          <Link to="/" className="text-accent-teal hover:underline">
            Go back home
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-10 text-center">
        <div className="h-10 w-10 rounded-full border-2 border-border-default border-t-accent-teal animate-spin mx-auto" />
        <p className="text-sm text-text-muted mt-3">Loading shared answer…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-10 text-center">
        <h1 className="text-xl font-semibold text-accent-red">Unable to load share</h1>
        <p className="text-sm text-text-muted mt-2">{error}</p>
        <div className="mt-4">
          <Link to="/" className="text-accent-teal hover:underline">
            Go back home
          </Link>
        </div>
      </div>
    );
  }

  if (!entry) return null;

  return (
    <div className="space-y-6 p-6">
      <div className="rounded-xl border border-border-default bg-bg-surface p-6">
        <h1 className="text-lg font-semibold text-text-primary">Shared Answer</h1>
        <p className="text-sm text-text-muted mt-1">Question: {entry.question}</p>
        <p className="text-sm text-text-muted">Repo: {entry.repo}</p>
        <p className="text-xs text-text-muted mt-2">Shared on {new Date(entry.createdAt).toLocaleString()}</p>
      </div>

      <AnswerCard answer={entry.answer} isLoading={false} />

      {entry.sources?.length > 0 && <SourceList sources={entry.sources as any} />}

      <div className="text-sm text-text-muted">
        <Link to="/" className="text-accent-teal hover:underline">
          Back to app
        </Link>
      </div>
    </div>
  );
}
