/// <reference lib="webworker" />

import { diffWords } from 'diff';

type DiffPart = {
  added?: boolean;
  removed?: boolean;
  value: string;
};

type DiffMessage = {
  previous: string;
  current: string;
};

function isDiffMessage(data: unknown): data is DiffMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as DiffMessage).previous === 'string' &&
    typeof (data as DiffMessage).current === 'string'
  );
}

self.addEventListener('message', (event) => {
  const data: unknown = event.data;

  // Validate message shape before processing
  if (!isDiffMessage(data)) {
    // Ignore unexpected or malformed messages
    return;
  }

  const { previous, current } = data;
  const diff = diffWords(previous, current) as DiffPart[];
  self.postMessage(diff);
});
