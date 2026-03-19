import { useState, useCallback, useMemo, useEffect } from 'react';
import type { StreamStatus } from '../hooks/useAskRepo';
import { diffWords } from 'diff';
import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-bash';
import 'prismjs/themes/prism-tomorrow.css';
import { parseMarkdown, renderMarkdownInline } from '../../../utils/markdown-parser';
import type { MarkdownBlock } from '../../../utils/markdown-parser';

interface AnswerCardProps {
  answer: string;
  previousAnswer?: string | null;
  isLoading: boolean;
  streamStatus?: StreamStatus;
  onCancel?: () => void;
  onRetry?: () => void;
  onShare?: () => void;
  onEdit?: (answer: string) => void;
}

export default function AnswerCard({ answer, previousAnswer, isLoading, streamStatus = 'idle', onCancel, onRetry, onShare, onEdit }: AnswerCardProps) {
  const isStreaming = streamStatus === 'streaming' || streamStatus === 'connecting' || streamStatus === 'reconnecting';
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState(answer);

  useEffect(() => {
    setEditedText(answer);
  }, [answer]);

  // Keyboard shortcut: Escape cancels active streaming.
  useEffect(() => {
    if (!onCancel || !isStreaming) return;

    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isStreaming, onCancel]);

  const downloadMarkdown = () => {
    const blob = new Blob([answer], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'answer.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const startEditing = () => setEditing(true);
  const cancelEditing = () => {
    setEditedText(answer);
    setEditing(false);
  };
  const saveEditing = () => {
    setEditing(false);
    onEdit?.(editedText);
  };

  if (isLoading && !answer) {
    return (
      <div className="rounded-xl border border-border-default bg-bg-surface p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-5 w-5 rounded-full border-2 border-accent-teal border-t-transparent animate-spin" />
          <span className="text-sm text-text-muted">
            {streamStatus === 'connecting'
              ? 'Connecting…'
              : streamStatus === 'reconnecting'
              ? 'Reconnecting…'
              : 'Thinking...'}
          </span>
        </div>
        <div className="space-y-3 animate-pulse">
          <div className="h-4 bg-bg-elevated rounded w-full" />
          <div className="h-4 bg-bg-elevated rounded w-5/6" />
          <div className="h-4 bg-bg-elevated rounded w-4/6" />
        </div>
      </div>
    );
  }

  if (streamStatus === 'cancelled') {
    return (
      <div className="rounded-xl border border-accent-amber/30 bg-accent-amber/5 p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-accent-amber">Stream cancelled</h3>
          <span className="text-xs text-text-muted">{answer.length} chars received</span>
        </div>
        <div className="text-text-primary text-sm leading-relaxed mb-4 max-h-64 overflow-y-auto">
          {answer || '(No content received)'}
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-xs text-accent-amber hover:text-accent-amber/80 transition-colors underline"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  const blocks = parseMarkdown(answer);

  const diffNodes = useMemo(() => {
    if (!previousAnswer || previousAnswer === answer) return null;

    const diff = diffWords(previousAnswer, answer);
    return diff.map((part, idx) => {
      const className = part.added
        ? 'text-accent-green'
        : part.removed
        ? 'text-accent-red line-through'
        : '';
      return (
        <span key={idx} className={className}>
          {part.value}
        </span>
      );
    });
  }, [answer, previousAnswer]);

  return (
    <div className="rounded-xl border border-border-default bg-bg-surface p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-text-muted uppercase tracking-wider">Answer</h3>
        <div className="flex items-center gap-2">
          {isStreaming && (
            <div className="flex items-center gap-1">
              <div className="h-1.5 w-1.5 bg-accent-teal rounded-full animate-pulse" />
              <span className="text-xs text-text-muted">streaming</span>
            </div>
          )}

          {answer && (
            <>
              <button
                onClick={downloadMarkdown}
                className="text-xs text-text-muted hover:text-accent-teal transition-colors px-2 py-0.5 rounded hover:bg-accent-teal/10"
              >
                Download
              </button>
              {onShare && (
                <button
                  onClick={onShare}
                  className="text-xs text-text-muted hover:text-accent-teal transition-colors px-2 py-0.5 rounded hover:bg-accent-teal/10"
                >
                  Share
                </button>
              )}
              {onEdit && !isStreaming && (
                <button
                  onClick={startEditing}
                  className="text-xs text-text-muted hover:text-accent-teal transition-colors px-2 py-0.5 rounded hover:bg-accent-teal/10"
                >
                  Edit
                </button>
              )}
            </>
          )}

          {onCancel && isStreaming && (
            <button
              onClick={onCancel}
              className="text-xs text-text-muted hover:text-accent-red transition-colors px-2 py-0.5 rounded hover:bg-accent-red/10"
            >
              Stop
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="mb-4 space-y-2">
          <textarea
            value={editedText}
            onChange={(e) => setEditedText(e.target.value)}
            className="w-full min-h-[160px] rounded-lg border border-border-default bg-bg-surface p-3 text-sm text-text-primary resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={saveEditing}
              className="rounded-lg bg-accent-teal px-4 py-2 text-sm font-medium text-white hover:bg-accent-teal/90"
            >
              Save
            </button>
            <button
              onClick={cancelEditing}
              className="rounded-lg border border-border-default bg-bg-surface px-4 py-2 text-sm font-medium text-text-muted hover:bg-bg-elevated"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {diffNodes && (
        <div className="mb-4 rounded-lg border border-border-default bg-bg-surface p-4 text-xs leading-relaxed">
          <div className="text-text-muted mb-2">Changes since last attempt:</div>
          <div className="whitespace-pre-wrap break-words">{diffNodes}</div>
        </div>
      )}

      <div className="space-y-2 text-text-primary text-sm leading-relaxed">
        {renderBlocks(blocks)}
        {isStreaming && (
          <span className="inline-block w-2 h-4 bg-accent-teal animate-pulse rounded-sm ml-0.5 align-text-bottom" />
        )}
      </div>
    </div>
  );
}

function renderBlocks(blocks: MarkdownBlock[]): React.ReactNode[] {
  return blocks.map((block, idx) => {
    switch (block.type) {
      case 'paragraph':
        return (
          <p key={idx} className="mb-3 last:mb-0">
            {renderMarkdownInline(block.content)}
          </p>
        );
      case 'code':
        return <CodeBlock key={idx} code={block.content} lang={block.lang} />;
      case 'blockquote':
        return (
          <div
            key={idx}
            className="rounded-lg border-l-4 border-accent-teal/60 bg-accent-teal/10 px-4 py-3 my-3 text-sm text-text-primary"
          >
            {renderMarkdownInline(block.content)}
          </div>
        );
      case 'list':
        const indentClasses = ['ml-0', 'ml-4', 'ml-8', 'ml-12', 'ml-16'];
        const indentLevel = Math.min(indentClasses.length - 1, Math.floor(block.level / 2));
        return (
          <div key={idx} className={`my-3 ${indentClasses[indentLevel]}`}>
            {renderList(block)}
          </div>
        );
      case 'table':
        return (
          <div key={idx} className="overflow-x-auto my-4">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr>
                  {block.headers.map((header, hIdx) => (
                    <th
                      key={hIdx}
                      className="border border-border-default bg-bg-surface px-3 py-2 text-left font-semibold"
                    >
                      {renderMarkdownInline(header)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rIdx) => (
                  <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-bg-surface/50' : ''}>
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="border border-border-default px-3 py-2">
                        {renderBlocks(parseMarkdown(cell))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        return null;
    }
  });
}

function renderList(list: Extract<MarkdownBlock, { type: 'list' }>): React.ReactNode {
  const Component = list.ordered ? 'ol' : 'ul';

  const renderItem = (item: { content: string; blocks?: MarkdownBlock[] }, idx: number) => (
    <li key={idx} className="mb-1">
      <div className="inline-flex gap-1">{renderMarkdownInline(item.content)}</div>
      {item.blocks && <div className="ml-5 mt-1">{renderBlocks(item.blocks)}</div>}
    </li>
  );

  return (
    <Component className={list.ordered ? 'list-decimal list-inside' : 'list-disc list-inside'}>
      {list.items.map(renderItem)}
    </Component>
  );
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  const prismLang = (lang || 'javascript').toLowerCase().trim();
  const highlighted = useMemo(() => {
    const grammar = Prism.languages[prismLang] || Prism.languages.javascript;
    try {
      return Prism.highlight(code, grammar, prismLang);
    } catch {
      return code;
    }
  }, [code, prismLang]);

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
        <code
          className={`language-${prismLang}`}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
}
