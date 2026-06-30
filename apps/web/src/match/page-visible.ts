import { useEffect, useState } from 'react';

let pageVisible = typeof document !== 'undefined' ? !document.hidden : true;
const listeners = new Set<() => void>();

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    pageVisible = !document.hidden;
    for (const listener of listeners) listener();
  });
}

/** Module-level visibility for RAF loops outside React. */
export function isPageVisible(): boolean {
  return pageVisible;
}

export function subscribePageVisible(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => isPageVisible());
  useEffect(() => subscribePageVisible(() => setVisible(isPageVisible())), []);
  return visible;
}

/** True when match is idle (setup/init/post) with no active simulation benefit from full-rate loops. */
export function isIdleMatchPhase(phase: string): boolean {
  return phase === 'setup' || phase === 'init' || phase === 'post';
}
