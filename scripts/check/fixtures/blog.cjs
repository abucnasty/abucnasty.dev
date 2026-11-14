// A small stand-in for the vault's blog (https://vault.abucnasty.dev/blog/), so no check depends
// on the live vault. Served by the catalog fixture's vault route (catalog.cjs), to every browser
// context; a page module can override a URL with page.route. The two listed posts are the real
// ones (slug, title, date), so their addresses are checked; their bodies are short stand-ins.

const BLOB = 'b'.repeat(40);

const index = {
  schema: 1,
  generatedAt: '2026-11-14T00:00:00.000Z',
  commit: 'fixture',
  // An unknown top-level field must be ignored.
  futureField: true,
  posts: [
    {
      // Unlisted and the newest: opens by its address, but is in no list, count or search.
      slug: 'hidden-post',
      title: 'Hidden Fixture Post',
      date: '2026-06-01',
      description: 'Only by its address.',
      tags: [],
      status: 'unlisted',
      files: [],
    },
    {
      slug: 'fps-limit-impact-on-factorio-ups',
      title: 'Does Limiting FPS Affect Factorio UPS?',
      date: '2026-05-13',
      description: 'A deep dive into FPS limits and their impact on gameplay.',
      tags: ['performance', 'fps', 'ups'],
      status: 'public',
      files: [{ path: 'screenshots/prom_ship_60.jpg', size: 1, blob: BLOB }],
    },
    {
      slug: 'ups-wars-utility-science-announcement',
      title: 'UPS Wars: Utility Science Entries Have Opened',
      date: '2026-05-11',
      description: 'Competition entry and form submission details',
      tags: ['ups-wars'],
      status: 'public',
      files: [],
    },
  ],
};

const filler = 'Reducing the FPS cap leaves the game more time for each update, so UPS goes up. '.repeat(4);

/** Each post's markdown (index.md); relative links resolve against the post's folder. */
const markdown = {
  'hidden-post': `## Hidden\n\n${filler}\n`,
  'fps-limit-impact-on-factorio-ups': `## The Question\n\nDoes limiting the FPS of the game have an impact on UPS?\n\n${filler}\n\n![Promethium Ship at 60 FPS](./screenshots/prom_ship_60.jpg)\n\n| Term | Description |\n| ---- | ----------- |\n| FPS | Frames Per Second |\n`,
  'ups-wars-utility-science-announcement': `## Overview\n\nThe community has voted that the next competition will be for Utility Science.\n\n${filler}\n`,
};

/** The response for a path under /blog/ (without it), as the link Worker serves it; null for a 404. */
function serve(path, image) {
  if (path === 'index.json') return { contentType: 'application/json', body: JSON.stringify(index) };
  const [slug, ...rest] = path.split('/');
  const post = index.posts.find((p) => p.slug === slug);
  if (!post) return null;
  const file = rest.join('/');
  if (file === 'index.md') return { contentType: 'text/markdown; charset=utf-8', body: markdown[slug] };
  if (post.files.some((f) => f.path === file)) return { contentType: 'image/jpeg', body: image };
  return null;
}

module.exports = { index, markdown, serve, BLOB };
