/// <reference lib="webworker" />

import { diffWords } from 'diff';

type DiffPart = {
  added?: boolean;
  removed?: boolean;
  value: string;
};

self.addEventListener('message', (event) => {
  const data = event.data;

  // Validate message shape before processing
  if (
    !data ||
    typeof data !== 'object' ||
    typeof (data as any).previous !== 'string' ||
    typeof (data as any).current !== 'string'
  ) {
    // Ignore unexpected or malformed messages
    return;
  }

  const { previous, current } = data as { previous: string; current: string };
  const diff = diffWords(previous, current) as DiffPart[];
  self.postMessage(diff);
});
