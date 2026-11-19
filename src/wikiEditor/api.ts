// The editor's calls to the site's Worker (worker/wikiSave.ts): a page's source on the vault's
// main branch, and saving (which merges with edits made meanwhile, or answers a conflict: see
// worker/wikiMerge.ts).
import type { OtherEdit } from './concurrent';

export type { OtherEdit };

export interface PageSource {
  /** Vault path, e.g. wiki/Guides/How to Benchmark.md; null for a page not saved yet. */
  path: string | null;
  title: string;
  folder: string;
  /** The git blob the editor started from; null for a new page. */
  blob: string | null;
  /** main's head when the page was read: the Worker names the edits made since. */
  head?: string;
  frontmatter: string;
  body: string;
  draft: boolean;
}

export interface SaveResult {
  ok: true;
  unchanged?: boolean;
  commit?: string;
  path: string;
  slug: string;
  title: string;
  folder: string;
  blob: string;
  frontmatter: string;
  draft: boolean;
  created?: boolean;
  /** The images saved with the page: vault path and LFS object id. */
  images?: Array<{ path: string; oid: string }>;
  /** The page's body as saved (with other edits combined in, when there were any). */
  body?: string;
  /** Edits made meanwhile that the save was combined with (newest first). */
  merged?: { edits: OtherEdit[] };
  /** The page was renamed meanwhile: its path when the editor opened it. */
  renamedFrom?: string;
  /** What the page view says about it besides "Saved" (set by the editor). */
  notice?: string;
}


/** A 409 `conflict`: the page changed in the same places the editor changed. */
export interface Conflict {
  path: string;
  title: string;
  folder: string;
  base: { blob: string; body: string | null };
  theirs: { blob: string; head: string; frontmatter: string; body: string; draft: boolean; edits: OtherEdit[] };
  /** The editor's text as sent, and with the other edit's non-overlapping changes already in. */
  mine: { body: string; combined: string };
  renamedFrom?: string;
}

/** A 409 `gone`: the page was deleted while it was being edited. */
export interface Gone {
  deleted: OtherEdit | null;
  path: string;
  title: string;
  folder: string;
}

/** A refusal from the Worker: `error` is its code (conflict, not_editor, read_only, ...). */
export class SaveError extends Error {
  readonly status: number;
  readonly code: string;
  /** The whole answer (a conflict's versions, who deleted the page). */
  readonly detail: Record<string, unknown>;
  constructor(status: number, code: string, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }

  /** The versions to combine, for a conflict the Worker could merge three ways. */
  conflict(): Conflict | null {
    const d = this.detail as Partial<Conflict>;
    return this.code === 'conflict' && d.theirs && d.mine && typeof d.path === 'string' ? (d as Conflict) : null;
  }

  /** The page was deleted meanwhile (an editor's save). */
  gone(): Gone | null {
    const d = this.detail as Partial<Gone>;
    return this.code === 'gone' && typeof d.path === 'string' && typeof d.title === 'string' && 'deleted' in d ? (d as Gone) : null;
  }
}

async function refusal(res: Response, fallback: string): Promise<SaveError> {
  const body = (await res.json().catch(() => null)) as ({ error?: string; message?: string } & Record<string, unknown>) | null;
  return new SaveError(res.status, body?.error ?? 'error', body?.message ?? fallback, body ?? {});
}

export async function loadSource(slug: string): Promise<PageSource> {
  let res: Response;
  try {
    res = await fetch(`/api/wiki/source?slug=${encodeURIComponent(slug)}`, { credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new SaveError(0, 'network', "Couldn't reach the site. Check your connection and try again.");
  }
  if (!res.ok) throw await refusal(res, "The page couldn't be opened for editing.");
  return (await res.json()) as PageSource;
}

export interface SaveInput {
  source: PageSource;
  body: string;
  draft: boolean;
  summary: string;
  /** New images, by file name. */
  images: Array<{ name: string; blob: Blob }>;
}

export async function savePage(input: SaveInput): Promise<SaveResult> {
  const { source } = input;
  const meta = {
    ...(source.path ? { path: source.path } : { create: { title: source.title, folder: source.folder } }),
    base: source.blob,
    ...(source.head ? { head: source.head } : {}),
    frontmatter: source.frontmatter,
    body: input.body,
    draft: input.draft,
    summary: input.summary,
  };
  const form = new FormData();
  form.set('save', JSON.stringify(meta));
  for (const image of input.images) form.set(`image:${image.name}`, image.blob, image.name);
  let res: Response;
  try {
    res = await fetch('/api/wiki/save', { method: 'POST', body: form, credentials: 'same-origin' });
  } catch {
    throw new SaveError(0, 'network', "Couldn't reach the site, so the page may not have been saved. Check your connection, then save again.");
  }
  if (!res.ok) throw await refusal(res, `Saving failed (HTTP ${res.status}). Nothing was saved.`);
  return (await res.json()) as SaveResult;
}
