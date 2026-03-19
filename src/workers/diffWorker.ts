/// <reference lib="webworker" />

import { diffWords } from 'diff';

type DiffPart = {
  added?: boolean;
  removed?: boolean;
  value: string;
};

self.addEventListener('message', (event) => {
  const { previous, current } = event.data as { previous: string; current: string };
  const diff = diffWords(previous, current) as DiffPart[];
  self.postMessage(diff);
});
