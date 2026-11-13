// The blueprint catalog, fetched in the browser from the live vault on every
// page load (never baked into the build), plus the URL helpers for strings,
// images, versions and notes.
import { useCallback, useEffect, useState } from 'react';

export const VAULT_ORIGIN = 'https://blueprints.abucnasty.dev';
export const VAULT_REPO_URL = 'https://github.com/abucnasty/factorio-blueprints';
const NOTES_BASE = 'https://raw.githubusercontent.com/abucnasty/factorio-blueprints/main';

export type NodeKind = 'blueprint' | 'blueprint-book' | 'upgrade-planner' | 'deconstruction-planner';

export interface CatalogRender {
  /** Relative to `/<path>/renders/`, e.g. `0.jpg` or `0/3.jpg`. */
  file: string;
  oid: string;
  size: number;
  width?: number;
  height?: number;
}

export interface BookNode {
  slot: number;
  /** Slot path within the book, e.g. `3/1`. */
  path: string;
  kind: NodeKind;
  label: string;
  /** A render file, when this entry has one. */
  render?: string;
  /** Vault folder holding this entry's own README, when it has one. */
  folder?: string;
  children?: BookNode[];
}

export interface CatalogHistoryItem {
  sha: string;
  /** ISO date-time. */
  date: string;
  subject: string;
}

export interface CatalogEntry {
  /** Vault path, e.g. `megabasing/space-science/walt-q5`. */
  path: string;
  title: string;
  authors: string[];
  version?: string;
  posted?: string;
  video?: string;
  deprecated: boolean;
  /** Missing means public. An unlisted build opens by its address but is listed nowhere. */
  status?: 'public' | 'deprecated' | 'unlisted';
  previous_paths?: string[];
  blueprint: {
    kind: NodeKind;
    counts: { blueprints: number; books: number; entities: number; tiles: number };
    description?: string;
    factorioVersion?: string;
  };
  /** Commits that changed the string, newest first. */
  history: CatalogHistoryItem[];
  renders: CatalogRender[];
  /** A render file. */
  cover?: string;
  nodes?: BookNode[];
}

export interface Catalog {
  schema: number;
  generatedAt: string;
  commit: string;
  blueprints: CatalogEntry[];
}

const ZERO_COUNTS = { blueprints: 0, books: 0, entities: 0, tiles: 0 };

const INDEX_URL = `${VAULT_ORIGIN}/index.json`;

/** Keep only entries with the fields the site relies on; ignore anything unknown. */
function normalise(raw: unknown): Catalog {
  const data = raw as Partial<Catalog> | null;
  if (!data || !Array.isArray(data.blueprints)) throw new Error('The catalog has no blueprints list.');
  const blueprints = data.blueprints
    .filter((e): e is CatalogEntry => !!e && typeof e.path === 'string' && typeof e.title === 'string' && !!e.blueprint)
    .map((e) => ({
      ...e,
      authors: Array.isArray(e.authors) ? e.authors : [],
      deprecated: Boolean(e.deprecated),
      history: Array.isArray(e.history) ? e.history : [],
      renders: Array.isArray(e.renders) ? e.renders : [],
      blueprint: { ...e.blueprint, counts: { ...ZERO_COUNTS, ...(e.blueprint.counts as Partial<CatalogEntry['blueprint']['counts']> | undefined) } },
    }));
  return { schema: data.schema ?? 0, generatedAt: data.generatedAt ?? '', commit: data.commit ?? '', blueprints };
}

let pending: Promise<Catalog> | null = null;
let loaded: Catalog | null = null;

/** One fetch per page load, shared by every caller; a failed fetch is forgotten so the next call retries. */
export function loadCatalog(): Promise<Catalog> {
  pending ??= fetch(INDEX_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`index.json: HTTP ${res.status}`);
      return res.json();
    })
    .then((json) => (loaded = normalise(json)))
    .catch((err) => {
      pending = null;
      throw err;
    });
  return pending;
}

export type CatalogState =
  | { status: 'loading'; catalog: null; retry: () => void }
  | { status: 'ready'; catalog: Catalog; retry: () => void }
  | { status: 'failed'; catalog: null; retry: () => void };

/** The catalog for a component: starts the shared fetch on mount. */
export function useCatalog(): CatalogState {
  const [catalog, setCatalog] = useState<Catalog | null>(loaded);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (catalog) return;
    let live = true;
    loadCatalog().then(
      (c) => live && setCatalog(c),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [catalog, attempt]);

  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);

  if (catalog) return { status: 'ready', catalog, retry };
  return { status: failed ? 'failed' : 'loading', catalog: null, retry };
}

/** Site route of an entry. */
export function blueprintRoute(path: string): string {
  return `/blueprints/${path}`;
}

/** The string of an entry, or of one entry of a book (`nodePath`, a slot path such as `3/1`). */
export function stringUrl(path: string, nodePath?: string): string {
  return `${VAULT_ORIGIN}/${path}${nodePath ? `/${nodePath}` : ''}.txt`;
}

/** The string as it was at commit `sha`. */
export function versionUrl(path: string, sha: string): string {
  return `${VAULT_ORIGIN}/${path}@${sha}.txt`;
}

/** A render: `file` is a `renders[].file`, or a book node's `render`. */
export function imageUrl(path: string, file: string): string {
  return `${VAULT_ORIGIN}/${path}/renders/${file}`;
}

/** The README of a vault folder (an entry's `path`, or a node's `folder`). */
export function notesUrl(folder: string): string {
  return `${NOTES_BASE}/${folder}/README.md`;
}

/** False for an unlisted build: it opens by its address but appears in no list, count or search. */
export function isListed(entry: CatalogEntry): boolean {
  return entry.status !== 'unlisted';
}

/** Listed entries that are not deprecated. */
export function activeCount(catalog: Catalog): number {
  return catalog.blueprints.filter((e) => isListed(e) && !e.deprecated).length;
}

/** "common-quality-science" → "Common Quality Science". */
export function folderName(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Category of an entry: the folders between the top-level group and the entry, e.g. "Space Science". */
export function categoryName(path: string): string {
  return path.split('/').slice(1, -1).map(folderName).join(' / ');
}
