// Clipboard helpers. A string is fetched when it is copied; where the browser
// supports it the fetch is handed to the clipboard as a promise, so Safari still
// treats the write as part of the click.
import { useCallback, useEffect, useRef, useState } from 'react';

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function copyFromUrl(url: string): Promise<void> {
  const text = fetchText(url);
  text.catch(() => {}); // handled below; avoid an unhandled rejection while the clipboard waits
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) }),
      ]);
      return;
    } catch {
      /* fall back to writeText once the text is here */
    }
  }
  await navigator.clipboard.writeText(await text);
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export type CopyState = 'idle' | 'busy' | 'copied' | 'failed';

/** Runs a copy and reports its state; "copied" lasts two seconds. Resets when `key` changes. */
export function useCopy(key: string): [CopyState, (run: () => Promise<void>) => void] {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<number | undefined>(undefined);
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    window.clearTimeout(timer.current);
    setState('idle');
  }, [key]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const run = useCallback((copy: () => Promise<void>) => {
    const mine = ++generation.current;
    window.clearTimeout(timer.current);
    setState('busy');
    copy().then(
      () => {
        if (mine !== generation.current) return;
        setState('copied');
        timer.current = window.setTimeout(() => mine === generation.current && setState('idle'), 2000);
      },
      () => mine === generation.current && setState('failed'),
    );
  }, []);

  return [state, run];
}
