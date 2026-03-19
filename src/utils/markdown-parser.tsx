import React from 'react';

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; content: string }
  | { type: 'paragraph'; content: string }
  | { type: 'code'; content: string; lang?: string }
  | { type: 'blockquote'; content: string }
  | {
      type: 'list';
      ordered: boolean;
      level: number;
      items: Array<{
        content: string;
        blocks?: MarkdownBlock[];
      }>;
    }
  | { type: 'table'; headers: string[]; rows: string[][] };

/**
 * Parse a Markdown string into a list of block-level nodes.
 * Supports: paragraphs, fenced code blocks, blockquotes, lists (nested), and tables.
 */
export function parseMarkdown(text: string): MarkdownBlock[] {
  const lines = text.split('\n');
  const blocks: MarkdownBlock[] = [];

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmedLine = line.trimStart();

    // Fenced code block
    const fence = trimmedLine.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || undefined;
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && lines[i].trimStart().startsWith('```')) {
        i += 1;
      }
      blocks.push({ type: 'code', content: codeLines.join('\n'), lang });
      continue;
    }

    // Table detection: require at least 2 lines (header + separator)
    if (i + 1 < lines.length) {
      const headerMatch = lines[i].trim().startsWith('|');
      const sepMatch = lines[i + 1].trim().match(/^\s*\|?\s*[:-]+\s*(\|\s*[:-]+\s*)*\|?\s*$/);
      if (headerMatch && sepMatch) {
        const headerLine = lines[i].trim();
        const headers = headerLine
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((h) => h.trim());
        i += 2;
        const rows: string[][] = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          const row = lines[i]
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((c) => c.trim());
          rows.push(row);
          i += 1;
        }
        blocks.push({ type: 'table', headers, rows });
        continue;
      }
    }

    // Heading (supports # to ######)
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const rest = headingMatch[2];

      // If line contains additional text after a short heading (typical LLM output),
      // split it into a heading + paragraph to avoid rendering a huge heading.
      const words = rest.trim().split(/\s+/);
      if (words.length > 2) {
        blocks.push({ type: 'heading', level, content: words[0] });
        blocks.push({ type: 'paragraph', content: words.slice(1).join(' ') });
      } else {
        blocks.push({ type: 'heading', level, content: rest });
      }
      i += 1;
      continue;
    }

    // Blockquote
    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].match(/^>\s?(.*)$/)) {
        const match = lines[i].match(/^>\s?(.*)$/);
        quoteLines.push(match ? match[1] : '');
        i += 1;
      }
      blocks.push({ type: 'blockquote', content: quoteLines.join(' ') });
      continue;
    }

    // Lists (unordered and ordered)
    const listMatch = line.match(/^(\s*)([-*+]\s+|\d+\.\s+)(.*)$/);
    if (listMatch) {
      const startIndent = listMatch[1].length;
      const ordered = /\d+\./.test(listMatch[2]);

      const parseList = (baseIndent: number, orderedList: boolean) => {
        const items: Array<{ content: string; blocks?: MarkdownBlock[] }> = [];
        while (i < lines.length) {
          const match = lines[i].match(/^(\s*)([-*+]\s+|\d+\.\s+)(.*)$/);
          if (!match) break;
          const indent = match[1].length;
          if (indent < baseIndent) break;
          if (indent > baseIndent) {
            // nested list: attach to last item's blocks
            const nestedOrdered = /\d+\./.test(match[2]);
            const nested = parseList(indent, nestedOrdered);
            if (items.length > 0) {
              if (!items[items.length - 1].blocks) {
                items[items.length - 1].blocks = [];
              }
              items[items.length - 1].blocks!.push(nested);
            }
            continue;
          }

          const content = match[3].trim();
          i += 1;

          // Collect any indented lines that belong to this list item (e.g. code blocks or paragraphs)
          const subLines: string[] = [];
          while (i < lines.length) {
            const nextLine = lines[i];
            const indentMatch = nextLine.match(/^(\s*)/);
            const nextIndent = indentMatch ? indentMatch[1].length : 0;
            if (nextLine.trim() === '') {
              subLines.push('');
              i += 1;
              continue;
            }
            if (nextIndent > baseIndent) {
              const strip = Math.min(nextIndent, baseIndent + 2);
              subLines.push(nextLine.slice(strip));
              i += 1;
              continue;
            }
            break;
          }

          if (subLines.length > 0) {
            items.push({ content, blocks: parseMarkdown(subLines.join('\n')) });
          } else {
            items.push({ content });
          }
        }
        return { type: 'list', ordered: orderedList, level: baseIndent, items } as MarkdownBlock;
      };

      const listBlock = parseList(startIndent, ordered);
      blocks.push(listBlock);
      continue;
    }

    // Blank line indicates paragraph boundary
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Paragraph text
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith('```') || trimmed.startsWith('>') || trimmed.startsWith('|')) break;
      const listLineMatch = lines[i].match(/^(\s*)([-*+]\s+|\d+\.\s+)/);
      if (listLineMatch) break;
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'paragraph', content: paraLines.join('\n') });
  }

  return blocks;
}

/**
 * Render inline markdown (bold, italic, links, images, inline code, [Source N])
 */
export function renderMarkdownInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  const patterns = [
    { type: 'image', regex: /!\[([^\]]*)\]\(([^)]+)\)/ },
    { type: 'link', regex: /\[([^\]]+)\]\(([^)]+)\)/ },
    { type: 'bold', regex: /\*\*(.+?)\*\*/ },
    { type: 'italic', regex: /\*(.+?)\*/ },
    { type: 'inlineCode', regex: /`([^`]+)`/ },
    { type: 'source', regex: /\[Source (\d+)\]/ },
  ];

  while (remaining.length > 0) {
    let earliestIndex = Infinity;
    let match: RegExpExecArray | null = null;
    let matchType: string | null = null;

    for (const pattern of patterns) {
      const m = pattern.regex.exec(remaining);
      if (m && m.index < earliestIndex) {
        earliestIndex = m.index;
        match = m;
        matchType = pattern.type;
      }
    }

    if (!match || matchType === null) {
      nodes.push(remaining);
      break;
    }

    if (match.index > 0) {
      nodes.push(remaining.slice(0, match.index));
    }

    const [full, a, b] = match;
    switch (matchType) {
      case 'image':
        nodes.push(
          <img
            key={key++}
            src={b}
            alt={a}
            className="max-w-full rounded-md"
            loading="lazy"
          />,
        );
        break;
      case 'link':
        nodes.push(
          <a
            key={key++}
            href={b}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent-teal hover:underline"
          >
            {a}
          </a>,
        );
        break;
      case 'bold':
        nodes.push(
          <strong key={key++} className="font-semibold">
            {a}
          </strong>,
        );
        break;
      case 'italic':
        nodes.push(
          <em key={key++} className="italic">
            {a}
          </em>,
        );
        break;
      case 'inlineCode':
        nodes.push(
          <code key={key++} className="text-accent-teal bg-bg-elevated px-1 py-0.5 rounded text-xs">
            {a}
          </code>,
        );
        break;
      case 'source':
        nodes.push(
          <span
            key={key++}
            className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-accent-teal/20 text-accent-teal text-xs font-medium"
          >
            {a}
          </span>,
        );
        break;
    }

    remaining = remaining.slice(match.index + full.length);
  }

  return nodes;
}

