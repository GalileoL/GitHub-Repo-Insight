import OpenAI from 'openai';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

/** Embed a single text string */
export async function embedText(text: string): Promise<number[]> {
  const res = await getClient().embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return res.data[0].embedding;
}

/** Embed multiple texts in a single batch call */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  // OpenAI supports up to 2048 inputs per call; chunk if needed
  const BATCH = 512;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await getClient().embeddings.create({
      model: 'text-embedding-3-small',
      input: batch,
    });
    for (const d of res.data) {
      results.push(d.embedding);
    }
  }

  return results;
}
