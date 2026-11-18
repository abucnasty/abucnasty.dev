// The wiki editor's markdown: how page text is read into the visual editor and written back,
// without damaging what Obsidian writes. A remark plugin (remarkWiki) and the house-style
// serialiser options; the visual editor (milkdown.ts) maps the nodes made here to its own.
//
// Read as their own nodes, and written back exactly as they were read:
// - `[[Page]]`, `[[Page|label]]`, `[[Page#Heading]]`  → wikiLink (value = what is inside [[ ]])
// - `![[image.png]]`, `![[image.png|400]]`, `![[Page]]` → wikiEmbed
// - `%% comment %%` within a paragraph (lines too)     → wikiComment (value = the whole comment)
// - a comment starting a block, over any number of lines → wikiCommentBlock (an unclosed one runs
//   to the end of the page, as in Obsidian)
// - `> [!note] Title` (the callout marker, folding sign included) → calloutMarker
// Without these, the serialiser escapes `[[` and `[!note]` (`\[\[Page]]`) and reads the inside of
// comments as markdown. Everything is tokenised by micromark, so code spans and fenced code keep
// their text as written.
//
// House style when the editor writes a page: `-` bullets, `**bold**`, `_italic_`, `#` headings,
// ``` fences, `1.` lists, `---` rules. Only text changed in the visual editor is written this way;
// a page opened and saved without changes keeps its text.
//
// Pure (no DOM), so the round trip is unit-tested under Node (worker/wikiEditorMarkdown.test.ts).
import type { Blockquote, Link, Literal, Nodes, Paragraph, Parents, Root } from 'mdast';
import type { CompileContext, Extension as FromMarkdownExtension, Token } from 'mdast-util-from-markdown';
import { defaultHandlers, type Options as ToMarkdownExtension, type Handle, type State as ToMarkdownState, type Info } from 'mdast-util-to-markdown';
import type { Code, Construct, Effects, Extension as SyntaxExtension, State, TokenizeContext } from 'micromark-util-types';
import type { Options as StringifyOptions } from 'remark-stringify';
import type { Processor } from 'unified';

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    wikiLink: 'wikiLink';
    wikiEmbed: 'wikiEmbed';
    wikiLinkMarker: 'wikiLinkMarker';
    wikiLinkValue: 'wikiLinkValue';
    wikiComment: 'wikiComment';
    wikiCommentFlow: 'wikiCommentFlow';
    wikiCommentFlowValue: 'wikiCommentFlowValue';
  }
}

export interface WikiLink extends Literal {
  type: 'wikiLink';
}
export interface WikiEmbed extends Literal {
  type: 'wikiEmbed';
}
export interface WikiComment extends Literal {
  type: 'wikiComment';
}
export interface WikiCommentBlock extends Literal {
  type: 'wikiCommentBlock';
}
export interface CalloutMarker extends Literal {
  type: 'calloutMarker';
}

declare module 'mdast' {
  interface PhrasingContentMap {
    wikiLink: WikiLink;
    wikiEmbed: WikiEmbed;
    wikiComment: WikiComment;
    calloutMarker: CalloutMarker;
  }
  interface BlockContentMap {
    wikiCommentBlock: WikiCommentBlock;
  }
  interface RootContentMap {
    wikiLink: WikiLink;
    wikiEmbed: WikiEmbed;
    wikiComment: WikiComment;
    calloutMarker: CalloutMarker;
    wikiCommentBlock: WikiCommentBlock;
  }
}

// ---------------------------------------------------------------------------------------------
// Syntax (micromark)

const BANG = 33;
const PERCENT = 37;
const OPEN = 91;
const CLOSE = 93;
const isEol = (code: Code) => code !== null && code < -2;
const isSpace = (code: Code) => code === -2 || code === -1 || code === 32;
const MAX_INSIDE = 1000;

/** `[[...]]` (or `![[...]]` when `embed`): anything but `]` and line endings inside, as the site's renderer reads them. */
function wikiLinkConstruct(embed: boolean): Construct {
  const type = embed ? 'wikiEmbed' : 'wikiLink';
  return {
    name: type,
    tokenize(effects: Effects, ok: State, nok: State): State {
      let size = 0;
      let opens = 0;
      const start: State = (code) => {
        effects.enter(type);
        effects.enter('wikiLinkMarker');
        if (embed) {
          effects.consume(code);
          return open;
        }
        return open(code);
      };
      const open: State = (code) => {
        if (code !== OPEN) return nok(code);
        effects.consume(code);
        if (++opens < 2) return open;
        effects.exit('wikiLinkMarker');
        effects.enter('wikiLinkValue');
        return inside;
      };
      const inside: State = (code) => {
        if (code === null || isEol(code) || size > MAX_INSIDE) return nok(code);
        if (code === CLOSE) {
          if (size === 0) return nok(code);
          effects.exit('wikiLinkValue');
          effects.enter('wikiLinkMarker');
          effects.consume(code);
          return close;
        }
        size++;
        effects.consume(code);
        return inside;
      };
      const close: State = (code) => {
        if (code !== CLOSE) return nok(code);
        effects.consume(code);
        effects.exit('wikiLinkMarker');
        effects.exit(type);
        return ok;
      };
      return start;
    },
  };
}

/** `%% ... %%` inside a paragraph, possibly over several of its lines. Unclosed: not a comment. */
const inlineComment: Construct = {
  name: 'wikiComment',
  tokenize(effects, ok, nok) {
    const start: State = (code) => {
      effects.enter('wikiComment');
      effects.consume(code);
      return second;
    };
    const second: State = (code) => {
      if (code !== PERCENT) return nok(code);
      effects.consume(code);
      return inside;
    };
    const inside: State = (code) => {
      if (code === null) return nok(code);
      if (isEol(code)) {
        effects.enter('lineEnding');
        effects.consume(code);
        effects.exit('lineEnding');
        return inside;
      }
      effects.consume(code);
      return code === PERCENT ? percent : inside;
    };
    const percent: State = (code) => {
      if (code !== PERCENT) return inside(code);
      effects.consume(code);
      effects.exit('wikiComment');
      return ok;
    };
    return start;
  },
};

/** The next line belongs to the same block (is not a lazy continuation of a container). */
const nonLazyLine: Construct = {
  partial: true,
  tokenize(this: TokenizeContext, effects, ok, nok) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const lineStart: State = (code) => (self.parser.lazy[self.now().line] ? nok(code) : ok(code));
    return (code) => {
      if (!isEol(code)) return nok(code);
      effects.enter('lineEnding');
      effects.consume(code);
      effects.exit('lineEnding');
      return lineStart;
    };
  },
};

/**
 * A comment that starts a block: from a line starting with `%%` to the line its closing `%%` is on
 * (only spaces may follow it), or the end of the page. It never interrupts a paragraph: there the
 * inline comment reads it.
 */
const blockComment: Construct = {
  name: 'wikiCommentFlow',
  concrete: true,
  tokenize(this: TokenizeContext, effects, ok, nok) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const start: State = (code) => {
      if (self.interrupt) return nok(code);
      effects.enter('wikiCommentFlow');
      effects.enter('wikiCommentFlowValue');
      effects.consume(code);
      return second;
    };
    const second: State = (code) => {
      if (code !== PERCENT) return nok(code);
      effects.consume(code);
      return inside;
    };
    const inside: State = (code) => {
      if (code === null) {
        effects.exit('wikiCommentFlowValue');
        return done(code);
      }
      if (isEol(code)) {
        effects.exit('wikiCommentFlowValue');
        return effects.check(nonLazyLine, newline, done)(code);
      }
      effects.consume(code);
      return code === PERCENT ? percent : inside;
    };
    const percent: State = (code) => {
      if (code !== PERCENT) return inside(code);
      effects.consume(code);
      return after;
    };
    const after: State = (code) => {
      if (code === null || isEol(code)) {
        effects.exit('wikiCommentFlowValue');
        return done(code);
      }
      if (isSpace(code)) {
        effects.consume(code);
        return after;
      }
      // Text after the comment on its last line: a paragraph with an inline comment instead.
      return nok(code);
    };
    const newline: State = (code) => {
      effects.enter('lineEnding');
      effects.consume(code);
      effects.exit('lineEnding');
      return lineStart;
    };
    const lineStart: State = (code) => {
      if (code === null) return done(code);
      if (isEol(code)) return effects.check(nonLazyLine, newline, done)(code);
      effects.enter('wikiCommentFlowValue');
      return inside(code);
    };
    const done: State = (code) => {
      effects.exit('wikiCommentFlow');
      return ok(code);
    };
    return start;
  },
};

/** The micromark extension. Its constructs go before CommonMark's, so `[[` is never a link label. */
export const wikiSyntax: SyntaxExtension = {
  text: { [OPEN]: wikiLinkConstruct(false), [BANG]: wikiLinkConstruct(true), [PERCENT]: inlineComment },
  flow: { [PERCENT]: blockComment },
};

// ---------------------------------------------------------------------------------------------
// Syntax tree (mdast)

function enterLiteral(type: 'wikiLink' | 'wikiEmbed' | 'wikiComment' | 'wikiCommentBlock') {
  return function (this: CompileContext, token: Token) {
    this.enter({ type, value: '' } as never, token);
  };
}

function exitValue(this: CompileContext, token: Token) {
  (this.stack[this.stack.length - 1] as unknown as Literal).value = this.sliceSerialize(token);
}

function exitWhole(this: CompileContext, token: Token) {
  (this.stack[this.stack.length - 1] as unknown as Literal).value = this.sliceSerialize(token);
  this.exit(token);
}

export const wikiFromMarkdown: FromMarkdownExtension = {
  enter: {
    wikiLink: enterLiteral('wikiLink'),
    wikiEmbed: enterLiteral('wikiEmbed'),
    wikiComment: enterLiteral('wikiComment'),
    wikiCommentFlow: enterLiteral('wikiCommentBlock'),
  },
  exit: {
    wikiLinkValue: exitValue,
    wikiLink(token) {
      this.exit(token);
    },
    wikiEmbed(token) {
      this.exit(token);
    },
    wikiComment: exitWhole,
    wikiCommentFlow: exitWhole,
  },
};

const raw =
  (wrap: (value: string) => string): Handle =>
  (node: Literal) =>
    wrap(node.value);

export const wikiToMarkdown: ToMarkdownExtension = {
  handlers: {
    wikiLink: raw((v) => `[[${v}]]`),
    wikiEmbed: raw((v) => `![[${v}]]`),
    wikiComment: raw((v) => v),
    wikiCommentBlock: raw((v) => v),
    calloutMarker: raw((v) => v),
  } as Record<string, Handle>,
};

/** `[!type]` at the start of a blockquote, with Obsidian's folding sign. */
export const CALLOUT_MARKER = /^\[![A-Za-z][\w-]*\][+-]?/;

/** The callout marker of each blockquote that starts with one, as its own node. */
function markCallouts(tree: Nodes): void {
  const walk = (node: Nodes) => {
    if (node.type === 'blockquote') splitMarker(node);
    if ('children' in node) for (const child of (node as Parents).children) walk(child);
  };
  walk(tree);
}

function splitMarker(node: Blockquote): void {
  const first = node.children[0] as Paragraph | undefined;
  if (first?.type !== 'paragraph') return;
  const lead = first.children[0];
  if (lead?.type !== 'text') return;
  const m = CALLOUT_MARKER.exec(lead.value);
  if (!m) return;
  const rest = lead.value.slice(m[0].length);
  first.children.splice(0, 1, { type: 'calloutMarker', value: m[0] }, ...(rest ? [{ type: 'text' as const, value: rest }] : []));
}

/**
 * The remark plugin: the syntax above when reading, its nodes when writing, and callout markers
 * split off after reading.
 */
export function remarkWiki(this: Processor) {
  const data = this.data() as {
    micromarkExtensions?: SyntaxExtension[];
    fromMarkdownExtensions?: FromMarkdownExtension[];
    toMarkdownExtensions?: ToMarkdownExtension[];
  };
  (data.micromarkExtensions ??= []).push(wikiSyntax);
  (data.fromMarkdownExtensions ??= []).push(wikiFromMarkdown);
  (data.toMarkdownExtensions ??= []).push(wikiToMarkdown);
  return (tree: Root) => {
    markCallouts(tree);
  };
}

// ---------------------------------------------------------------------------------------------
// Writing (remark-stringify)

/**
 * Text as Milkdown writes it (a trailing space stays a space), otherwise escaped as usual, except
 * where a character cannot start emphasis anyway: `_` inside a word (snake_case) and `*` with a
 * space on both sides (5 * 3) are left as written.
 */
const text: Handle = (node: Literal, _, state: ToMarkdownState, info: Info) => {
  const value = node.value;
  if (/^[^*_\\]*\s+$/.test(value)) return value;
  return state
    .safe(value, { ...info, encode: [] } as Info)
    .replace(/(?<=[\p{L}\p{N}])\\_(?=[\p{L}\p{N}])/gu, '_')
    .replace(/(?<=[ \t])\\\*(?=[ \t])/g, '*');
};

/**
 * A link whose text is its http(s) URL is written bare (GFM reads it back as the same link), as
 * people paste them and as the site's YouTube embeds expect, unless a character right after it
 * would run into the URL.
 */
const link: Handle = (node: Link, parent, state: ToMarkdownState, info: Info) => {
  const only = node.children.length === 1 && node.children[0].type === 'text' ? node.children[0].value : null;
  if (!node.title && only === node.url && /^https?:\/\/[^\s<>]+$/i.test(node.url) && /[A-Za-z0-9/]$/.test(node.url) && !/^[\p{L}\p{N}_\-/=&?#%~+@]/u.test(info.after)) {
    return node.url;
  }
  return defaultHandlers.link(node, parent, state, info);
};

function attention(kind: 'strong' | 'emphasis', marker: string): Handle {
  return (node: Parents, _, state: ToMarkdownState, info: Info) => {
    const fence = kind === 'strong' ? marker + marker : marker;
    const exit = state.enter(kind);
    const tracker = state.createTracker(info);
    let value = tracker.move(fence);
    value += tracker.move(state.containerPhrasing(node as never, { before: value, after: marker, ...tracker.current() }));
    value += tracker.move(fence);
    exit();
    return value;
  };
}

/**
 * remark-stringify options in the house style. Bold and italic always use `**` and `_` (whatever
 * marker the text was written with); the rest are remark's settings for the house style.
 */
export const wikiStringifyOptions: StringifyOptions = {
  bullet: '-',
  bulletOther: '*',
  bulletOrdered: '.',
  emphasis: '_',
  strong: '*',
  fence: '`',
  fences: true,
  rule: '-',
  ruleRepetition: 3,
  ruleSpaces: false,
  listItemIndent: 'one',
  incrementListMarker: true,
  setext: false,
  closeAtx: false,
  resourceLink: false,
  handlers: {
    text,
    link,
    strong: attention('strong', '*'),
    emphasis: attention('emphasis', '_'),
  } as Record<string, Handle>,
};
