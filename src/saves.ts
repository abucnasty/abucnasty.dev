// Folder-tree model over the flat save index, plus the lazy loader for it.
import type { SaveFolderMeta, SaveIndex } from './content';

export interface SaveFile {
  name: string;
  /** Full path within the source repo. */
  path: string;
  /** Path of the containing folder. */
  dir: string;
  bytes: number;
  /** Direct download URL on the LFS worker. */
  url: string;
  /** Lower-cased text the search matches against: path + benchmark title. */
  haystack: string;
}

export interface SaveFolder {
  name: string;
  /** Full path within the source repo; '' for the root. */
  path: string;
  folders: SaveFolder[];
  files: SaveFile[];
  /** Totals for everything underneath, however deep. */
  count: number;
  bytes: number;
}

export interface SaveTree {
  root: SaveFolder;
  /** Every save, in index (path) order. */
  all: SaveFile[];
  meta: Record<string, SaveFolderMeta>;
}

export function buildSaveTree(index: SaveIndex): SaveTree {
  const root: SaveFolder = { name: '', path: '', folders: [], files: [], count: 0, bytes: 0 };
  const byPath = new Map<string, SaveFolder>([['', root]]);
  const all: SaveFile[] = [];

  for (const [path, bytes, oid] of index.files) {
    const parts = path.split('/');
    const name = parts[parts.length - 1];
    let node = root;
    node.count += 1;
    node.bytes += bytes;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const folderPath = parts.slice(0, i + 1).join('/');
      let child = byPath.get(folderPath);
      if (!child) {
        child = { name: parts[i], path: folderPath, folders: [], files: [], count: 0, bytes: 0 };
        byPath.set(folderPath, child);
        node.folders.push(child);
      }
      node = child;
      node.count += 1;
      node.bytes += bytes;
    }
    const title = index.meta[parts.slice(0, 2).join('/')]?.title ?? '';
    const file: SaveFile = {
      name,
      path,
      dir: node.path,
      bytes,
      // Same scheme as the per-benchmark saves in sync-content.mjs: the file
      // name is appended so browsers save the download under the right name.
      url: `${index.lfsWorkerUrl}/objects/${oid}/${encodeURIComponent(name)}`,
      haystack: `${path} ${title}`.toLowerCase(),
    };
    node.files.push(file);
    all.push(file);
  }
  return { root, all, meta: index.meta };
}

export function findFolder(tree: SaveTree, path: string): SaveFolder | null {
  let node = tree.root;
  if (!path) return node;
  for (const segment of path.split('/')) {
    const next = node.folders.find((f) => f.name === segment);
    if (!next) return null;
    node = next;
  }
  return node;
}

/**
 * Follow folders that hold nothing but one sub-folder ("5_tiles / maps") down
 * to the first one with something to show.
 */
export function collapseChain(folder: SaveFolder): { folder: SaveFolder; label: string } {
  const names = [folder.name];
  let current = folder;
  while (current.files.length === 0 && current.folders.length === 1) {
    current = current.folders[0];
    names.push(current.name);
  }
  return { folder: current, label: names.join(' / ') };
}

/** Whitespace-separated terms; a save matches when every term does. */
export function searchSaves(tree: SaveTree, query: string): SaveFile[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return tree.all.filter((f) => terms.every((t) => f.haystack.includes(t)));
}

/** Site route for a folder in the save browser. */
export function saveFolderRoute(path: string): string {
  return path ? `/saves/${path.split('/').map(encodeURIComponent).join('/')}` : '/saves';
}

let pending: Promise<SaveTree> | null = null;
let loaded: SaveTree | null = null;

/** The tree, if an earlier call to `loadSaveTree` has already finished. */
export function loadedSaveTree(): SaveTree | null {
  return loaded;
}

/**
 * The index is its own chunk, fetched the first time something asks for it,
 * so pages that never show saves don't download it.
 */
export function loadSaveTree(): Promise<SaveTree> {
  pending ??= import('./generated/saves.json')
    .then((mod) => (loaded = buildSaveTree(mod.default as unknown as SaveIndex)))
    .catch((err) => {
      pending = null; // let a later visit to the page try again
      throw err;
    });
  return pending;
}
