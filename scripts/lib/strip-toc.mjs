/**
 * Remove a "Table of Contents" section from a README: the heading and the list under it.
 * Returns the markdown unchanged when there is no such section, or when the section
 * holds anything other than list items and blank lines.
 *
 * @param {string} markdown
 * @returns {string}
 */
export function stripOwnToc(markdown) {
  const lines = markdown.split('\n');
  const headingRe = /^ {0,3}(#{1,4})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
  const anyHeadingRe = /^ {0,3}#{1,6}(?:[ \t]|$)/;
  // A single-line HTML heading, e.g. <h2>Table Of Contents</h2>, counts as an opening heading
  // and, as any other line of this form, as a heading that ends the section.
  const htmlTocRe = /^ {0,3}<h[1-4](?:\s[^>]*)?>\s*table of contents\s*<\/h[1-4]>\s*$/i;
  const htmlHeadingRe = /^ {0,3}<h[1-6](?:\s[^>]*)?>/i;
  const listItemRe = /^[ \t]*(?:[-*+]|\d+[.)])(?:[ \t]|$)/;
  const fenceRe = /^ {0,3}(`{3,}|~{3,})/;

  let fence = null;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    const f = line.match(fenceRe);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const m = line.match(headingRe);
    if ((m && m[2].trim().toLowerCase() === 'table of contents') || htmlTocRe.test(line)) {
      start = i;
      break;
    }
  }
  if (start < 0) return markdown;

  let end = start + 1;
  while (end < lines.length && !anyHeadingRe.test(lines[end]) && !htmlHeadingRe.test(lines[end])) {
    const line = lines[end].replace(/\r$/, '');
    if (line.trim() !== '' && !listItemRe.test(line)) return markdown;
    end++;
  }

  const before = lines.slice(0, start);
  const after = lines.slice(end);
  while (before.length && before[before.length - 1].trim() === '') before.pop();
  while (after.length && after[0].trim() === '') after.shift();
  if (before.length === 0) return after.join('\n');
  if (after.length === 0) return before.join('\n') + '\n';
  return [...before, '', ...after].join('\n');
}
