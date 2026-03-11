import OpenAI from 'openai';
import type { ScoredChunk, Source, AskResponse } from '../types.js';

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

function buildContext(chunks: ScoredChunk[]): string {
  return chunks
    .map((sc, i) => {
      const m = sc.chunk.metadata;
      const header = `[Source ${i + 1}] ${m.title} (${m.type}) — ${m.githubUrl}`;
      return `${header}\n${sc.chunk.content}`;
    })
    .join('\n\n---\n\n');
}

export function buildSources(chunks: ScoredChunk[]): Source[] {
  return chunks.map((sc) => {
    const m = sc.chunk.metadata;
    return {
      type: m.type,
      title: m.title,
      url: m.githubUrl,
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
- When asked about counts or statistics, count the items visible in the provided context and clarify that the count is based on the indexed data (not the full repository).
- Reference specific sources by mentioning issue numbers, PR numbers, release names, or section titles.
- Keep answers concise but informative.
- Use markdown formatting for readability.
- When referencing a source, use the format [Source N] to cite it.
- Today's date is {{TODAY}}.`;

function buildMessages(question: string, repo: string, chunks: ScoredChunk[]) {
  const context = buildContext(chunks);
  const today = new Date().toISOString().slice(0, 10);
  const systemPrompt = SYSTEM_PROMPT.replace('{{TODAY}}', today);
  return [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: `Repository: ${repo}\n\nContext:\n${context}\n\nQuestion: ${question}` },
  ];
}

export async function generateAnswer(
  question: string,
  repo: string,
  chunks: ScoredChunk[],
): Promise<AskResponse> {
  const sources = buildSources(chunks);
  const provider = getProvider();
  const model = LLM_CONFIG[provider].model;
  const messages = buildMessages(question, repo, chunks);

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
): AsyncGenerator<string> {
  const provider = getProvider();
  const model = LLM_CONFIG[provider].model;
  const messages = buildMessages(question, repo, chunks);

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
