// A stand-in for the site Worker's wiki API (/api/wiki/..., worker/wikiApi.ts), which `vite
// preview` does not run. Every browser context gets one, signed out unless `open` names a persona:
//
//   'signed-out'    no session
//   'editor'        a wiki editor who has seen the first-sign-in notice
//   'editor-first'  a wiki editor signing in for the first time on this device
//   'member'        signed in without the Wiki Editor role
//   'check-failed'  signed in, but Discord could not be asked (503)
//
// Editors also get the editor's calls: `source?slug=` (a page's file, frontmatter included, built
// from the wiki fixture) and `save` (recorded, multipart body and all, in `asked.saves`). Edits
// made by someone else meanwhile are stood in for by the save's summary:
//   "force merge"     combined with abucnasty's edit from 5 minutes ago (THEIRS_HEADING), saved;
//                     `source` then gives the combined page
//   "force conflict"  409 conflict: Other Editor changed the last line too (theirsVersion), unless
//                     the save is already against their version (the combined save)
//   "force gone"      409 gone: abucnasty deleted the page 5 minutes ago
// A new page whose title is a page's in the wiki fixture is answered 409 exists.
// Sign-out and "I understand" change the persona for the rest of the context, as the cookies would.
//
// History: `history?path=` (anyone for a published page, editors for a draft; How to Benchmark has
// three edits across a rename), `version?path=&ref=` and `deleted` (editors), and the changes
// `restore`, `rename`, `delete`, `undelete` (editors; recorded in `asked.changes` as { what, body }).
// Restoring a deleted page whose title is taken without a new title is answered 409 title_taken.
const { drafts, draftMarkdown, index, markdown } = require('./wiki.cjs');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

/** The frontmatter the editor must send back untouched. */
const FRONTMATTER = '---\naliases: [Benchmarking Guide]\n---\n\n';

/** The other edit's change that overlaps nothing (a heading), and the line both change. */
const THEIRS_HEADING = ['## Prerequisites', '## Before you start'];
const LAST_LINE = 'See [[Setting Up Arch to Run Factorio#Prerequisites|the Arch prerequisites]].';
const THEIRS_LAST = 'See [[Setting Up Arch to Run Factorio#Prerequisites|the Arch prerequisites]], updated in Obsidian.';
/** How to Benchmark as the other edit left it. */
const theirsVersion = (body) => body.replace(THEIRS_HEADING[0], THEIRS_HEADING[1]).replace(LAST_LINE, THEIRS_LAST);
const THEIR_BLOB = 'e'.repeat(40);
const THEIR_HEAD = 'd'.repeat(40);
const minutesAgo = (n) => new Date(Date.now() - n * 60 * 1000).toISOString();

/** The parts of a multipart/form-data body: name → { filename, text, size }. */
function parts(req) {
  const type = req.headers()['content-type'] ?? '';
  const boundary = /boundary=(.+)$/.exec(type)?.[1];
  const raw = req.postDataBuffer();
  const out = {};
  if (!boundary || !raw) return out;
  const text = raw.toString('latin1');
  for (const chunk of text.split(`--${boundary}`)) {
    const m = /^\r\nContent-Disposition: form-data; name="([^"]*)"(?:; filename="([^"]*)")?\r\n(?:Content-Type: [^\r]*\r\n)?\r\n([\s\S]*)\r\n$/.exec(chunk);
    if (m) out[Buffer.from(m[1], 'latin1').toString('utf8')] = { filename: m[2], text: Buffer.from(m[3], 'latin1').toString('utf8'), size: Buffer.from(m[3], 'latin1').length, head: m[3].slice(0, 12) };
  }
  return out;
}

const HOW_TO = 'wiki/Guides/How to Benchmark.md';
const OLD_PATH = 'wiki/Guides/Benchmarking Guide.md';
const sha = (c) => c.repeat(40);
/** How to Benchmark's history: an edit on the site, a rename on the site, the owner's first version. */
const HISTORY = [
  { sha: sha('1'), date: '2026-11-17T18:20:00Z', author: 'Buc the Editor', summary: 'Explain the new flags', path: HOW_TO, site: true },
  { sha: sha('2'), date: '2026-11-10T09:05:00Z', author: 'Buc the Editor', summary: 'Renamed Benchmarking Guide to How to Benchmark', path: HOW_TO, kind: 'renamed', from: OLD_PATH, site: true },
  { sha: sha('3'), date: '2026-10-01T12:00:00Z', author: 'abucnasty', summary: 'sync edits from obsidian', path: OLD_PATH, site: false },
];
const pathOf = (p) => `wiki/${p.folder ? `${p.folder}/` : ''}${p.title}.md`;
/** A page's file at a history commit. */
function versionText(path, ref) {
  const body = markdown['how-to-benchmark'];
  if (path === HOW_TO && ref === sha('1')) return FRONTMATTER + body;
  if (path === HOW_TO && ref === sha('2')) return FRONTMATTER + body.replace('## Prerequisites', '## Before you start');
  if (path === OLD_PATH && ref === sha('3')) return body.replace('## Prerequisites', '## Before you start').replace(/\n\n[^\n]*$/, '\n');
  const page = [...index.pages, ...drafts.pages].find((p) => pathOf(p) === path);
  return page ? (markdown[page.slug] ?? draftMarkdown[page.slug] ?? '') : null;
}
const DELETED = [
  { path: 'wiki/Guides/Old Notes.md', title: 'Old Notes', folder: 'Guides', commit: sha('4'), date: '2026-11-15T08:00:00Z', author: 'abucnasty', site: false, titleTaken: null },
  { path: 'wiki/Setting Up Arch to Run Factorio.md', title: 'Setting Up Arch to Run Factorio', folder: '', commit: sha('5'), date: '2026-11-12T08:00:00Z', author: 'Buc the Editor', site: true, titleTaken: 'Setting Up Arch to Run Factorio' },
];
const slugOf = (title) => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');

const USER = { userId: '80351110224678912', displayName: 'Buc the Editor', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png' };

function me(persona) {
  switch (persona) {
    case 'editor':
      return { status: 200, body: { signedIn: true, editor: true, ...USER, firstSignIn: false } };
    case 'editor-first':
      return { status: 200, body: { signedIn: true, editor: true, ...USER, firstSignIn: true } };
    case 'member':
      return { status: 200, body: { signedIn: true, editor: false, ...USER, displayName: 'Just A Member' } };
    case 'check-failed':
      return { status: 503, body: { error: 'access_check_failed', message: "Couldn't check your wiki access with Discord. Try again in a minute.", signedIn: true, ...USER } };
    default:
      return { status: 200, body: { signedIn: false, editor: false, userId: null, displayName: null, avatarUrl: null } };
  }
}

/** Serve /api/wiki/... on `base` to every page of the context; returns what it was asked, in order. */
async function install(context, base, persona = 'signed-out') {
  let who = persona;
  const asked = [];
  asked.saves = [];
  asked.changes = [];
  /** Pages combined with another edit by a save: the source gives them afterwards. */
  const combined = new Map();
  await context.route(`${base}/api/wiki/**`, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.slice('/api/wiki/'.length);
    asked.push(`${req.method()} ${path}`);
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(body) });
    const editor = who === 'editor' || who === 'editor-first';
    if (path === 'me' && req.method() === 'GET') {
      const r = me(who);
      return json(r.status, r.body);
    }
    if (path === 'auth/logout' && req.method() === 'POST') {
      who = 'signed-out';
      return route.fulfill({ status: 204 });
    }
    if (path === 'ack' && req.method() === 'POST') {
      if (who === 'editor-first') who = 'editor';
      return route.fulfill({ status: 204 });
    }
    if (path.startsWith('drafts/')) {
      if (!editor) return json(who === 'signed-out' ? 401 : 403, { error: 'not_editor' });
      const rest = path.slice('drafts/'.length);
      if (rest === 'index.json') return json(200, drafts);
      const m = /^(.+)\.md$/.exec(rest);
      const md = m && draftMarkdown[decodeURIComponent(m[1])];
      return md ? route.fulfill({ status: 200, contentType: 'text/markdown; charset=utf-8', body: md }) : json(404, { error: 'not_found' });
    }
    if (path.startsWith('image/') && req.method() === 'GET') {
      if (!editor) return json(403, { error: 'not_editor' });
      // A just-saved image: any small picture will do.
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    }
    if (path === 'source' && req.method() === 'GET') {
      if (!editor) return json(who === 'signed-out' ? 401 : 403, { error: 'not_editor' });
      const slug = new URL(req.url()).searchParams.get('slug');
      const page = index.pages.find((p) => p.slug === slug);
      if (!page) return json(404, { error: 'not_found', message: "This page isn't in the vault's main branch." });
      const folder = page.folder;
      return json(200, {
        path: `wiki/${folder ? `${folder}/` : ''}${page.title}.md`,
        title: page.title,
        folder,
        blob: page.blob,
        head: 'f'.repeat(40),
        frontmatter: slug === 'how-to-benchmark' ? FRONTMATTER : '',
        body: combined.get(slug) ?? markdown[slug],
        draft: false,
      });
    }
    const url = new URL(req.url());
    if (path === 'history' && req.method() === 'GET') {
      const p = url.searchParams.get('path');
      const published = index.pages.some((x) => pathOf(x) === p);
      if (!published && !editor) return json(who === 'signed-out' ? 401 : 403, { error: 'not_editor', message: 'Sign in as a wiki editor.' });
      const entries = p === HOW_TO ? HISTORY : [{ sha: sha('6'), date: '2026-09-01T10:00:00Z', author: 'abucnasty', summary: 'sync edits from obsidian', path: p, site: false }];
      return json(200, { path: p, entries, truncated: false });
    }
    if (path === 'version' && req.method() === 'GET') {
      if (!editor) return json(403, { error: 'not_editor' });
      const text = versionText(url.searchParams.get('path'), url.searchParams.get('ref'));
      return text === null ? json(404, { error: 'not_found' }) : route.fulfill({ status: 200, contentType: 'text/markdown; charset=utf-8', body: text });
    }
    if (path === 'deleted' && req.method() === 'GET') {
      if (!editor) return json(who === 'signed-out' ? 401 : 403, { error: 'not_editor' });
      return json(200, { since: '2026-08-20T00:00:00Z', partial: false, pages: DELETED });
    }
    if (['restore', 'rename', 'delete', 'undelete'].includes(path) && req.method() === 'POST') {
      if (!editor) return json(who === 'signed-out' ? 401 : 403, { error: 'not_editor', message: "You're signed in, but you don't have wiki access." });
      const body = JSON.parse(req.postData() ?? '{}');
      asked.changes.push({ what: path, body, headers: req.headers() });
      const title = /([^/]+)\.md$/.exec(body.path)[1];
      const folder = body.path.split('/').slice(1, -1).join('/');
      if (path === 'restore') {
        const text = versionText(body.from, body.commit) ?? '';
        return json(200, { ok: true, commit: sha('9'), path: body.path, slug: slugOf(title), title, folder, blob: sha('8'), frontmatter: FRONTMATTER, draft: false, body: text.startsWith('---') ? text.slice(FRONTMATTER.length) : text });
      }
      if (path === 'rename') {
        return json(200, { ok: true, commit: sha('9'), path: `wiki/${body.folder ? `${body.folder}/` : ''}${body.title}.md`, slug: slugOf(body.title), title: body.title, folder: body.folder, blob: sha('8'), frontmatter: `---\naliases: [Benchmarking Guide, ${title}]\n---\n\n`, draft: false });
      }
      if (path === 'delete') return json(200, { ok: true, commit: sha('9'), path: body.path, slug: slugOf(title), title, draft: false });
      const gone = DELETED.find((d) => d.path === body.path);
      if (gone && gone.titleTaken && !body.title) return json(409, { error: 'title_taken', message: `There's already a page called "${gone.titleTaken}". Restore this one under a different title.` });
      const t = body.title ?? title;
      return json(200, { ok: true, commit: sha('9'), path: `wiki/${folder ? `${folder}/` : ''}${t}.md`, slug: slugOf(t), title: t, folder, blob: sha('8'), frontmatter: '', draft: false, body: `# ${t}\n\nRestored by the check.\n` });
    }
    if (path === 'save' && req.method() === 'POST') {
      if (!editor) return json(who === 'signed-out' ? 401 : 403, { error: 'not_editor', message: "You're signed in, but you don't have wiki access." });
      const form = parts(req);
      const meta = JSON.parse(form.save?.text ?? '{}');
      asked.saves.push({ meta, parts: form, headers: req.headers() });
      const title = meta.create ? meta.create.title : /([^/]+)\.md$/.exec(meta.path)[1];
      const folder = meta.create ? meta.create.folder : meta.path.split('/').slice(1, -1).join('/');
      const slug = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
      if (meta.path && meta.summary === 'force conflict' && meta.base !== THEIR_BLOB) {
        const base = combined.get(slug) ?? markdown[slug];
        return json(409, {
          error: 'conflict',
          message: 'Other Editor changed the same part of this page while you were editing. Choose what to keep, then save the combined version.',
          current: { blob: THEIR_BLOB },
          path: meta.path,
          title,
          folder,
          base: { blob: meta.base, body: base },
          theirs: { blob: THEIR_BLOB, head: THEIR_HEAD, frontmatter: meta.frontmatter, body: theirsVersion(base), draft: false, edits: [{ author: 'Other Editor', date: minutesAgo(5), summary: 'Update the Arch link' }] },
          mine: { body: meta.body, combined: meta.body.replace(THEIRS_HEADING[0], THEIRS_HEADING[1]) },
        });
      }
      if (meta.path && meta.summary === 'force gone') {
        return json(409, { error: 'gone', message: 'abucnasty deleted this page while you were editing.', current: null, deleted: { author: 'abucnasty', date: minutesAgo(5), summary: 'sync edits from obsidian' }, path: meta.path, title, folder });
      }
      if (meta.create && index.pages.some((p) => p.title.toLowerCase() === title.toLowerCase())) {
        return json(409, { error: 'exists', message: `There's already a page called "${title}", which has the same title or address. Choose another title.` });
      }
      let extra = {};
      if (meta.path && meta.summary === 'force merge') {
        const body = meta.body.replace(THEIRS_HEADING[0], THEIRS_HEADING[1]);
        combined.set(slug, body);
        extra = { body, merged: { edits: [{ author: 'abucnasty', date: minutesAgo(5), summary: 'sync edits from obsidian' }] } };
      }
      const images = Object.keys(form).filter((k) => k.startsWith('image:')).map((k) => ({ path: `wiki/${folder ? `${folder}/` : ''}_attachments/${k.slice(6)}`, oid: '0'.repeat(64) }));
      return json(200, { ok: true, commit: '9'.repeat(40), path: meta.path ?? `wiki/${folder ? `${folder}/` : ''}${title}.md`, slug, title, folder, blob: '8'.repeat(40), frontmatter: meta.frontmatter, draft: meta.draft, created: !!meta.create, images, ...extra });
    }
    return json(404, { error: 'not_found' });
  });
  return asked;
}

module.exports = { install, USER, FRONTMATTER, theirsVersion, THEIRS_LAST, THEIR_BLOB, THEIR_HEAD };
