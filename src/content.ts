// Types for the generated content index produced by scripts/sync-content.mjs.

export interface SourceRepo {
  owner: string;
  repo: string;
  branch: string;
}

export interface BenchmarkSave {
  /** File name only, e.g. "bench_44k_01_clock.zip". */
  name: string;
  /** Path within the source benchmark folder. */
  path: string;
  /** Direct download URL on the LFS worker: `<lfsWorkerUrl>/objects/<oid>/<file name>`. */
  url: string;
}

export interface BenchmarkEntry {
  slug: string;
  source: string;
  title: string;
  date?: string;
  summary?: string;
  tags?: string[];
  featured?: boolean;
  factorioVersion?: string;
  platform?: string;
  /** From the README's `**CPU:**` header line, e.g. "Ryzen 9800X3D". */
  cpu?: string;
  /** Id of an entry in `ContentIndex.topics`; set in the manifest. */
  topic?: string;
  /** The question the benchmark asks, as one line of plain text (from its "Question" section). */
  question?: string;
  /** One-line result, as plain text (from its "Answer" section, else its "Conclusion"). */
  finding?: string;
  githubUrl: string;
  readmeGithubUrl: string;
  saves: BenchmarkSave[];
  assetCount: number;
  /** True when scripts/sync-content.mjs emitted a timeseries.json next to the README. */
  timeseries?: boolean;
}

/** A topic from the manifest, in display order. */
export interface TopicSummary {
  id: string;
  label: string;
  /** Number of benchmarks with this topic. */
  count: number;
}

export interface ContentIndex {
  sourceRepo: SourceRepo;
  /** Manifest order; empty when the manifest lists none. */
  topics: TopicSummary[];
  benchmarks: BenchmarkEntry[];
  saveStats: { count: number; bytes: number };
}

/**
 * One save in `src/generated/saves.json`:
 * `[path within the source repo, size in bytes, git-lfs sha256 oid]`.
 * A tuple rather than an object so ~650 entries stay small.
 */
export type SaveIndexFile = [path: string, bytes: number, oid: string];

/** Metadata for a top-level folder (`benchmarks/<name>`, `competitions/<name>`). */
export interface SaveFolderMeta {
  /** Set, along with `benchmark_slug`, when the folder is a curated benchmark's `source`. */
  title?: string;
  benchmark_slug?: string;
  /** `YYYY-MM-DD`: from the manifest, else the folder-name prefix. */
  benchmark_date?: string;
  /** From the folder's README. */
  factorio_version?: string;
  /** From the folder's README, e.g. "linux-x86_64". */
  benchmark_machine_platform?: string;
}

/** Every `.zip` committed to the source repo. Loaded on demand by the /saves page. */
export interface SaveIndex {
  /** Download base: `${lfsWorkerUrl}/objects/<oid>/<file name>`. */
  lfsWorkerUrl: string;
  /** Sorted by path. */
  files: SaveIndexFile[];
  /** Keyed by top-level folder path. */
  meta: Record<string, SaveFolderMeta>;
}
