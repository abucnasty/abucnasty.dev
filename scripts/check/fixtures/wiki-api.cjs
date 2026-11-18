// A stand-in for the site Worker's wiki API (/api/wiki/..., worker/wikiApi.ts), which `vite
// preview` does not run. Every browser context gets one, signed out unless `open` names a persona:
//
//   'signed-out'    no session
//   'editor'        a wiki editor who has seen the first-sign-in notice
//   'editor-first'  a wiki editor signing in for the first time on this device
//   'member'        signed in without the Wiki Editor role
//   'check-failed'  signed in, but Discord could not be asked (503)
//
// Sign-out and "I understand" change the persona for the rest of the context, as the cookies would.
const { drafts, draftMarkdown } = require('./wiki.cjs');

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
    return json(404, { error: 'not_found' });
  });
  return asked;
}

module.exports = { install, USER };
