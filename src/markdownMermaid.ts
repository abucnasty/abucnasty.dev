// Finds a ```mermaid fenced code block in react-markdown's output. Pure (no React or DOM), so
// worker/wiki.test.ts checks it against the wiki's sanitised renderer.
import type { Element, ElementContent } from 'hast';

const text = (nodes: readonly ElementContent[]): string =>
  nodes.map((n) => (n.type === 'text' ? n.value : n.type === 'element' ? text(n.children) : '')).join('');

/** The diagram's source if `pre` is a ```mermaid code block (`pre > code.language-mermaid`), else undefined. */
export function mermaidSource(pre: Element | undefined): string | undefined {
  if (!pre || pre.children.length !== 1) return undefined;
  const code = pre.children[0];
  if (code.type !== 'element' || code.tagName !== 'code') return undefined;
  const cls = code.properties.className;
  if (!Array.isArray(cls) || !cls.includes('language-mermaid')) return undefined;
  return text(code.children);
}
