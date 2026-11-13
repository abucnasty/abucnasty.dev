#!/usr/bin/env node
/**
 * Content sync: copies curated benchmark folders from a local clone of
 * `factorio-benchmarks` into this site, rewriting markdown asset paths and
 * emitting a typed index that the React app imports.
 *
 * - README.md is rewritten and written to src/generated/benchmarks/<slug>/README.md
 * - All other non-`.zip` files are copied (preserving sub-paths) to public/benchmarks/<slug>/
 * - `.zip` files are NOT copied; the index gets a download URL on the LFS worker
 *   (`manifest.lfsWorkerUrl`) built from the file's git-lfs object id at HEAD.
 * - Relative links in a README point at GitHub: a folder gets its `tree` page, a file
 *   tracked by git-lfs gets the same LFS worker URL as a save, anything else the raw file.
 * - Every `.zip` committed to the source repo (curated or not) is indexed into
 *   src/generated/saves.json for the /saves page — see scripts/lib/save-index.mjs.
 *   That index is read from git objects at HEAD, so the source must be a git clone.
 *
 * Source repo path resolution:
 *   - `.env` and `.env.local` (if present) are loaded from the site root.
 *   1. $FACTORIO_BENCHMARKS_PATH  (preferred — used in CI)
 *   2. ../factorio/factorio-benchmarks  (local dev fallback)
 */
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { aggregateScenarioCsv } from './lib/aggregate.mjs';
import { parseReadmeMeta } from './lib/readme-meta.mjs';
import { stripOwnToc } from './lib/strip-toc.mjs';
import { findSection, removeSection, plainFirstParagraph } from './lib/readme-sections.mjs';
import { buildSaveIndex, createHeadReader } from './lib/save-index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(ROOT, '.env') });
dotenv.config({ path: path.join(ROOT, '.env.local'), override: true });

const MANIFEST_PATH = path.join(ROOT, 'content', 'manifest.json');
const GENERATED_DIR = path.join(ROOT, 'src', 'generated');
const PUBLIC_BENCHMARKS_DIR = path.join(ROOT, 'public', 'benchmarks');

const SOURCE_REPO_PATH =
  process.env.FACTORIO_BENCHMARKS_PATH ??
  path.resolve(ROOT, '..', 'factorio', 'factorio-benchmarks');

/** @typedef {{ name: string, csv: string }} ChartScenario */
/** @typedef {{ name: string, scenarios: ChartScenario[], metrics?: string[] }} ChartGroup */
/** @typedef {{ scenarios?: ChartScenario[], groups?: ChartGroup[], metrics?: string[], removeFirstTicks?: number, maxTicks?: number, window?: number }} ChartConfig */
/** @typedef {{ slug: string, source: string, title: string, date?: string, summary?: string, tags?: string[], topic?: string, featured?: boolean, chart?: ChartConfig }} BenchmarkEntry */
/** @typedef {{ id: string, label: string }} Topic */
/** @typedef {{ sourceRepo: { owner: string, repo: string, branch: string }, lfsWorkerUrl?: string, topics?: Topic[], benchmarks: BenchmarkEntry[] }} Manifest */

/** Shortest text worth showing as a one-line finding. */
const MIN_FINDING_LENGTH = 12;

async function main() {
  const manifest = /** @type {Manifest} */ (
    JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'))
  );

  validateTopics(manifest);
  await assertSourceExists();
  await resetOutputDirs();

  const githubBase = `https://github.com/${manifest.sourceRepo.owner}/${manifest.sourceRepo.repo}`;
  const rawBase = rawBaseOf(manifest);
  const treeBase = `${githubBase}/tree/${manifest.sourceRepo.branch}`;
  const lfsWorkerUrl = manifest.lfsWorkerUrl ?? null;
  const headReader = createHeadReader(SOURCE_REPO_PATH);

  // First, so a broken save index fails the sync before any slower work.
  const saveIndex = buildSaveIndex({
    repoPath: SOURCE_REPO_PATH,
    lfsWorkerUrl: manifest.lfsWorkerUrl,
    benchmarks: manifest.benchmarks,
    log,
  });
  await fs.writeFile(path.join(GENERATED_DIR, 'saves.json'), JSON.stringify(saveIndex));

  const benchmarks = [];
  for (const entry of manifest.benchmarks) {
    const result = await syncBenchmark(entry, githubBase, manifest.sourceRepo.branch, rawBase, treeBase, lfsWorkerUrl, headReader);
    benchmarks.push(result);
    log(`✓ ${entry.slug} (${result.assetCount} assets, ${result.saves.length} saves)`);
  }

  const total = benchmarks.length;
  const count = (key) => benchmarks.filter((b) => b[key]).length;
  log(
    `✓ topics ${count('topic')}/${total} · questions ${count('question')}/${total} · findings ${count('finding')}/${total} · cpu ${count('cpu')}/${total}`,
  );
  if (count('topic') < total) {
    log(`⚠ ${total - count('topic')} of ${total} benchmarks have no topic`);
  }

  await fs.mkdir(GENERATED_DIR, { recursive: true });
  await fs.writeFile(
    path.join(GENERATED_DIR, 'index.json'),
    JSON.stringify(
      {
        sourceRepo: manifest.sourceRepo,
        topics: (manifest.topics ?? []).map((t) => ({
          id: t.id,
          label: t.label,
          count: benchmarks.filter((b) => b.topic === t.id).length,
        })),
        benchmarks,
        saveStats: { count: saveIndex.files.length, bytes: saveIndex.files.reduce((sum, file) => sum + file[1], 0) },
      },
      null,
      2,
    ),
  );
  log(`✓ index.json (${benchmarks.length} benchmarks)`);
}

/**
 * @param {BenchmarkEntry} entry
 * @param {string} githubBase
 * @param {string} branch
 * @param {string} rawBase
 * @param {string} treeBase
 * @param {string|null} lfsWorkerUrl
 * @param {ReturnType<typeof createHeadReader>} headReader
 */
async function syncBenchmark(entry, githubBase, branch, rawBase, treeBase, lfsWorkerUrl, headReader) {
  const srcDir = path.join(SOURCE_REPO_PATH, entry.source);
  await assertDir(srcDir, `benchmark source missing: ${entry.source}`);

  const outMdDir = path.join(GENERATED_DIR, 'benchmarks', entry.slug);
  const outAssetsDir = path.join(PUBLIC_BENCHMARKS_DIR, entry.slug);
  await fs.mkdir(outMdDir, { recursive: true });
  await fs.mkdir(outAssetsDir, { recursive: true });

  const files = await walk(srcDir);
  const saves = [];
  let assetCount = 0;
  let factorioVersion;
  let platform;
  let cpu;
  let question;
  let finding;

  for (const absFile of files) {
    const rel = path.relative(srcDir, absFile);
    const ext = path.extname(rel).toLowerCase();

    // Skip macOS noise
    if (path.basename(rel) === '.DS_Store') continue;

    if (ext === '.zip') {
      const relPath = rel.split(path.sep).join('/');
      const gitObjectPath = `${entry.source}/${relPath}`;
      // Read via git (always returns the raw LFS pointer text, regardless of
      // whether the smudge filter has materialised the file). buildSaveIndex has
      // already failed the sync if lfsWorkerUrl is unset.
      let pointer;
      try {
        pointer = execFileSync(
          'git', ['-C', SOURCE_REPO_PATH, 'show', `HEAD:${gitObjectPath}`],
          { encoding: 'utf8' },
        );
      } catch {
        // Not committed: a gitignored file is skipped silently, an untracked one
        // is read from disk.
        const ignored = (() => {
          try {
            execFileSync('git', ['-C', SOURCE_REPO_PATH, 'check-ignore', '-q', absFile]);
            return true;
          } catch {
            return false;
          }
        })();
        if (ignored) continue;
        pointer = await fs.readFile(absFile, 'utf8').catch(() => '');
      }
      const oidMatch = pointer.match(/^oid sha256:([0-9a-f]{64})$/m);
      if (!oidMatch) throw new Error(`No LFS OID found for ${gitObjectPath} — ensure the file is tracked by git-lfs`);
      // Append the original filename so browsers save the file with the right name.
      const url = `${lfsWorkerUrl}/objects/${oidMatch[1]}/${encodeURIComponent(path.basename(relPath))}`;
      saves.push({ name: path.basename(rel), path: relPath, url });
      continue;
    }

    if (rel.toLowerCase() === 'readme.md') {
      const raw = await fs.readFile(absFile, 'utf8');
      ({ factorioVersion, platform, cpu } = parseReadmeMeta(raw));
      const rawGithubDir = `${rawBase}/${entry.source}`;
      // Order matters: strip the README's own contents list, lift the question and answer
      // sections, and only then rewrite assets and links, so all three files are rewritten alike.
      const stripped = stripOwnToc(raw);
      const lifted = liftQuestionAndAnswer(stripped);
      ({ question, finding } = lifted);
      const linkRewrites = planLinkRewrites(stripped, entry.source, treeBase, lfsWorkerUrl, headReader);
      const rewrite = (md) => rewriteMarkdownAssetPaths(md, entry.slug, rawGithubDir, linkRewrites);
      await fs.writeFile(path.join(outMdDir, 'README.md'), rewrite(lifted.readme));
      if (lifted.questionBody) await fs.writeFile(path.join(outMdDir, 'question.md'), rewrite(lifted.questionBody) + '\n');
      if (lifted.answerBody) await fs.writeFile(path.join(outMdDir, 'answer.md'), rewrite(lifted.answerBody) + '\n');
      continue;
    }

    // Skip file types that are only needed at build time or not served to users.
    const skipExts = new Set(['.csv', '.sh', '.ps1', '.bat', '.txt', '.json']);
    if (skipExts.has(ext)) continue;

    // Everything else (images, svgs, supplementary md) → public assets.
    const dest = path.join(outAssetsDir, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(absFile, dest);
    assetCount++;
  }

  // Optional: aggregate verbose CSVs for interactive charts.
  const timeseries = entry.chart
    ? await aggregateBenchmarkChart(entry, srcDir, outMdDir)
    : false;

  return {
    ...entry,
    factorioVersion,
    platform,
    cpu,
    question,
    finding,
    githubUrl: `${githubBase}/tree/${branch}/${entry.source}`,
    readmeGithubUrl: `${githubBase}/blob/${branch}/${entry.source}/README.md`,
    saves,
    assetCount,
    timeseries,
  };
}

/**
 * Fail the sync on a bad topic list: duplicate ids, or a benchmark whose `topic` is not one.
 *
 * @param {Manifest} manifest
 */
function validateTopics(manifest) {
  const ids = new Set();
  for (const topic of manifest.topics ?? []) {
    if (ids.has(topic.id)) throw new Error(`manifest: duplicate topic id "${topic.id}"`);
    ids.add(topic.id);
  }
  for (const entry of manifest.benchmarks) {
    if (entry.topic !== undefined && !ids.has(entry.topic)) {
      throw new Error(`manifest: benchmark "${entry.slug}" has topic "${entry.topic}", which is not in "topics"`);
    }
  }
}

/**
 * Read the question and finding off a README and lift their sections out of it.
 * The question is cut after its last "?"; either may be the first item of a flat list.
 * The question section is lifted only when it has a plain-text first paragraph, and the
 * answer section only along with it; a "Conclusion" gives a finding but is never lifted.
 *
 * @param {string} markdown - README after stripOwnToc, before any rewriting
 * @returns {{ readme: string, question?: string, finding?: string, questionBody?: string, answerBody?: string }}
 */
function liftQuestionAndAnswer(markdown) {
  const questionNames = ['The Question', 'Question'];
  const answerNames = ['The Answer', 'Answer'];

  const questionSection = findSection(markdown, questionNames);
  const answerSection = findSection(markdown, answerNames);
  const conclusionSection = findSection(markdown, ['Conclusion', 'Conclusions']);

  const question = questionSection
    ? plainFirstParagraph(questionSection.body, { allowList: true, trimToQuestion: true })
    : '';
  // Too short to say anything on its own ("Yes") counts as no finding.
  const findingOf = (section) => {
    const text = section ? plainFirstParagraph(section.body, { allowList: true }) : '';
    return text.length >= MIN_FINDING_LENGTH ? text : '';
  };
  const finding = findingOf(answerSection) || findingOf(conclusionSection);

  let readme = markdown;
  let questionBody;
  let answerBody;
  if (question) {
    questionBody = questionSection.body;
    readme = removeSection(readme, questionSection);
    // Positions moved; look the answer up again in what is left.
    const remaining = findSection(readme, answerNames);
    if (remaining) {
      answerBody = remaining.body;
      readme = removeSection(readme, remaining);
    }
  }

  return {
    readme,
    question: question || undefined,
    finding: finding || undefined,
    questionBody,
    answerBody: answerBody || undefined,
  };
}

/**
 * Aggregate every scenario CSV declared in the manifest into a single
 * `timeseries.json` written next to the rewritten README. Returns true if a
 * file was emitted.
 *
 * @param {BenchmarkEntry} entry
 * @param {string} srcDir
 * @param {string} outMdDir
 */
async function aggregateBenchmarkChart(entry, srcDir, outMdDir) {
  const cfg = entry.chart;
  if (!cfg) return false;

  const removeFirstTicks = cfg.removeFirstTicks ?? 30;
  const maxTicks = cfg.maxTicks ?? 18000;
  const window = cfg.window ?? 60;

  /**
   * Aggregate one flat list of scenarios into { metrics (union), scenarios[] }.
   * @param {ChartScenario[]} scenarioList
   * @param {string[]} [metricsOverride]
   */
  async function aggregateScenarios(scenarioList, metricsOverride) {
    const scenarios = [];
    const metricUnion = new Set();
    for (const sc of scenarioList) {
      const csvPath = path.join(srcDir, sc.csv);
      await assertFile(csvPath, `chart csv missing: ${entry.slug} → ${sc.csv}`);
      const agg = await aggregateScenarioCsv(csvPath, {
        metrics: metricsOverride ?? cfg.metrics,
        removeFirstTicks,
        maxTicks,
        window,
      });
      const trimmed = {};
      for (const [m, points] of Object.entries(agg.metrics)) {
        if (points.some((p) => p.y !== 0)) {
          trimmed[m] = points;
          metricUnion.add(m);
        }
      }
      scenarios.push({ name: sc.name, metrics: trimmed });
    }
    return { metrics: [...metricUnion], scenarios };
  }

  let payload;

  if (cfg.groups?.length) {
    // Multi-group mode: each group gets its own scenarios array.
    const groups = [];
    for (const grp of cfg.groups) {
      if (!grp.scenarios?.length) continue;
      const result = await aggregateScenarios(grp.scenarios, grp.metrics);
      groups.push({ name: grp.name, ...result });
    }
    if (!groups.length) return false;
    payload = { window, unit: 'µs', groups };
  } else if (cfg.scenarios?.length) {
    // Flat mode (original behaviour).
    const result = await aggregateScenarios(cfg.scenarios);
    payload = { window, unit: 'µs', ...result };
  } else {
    return false;
  }

  await fs.writeFile(
    path.join(outMdDir, 'timeseries.json'),
    JSON.stringify(payload),
  );
  return true;
}

/** `[text](path rest)`, not an image. */
const LINK_RE = /(?<!!)\[([^\]]*)\]\(([^)\s"']+)([^)]*)\)/g;

/**
 * Decide, for every relative `[text](path)` link in a README, whether it needs
 * something other than the raw GitHub URL: a folder (raw GitHub cannot serve one)
 * gets its `tree` page, and a file that is a git-lfs pointer at HEAD (raw GitHub
 * would serve the pointer text) gets the LFS worker download URL, like a save.
 * Everything is looked up in HEAD's git objects, so it does not matter which
 * files a sparse checkout put on disk. One lookup per README.
 *
 * @param {string} markdown
 * @param {string} source - benchmark folder in the source repo
 * @param {string} treeBase - `https://github.com/<owner>/<repo>/tree/<branch>`
 * @param {string|null} lfsWorkerUrl
 * @param {ReturnType<typeof createHeadReader>} headReader
 * @returns {Map<string, string>} link target (as written, minus a leading `./`) → URL
 */
function planLinkRewrites(markdown, source, treeBase, lfsWorkerUrl, headReader) {
  /** @type {Map<string, { repoPath: string, suffix: string }>} */
  const candidates = new Map();
  for (const m of markdown.matchAll(LINK_RE)) {
    const trimmed = m[2].trim();
    if (!trimmed || /^[a-z]+:/i.test(trimmed) || trimmed.startsWith('#') || trimmed.startsWith('/')) continue;
    const target = trimmed.replace(/^\.\//, '');
    const suffixAt = target.search(/[?#]/);
    const rawPath = suffixAt < 0 ? target : target.slice(0, suffixAt);
    let decoded = rawPath;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      /* keep as written */
    }
    const repoPath = path.posix.normalize(`${source}/${decoded}`).replace(/\/+$/, '');
    if (!repoPath || repoPath.startsWith('../')) continue;
    candidates.set(target, { repoPath, suffix: suffixAt < 0 ? '' : target.slice(suffixAt) });
  }
  const plan = new Map();
  if (candidates.size === 0) return plan;

  const found = headReader.classify([...new Set([...candidates.values()].map((c) => c.repoPath))]);
  for (const [target, { repoPath, suffix }] of candidates) {
    const hit = found.get(repoPath);
    if (hit?.kind === 'dir') {
      plan.set(target, `${treeBase}/${repoPath}${suffix}`);
    } else if (hit?.kind === 'lfs') {
      if (!lfsWorkerUrl) throw new Error(`link to ${repoPath} is an LFS file but manifest.lfsWorkerUrl is not set`);
      plan.set(target, `${lfsWorkerUrl.replace(/\/+$/, '')}/objects/${hit.oid}/${encodeURIComponent(path.posix.basename(repoPath))}`);
    }
  }
  return plan;
}

/**
 * Rewrite markdown asset references so they point at /benchmarks/<slug>/...
 * Handles ![alt](path), <img src="path">, and any href that starts with `./`.
 * Leaves absolute URLs (http://, https://, /), anchors (#), and `mailto:` alone.
 *
 * Regular hyperlinks [text](relative-path) are rewritten to the raw GitHub URL
 * so that files not served from the site (e.g. .txt) download from GitHub. A link
 * with an entry in `linkRewrites` (see planLinkRewrites) uses that URL instead.
 *
 * @param {string} markdown
 * @param {string} slug
 * @param {string|null} [githubRawDir] - raw GitHub URL prefix for the benchmark source dir
 * @param {Map<string, string>} [linkRewrites] - relative link target → replacement URL
 */
function rewriteMarkdownAssetPaths(markdown, slug, githubRawDir = null, linkRewrites = new Map()) {
  const prefix = `/benchmarks/${slug}`;

  const rewriteAssetPath = (p) => {
    const trimmed = p.trim();
    if (!trimmed) return trimmed;
    if (/^[a-z]+:/i.test(trimmed)) return trimmed; // http:, https:, mailto:, data:
    if (trimmed.startsWith('#')) return trimmed;
    if (trimmed.startsWith('/')) return trimmed; // already site-absolute
    const normalized = trimmed.replace(/^\.\//, '');
    return `${prefix}/${normalized}`;
  };

  const rewriteLinkPath = (p) => {
    const trimmed = p.trim();
    if (!trimmed) return trimmed;
    if (/^[a-z]+:/i.test(trimmed)) return trimmed;
    if (trimmed.startsWith('#')) return trimmed;
    if (trimmed.startsWith('/')) return trimmed;
    const normalized = trimmed.replace(/^\.\//, '');
    const planned = linkRewrites.get(normalized);
    if (planned) return planned;
    // Point to raw GitHub so files not copied to the site (e.g. .txt) are reachable.
    if (githubRawDir) return `${githubRawDir}/${normalized}`;
    return `${prefix}/${normalized}`;
  };

  // ![alt](path "title"?) — images stay site-local
  let out = markdown.replace(/(!\[[^\]]*\]\()([^)\s]+)([^)]*\))/g, (_m, pre, p, post) => {
    return `${pre}${rewriteAssetPath(p)}${post}`;
  });

  // [text](path) — regular hyperlinks (not images) go to GitHub raw
  out = out.replace(LINK_RE, (_m, text, p, rest) => {
    return `[${text}](${rewriteLinkPath(p)}${rest})`;
  });

  // <img src="..."> / <img src='...'>
  out = out.replace(/(<img\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)(\2)/gi, (_m, pre, q, p, qq) => {
    return `${pre}${q}${rewriteAssetPath(p)}${qq}`;
  });

  return out;
}

/** @param {Manifest} manifest */
function rawBaseOf(manifest) {
  return `https://raw.githubusercontent.com/${manifest.sourceRepo.owner}/${manifest.sourceRepo.repo}/${manifest.sourceRepo.branch}`;
}

/** @param {string} dir */
async function walk(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

async function resetOutputDirs() {
  await fs.rm(path.join(GENERATED_DIR, 'benchmarks'), { recursive: true, force: true });
  await fs.rm(path.join(GENERATED_DIR, 'index.json'), { force: true });
  await fs.rm(path.join(GENERATED_DIR, 'saves.json'), { force: true });
  await fs.rm(PUBLIC_BENCHMARKS_DIR, { recursive: true, force: true });
  await fs.mkdir(GENERATED_DIR, { recursive: true });
  await fs.mkdir(PUBLIC_BENCHMARKS_DIR, { recursive: true });
}

async function assertSourceExists() {
  try {
    const stat = await fs.stat(SOURCE_REPO_PATH);
    if (!stat.isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error(
      `factorio-benchmarks source not found at: ${SOURCE_REPO_PATH}\n` +
        `Set FACTORIO_BENCHMARKS_PATH to point at your local clone.`,
    );
  }
}

/** @param {string} p @param {string} msg */
async function assertDir(p, msg) {
  try {
    const s = await fs.stat(p);
    if (!s.isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error(`${msg} (looked at ${p})`);
  }
}

/** @param {string} p @param {string} msg */
async function assertFile(p, msg) {
  try {
    const s = await fs.stat(p);
    if (!s.isFile()) throw new Error('not a file');
  } catch {
    throw new Error(`${msg} (looked at ${p})`);
  }
}

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[sync-content] ${msg}`);
}

main().catch((err) => {
  console.error(`[sync-content] ✗ ${err.message}`);
  process.exit(1);
});
