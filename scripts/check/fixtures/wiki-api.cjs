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
// from the wiki fixture) and `save` (recorded, multipart body and all, in `asked.saves`; a save
// whose summary is "force conflict" is answered 409 as when the page changed meanwhile).
// Sign-out and "I understand" change the persona for the rest of the context, as the cookies would.
const { drafts, draftMarkdown, index, markdown } = require('./wiki.cjs');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

/** The frontmatter the editor must send back untouched. */
const FRONTMATTER = '---\naliases: [Benchmarking Guide]\n---\n\n';

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
        body: markdown[slug],
        draft: false,
      });
    }
    if (path === 'save' && req.method() === 'POST') {
      if (!editor) return json(who === 'signed-out' ? 401 : 403, { error: 'not_editor', message: "You're signed in, but you don't have wiki access." });
      const form = parts(req);
      const meta = JSON.parse(form.save?.text ?? '{}');
      asked.saves.push({ meta, parts: form, headers: req.headers() });
      if (meta.summary === 'force conflict') {
        return json(409, { error: 'conflict', message: 'This page changed since you opened it. Copy your text, open the page again and add your changes to the new version.', current: { blob: 'e'.repeat(40) } });
      }
      const title = meta.create ? meta.create.title : /([^/]+)\.md$/.exec(meta.path)[1];
      const folder = meta.create ? meta.create.folder : meta.path.split('/').slice(1, -1).join('/');
      const slug = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
      const images = Object.keys(form).filter((k) => k.startsWith('image:')).map((k) => ({ path: `wiki/${folder ? `${folder}/` : ''}_attachments/${k.slice(6)}`, oid: '0'.repeat(64) }));
      return json(200, { ok: true, commit: '9'.repeat(40), path: meta.path ?? `wiki/${folder ? `${folder}/` : ''}${title}.md`, slug, title, folder, blob: '8'.repeat(40), frontmatter: meta.frontmatter, draft: meta.draft, created: !!meta.create, images });
    }
    return json(404, { error: 'not_found' });
  });
  return asked;
}

module.exports = { install, USER, FRONTMATTER };
