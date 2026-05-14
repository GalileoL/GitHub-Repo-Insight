export type ChunkType = 'readme' | 'issue' | 'pr' | 'release' | 'commit' | 'code_summary';

export interface Source {
  type: ChunkType;
  title: string;
  url: string;
  issueNumber?: number;
  prNumber?: number;
  releaseName?: string;
  snippet?: string;
}

export interface AskResponse {
  answer: string;
  sources: Source[];
  requestId?: string;
}

export interface IngestResponse {
  status: 'ok' | 'error';
  chunksIndexed: number;
  message?: string;
}

export interface StatusResponse {
  indexed: boolean;
  chunkCount: number;
  lastSync?: string;
}
