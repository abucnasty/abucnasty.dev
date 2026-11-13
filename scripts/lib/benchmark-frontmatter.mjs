/**
 * Which benchmarks the site publishes, read from YAML frontmatter at the top of each
 * `benchmarks/<folder>/README.md` in factorio-benchmarks:
 *
 *   ---
 *   publish: true            # required to publish; without it the folder is ignored
 *   slug: clocked-mining-drills   # required; the page is /benchmarks/<slug>
 *   title: Clocked Mining Drills  # required
 *   topic: mining            # optional; an id from `topics` in content/manifest.json
 *   date: 2025-11-11         # optional, YYYY-MM-DD
 *   featured: 1              # optional; position in the home page's Featured list
 *   chart: { ... }           # optional; interactive chart config (see ChartConfig in sync-content.mjs)
 *   ---
 *
 * `summary` and `tags` are accepted too. The frontmatter is not part of the published markdown.
 * Benchmarks come out in folder-name order, featured ones first by their `featured` number;
 * every list on the site sorts by date and falls back to this order.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

/** Folder of the source repo whose subfolders are scanned. */
export const BENCHMARKS_DIR = 'benchmarks';

const KEYS = new Set(['publish', 'slug', 'title', 'topic', 'date', 'featured', 'summary', 'tags', 'chart']);

/** `---` on the first line, YAML, `---`, and the one blank line that conventionally follows it. */
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n?^---[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)?/m;

/**
 * Split a README into its frontmatter (parsed) and the markdown after it.
 *
 * @param {string} markdown
 * @param {string} where - for error messages
 * @returns {{ data: Record<string, unknown> | null, body: string }}
 */
export function splitFrontmatter(markdown, where) {
  if (!/^---[ \t]*\r?\n/.test(markdown)) return { data: null, body: markdown };
  const m = markdown.match(FRONTMATTER_RE);
  if (!m || m.index !== 0) throw new Error(`${where}: frontmatter opened with --- is never closed`);
  let data;
  try {
    data = parseYaml(m[1]) ?? {};
  } catch (err) {
    throw new Error(`${where}: frontmatter is not valid YAML: ${err.message}`);
  }
  if (typeof data !== 'object' || Array.isArray(data)) throw new Error(`${where}: frontmatter is not a YAML mapping`);
  return { data, body: markdown.slice(m[0].length) };
}

/**
 * The benchmarks whose README frontmatter has `publish: true`, validated, in site order.
 *
 * @param {string} repoPath - local clone of factorio-benchmarks
 * @param {Set<string> | null} topicIds - known topic ids; null skips the topic check
 * @returns {import('../sync-content.mjs').BenchmarkEntry[]}
 */
export function discoverBenchmarks(repoPath, topicIds) {
  const root = path.join(repoPath, BENCHMARKS_DIR);
  const folders = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const entries = [];
  const fileBySlug = new Map();
  for (const folder of folders) {
    const readme = readdirSync(path.join(root, folder)).find((n) => n.toLowerCase() === 'readme.md');
    if (!readme) continue;
    const source = `${BENCHMARKS_DIR}/${folder}`;
    const where = `${source}/${readme}`;
    const { data } = splitFrontmatter(readFileSync(path.join(root, folder, readme), 'utf8'), where);
    if (!data || data.publish === undefined || data.publish === false) continue;

    const fail = (msg) => {
      throw new Error(`${where}: ${msg}`);
    };
    if (data.publish !== true) fail(`"publish" must be true or false, not ${JSON.stringify(data.publish)}`);
    for (const key of Object.keys(data)) if (!KEYS.has(key)) fail(`unknown frontmatter field "${key}" (known: ${[...KEYS].join(', ')})`);
    const { slug, title, topic, date, featured, summary, tags, chart } = data;
    if (typeof slug !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug)) {
      fail(slug === undefined ? 'missing required field "slug"' : `"slug" must be letters, digits, ".", "_" or "-", not ${JSON.stringify(slug)}`);
    }
    if (typeof title !== 'string' || !title.trim()) fail('missing required field "title"');
    if (topic !== undefined && (typeof topic !== 'string' || (topicIds && !topicIds.has(topic)))) {
      fail(`topic ${JSON.stringify(topic)} is not in "topics" in content/manifest.json`);
    }
    if (date !== undefined && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
      fail(`"date" must be YYYY-MM-DD, not ${JSON.stringify(date)}`);
    }
    if (featured !== undefined && featured !== true && featured !== false && !(Number.isInteger(featured) && featured > 0)) {
      fail(`"featured" must be a positive whole number (its place in the Featured list) or true, not ${JSON.stringify(featured)}`);
    }
    if (summary !== undefined && typeof summary !== 'string') fail('"summary" must be text');
    if (tags !== undefined && !(Array.isArray(tags) && tags.every((t) => typeof t === 'string'))) fail('"tags" must be a list of text');
    if (chart !== undefined && (typeof chart !== 'object' || chart === null || Array.isArray(chart))) fail('"chart" must be a mapping');
    if (fileBySlug.has(slug)) fail(`slug "${slug}" is already used by ${fileBySlug.get(slug)}`);
    fileBySlug.set(slug, where);

    // Key order as the manifest had it, so index.json reads the same.
    const isFeatured = featured !== undefined && featured !== false;
    entries.push({
      rank: isFeatured ? (featured === true ? Infinity : featured) : undefined,
      entry: { slug, source, title, topic, date, featured: isFeatured || undefined, summary, tags, chart },
    });
  }

  // Featured first, by their number; the rest keep folder order (Array.sort is stable).
  return entries
    .sort((a, b) => (a.rank ?? Number.MAX_VALUE) - (b.rank ?? Number.MAX_VALUE) || 0)
    .map(({ entry }) => /** @type {any} */ (Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined))));
}
