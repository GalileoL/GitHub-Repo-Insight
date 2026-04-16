import OpenAI from 'openai';
import type { ScoredChunk, Source, AskResponse, QueryAnchors } from '../types.js';
import {
  compileAllowedOriginPatterns,
  isAllowedHttpUrlWithCompiledPatterns,
  parseAllowedOriginPatterns,
} from '../security/url-safety.js';

/** Supported LLM providers */
type LLMProvider = 'openai' | 'deepseek' | 'groq' | 'gemini' | 'claude';

const VALID_PROVIDERS = new Set<LLMProvider>(['openai', 'deepseek', 'groq', 'gemini', 'claude']);

function getProvider(): LLMProvider {
  const p = (process.env.LLM_PROVIDER ?? 'openai').toLowerCase() as LLMProvider;
  return VALID_PROVIDERS.has(p) ? p : 'openai';
}

const LLM_CONFIG: Record<LLMProvider, { baseURL?: string; model: string; envKey: string }> = {
  openai: {
    model: 'gpt-4o-mini',
    envKey: 'OPENAI_API_KEY',
  },
  deepseek: {
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    envKey: 'DEEPSEEK_API_KEY',
  },
  groq: {
    baseURL: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    envKey: 'GROQ_API_KEY',
  },
  gemini: {
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-2.0-flash',
    envKey: 'GEMINI_API_KEY',
  },
  claude: {
    baseURL: 'https://api.anthropic.com/v1/',
    model: 'claude-sonnet-4-20250514',
    envKey: 'ANTHROPIC_API_KEY',
  },
};

let client: OpenAI | null = null;
let currentProvider: LLMProvider | null = null;

function getClient(): OpenAI {
  const provider = getProvider();
  if (!client || currentProvider !== provider) {
    const cfg = LLM_CONFIG[provider];
    client = new OpenAI({
      apiKey: process.env[cfg.envKey],
      ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
    });
    currentProvider = provider;
  }
  return client;
}

export function buildContextText(chunks: ScoredChunk[]): string {
  return chunks
    .map((sc, i) => {
      const m = sc.chunk.metadata;
      const header = `[Source ${i + 1}] ${m.title} (${m.type}) — ${m.githubUrl}`;
      return `${header}\n${sc.chunk.content}`;
    })
    .join('\n\n---\n\n');
}

export function buildSources(chunks: ScoredChunk[]): Source[] {
  const allowedPatterns = parseAllowedOriginPatterns(process.env.RAG_ALLOWED_URL_ORIGIN_PATTERNS);
  const compiledAllowedPatterns = compileAllowedOriginPatterns(allowedPatterns);

  return chunks.map((sc) => {
    const m = sc.chunk.metadata;
    const safeUrl = isAllowedHttpUrlWithCompiledPatterns(m.githubUrl, compiledAllowedPatterns)
      ? m.githubUrl
      : '';

    return {
      type: m.type,
      title: m.title,
      url: safeUrl,
      issueNumber: m.issueNumber,
      prNumber: m.prNumber,
      releaseName: m.releaseName,
      snippet: sc.chunk.content.slice(0, 150),
    };
  });
}

const SYSTEM_PROMPT = `You are a knowledgeable assistant that answers questions about a GitHub repository.
You are given context from the repository's README, issues, pull requests, releases, and commits.
Each source includes metadata like created date, author, and state — use these to answer time-based and author-based questions.

Rules:
- Answer based ONLY on the provided context. Do not make up information.
- If the context doesn't contain enough information, say so honestly and explain what data is available.
- If the context includes "[Verified data from GitHub API]", treat those numbers as exact facts — state them confidently without hedging or approximating. Do NOT say "based on indexed data" for verified API data.
- When asked about counts or statistics without verified API data, count the items visible in the provided context and clarify that the count is based on the indexed data (not the full repository).
- Reference specific sources by mentioning issue numbers, PR numbers, release names, or section titles.
- Keep answers concise but informative.
- Use markdown formatting for readability.
- When referencing a source, use the format [Source N] to cite it.
- Reply in the same language the user used in their question.
- Today's date is {{TODAY}}.`;

export function buildMessagesFromContext(
  question: string,
  repo: string,
  contextText: string,
  contextPrefix?: string,
  continuationText?: string,
) {
  const today = new Date().toISOString().slice(0, 10);
  const systemPrompt = SYSTEM_PROMPT.replace('{{TODAY}}', today);
  const fullContext = contextPrefix ? `${contextPrefix}${contextText}` : contextText;
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: `Repository: ${repo}\n\nContext:\n${fullContext}\n\nQuestion: ${question}` },
  ];

  if (continuationText) {
    messages.push(
      { role: 'assistant', content: continuationText },
      {
        role: 'user',
        content: 'Continue from the exact next character without repeating prior text. Keep using the same language as the original question.',
      },
    );
  }

  return messages;
}

function buildMessages(
  question: string,
  repo: string,
  chunks: ScoredChunk[],
  contextPrefix?: string,
  continuationText?: string,
) {
  const context = buildContextText(chunks);
  return buildMessagesFromContext(question, repo, context, contextPrefix, continuationText);
}

async function* generateStreamFromMessages(
  model: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
): AsyncGenerator<string> {
  const stream = await getClient().chat.completions.create({
    model,
    messages,
    temperature: 0.3,
    max_tokens: 1000,
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) yield content;
  }
}

export async function generateAnswer(
  question: string,
  repo: string,
  chunks: ScoredChunk[],
  contextPrefix?: string,
): Promise<AskResponse> {
  const sources = buildSources(chunks);
  const provider = getProvider();
  const model = LLM_CONFIG[provider].model;
  const messages = buildMessages(question, repo, chunks, contextPrefix);

  const response = await getClient().chat.completions.create({
    model,
    messages,
    temperature: 0.3,
    max_tokens: 1000,
  });

  const answer = response.choices[0]?.message?.content ?? 'Unable to generate an answer.';

  return { answer, sources };
}

/** Streaming variant — yields delta strings as they arrive from the LLM. */
export async function* generateAnswerStream(
  question: string,
  repo: string,
  chunks: ScoredChunk[],
  contextPrefix?: string,
  continuationText?: string,
): AsyncGenerator<string> {
  const provider = getProvider();
  const model = LLM_CONFIG[provider].model;
  const messages = buildMessages(question, repo, chunks, contextPrefix, continuationText);
  yield* generateStreamFromMessages(model, messages);
}

/** Streaming variant that reuses a stored context snapshot rather than re-running retrieval. */
export async function* generateAnswerStreamFromContext(
  question: string,
  repo: string,
  contextText: string,
  contextPrefix?: string,
  continuationText?: string,
): AsyncGenerator<string> {
  const provider = getProvider();
  const model = LLM_CONFIG[provider].model;
  const messages = buildMessagesFromContext(question, repo, contextText, contextPrefix, continuationText);
  yield* generateStreamFromMessages(model, messages);
}

const REWRITE_SYSTEM_PROMPT = `You are a search query rewriting assistant. Given a user's question about a GitHub repository, generate semantically distinct reformulations that will improve search retrieval.

Rules:
- Generate exactly the requested number of reformulations
- Each reformulation should approach the question from a different angle
- Expand implicit concepts into explicit implementation-level terms
- If anchor terms are provided, preserve them VERBATIM in every reformulation
- Keep reformulations concise (under 100 words each)
- Return ONLY a JSON array of strings, no other text`;

/**
 * LLM-based query rewrite for strong-llm mode.
 * Generates semantically distinct reformulations of the original query.
 * Called only when deterministic rewrites are insufficient.
 */
export async function rewriteQueries(
  query: string,
  anchors: QueryAnchors,
  count: number = 3,
): Promise<string[]> {
  const provider = getProvider();
  const model = LLM_CONFIG[provider].model;

  const anchorList = [
    ...anchors.filePaths,
    ...anchors.endpoints,
    ...anchors.codeSymbols,
    ...anchors.directories,
  ];
  const anchorInstruction = anchorList.length > 0
    ? `\n\nAnchor terms to preserve verbatim: ${anchorList.join(', ')}`
    : '';

  const response = await getClient().chat.completions.create({
    model,
    messages: [
      { role: 'system', content: REWRITE_SYSTEM_PROMPT },
      { role: 'user', content: `Generate ${count} reformulations of: "${query}"${anchorInstruction}` },
    ],
    temperature: 0.7,
    max_tokens: 300,
  });

  const content = response.choices[0]?.message?.content ?? '[]';
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.every((s: unknown) => typeof s === 'string')) {
      return parsed.slice(0, count);
    }
  } catch {
    // Parse failure — return empty, caller falls back to deterministic
  }
  return [];
}

/**
 * Pre-warm embeddings by requesting embeddings for a few common queries.
 * This is a best-effort optimization to reduce cold start latency on first query.
 */
export async function prewarmEmbeddings(): Promise<void> {
  try {
    const client = getClient();
    await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: ['What is this repository about?', 'How do I use this project?'],
    });
  } catch {
    // Best-effort; ignore failures.
  }
}
