import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseRepoInput } from '../../utils/validators';

interface SearchBarProps {
  size?: 'default' | 'large';
  placeholder?: string;
}

export function SearchBar({ size = 'default', placeholder = 'Search repository (e.g. facebook/react)' }: SearchBarProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setError('');

      const parsed = parseRepoInput(input);
      if (!parsed) {
        setError('Enter a valid owner/repo or GitHub URL');
        return;
      }

      const { owner, repo } = parsed;
      const slug = `${owner}/${repo}`;

      // Save to recent history
      const history = JSON.parse(localStorage.getItem('repo-history') || '[]') as string[];
      const updated = [slug, ...history.filter((h) => h !== slug)].slice(0, 10);
      localStorage.setItem('repo-history', JSON.stringify(updated));

      navigate(`/repo/${owner}/${repo}`);
    },
    [input, navigate],
  );

  const isLarge = size === 'large';

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative group">
        <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-accent-blue/20 to-accent-teal/20 blur-xl opacity-0 group-focus-within:opacity-100 transition-opacity" />
        <div className="relative flex items-center">
          <svg
            className={`absolute left-4 text-text-muted ${isLarge ? 'h-6 w-6' : 'h-5 w-5'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(''); }}
            placeholder={placeholder}
            className={`w-full rounded-xl border border-border-default bg-bg-surface text-text-primary placeholder:text-text-muted
              focus:border-accent-blue focus:ring-1 focus:ring-accent-blue/50 focus:outline-none transition-all
              ${isLarge ? 'py-4 pl-14 pr-32 text-lg' : 'py-3 pl-12 pr-28 text-sm'}`}
          />
          <button
            type="submit"
            className={`absolute right-2 rounded-lg bg-accent-blue font-medium text-white
              hover:bg-accent-blue/90 active:scale-95 transition-all
              ${isLarge ? 'px-6 py-2.5 text-base' : 'px-4 py-2 text-sm'}`}
          >
            Explore
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-accent-red">{error}</p>}
    </form>
  );
}
