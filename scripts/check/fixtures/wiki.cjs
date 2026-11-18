// A small stand-in for the vault's wiki (https://vault.abucnasty.dev/wiki/), so no check depends
// on the live vault. Served by the catalog fixture's vault route (catalog.cjs), to every browser
// context; a page module can override a URL with page.route. The pages are the real first ones
// (titles, folders); their bodies are short stand-ins that exercise the renderer.

const index = {
  schema: 1,
  generatedAt: '2026-11-18T00:00:00.000Z',
  commit: 'fixture',
  // An unknown top-level field must be ignored.
  futureField: true,
  pages: [
    {
      title: 'Home',
      slug: 'home',
      folder: '',
      aliases: [],
      headings: [],
      excerpt: 'This is the community wiki for Factorio benchmarking and UPS research.',
      links: ['how-to-benchmark', 'setting-up-arch-to-run-factorio'],
      files: [],
      blob: 'a'.repeat(40),
    },
    {
      title: 'How to Benchmark',
      slug: 'how-to-benchmark',
      folder: 'Guides',
      aliases: ['Benchmarking Guide'],
      headings: [
        { depth: 2, text: 'Prerequisites', id: 'prerequisites' },
        { depth: 2, text: 'Step 2.1: Generate a Test Map', id: 'step-21-generate-a-test-map' },
      ],
      excerpt: 'This guide will walk you through benchmarking performance in Factorio using belt.',
      links: ['setting-up-arch-to-run-factorio'],
      files: ['Guides/_attachments/engineer_q5.png'],
      blob: 'b'.repeat(40),
    },
    {
      title: 'Setting Up Arch to Run Factorio',
      slug: 'setting-up-arch-to-run-factorio',
      folder: 'Guides',
      aliases: [],
      headings: [{ depth: 2, text: 'Prerequisites', id: 'prerequisites' }],
      excerpt: 'This guide will not explain how to install Arch itself.',
      links: [],
      files: ['Guides/_attachments/engineer_q5.png'],
      blob: 'c'.repeat(40),
    },
  ],
  files: [
    {
      path: 'Guides/_attachments/engineer_q5.png',
      published: 'Guides/_attachments/engineer_q5.webp',
      type: 'image/webp',
      size: 2038,
      sourceSize: 5097,
      blob: 'd'.repeat(40),
      v: '24cd660437a0d01f',
      convert: 'webp-1600-q85',
    },
  ],
};

const filler = 'Benchmarks compare how many updates per second a save reaches over a fixed number of ticks. '.repeat(3);

/** Each page's markdown, as the vault publishes it (frontmatter and comments removed). */
const markdown = {
  home: [
    'This is the community wiki for Factorio benchmarking and UPS research.',
    '',
    '- [How to Benchmark](Guides/How%20to%20Benchmark.md)',
    '- [[Setting Up Arch to Run Factorio]]',
    '- [[A Page Nobody Wrote]]',
    '',
  ].join('\n'),
  'how-to-benchmark': [
    'This guide will walk you through benchmarking performance in **Factorio** using `belt`.',
    '',
    'https://youtu.be/pXz01Be-9hE',
    '',
    '> [!warning] Close other programs',
    '> Background programs make results noisy.',
    '',
    '## Prerequisites',
    '',
    filler,
    '',
    '| Tool | Why |',
    '| ---- | --- |',
    '| belt | runs the benchmark |',
    '',
    '<script>window.__wikiScript = true</script>',
    '',
    '[Do not click](javascript:alert(1))',
    '',
    '![[engineer_q5.png|64]]',
    '',
    '## Step 2.1: Generate a Test Map',
    '',
    // Long enough below the heading that a #heading address can scroll it to the top.
    ...Array(8).fill([filler, '']).flat(),
    'See [[Setting Up Arch to Run Factorio#Prerequisites|the Arch prerequisites]].',
    '',
  ].join('\n'),
  'setting-up-arch-to-run-factorio': [
    '## Prerequisites',
    '',
    filler,
    '',
    '![64x64 Factorio logo](_attachments/engineer_q5.png)',
    '',
  ].join('\n'),
};

// A 1 × 1 WebP.
const WEBP = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64');

/** The response for a path under /wiki/ (without it), as the link Worker serves it; null for a 404. */
function serve(path) {
  if (path === 'index.json') return { contentType: 'application/json', body: JSON.stringify(index) };
  if (path.startsWith('files/')) {
    const file = index.files.find((f) => f.published === path.slice('files/'.length));
    return file ? { contentType: file.type, body: WEBP } : null;
  }
  const m = /^([^/]+)\.md$/.exec(path);
  if (m && index.pages.some((p) => p.slug === m[1])) return { contentType: 'text/markdown; charset=utf-8', body: markdown[m[1]] };
  return null;
}

module.exports = { index, markdown, serve };
