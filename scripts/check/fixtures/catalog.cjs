// A small stand-in for the live blueprint vault, so no check depends on
// https://blueprints.abucnasty.dev or raw.githubusercontent.com. run.cjs serves
// it to every browser context; a page module can override a URL with page.route.

const VAULT = 'https://blueprints.abucnasty.dev';
const RAW = 'https://raw.githubusercontent.com/abucnasty/factorio-blueprints/main';

// A 64 × 32 JPEG: a dark plate with an amber frame.
const RENDER_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAgAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDlmaGC2tibSKRpIyzM7PnO9h2YDoBUf2qH/nwtv++pP/iqLv8A497L/rif/Rj1WqIxuU2WftUP/Phbf99Sf/FUfaof+fC2/wC+pP8A4qq1FPlX9MVyz9qh/wCfC2/76k/+Ko+1Q/8APhbf99Sf/FVWoo5V/TC5Z+1Q/wDPhbf99Sf/ABVSK0M9tckWkUbRxhlZGfOd6juxHQmqVWbT/j3vf+uI/wDRiUpRsNMLv/j3sv8Arif/AEY9VqussM9tbA3cUbRxlWV1fOd7HspHQio/ssP/AD/23/fMn/xNEZWBorUVZ+yw/wDP/bf98yf/ABNH2WH/AJ/7b/vmT/4mnzL+kKxWoqz9lh/5/wC2/wC+ZP8A4mj7LD/z/wBt/wB8yf8AxNHMv6QWK1WbT/j3vf8AriP/AEYlH2WH/n/tv++ZP/iakVYYLa5Au4pGkjCqqK+c71PdQOgNKUrjSP/Z',
  'base64',
);

const counts = (blueprints, books, entities, tiles) => ({ blueprints, books, upgradePlanners: 0, deconstructionPlanners: 0, entities, tiles });

const index = {
  schema: 2,
  generatedAt: '2026-11-01T00:00:00.000Z',
  commit: 'fixture',
  // An unknown top-level field must be ignored.
  futureField: { anything: true },
  blueprints: [
    {
      // A blueprint with a render and its size: the stacked arrangement, set up before the image loads.
      path: 'megabasing/space-science/wide-build',
      title: 'Wide Build',
      authors: ['abucnasty', 'yuu'],
      version: 'MK2',
      posted: '2026-05-01',
      video: 'https://youtu.be/fixture',
      factoriobin: 'https://factoriobin.com/post/ignored',
      deprecated: false,
      blueprint: { kind: 'blueprint', counts: counts(1, 0, 2818, 6227), description: 'A wide fixture build.', factorioVersion: '2.0.76' },
      history: [
        { sha: 'a'.repeat(40), date: '2026-05-01T12:00:00Z', subject: 'update Wide Build to MK2' },
        { sha: 'b'.repeat(40), date: '2026-01-02T12:00:00Z', subject: 'add Wide Build MK1' },
      ],
      renders: [{ file: '0.jpg', oid: 'x', size: RENDER_JPEG.length, width: 64, height: 32 }],
      cover: '0.jpg',
      unknownEntryField: [1, 2, 3],
    },
    {
      // No render yet: the ghost plate.
      path: 'megabasing/uncommon-science/unrendered-build',
      title: 'Unrendered Build',
      authors: ['abucnasty'],
      version: '2.5',
      posted: '2025-07-03',
      deprecated: false,
      blueprint: { kind: 'blueprint', counts: counts(1, 0, 3242, 0), description: 'Not drawn yet.', factorioVersion: '2.0.55' },
      history: [{ sha: 'c'.repeat(40), date: '2025-07-03T12:00:00Z', subject: 'add Unrendered Build' }],
      renders: [],
    },
    {
      // A book with nested nodes; its renders carry no size, so the page measures them on load.
      path: 'general/tools/test-book',
      title: 'Test Book',
      authors: ['abucnasty', 'community'],
      version: '1.0',
      posted: '2026-03-01',
      deprecated: false,
      blueprint: { kind: 'blueprint-book', counts: counts(3, 1, 120, 0), description: 'A book for the checks.', factorioVersion: '2.0.76' },
      history: [{ sha: 'd'.repeat(40), date: '2026-03-01T12:00:00Z', subject: 'add Test Book' }],
      renders: [{ file: '0/0.jpg', oid: 'y', size: RENDER_JPEG.length }],
      cover: '0/0.jpg',
      nodes: [
        {
          slot: 0,
          path: '0',
          kind: 'blueprint-book',
          label: 'Outer Book',
          children: [
            { slot: 0, path: '0/0', kind: 'blueprint', label: 'Inner One', render: '0/0.jpg', folder: 'general/tools/test-book/0-inner-one' },
            { slot: 3, path: '0/3', kind: 'blueprint', label: '' },
          ],
        },
        { slot: 1, path: '1', kind: 'upgrade-planner', label: '' },
      ],
    },
    {
      path: 'megabasing/space-science/old-build',
      title: 'Old Build',
      authors: ['abucnasty'],
      version: 'MK1',
      posted: '2025-01-01',
      deprecated: true,
      status: 'deprecated',
      blueprint: { kind: 'blueprint', counts: counts(1, 0, 500, 0), description: 'Superseded.', factorioVersion: '2.0.20' },
      history: [{ sha: 'e'.repeat(40), date: '2025-01-01T12:00:00Z', subject: 'add Old Build' }],
      renders: [{ file: '0.jpg', oid: 'z', size: RENDER_JPEG.length, width: 64, height: 32 }],
      cover: '0.jpg',
    },
    {
      // Unlisted: opens by its address, listed nowhere; the newest, so it must not be the opening pick.
      path: 'megabasing/space-science/hidden-build',
      title: 'Hidden Build',
      authors: ['abucnasty'],
      version: 'MK9',
      posted: '2026-10-01',
      deprecated: false,
      status: 'unlisted',
      blueprint: { kind: 'blueprint', counts: counts(1, 0, 900, 0), description: 'Only by link.', factorioVersion: '2.0.76' },
      history: [{ sha: 'f'.repeat(40), date: '2026-10-01T12:00:00Z', subject: 'add Hidden Build' }],
      renders: [{ file: '0.jpg', oid: 'w', size: RENDER_JPEG.length, width: 64, height: 32 }],
      cover: '0.jpg',
    },
  ],
};

/** The text served as the string at a vault `.txt` address. */
const stringFor = (pathAndSlot) => `0eFIXTURE${pathAndSlot.replace(/[^A-Za-z0-9]/g, '')}`;

const readme = (folder) =>
  [
    '---',
    `title: ${folder}`,
    '---',
    '',
    `![cover](${VAULT}/${folder}/cover.jpg)`,
    '',
    `- [Whole](${VAULT}/${folder}.txt)`,
    `  - [Part](${VAULT}/${folder}/0.txt)`,
    '',
    `Fixture note for ${folder}.`,
    '',
  ].join('\n');

const cors = { 'access-control-allow-origin': '*' };

async function serveVault(route) {
  const url = new URL(route.request().url());
  const p = decodeURIComponent(url.pathname.slice(1));
  if (p === 'index.json') return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(index) });
  if (p.endsWith('.jpg')) return route.fulfill({ status: 200, headers: cors, contentType: 'image/jpeg', body: RENDER_JPEG });
  if (p.endsWith('.txt')) return route.fulfill({ status: 200, headers: cors, contentType: 'text/plain', body: stringFor(p.slice(0, -4)) });
  return route.fulfill({ status: 404, headers: cors, body: 'not found' });
}

async function serveRaw(route) {
  const url = route.request().url();
  if (url.startsWith(`${RAW}/`) && url.endsWith('/README.md')) {
    const folder = decodeURIComponent(url.slice(RAW.length + 1, -'/README.md'.length));
    return route.fulfill({ status: 200, headers: cors, contentType: 'text/plain', body: readme(folder) });
  }
  return route.fulfill({ status: 404, headers: cors, body: 'not found' });
}

/** Serve the fixture to every page of a browser context. */
async function install(context) {
  await context.route(`${VAULT}/**`, serveVault);
  await context.route('https://raw.githubusercontent.com/**', serveRaw);
}

module.exports = { VAULT, index, stringFor, install };
