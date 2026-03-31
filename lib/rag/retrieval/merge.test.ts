import { describe, it, expect } from 'vitest';
import { mergeResults, toScoredChunks, buildDiagnosticSnapshots } from './merge.js';
import type { ScoredChunk, RewriteCandidate } from '../types.js';

function makeChunk(id: string, score: number): ScoredChunk {
  return {
    chunk: {
      id,
      content: `Content for ${id}`,
      metadata: {
        repo: 'owner/repo',
        type: 'issue',
        title: `Chunk ${id}`,
        githubUrl: `https://github.com/owner/repo/issues/${id}`,
      },
    },
    score,
  };
}

const dummyCandidate: RewriteCandidate = {
  query: 'rewritten query',
  strategy: 'synonym',
  preservedAnchors: { filePaths: [], endpoints: [], codeSymbols: [], directories: [] },
};

describe('mergeResults', () => {
  it('returns first-pass results unchanged when no rewrite passes', () => {
    const firstPass = [makeChunk('a', 0.9), makeChunk('b', 0.7)];
    const merged = mergeResults(firstPass, [], []);
    expect(merged.length).toBe(2);
    expect(merged[0].chunk.id).toBe('a');
    expect(merged[0].fromOriginal).toBe(true);
    expect(merged[0].originalScore).toBe(0.9);
  });

  it('deduplicates chunks by ID across passes', () => {
    const firstPass = [makeChunk('a', 0.9), makeChunk('b', 0.7)];
    const rewritePass = [makeChunk('a', 0.85), makeChunk('c', 0.8)];
    const merged = mergeResults(firstPass, [rewritePass], [dummyCandidate]);
    const ids = merged.map((m) => m.chunk.id);
    expect(ids.sort()).toEqual(['a', 'b', 'c']);
  });

  it('uses max-wins scoring with consensus bonus', () => {
    const firstPass = [makeChunk('a', 0.9)];
    const rewritePass = [makeChunk('a', 0.85)];
    const merged = mergeResults(firstPass, [rewritePass], [dummyCandidate], 0.05);
    const chunkA = merged.find((m) => m.chunk.id === 'a')!;
    // max(0.9, 0.85) + (2 - 1) * 0.05 = 0.95
    expect(chunkA.mergedScore).toBeCloseTo(0.95, 2);
  });

  it('prefers original on tie (within 0.01)', () => {
    const firstPass = [makeChunk('a', 0.5)];
    const rewritePass = [makeChunk('b', 0.505)];
    const merged = mergeResults(firstPass, [rewritePass], [dummyCandidate]);
    // a is from original (0.5), b is rewrite-only (0.505), within 0.01 → a first
    expect(merged[0].chunk.id).toBe('a');
  });

  it('does not prefer original when score difference is significant', () => {
    const firstPass = [makeChunk('a', 0.5)];
    const rewritePass = [makeChunk('b', 0.8)];
    const merged = mergeResults(firstPass, [rewritePass], [dummyCandidate]);
    expect(merged[0].chunk.id).toBe('b');
  });

  it('tracks sourceQueries correctly', () => {
    const firstPass = [makeChunk('a', 0.9)];
    const rewritePass1 = [makeChunk('a', 0.8)];
    const rewritePass2 = [makeChunk('a', 0.7)];
    const merged = mergeResults(
      firstPass,
      [rewritePass1, rewritePass2],
      [dummyCandidate, { ...dummyCandidate, query: 'second rewrite' }],
    );
    const chunkA = merged.find((m) => m.chunk.id === 'a')!;
    expect(chunkA.sourceQueries.length).toBe(3); // original + 2 rewrites
  });

  it('accepts custom consensus bonus', () => {
    const firstPass = [makeChunk('a', 0.5)];
    const rewritePass = [makeChunk('a', 0.5)];
    const merged0 = mergeResults(firstPass, [rewritePass], [dummyCandidate], 0);
    const merged1 = mergeResults(firstPass, [rewritePass], [dummyCandidate], 0.1);
    expect(merged0[0].mergedScore).toBeCloseTo(0.5, 2);
    expect(merged1[0].mergedScore).toBeCloseTo(0.6, 2);
  });
});

describe('toScoredChunks', () => {
  it('projects MergedChunk to ScoredChunk using mergedScore', () => {
    const firstPass = [makeChunk('a', 0.9)];
    const merged = mergeResults(firstPass, [], []);
    const scored = toScoredChunks(merged);
    expect(scored.length).toBe(1);
    expect(scored[0].chunk.id).toBe('a');
    expect(scored[0].score).toBe(merged[0].mergedScore);
  });
});

describe('buildDiagnosticSnapshots', () => {
  it('computes before/after comparison', () => {
    const firstPass = [makeChunk('a', 0.9), makeChunk('b', 0.7), makeChunk('c', 0.5)];
    const finalChunks = [makeChunk('a', 0.95), makeChunk('d', 0.85), makeChunk('b', 0.7)];
    const { before, after } = buildDiagnosticSnapshots(firstPass, finalChunks, 3);

    expect(before.chunkIds).toEqual(['a', 'b', 'c']);
    expect(after.chunkIds).toEqual(['a', 'd', 'b']);
    expect(after.newChunkIds).toEqual(['d']);
    expect(after.droppedChunkIds).toEqual(['c']);
    expect(after.overlapRatio).toBeCloseTo(2 / 4, 2); // |{a,b}| / |{a,b,c,d}|
  });

  it('handles identical before/after', () => {
    const chunks = [makeChunk('a', 0.9), makeChunk('b', 0.7)];
    const { after } = buildDiagnosticSnapshots(chunks, chunks, 2);
    expect(after.newChunkIds).toEqual([]);
    expect(after.droppedChunkIds).toEqual([]);
    expect(after.overlapRatio).toBe(1);
  });
});
