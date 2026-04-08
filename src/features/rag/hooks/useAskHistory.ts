import { useState, useCallback } from 'react';
import type { Source } from '../types';

export interface AskHistoryEntry {
  question: string;
  answer: string;
  sources: Source[];
  timestamp: number;
  shareUrl?: string;
}

const STORAGE_KEY_PREFIX = 'rag-history:';
const MAX_ENTRIES = 20;

function getStorageKey(repo: string): string {
  return `${STORAGE_KEY_PREFIX}${repo}`;
}

function loadHistory(repo: string): AskHistoryEntry[] {
  try {
    const raw = localStorage.getItem(getStorageKey(repo));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(repo: string, entries: AskHistoryEntry[]): void {
  localStorage.setItem(getStorageKey(repo), JSON.stringify(entries.slice(0, MAX_ENTRIES)));
}

export function useAskHistory(repo: string) {
  const [history, setHistory] = useState<AskHistoryEntry[]>(() => loadHistory(repo));

  const addEntry = useCallback(
    (entry: AskHistoryEntry) => {
      setHistory((prev) => {
        // Remove older entry with the same question to avoid duplicates
        const deduped = prev.filter(
          (e) => e.question.trim().toLowerCase() !== entry.question.trim().toLowerCase(),
        );
        const next = [entry, ...deduped].slice(0, MAX_ENTRIES);
        saveHistory(repo, next);
        return next;
      });
    },
    [repo],
  );

  const updateEntry = useCallback(
    (question: string, patch: Partial<AskHistoryEntry>) => {
      setHistory((prev) => {
        const next = prev.map((e) =>
          e.question.trim().toLowerCase() === question.trim().toLowerCase()
            ? { ...e, ...patch }
            : e,
        );
        saveHistory(repo, next);
        return next;
      });
    },
    [repo],
  );

  const clearHistory = useCallback(() => {
    localStorage.removeItem(getStorageKey(repo));
    setHistory([]);
  }, [repo]);

  return { history, addEntry, updateEntry, clearHistory };
}
