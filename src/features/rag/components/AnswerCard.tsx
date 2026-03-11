import { useState, useCallback } from 'react';

interface AnswerCardProps {
  answer: string;
  isLoading: boolean;
  isStreaming?: boolean;
}

export default function AnswerCard({ answer, isLoading, isStreaming }: AnswerCardProps) {
  if (isLoading && !answer) {
    return (
      <div className="rounded-xl border border-border-default bg-bg-surface p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-5 w-5 rounded-full border-2 border-accent-teal border-t-transparent animate-spin" />
          <span className="text-sm text-text-muted">Thinking...</span>
        </div>
        <div className="space-y-3 animate-pulse">
          <div className="h-4 bg-bg-elevated rounded w-full" />
          <div className="h-4 bg-bg-elevated rounded w-5/6" />
          <div className="h-4 bg-bg-elevated rounded w-4/6" />
        </div>
      </div>
    );
  }

  const blocks = parseBlocks(answer);

  return (
    <div className="rounded-xl border border-border-default bg-bg-surface p-6">
      <h3 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-3">Answer</h3>
      <div className="space-y-2 text-text-primary text-sm leading-relaxed">
        {blocks.map((block, i) =>
          block.type === 'code' ? (
            <CodeBlock key={i} code={block.content} lang={block.lang} />
          ) : (
            <div key={i}>
              {block.content.split('\n').map((line, j) => {
                if (!line.trim()) return <br key={j} />;
                return <p key={j} className="mb-2 last:mb-0">{renderInlineMarkdown(line)}</p>;
              })}
            </div>
          ),
        )}
        {isStreaming && (
          <span className="inline-block w-2 h-4 bg-accent-teal animate-pulse rounded-sm ml-0.5 align-text-bottom" />
        )}
      </div>
    </div>
  );
}

interface Block {
  type: 'text' | 'code';
  content: string;
  lang?: string;
}

/** Parse markdown into text blocks and fenced code blocks */
function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let i = 0;
  let textBuf: string[] = [];

  const flushText = () => {
    if (textBuf.length > 0) {
      blocks.push({ type: 'text', content: textBuf.join('\n') });
      textBuf = [];
    }
  };

  while (i < lines.length) {
    const fenceMatch = /^```(\w*)/.exec(lines[i]);
    if (fenceMatch) {
      flushText();
      const lang = fenceMatch[1] || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'code', content: codeLines.join('\n'), lang });
      i++; // skip closing ```
    } else {
      textBuf.push(lines[i]);
      i++;
    }
  }
  flushText();
  return blocks;
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  return (
    <div className="relative group rounded-lg bg-bg-elevated border border-border-default overflow-hidden my-3">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-default bg-bg-base/50">
        <span className="text-xs text-text-muted">{lang || 'code'}</span>
        <button
          onClick={handleCopy}
          className="text-xs text-text-muted hover:text-text-primary transition-colors flex items-center gap-1"
        >
          {copied ? (
            <>
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="px-4 py-3 overflow-x-auto text-xs leading-5">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Simple inline markdown renderer for bold, code, and source references */
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold
    const boldMatch = /\*\*(.+?)\*\*/.exec(remaining);
    // Inline code
    const codeMatch = /`(.+?)`/.exec(remaining);
    // Source reference [Source N]
    const sourceMatch = /\[Source (\d+)]/.exec(remaining);

    // Find the earliest match
    const matches = [boldMatch, codeMatch, sourceMatch].filter(Boolean) as RegExpExecArray[];
    if (matches.length === 0) {
      parts.push(remaining);
      break;
    }

    const earliest = matches.reduce((a, b) => (a.index! < b.index! ? a : b));
    const idx = earliest.index!;

    // Text before the match
    if (idx > 0) {
      parts.push(remaining.slice(0, idx));
    }

    if (earliest === boldMatch) {
      parts.push(<strong key={key++}>{boldMatch![1]}</strong>);
      remaining = remaining.slice(idx + boldMatch![0].length);
    } else if (earliest === codeMatch) {
      parts.push(
        <code key={key++} className="text-accent-teal bg-bg-elevated px-1 py-0.5 rounded text-xs">
          {codeMatch![1]}
        </code>,
      );
      remaining = remaining.slice(idx + codeMatch![0].length);
    } else if (earliest === sourceMatch) {
      parts.push(
        <span key={key++} className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-accent-teal/20 text-accent-teal text-xs font-medium">
          {sourceMatch![1]}
        </span>,
      );
      remaining = remaining.slice(idx + sourceMatch![0].length);
    }
  }

  return parts;
}
