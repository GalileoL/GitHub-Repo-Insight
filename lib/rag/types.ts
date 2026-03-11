/** Source type for a RAG chunk */
export type ChunkType = 'readme' | 'issue' | 'pr' | 'release' | 'commit';

/** Query intent classification */
export type QueryCategory = 'documentation' | 'community' | 'changes' | 'general';

/** Metadata attached to each chunk stored in the vector DB */
export interface ChunkMetadata {
  repo: string;
  type: ChunkType;
  title: string;
  githubUrl: string;
  filePath?: string;
  issueNumber?: number;
  prNumber?: number;
  commitSha?: string;
  releaseName?: string;
  createdAt?: string;
  tags?: string[];
}

/** A document chunk ready for embedding */
export interface Chunk {
  id: string;
  content: string;
  metadata: ChunkMetadata;
}

/** A retrieved chunk with relevance score */
export interface ScoredChunk {
  chunk: Chunk;
  score: number;
}

/** A source citation returned to the user */
export interface Source {
  type: ChunkType;
  title: string;
  url: string;
  issueNumber?: number;
  prNumber?: number;
  releaseName?: string;
  snippet?: string;
}

/** Response from the /api/rag/ask endpoint */
export interface AskResponse {
  answer: string;
  sources: Source[];
}

/** Response from the /api/rag/ingest endpoint */
export interface IngestResponse {
  status: 'ok' | 'error';
  chunksIndexed: number;
  message?: string;
}

/** Response from the /api/rag/status endpoint */
export interface StatusResponse {
  indexed: boolean;
  chunkCount: number;
  lastSync?: string;
}

/** Raw GitHub data fetched for ingestion */
export interface RawRepoData {
  readme: string | null;
  issues: RawIssue[];
  pulls: RawPull[];
  releases: RawRelease[];
  commits: RawCommit[];
}

export interface RawIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  created_at: string;
  user: string | null;
  labels: Array<{ name: string }>;
}

export interface RawPull {
  number: number;
  title: string;
  body: string | null;
  state: string;
  merged_at: string | null;
  html_url: string;
  created_at: string;
  user: string | null;
  labels: Array<{ name: string }>;
  changedFiles?: string[];
}

export interface RawRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string;
  prerelease: boolean;
}

export interface RawCommit {
  sha: string;
  message: string;
  html_url: string;
  date: string;
  author: string | null;
}
