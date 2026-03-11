const SUGGESTED = [
  'What does this repository mainly do?',
  'What changed most recently?',
  'What are the main themes in recent PRs?',
  'What issues are most commonly discussed?',
  'Which files are frequently changed?',
  'How do I get started with this project?',
];

interface SuggestedQuestionsProps {
  onSelect: (question: string) => void;
  disabled?: boolean;
}

export default function SuggestedQuestions({ onSelect, disabled }: SuggestedQuestionsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {SUGGESTED.map((q) => (
        <button
          key={q}
          onClick={() => onSelect(q)}
          disabled={disabled}
          className="rounded-lg border border-border-default bg-bg-surface px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-accent-teal hover:text-accent-teal disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {q}
        </button>
      ))}
    </div>
  );
}
