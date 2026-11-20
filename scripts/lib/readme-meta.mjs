/**
 * Where a benchmark's Factorio version, platform and CPU come from. The README's frontmatter
 * (`factorioVersion`, a text or a list of texts; `platform`, a text or a list of texts; `cpu`) is read first; the `**Factorio Version:**` / `**Platform:**` /
 * `**CPU:**` header lines of older READMEs are the fallback, value by value (the version line as a
 * one-item list, the platform line split on commas). Shared by the
 * per-benchmark sync and the save index so both read a README the same way.
 */
import { resolveDate, platformList, splitFrontmatter, versionList } from './benchmark-frontmatter.mjs';

export { resolveDate };

/**
 * Pull the `**Factorio Version:**` / `**Platform:**` / `**CPU:**` header fields out of a
 * benchmark README body.
 *
 * @param {string} markdown
 * @returns {{ factorioVersion?: string, platform?: string, cpu?: string }}
 */
export function parseReadmeMeta(markdown) {
  const versionMatch = markdown.match(/\*\*Factorio Version:\*\*\s*([\d.]+)/i);
  const platformMatch = markdown.match(/\*\*Platform:\*\*\s*([^\r\n]+)/i);
  const cpuMatch = markdown.match(/\*\*CPU:\*\*\s*([^\r\n]+)/i);
  return {
    factorioVersion: versionMatch ? versionMatch[1] : undefined,
    platform: platformMatch ? platformMatch[1].trim() : undefined,
    cpu: cpuMatch ? cpuMatch[1].trim() : undefined,
  };
}

/**
 * Versions, platform and CPU of a whole README (frontmatter included), the frontmatter first and
 * the header lines of the body second, plus its `published_date`. Never throws: a README whose
 * frontmatter does not parse is read as plain text (the published ones are validated by
 * `discoverBenchmarks`).
 *
 * @param {string} markdown
 * @returns {{ factorioVersions?: string[], platforms?: string[], cpu?: string, publishedDate?: string }}
 */
export function readmeMeta(markdown) {
  let data = null;
  let body = markdown;
  try {
    ({ data, body } = splitFrontmatter(markdown, 'README'));
  } catch {
    /* read it as plain text */
  }
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const header = parseReadmeMeta(body);
  return {
    factorioVersions: versionList(data?.factorioVersion) ?? versionList(header.factorioVersion),
    platforms: platformList(data?.platform) ?? platformList(header.platform),
    cpu: text(data?.cpu) ?? header.cpu,
    publishedDate: text(data?.published_date),
  };
}
