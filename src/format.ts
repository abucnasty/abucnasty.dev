// Small display formatters shared between pages.

/** "windows-x86_64" → "Windows". Unknown platforms are shown as-is. */
export function formatPlatform(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('windows') || lower.startsWith('win')) return 'Windows';
  if (lower.includes('linux')) return 'Linux';
  if (lower.includes('mac') || lower.includes('darwin')) return 'macOS';
  return raw;
}

/** Decimal units, the way browsers and file managers report download sizes. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e8) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e5) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} kB`;
}

export function formatSaveCount(n: number): string {
  return `${n} ${n === 1 ? 'save' : 'saves'}`;
}
