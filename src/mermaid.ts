// Draws a ```mermaid code block as an SVG diagram. Loaded only when a page has one
// (components/MermaidDiagram.tsx imports it on demand), so no other page downloads mermaid.
//
// Wiki pages are publicly editable, so the diagram source is untrusted. What keeps it inert:
// - securityLevel 'strict': no click callbacks (`click A call fn()` is ignored), link URLs go
//   through @braintree/sanitize-url (javascript: becomes about:blank), label text is run
//   through DOMPurify before it is drawn, and the finished SVG markup is run through DOMPurify.
// - htmlLabels off: labels are SVG <text>, not HTML in a <foreignObject>.
// - The look is flat: mermaid 12 draws flowcharts in its 'neo' look by default, with a gradient
//   border and drop shadows; 'classic' with useGradient and dropShadow off draws plain dark boxes
//   with one accent border; any other shadow is turned off in themeCSS, and mermaid's unused
//   shadow filters are dropped below. The look and theme are locked like the rest.
// - `secure`: a diagram's own `%%{init: ...}%%` directive cannot change any of the above, nor
//   the DOMPurify options, the theme, its CSS or fonts (mermaid drops those keys from directives).
// - suppressErrorRendering: a broken diagram throws instead of drawing mermaid's error picture.
// - Then, here: the SVG is parsed in an inert document (nothing in it runs or loads) and
//   anything executable left in it (script, iframe, object, embed, on* attributes, non-http(s)
//   links) is removed before it is put on the page.
import mermaid, { type MermaidConfig } from 'mermaid';
import { darkTheme } from './theme';

const { palette, typography } = darkTheme;

const config: MermaidConfig = {
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,
  suppressErrorRendering: true,
  logLevel: 'fatal',
  // mermaid 12 lays out with ELK by default (a further ~470 kB gzipped); dagre is what Obsidian
  // and GitHub draw with. A diagram can still ask for ELK in its own config.
  layout: 'dagre',
  // Flowcharts take their own `flowchart.look`, which defaults to 'neo'.
  look: 'classic',
  flowchart: { look: 'classic' },
  // Keys a diagram's own init directive may not change (mermaid's defaults first).
  secure: [
    'secure',
    'securityLevel',
    'startOnLoad',
    'maxTextSize',
    'suppressErrorRendering',
    'maxEdges',
    'htmlLabels',
    'dompurifyConfig',
    'theme',
    'themeVariables',
    'themeCSS',
    'darkMode',
    'fontFamily',
    'altFontFamily',
    'logLevel',
    // Removed at any depth, so `flowchart: { look }` in a directive goes too.
    'look',
  ],
  theme: 'base',
  // Some diagrams' own styles add shadows whatever the look (a sequence diagram's actor menus).
  themeCSS: '* { filter: none !important; }',
  darkMode: true,
  fontFamily: typography.fontFamily,
  themeVariables: {
    darkMode: true,
    fontFamily: typography.fontFamily,
    fontSize: '15px',
    background: palette.background.paper,
    // Plain dark boxes with the site's orange as their one accent (borders).
    primaryColor: '#1e1e1e',
    primaryBorderColor: palette.primary.main,
    primaryTextColor: palette.text.primary,
    secondaryColor: '#16261a',
    secondaryBorderColor: palette.secondary.main,
    secondaryTextColor: palette.text.primary,
    tertiaryColor: '#1e1e1e',
    tertiaryBorderColor: '#5c5c5c',
    tertiaryTextColor: palette.text.primary,
    lineColor: '#bdbdbd',
    textColor: palette.text.primary,
    noteBkgColor: '#1e1e1e',
    noteBorderColor: palette.primary.main,
    noteTextColor: palette.text.primary,
    edgeLabelBackground: palette.background.paper,
    clusterBkg: '#181818',
    clusterBorder: '#5c5c5c',
    titleColor: palette.text.primary,
    useGradient: false,
    dropShadow: 'none',
  },
};

let ready: Promise<void> | undefined;
function setup(): Promise<void> {
  // Text is measured to lay the diagram out, so wait for the page's fonts first.
  ready ??= document.fonts.ready.then(() => mermaid.initialize(config));
  return ready;
}

const UNSAFE_TAGS = 'script, iframe, object, embed, foreignObject, foreignobject';
// mermaid adds these to every diagram, whatever its look; nothing uses them in the flat look.
const SHADOW_FILTERS = 'filter[id$="-drop-shadow"], filter[id$="-drop-shadow-small"]';
const SAFE_URL = /^(?:#|https?:\/\/)/i;

/** The SVG in `markup`, parsed inertly and stripped of anything that could run or navigate oddly. */
function inertSvg(markup: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${markup}`, 'text/html');
  const svg = doc.body.querySelector('svg');
  if (!svg || doc.body.children.length !== 1) throw new Error('mermaid did not return one SVG');
  for (const el of svg.querySelectorAll(UNSAFE_TAGS)) el.remove();
  for (const el of svg.querySelectorAll(SHADOW_FILTERS)) el.remove();
  for (const el of [svg, ...svg.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if ((name === 'href' || name.endsWith(':href') || name === 'src') && !SAFE_URL.test(attr.value.trim())) el.removeAttribute(attr.name);
    }
  }
  return document.importNode(svg, true);
}

let count = 0;

/** `source` drawn as an SVG element, or a rejection if it is not a diagram mermaid can draw. */
export async function renderMermaid(source: string): Promise<SVGSVGElement> {
  await setup();
  await mermaid.parse(source);
  count += 1;
  const { svg } = await mermaid.render(`mermaid-diagram-${count}`, source);
  return inertSvg(svg);
}
