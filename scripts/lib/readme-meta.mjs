/**
 * Pull the `**Factorio Version:**` / `**Platform:**` / `**CPU:**` header fields out of a
 * benchmark README. Shared by the per-benchmark sync and the save index so
 * both read the header the same way.
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
