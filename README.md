# abucnasty.dev

Source for abucnasty's Factorio site: UPS benchmark write-ups, a browser for every save in [abucnasty/factorio-benchmarks](https://github.com/abucnasty/factorio-benchmarks), a blueprint catalog, tools, a wiki and a blog. It is a single-page app built with Vite 8, React 18, TypeScript, MUI and React Router (`BrowserRouter`).

## Run it locally

Vite 8 needs Node 20.19+ or 22.12+; CI uses Node 24.

The build reads a local git clone of factorio-benchmarks (any kind: full, shallow, partial or sparse, but a git clone, not an exported copy, because the save index is read from git objects). It looks in `../factorio/factorio-benchmarks`, or wherever `FACTORIO_BENCHMARKS_PATH` points. Chart CSVs in that repo are in git-lfs, so run `git lfs pull --include="*.csv"` there or the sync fails.

```sh
cp .env.example .env   # set FACTORIO_BENCHMARKS_PATH
npm install
npm run dev            # sync content, then start the Vite dev server
npm run build          # sync content, type-check, build to dist/
npm run sync           # only refresh the synced content
npm run lint           # type-check the app and the Worker (needs synced content in src/generated)
npm test               # unit tests of the Worker's pure parts (node --test)
npm run check          # check every page of the built site in headless Chromium
```

`npm run dev` has no Worker, so the latest-video card shows "Couldn't load the latest video" and pages keep the generic preview tags. To run the site with the Worker, build, put the key in `.dev.vars` (gitignored) and start `wrangler dev`:

```sh
echo 'YOUTUBE_API_KEY=...' > .dev.vars   # optional; without it /api/latest-video answers 503
npm run build && npx wrangler dev        # http://localhost:8787
```

After changing `wrangler.jsonc`, regenerate the Worker's types with `npm run types:worker`.

`npm run check` serves `dist/` with `vite preview` and asserts facts about each page at desktop and phone widths; `-- --only tools,home` limits it to some pages and `-- --shots` writes screenshots to `check-output/`. Page modules live in `scripts/check/pages/`, and the blueprint catalog is served from a fixture in `scripts/check/fixtures/`; so is the Worker's wiki API (`wiki-api.cjs`), signed out unless a check opens a page as an editor or another persona.

Sync runs through `&&` in the `dev` and `build` scripts, not lifecycle hooks, so it also runs with `ignore-scripts`.

## Where content comes from

- **Benchmarks and saves** are not in this repo. At build time `scripts/sync-content.mjs` reads the factorio-benchmarks clone and writes `src/generated/` and `public/benchmarks/` (both gitignored). Only the files a write-up's rendered markdown loads from the site (its images) go to `public/benchmarks/`; links to other files in the folder point at GitHub (or the LFS worker), and every site URL in the published markdown must resolve to a published file. PNG and JPEG images are published as WebP, at most 1600 px wide, by [sharp](https://sharp.pixelplumbing.com/) (`scripts/lib/webp.mjs`: lossless for images with at most 4096 colours, such as charts, quality 82 otherwise); SVGs and animated PNGs are copied as they are. sharp's native binaries come from its platform-specific optional dependencies, not an install script, so it works with `npm ci --ignore-scripts`; an install with `--omit=optional` would break it. A benchmark is published when its `benchmarks/<folder>/README.md` in factorio-benchmarks starts with frontmatter that opts in; the frontmatter is not published with the write-up:

  ```yaml
  ---
  publish: true                   # required; without it the folder is not published
  slug: clocked-mining-drills     # required; the page is /benchmarks/<slug>
  title: Clocked Mining Drills    # required
  topic: mining                   # optional; an id from `topics` in content/manifest.json
  date: 2025-11-11                # optional, YYYY-MM-DD
  featured: 3                     # optional; place in the home page's Featured list
  chart:                          # optional; the interactive chart's scenario CSVs
    scenarios:
      - { name: Clocked, csv: results/bm_mining_drill_clocked_verbose_metrics.csv }
  ---
  ```

  `summary` and `tags` are accepted too; any other field, a duplicate slug or an unknown topic fails the sync (`scripts/lib/benchmark-frontmatter.mjs`). Benchmarks are listed in folder-name order with featured ones first; every list on the site sorts by date and keeps that order for ties and undated ones. So publishing a benchmark means editing only factorio-benchmarks. `content/manifest.json` keeps the site-wide settings: the source repo and branch, `lfsWorkerUrl` and the topics. The `/saves` index covers every `.zip` committed at `HEAD` of the source repo, read from git-lfs pointers; downloads go through `lfsWorkerUrl` in the manifest. Sync fails rather than publish a broken page.
- **Blueprints** are fetched in the browser on each visit from the live catalog at `https://vault.abucnasty.dev/index.json` (strings and images under `https://vault.abucnasty.dev/blueprints/`, notes from the repo's `blueprints/` folder), published from [abucnasty/factorio-vault](https://github.com/abucnasty/factorio-vault). See `src/catalog.ts` (types and pure helpers in `src/catalogCore.ts`, which the Worker shares).
- **Blog posts** live in the vault ([abucnasty/factorio-vault](https://github.com/abucnasty/factorio-vault), `blog/<slug>/README.md` with its images beside it), not in this repo. The vault's CI publishes them to `https://vault.abucnasty.dev/blog/`: `index.json` lists the published posts and `<slug>/index.md` is each post's markdown. The browser reads both at run time (`src/blog.ts`, `src/blogCore.ts`), like the blueprint catalog, and resolves the post's relative links and images against `https://vault.abucnasty.dev/blog/<slug>/`. A new post needs no change or deploy here.
- **Wiki pages** live in the vault too (`wiki/**/<Title>.md`, images in `_attachments/` folders). Its CI publishes `https://vault.abucnasty.dev/wiki/index.json` (pages with their headings, excerpt and links, and the published images), each page's markdown at `/wiki/<slug>.md` and compressed images under `/wiki/files/`. The site shows `/wiki` (the front page, `Home.md`), `/wiki/<slug>` and `/wiki/all`; a former title's address (frontmatter `aliases`) redirects. Wiki markdown is rendered without raw HTML and sanitised (`src/wikiMarkdown.ts`), with Obsidian links, image embeds, callouts, comments and YouTube players; the addressing and link rules in `src/wikiCore.ts` repeat the vault's.
- **Tools** are listed in `src/data/tools.ts`.

## The Worker

`worker/` is a small Worker in front of the static assets. `run_worker_first` in `wrangler.jsonc` sends it only `/api/*`, `/blueprints/*`, `/benchmarks/<slug>`, `/blog/<slug>` and `/wiki`, `/wiki/<slug>`; every other request, and every file under those paths, is served from `dist/` without running it.

- **`GET /api/latest-video`** returns the channel's newest upload as `{ id, title, published, url }`, fetched from the YouTube Data API with the `YOUTUBE_API_KEY` secret, so the key is not in the client bundle. An answer is kept for an hour; when YouTube fails, the last good answer is served. With nothing to serve it answers `{ "error", "message" }` with 503 (`not_configured`: no key) or 502 (`upstream_error`).
- **Link previews.** For a blueprint (from the live catalog, cached for 60 s, including `?entry=<slot>`), a benchmark (`src/generated/index.json`) a blog post (from the live blog index, cached for 60 s) or a wiki page (from the live wiki index, likewise; a former title's address answers with a 301 to the page), it serves `index.html` with that page's `<title>`, description, canonical, Open Graph and Twitter tags. Benchmark data is bundled into the Worker by wrangler at deploy time. Canonical and `og:url` use the `SITE_URL` var; unknown pages get the page untouched.

- **Wiki sign-in and drafts (`/api/wiki/...`, `worker/wikiApi.ts`).** Wiki maintainers sign in with Discord (the `buc-bot` application, OAuth2 authorization code, `identify` scope only) from the "Maintainer sign-in" link at the foot of every wiki page. `auth/login?return=<path>` sets a signed 10-minute `state` cookie and sends the visitor to Discord; `auth/callback` (the redirect registered in Discord, exactly `https://abucnasty.dev/api/wiki/auth/callback`) checks it, exchanges the code, reads who signed in and sets the session: a signed (HMAC-SHA-256, `WIKI_SESSION_SECRET`) HttpOnly, Secure, SameSite=Lax `__Host-wiki-session` cookie holding the Discord user id and name, good for 30 days on that device. The Discord token is not kept, and there is no server-side session store. `POST auth/logout` clears it (same-origin requests only). An editor is a member of the server `DISCORD_GUILD_ID` with the role `WIKI_EDITOR_ROLE_ID`, looked up with the bot token (Get Guild Member, no privileged intent) and cached for five minutes per user; when Discord cannot answer, the wiki says it couldn't check rather than guessing. `GET me` says who is signed in and whether they are an editor; `POST ack` records that an editor read the first-sign-in notice (a second signed cookie, so it shows once per device). Editors also get the drafts: `drafts/index.json` and `drafts/<slug>.md` read the vault's `wiki-drafts/` objects from the catalog bucket (the `VAULT_CATALOG` R2 binding, read only), which the vault host never serves. On the site a draft appears only for editors, marked "Draft"; for anyone else it does not exist, and link previews and redirects never use drafts. The secrets `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN` and `WIKI_SESSION_SECRET` (random, at least 32 characters; changing it signs everyone out) are set on the Worker by hand with `wrangler secret put`; without them sign-in answers "unavailable". To try it locally, put them in `.dev.vars` too; the Discord redirect still goes to the live site.
- **Editing the wiki (`/api/wiki/source`, `/api/wiki/save`, `worker/wikiSave.ts`).** A wiki editor gets an Edit button on each page and "New page" on `/wiki/all` (and "Create this page" on a missing page or link). The editor (`src/wikiEditor/`, its own chunks: Milkdown for the visual mode, CodeMirror for the markdown mode, loaded only when someone edits) reads the page's file from the vault's `main` (`GET source?slug=`, editors only) and keeps the frontmatter hidden and unchanged; its only control is the Draft/Published switch. `POST save` (same-origin, multipart: the page plus new images) checks the session and asks Discord for the role every time (never the cache), takes a slot from the editor's rate limit (20 saves per 10 minutes, a Durable Object per Discord user, `worker/rateLimit.ts`; `wrangler deploy` creates it from the migration in `wrangler.jsonc`), and commits through the Git Data API as the wiki GitHub App (installed only on `abucnasty/factorio-vault`, Contents read and write): blobs, a tree on `main`'s tree, a commit whose author is the editor's server display name with the fixed address `wiki-editor@users.noreply.abucnasty.dev` (no mailbox) and the message `<summary>`, blank line, `Wiki edit by <name> (Discord <id>) via abucnasty.dev`, then `main` moved without force. It writes only `wiki/**/<Title>.md` pages (at most 200 KB) and images in the page's own `_attachments/` folder; images (converted in the browser to WebP, longest side 1600 px, quality 85; GIFs kept, at most 5 MB) go to the LFS bucket (`LFS_BUCKET`, `factorio-blueprints-lfs`, key `<oid[0:2]>/<oid[2:4]>/<oid>`) and their Git LFS pointers are committed with the page. A save carries the blob it started from: if the page changed meanwhile it answers 409 and the editor keeps the text with "Copy my text"; if only `main` moved, the commit is made again on the new head (three tries). Published saves are announced in `WIKI_ANNOUNCE_CHANNEL_ID` by the bot (an embed, no mentions); drafts are not, and a failed announcement never fails a save. The vault publishes the commit about a minute later; until then the editor sees the saved version (new images through `GET image/<oid>`, editors only). Config: vars `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID` in `wrangler.jsonc`, the secret `GITHUB_APP_PRIVATE_KEY` (the app's private key, PEM; PKCS#8, or the PKCS#1 key GitHub issues) set with `wrangler secret put`. Without the key or the bucket, Edit is disabled with "Wiki editing isn't set up".
- **Emergency stop: `WIKI_READ_ONLY`.** Set the variable `WIKI_READ_ONLY` to `true` in the Cloudflare dashboard (Workers & Pages → abucnasty-dev → Settings → Variables and Secrets, type Text) and every save is refused at once ("Wiki editing is paused"; Edit is disabled); delete it (or set `false`) to resume. It is deliberately not in `wrangler.jsonc`: `keep_vars: true` there makes deploys keep dashboard variables (without it, `wrangler deploy` deletes any var not in the config). A secret of the same name (`wrangler secret put WIKI_READ_ONLY`) works too.

The Worker sends `Referer: <SITE_URL>/` on its YouTube request, so the key can keep a website (HTTP referrer) restriction in Google Cloud: allow `https://abucnasty.dev/*` and restrict the key to the YouTube Data API v3. If `SITE_URL` changes, change the allowed referrer to match.

## Deployment

The site is a Cloudflare Worker that serves `dist/` as static assets, plus the script in `worker/` (`wrangler.jsonc`). Paths that match no file return `index.html` with status 200, so the client-side router handles deep links.

It is served at `https://abucnasty.dev`, a custom domain in `routes` in `wrangler.jsonc` (wrangler creates its DNS record and certificate on deploy), and still at the `workers.dev` address, which `workers_dev` keeps on as a preview. `www.abucnasty.dev` is not attached to the Worker; a Redirect Rule on the zone sends it to `https://abucnasty.dev` with 301, keeping path and query. Keep `SITE_URL` and the canonical, `og:url` and JSON-LD `url` in `index.html` on the same origin; `npm test` checks that they agree.

Cloudflare Web Analytics is a dashboard setting (automatic setup on the proxied zone), not a script in this repo.

**Checks.** Every pull request runs `.github/workflows/check.yml` (no secrets needed): the same benchmarks checkout and `npm run build` as a deploy, `npm test`, `npx wrangler deploy --dry-run`, and `npm run check -- --only home,blueprints,benchmark-detail` in headless Chromium. The page checks fetch nothing live: the blueprint catalog and the avatar come from fixtures, and any other outside request fails the run.

On every push to `main`, a manual run, or a `benchmarks-updated` repository dispatch, `.github/workflows/deploy.yml`:

1. runs `npm ci --ignore-scripts`, sparse-clones factorio-benchmarks (`--filter=blob:limit=1k`, so every git-lfs pointer still arrives for the save index) with only the benchmark READMEs checked out, reads their frontmatter, narrows the checkout to the published folders, then pulls the chart CSVs from git-lfs;
2. runs `npm run build` and `npm test`;
3. runs `npx wrangler deploy --secrets-file <temp file>`, which uploads the Worker's secrets from repository secrets along with the new version.

factorio-benchmarks sends that dispatch on each push to its `master` that touches a benchmark folder, a save or a README (its `.github/workflows/rebuild-site.yml`), so a new or changed benchmark goes live without a change here. That workflow uses the `SITE_DISPATCH_TOKEN` secret of factorio-benchmarks: a fine-grained personal access token with access to `abucnasty/abucnasty.dev` only and the repository permission Contents: Read and write.

Repository secrets it needs:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `YOUTUBE_API_KEY` (YouTube Data API v3 key for `/api/latest-video`; it becomes the Worker secret of the same name). `wrangler.jsonc` lists it under `secrets.required`, so a deploy fails if the Worker has no value for it; when the repository secret is empty the Worker keeps the value it already has.

To try a deploy without credentials: `npm run build && npx wrangler deploy --dry-run`.
