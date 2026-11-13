/**
 * Save index: every Factorio save (`*.zip`) committed to the source repo, with
 * its size and git-lfs object id, plus a little metadata per top-level folder.
 * Feeds the /saves page.
 *
 * Everything is read from git objects at HEAD, never from the working tree.
 * CI checks the source repo out sparsely (only curated benchmark folders), so
 * most saves have no file on disk there — but their LFS pointers are still
 * ordinary blobs in HEAD's tree. Reading objects also sidesteps the LFS smudge
 * filter: `git cat-file` always returns the pointer text, whether or not the
 * real file has been pulled.
 *
 * Cost is a fixed handful of git processes, however many saves there are:
 *   1. `git ls-tree -r`      → every path + blob id in HEAD
 *   2. `git rev-list` + `git fetch` (partial clones only) → download whichever
 *      of the blobs we need are not local yet, in one request
 *   3. `git cat-file --batch` → contents of every pointer + README
 */
import { execFileSync } from 'node:child_process';
import { parseReadmeMeta } from './readme-meta.mjs';

const MAX_BUFFER = 256 * 1024 * 1024;
/** LFS pointers are ~130 bytes; the spec caps them well under this. */
const MAX_POINTER_BYTES = 1024;

/**
 * @typedef {[path: string, bytes: number, oid: string]} SaveFile
 * @typedef {{ title?: string, benchmark_slug?: string, benchmark_date?: string, factorio_version?: string, benchmark_machine_platform?: string }} SaveFolderMeta
 * @typedef {{ lfsWorkerUrl: string, files: SaveFile[], meta: Record<string, SaveFolderMeta> }} SaveIndex
 */

/**
 * @param {object} opts
 * @param {string} opts.repoPath  Local clone of the source repo.
 * @param {string} [opts.lfsWorkerUrl]
 * @param {Array<{ slug: string, source: string, title: string, date?: string }>} opts.benchmarks  Manifest entries.
 * @param {(msg: string) => void} [opts.log]
 * @returns {SaveIndex}
 */
export function buildSaveIndex({ repoPath, lfsWorkerUrl, benchmarks, log = () => {} }) {
  if (!lfsWorkerUrl) {
    throw new Error('save index: manifest.lfsWorkerUrl is not set, so there is nowhere to download saves from');
  }

  const tree = listHeadTree(repoPath);

  const zips = tree.filter((e) => /\.zip$/i.test(e.path));
  if (zips.length === 0) {
    throw new Error(`save index: no .zip files in HEAD of ${repoPath} — refusing to publish an empty save browser`);
  }

  // A "top-level folder" is the first two path segments (benchmarks/<name>,
  // competitions/<name>): the unit the page shows a header card for.
  const folders = [...new Set(zips.map((z) => topLevelFolder(z.path)).filter(Boolean))].sort();
  const readmeOidByPath = new Map(
    tree.filter((e) => /(^|\/)readme\.md$/i.test(e.path)).map((e) => [e.path.toLowerCase(), e.oid]),
  );
  const readmeOidByFolder = new Map();
  for (const folder of folders) {
    const oid = readmeOidByPath.get(`${folder}/readme.md`.toLowerCase());
    if (oid) readmeOidByFolder.set(folder, oid);
  }

  const wanted = [...new Set([...zips.map((z) => z.oid), ...readmeOidByFolder.values()])];
  const fetched = fetchMissingBlobs(repoPath, wanted, log);
  const blobs = readBlobs(repoPath, wanted);

  /** @type {SaveFile[]} */
  const files = zips
    .map((z) => {
      const pointer = parseLfsPointer(blobs.get(z.oid));
      if (!pointer) {
        throw new Error(`save index: no LFS OID found for ${z.path} — ensure the file is tracked by git-lfs`);
      }
      return /** @type {SaveFile} */ ([z.path, pointer.size, pointer.oid]);
    })
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const bySource = new Map(benchmarks.map((b) => [b.source.replace(/^\/+|\/+$/g, ''), b]));
  /** @type {Record<string, SaveFolderMeta>} */
  const meta = {};
  for (const folder of folders) {
    const entry = bySource.get(folder);
    const readme = blobs.get(readmeOidByFolder.get(folder));
    const { factorioVersion, platform } = readme ? parseReadmeMeta(readme.toString('utf8')) : {};
    const datePrefix = folder.split('/')[1].match(/^(\d{4}-\d{2}-\d{2})-/);
    /** @type {SaveFolderMeta} */
    const m = {
      title: entry?.title,
      benchmark_slug: entry?.slug,
      benchmark_date: entry?.date ?? datePrefix?.[1],
      factorio_version: factorioVersion,
      benchmark_machine_platform: platform,
    };
    // JSON.stringify drops the undefined fields; skip folders with nothing to say.
    if (Object.values(m).some((v) => v !== undefined)) meta[folder] = m;
  }

  const bytes = files.reduce((sum, f) => sum + f[1], 0);
  log(
    `✓ saves.json (${files.length} saves, ${(bytes / 1e9).toFixed(2)} GB, ${folders.length} folders` +
      (fetched ? `; fetched ${fetched} missing blobs in one batch` : '') +
      ')',
  );
  return { lfsWorkerUrl: lfsWorkerUrl.replace(/\/+$/, ''), files, meta };
}

/**
 * The sha256 object id and size inside a git-lfs pointer blob, or null when the
 * blob is not a pointer (a real file, too large to be one, or missing).
 *
 * @param {Buffer | undefined} blob
 * @returns {{ oid: string, size: number } | null}
 */
export function parseLfsPointer(blob) {
  if (!blob || blob.length > MAX_POINTER_BYTES) return null;
  const text = blob.toString('utf8');
  const oid = text.match(/^oid sha256:([0-9a-f]{64})$/m);
  const size = text.match(/^size (\d+)$/m);
  return oid && size ? { oid: oid[1], size: Number(size[1]) } : null;
}

/**
 * Looks up paths in HEAD of the source repo: is each a folder, a git-lfs
 * pointer, an ordinary file, or absent. Same object-reading rules as the save
 * index (works in sparse and partial clones, ignores the working tree).
 * The tree is listed once; each `classify` call costs one `git cat-file` at
 * most, and none when no path is a file.
 *
 * @param {string} repoPath
 */
export function createHeadReader(repoPath) {
  /** @type {Map<string, string> | undefined} */
  let blobOids;
  /** @type {Set<string> | undefined} */
  let dirs;
  const load = () => {
    if (blobOids && dirs) return { blobOids, dirs };
    blobOids = new Map();
    dirs = new Set();
    for (const { path: p, oid } of listHeadTree(repoPath)) {
      blobOids.set(p, oid);
      const parts = p.split('/');
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    }
    return { blobOids, dirs };
  };

  return {
    /**
     * @param {string[]} paths  Repo-relative, no trailing slash.
     * @returns {Map<string, { kind: 'dir' } | { kind: 'file' } | { kind: 'lfs', oid: string, size: number }>}
     */
    classify(paths) {
      const { blobOids, dirs } = load();
      const result = new Map();
      const files = [];
      for (const p of paths) {
        if (dirs.has(p)) result.set(p, { kind: 'dir' });
        else if (blobOids.has(p)) files.push(p);
      }
      const oids = [...new Set(files.map((p) => blobOids.get(p)))];
      const blobs = oids.length ? readBlobs(repoPath, oids) : new Map();
      for (const p of files) {
        const pointer = parseLfsPointer(blobs.get(blobOids.get(p)));
        result.set(p, pointer ? { kind: 'lfs', ...pointer } : { kind: 'file' });
      }
      return result;
    },
  };
}

/** @param {string} filePath */
function topLevelFolder(filePath) {
  const parts = filePath.split('/');
  return parts.length >= 3 ? `${parts[0]}/${parts[1]}` : null;
}

/**
 * @param {string} repoPath
 * @param {string[]} args
 * @param {import('node:child_process').ExecFileSyncOptions} [opts]
 * @returns {Buffer}
 */
function git(repoPath, args, opts = {}) {
  return /** @type {Buffer} */ (
    execFileSync('git', ['-C', repoPath, ...args], {
      maxBuffer: MAX_BUFFER,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...opts,
    })
  );
}

/**
 * Every blob in HEAD's tree. Deliberately not `ls-tree -l`: asking for sizes
 * makes git lazily download each missing blob of a partial clone, one request
 * per blob.
 *
 * @param {string} repoPath
 * @returns {Array<{ path: string, oid: string }>}
 */
function listHeadTree(repoPath) {
  let out;
  try {
    // A plain folder nested inside some other repository would otherwise be
    // answered with that repository's tree.
    if (git(repoPath, ['rev-parse', '--show-prefix']).toString('utf8').trim() !== '') {
      throw new Error('it is a sub-folder of another git repository, not a clone of its own');
    }
    out = git(repoPath, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD']).toString('utf8');
  } catch (err) {
    throw new Error(
      `save index: could not list HEAD of ${repoPath} — the save index is read from git objects, ` +
        `so the source must be a git clone (${firstLine(err)})`,
    );
  }
  const entries = [];
  for (const record of out.split('\0')) {
    // <mode> SP <type> SP <oid> TAB <path>
    const m = /^\d+ (\w+) ([0-9a-f]+)\t([\s\S]+)$/.exec(record);
    if (m && m[1] === 'blob') entries.push({ oid: m[2], path: m[3] });
  }
  return entries;
}

/**
 * In a partial clone (`--filter=blob:…`), download whichever of `oids` are
 * not in the object store yet with a single fetch — the same request git
 * itself makes when a checkout needs many missing blobs. Without this,
 * `cat-file --batch` would fetch them lazily, one network round trip each.
 *
 * Best effort: if the fetch fails, `readBlobs` still gets every blob the slow
 * way (or reports the ones it truly cannot get).
 *
 * @param {string} repoPath
 * @param {string[]} oids
 * @param {(msg: string) => void} log
 * @returns {number} how many blobs were fetched
 */
function fetchMissingBlobs(repoPath, oids, log) {
  let remote;
  try {
    const cfg = git(repoPath, ['config', '--get-regexp', '^remote\\..*\\.promisor$']).toString('utf8');
    remote = /^remote\.(.+)\.promisor true$/m.exec(cfg)?.[1];
  } catch {
    /* exit 1 = no promisor remote = not a partial clone */
  }
  if (!remote) return 0;

  // `--missing=print` lists absent objects as `?<oid>` instead of fetching them.
  const listed = git(repoPath, ['rev-list', '--objects', '--no-walk', '--missing=print', 'HEAD']).toString('utf8');
  const absent = new Set(listed.split('\n').filter((l) => l.startsWith('?')).map((l) => l.slice(1)));
  const missing = oids.filter((oid) => absent.has(oid));
  if (missing.length === 0) return 0;

  try {
    git(
      repoPath,
      [
        '-c', 'fetch.negotiationAlgorithm=noop',
        'fetch', remote,
        '--no-tags', '--no-write-fetch-head', '--recurse-submodules=no', '--no-auto-maintenance',
        '--stdin',
      ],
      { input: missing.join('\n') + '\n', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
    return missing.length;
  } catch (err) {
    log(`! bulk fetch of ${missing.length} blobs failed, falling back to one-by-one (${firstLine(err)})`);
    return 0;
  }
}

/**
 * Contents of many blobs from one `git cat-file --batch` process.
 *
 * @param {string} repoPath
 * @param {string[]} oids
 * @returns {Map<string, Buffer>}
 */
function readBlobs(repoPath, oids) {
  let out;
  try {
    out = git(repoPath, ['cat-file', '--batch'], { input: oids.join('\n') + '\n' });
  } catch (err) {
    throw new Error(`save index: git cat-file failed in ${repoPath} (${firstLine(err)})`);
  }
  // Each reply is `<oid> <type> <size>\n<contents>\n`, or `<oid> missing\n`.
  const blobs = new Map();
  let offset = 0;
  for (const oid of oids) {
    const eol = out.indexOf(0x0a, offset);
    const header = eol < 0 ? '' : out.toString('utf8', offset, eol);
    const m = /^([0-9a-f]+) blob (\d+)$/.exec(header);
    if (!m || m[1] !== oid) {
      throw new Error(`save index: could not read blob ${oid} from ${repoPath} (git said: "${header}")`);
    }
    const size = Number(m[2]);
    blobs.set(oid, out.subarray(eol + 1, eol + 1 + size));
    offset = eol + 1 + size + 1;
  }
  return blobs;
}

/** @param {unknown} err */
function firstLine(err) {
  const e = /** @type {{ stderr?: Buffer, message?: string }} */ (err ?? {});
  const text = (e.stderr?.length ? e.stderr.toString('utf8') : e.message) ?? String(err);
  return text.trim().split('\n')[0];
}
