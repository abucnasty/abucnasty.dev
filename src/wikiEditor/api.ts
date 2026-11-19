// The editor's calls to the site's Worker (worker/wikiSave.ts): a page's source on the vault's
// main branch, and saving.

export interface PageSource {
  /** Vault path, e.g. wiki/Guides/How to Benchmark.md; null for a page not saved yet. */
  path: string | null;
  title: string;
  folder: string;
  /** The git blob the editor started from; null for a new page. */
  blob: string | null;
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
}

/** A refusal from the Worker: `error` is its code (conflict, not_editor, read_only, ...). */
export class SaveError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function refusal(res: Response, fallback: string): Promise<SaveError> {
  const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  return new SaveError(res.status, body?.error ?? 'error', body?.message ?? fallback);
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
