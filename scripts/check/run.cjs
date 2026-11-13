// Layout checks against the built site.
//
//   npm run build && npm run check [-- --only tools,home] [-- --shots]
//
// Starts `vite preview` on a free port, opens pages in headless Chromium and
// runs every module in scripts/check/pages. See "Checking layout" in README.md.
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const catalogFixture = require('./fixtures/catalog.cjs');

const root = path.resolve(__dirname, '..', '..');
const pagesDir = path.join(__dirname, 'pages');
const outDir = path.join(root, 'check-output');

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
};

// Console errors that are known and unrelated to layout. Matched against the
// message text and the URL of the resource that failed.
const IGNORED_ERRORS = [
  {
    match: 'googleapis.com/youtube',
    why: "Home's latest-video card calls the YouTube Data API, which fails without an API key",
  },
  {
    match: 'blueprints.abucnasty.dev/index.json',
    why: 'the blueprints check makes the catalog fail on purpose to see the "Try again" state',
  },
];

function parseArgs(argv) {
  const args = { only: null, shots: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--shots') args.shots = true;
    else if (argv[i] === '--only') args.only = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (argv[i].startsWith('--only=')) args.only = argv[i].slice(7).split(',').filter(Boolean);
    else {
      console.error(`Unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  return args;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

let server = null;
function stopServer() {
  if (server && server.exitCode === null && !server.killed) server.kill('SIGKILL');
  server = null;
}

async function startServer() {
  const port = await freePort();
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  server = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`vite preview exited early:\n${log}`);
    try {
      const res = await fetch(base + '/');
      if (res.ok) return base;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`vite preview did not answer on ${base} within 30 s:\n${log}`);
}

function loadData() {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(root, 'src', 'generated', name), 'utf8'));
  // `catalog` is the fixture every page is served in place of the live blueprint vault.
  return { index: read('index.json'), catalog: catalogFixture.index, saves: read('saves.json') };
}

const results = [];
const ignored = new Map();

// A page module may list `knownIssues: [{ match, why }]`: failing assertions whose
// label contains `match` are reported as KNOWN and do not fail the run. Use it only
// for an existing defect that a later package is going to fix, and say so in `why`.
function record(moduleName, label, ok, detail, known) {
  const issue = !ok ? (known || []).find((k) => label.includes(k.match)) : undefined;
  results.push({ module: moduleName, label, ok: ok || Boolean(issue), known: Boolean(issue) });
  const tail = !ok && detail !== undefined && detail !== '' ? `  -- ${detail}` : '';
  const status = ok ? 'PASS' : issue ? 'KNOWN' : 'FAIL';
  console.log(`${status}  [${moduleName}] ${label}${tail}${issue ? `  (known issue: ${issue.why})` : ''}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
    console.error('dist/index.html not found: run `npm run build` first.');
    process.exit(2);
  }
  const all = fs
    .readdirSync(pagesDir)
    .filter((f) => f.endsWith('.cjs'))
    .sort()
    .map((f) => ({ file: f, mod: require(path.join(pagesDir, f)) }));
  let selected = all;
  if (args.only) {
    const known = new Set(all.flatMap(({ file, mod }) => [mod.name, file.replace(/\.cjs$/, '')]));
    const unknown = args.only.filter((n) => !known.has(n));
    if (unknown.length) {
      console.error(`Unknown page module(s): ${unknown.join(', ')}. Available: ${all.map((a) => a.mod.name).join(', ')}`);
      process.exit(2);
    }
    selected = all.filter(({ file, mod }) => args.only.includes(mod.name) || args.only.includes(file.replace(/\.cjs$/, '')));
  }

  const data = loadData();
  const started = Date.now();
  let browser = null;
  let crashed = false;
  try {
    const base = await startServer();
    const launch = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : undefined;
    browser = await chromium.launch(launch);
    if (args.shots) fs.mkdirSync(outDir, { recursive: true });

    for (const { mod } of selected) {
      const contexts = [];
      const byPage = new Map(); // Page -> { viewport, errors, requests }

      const watch = (page, viewport) => {
        const state = { viewport, errors: [], requests: [] };
        byPage.set(page, state);
        page.on('request', (r) => state.requests.push(r.url()));
        const consider = (text, url) => {
          const hit = IGNORED_ERRORS.find((i) => text.includes(i.match) || (url ?? '').includes(i.match));
          if (hit) ignored.set(hit.match, hit.why);
          else state.errors.push(`${page.url()} :: ${text}`);
        };
        page.on('console', (m) => {
          if (m.type() === 'error') consider(m.text(), m.location().url);
        });
        page.on('pageerror', (e) => state.errors.push(`${page.url()} :: uncaught ${e.message}`));
      };

      const checkSideways = async (page, where) => {
        if (byPage.get(page).viewport !== 'phone') return;
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        record(mod.name, `phone: no sideways scroll on ${where}`, over <= 0, `overflow ${over}px`, mod.knownIssues);
      };

      const ctx = {
        base,
        data,
        async open(urlPath, viewport = 'desktop') {
          if (!VIEWPORTS[viewport]) throw new Error(`unknown viewport "${viewport}"`);
          const context = await browser.newContext({
            viewport: VIEWPORTS[viewport],
            deviceScaleFactor: args.shots ? 2 : 1,
            permissions: ['clipboard-read', 'clipboard-write'],
          });
          contexts.push(context);
          await catalogFixture.install(context);
          const page = await context.newPage();
          watch(page, viewport);
          await ctx.goto(page, urlPath);
          return page;
        },
        /** Full navigation of an already opened page, with the same per-page checks as `open`. */
        async goto(page, urlPath) {
          await page.goto(base + urlPath, { waitUntil: 'networkidle' });
          await checkSideways(page, urlPath);
        },
        /** URLs the page has requested so far. */
        requests(page) {
          return byPage.get(page).requests;
        },
        expect(label, ok, detail) {
          record(mod.name, label, Boolean(ok), detail, mod.knownIssues);
        },
        async aboveFold(page, selector) {
          return page.evaluate((sel) => {
            let n = 0;
            for (const el of document.querySelectorAll(sel)) {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth) n += 1;
            }
            return n;
          }, selector);
        },
        async box(page, selector) {
          const el = await page.$(selector);
          if (!el) return null;
          const b = await el.boundingBox();
          if (!b) return null;
          return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
        },
        async shot(page, name) {
          if (args.shots) await page.screenshot({ path: path.join(outDir, `${name}.png`) });
        },
      };

      try {
        await mod.run(ctx);
      } catch (err) {
        crashed = true;
        record(mod.name, 'page module ran to completion', false, err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : String(err));
      }
      const errors = [...byPage.values()].flatMap((s) => s.errors);
      if (byPage.size > 0) record(mod.name, 'no page errors or console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
      for (const context of contexts) await context.close().catch(() => {});
    }
  } catch (err) {
    crashed = true;
    console.error(err && err.stack ? err.stack : String(err));
  } finally {
    if (browser) await browser.close().catch(() => {});
    stopServer();
  }

  if (ignored.size) {
    console.log('\nIgnored console errors:');
    for (const [match, why] of ignored) console.log(`  ${match}: ${why}`);
  }
  const failed = results.filter((r) => !r.ok);
  const known = results.filter((r) => r.known);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${results.length - failed.length}/${results.length} assertions passed${known.length ? ` (${known.length} known)` : ''} in ${secs}s${crashed ? ' (a page module threw)' : ''}`);
  if (failed.length) {
    console.log('Failed:');
    for (const f of failed) console.log(`  [${f.module}] ${f.label}`);
  }
  process.exit(failed.length || crashed ? 1 : 0);
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    stopServer();
    process.exit(130);
  });
}
process.on('exit', stopServer);

main().catch((err) => {
  console.error(err);
  stopServer();
  process.exit(1);
});
