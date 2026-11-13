// The owner's notes for a vault folder: its README, minus the frontmatter and
// the generated block (cover image and the list of string links) at the top.
import { useEffect, useState } from 'react';
import { VAULT_ORIGIN, notesUrl } from '../../catalog';

const cache = new Map<string, Promise<string>>();

const escaped = VAULT_ORIGIN.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const IMAGE_LINE = new RegExp(`^\\s*!\\[[^\\]]*\\]\\(${escaped}/[^)]*\\)\\s*$`);
const STRING_LIST_LINE = new RegExp(`^\\s*(?:[-*+]|\\d+[.)])\\s.*\\]\\(${escaped}/[^)]*\\.txt\\)`);

export function stripNotes(markdown: string): string {
  let text = markdown.replace(/^﻿/, '');
  const front = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (front) text = text.slice(front[0].length);
  const lines = text.split(/\r?\n/);
  let i = 0;
  const skipBlank = () => {
    while (i < lines.length && lines[i].trim() === '') i += 1;
  };
  skipBlank();
  if (i < lines.length && IMAGE_LINE.test(lines[i])) i += 1;
  for (;;) {
    const start = i;
    skipBlank();
    if (i < lines.length && STRING_LIST_LINE.test(lines[i])) {
      i += 1;
      continue;
    }
    i = start;
    break;
  }
  return lines.slice(i).join('\n').trim();
}

function fetchNotes(folder: string): Promise<string> {
  let p = cache.get(folder);
  if (!p) {
    p = fetch(notesUrl(folder))
      .then((res) => {
        if (!res.ok) throw new Error(`README: HTTP ${res.status}`);
        return res.text();
      })
      .then(stripNotes);
    p.catch(() => cache.delete(folder));
    cache.set(folder, p);
  }
  return p;
}

/**
 * The notes to show for a folder: `fallback` (the description from the index) at once, replaced by
 * the stripped README when it arrives; the fallback stays when the fetch fails or the note is empty.
 */
export function useNotes(folder: string | undefined, fallback: string | undefined): string {
  const [fetched, setFetched] = useState<{ folder: string; text: string } | null>(null);
  useEffect(() => {
    if (!folder) return;
    let live = true;
    fetchNotes(folder).then(
      (text) => live && setFetched({ folder, text }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [folder]);
  const note = fetched && fetched.folder === folder ? fetched.text : '';
  return note || fallback?.trim() || '';
}
