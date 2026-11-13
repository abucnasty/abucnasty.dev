# abucnasty.dev

Source for abucnasty's Factorio site: UPS benchmark write-ups, a browser for every save in [abucnasty/factorio-benchmarks](https://github.com/abucnasty/factorio-benchmarks), a blueprint catalog, tools, and a blog. It is a single-page app built with Vite 5, React 18, TypeScript, MUI and React Router (`BrowserRouter`).

## Run it locally

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

`npm run check` serves `dist/` with `vite preview` and asserts facts about each page at desktop and phone widths; `-- --only tools,home` limits it to some pages and `-- --shots` writes screenshots to `check-output/`. Page modules live in `scripts/check/pages/`, and the blueprint catalog is served from a fixture in `scripts/check/fixtures/`.

Sync runs through `&&` in the `dev` and `build` scripts, not lifecycle hooks, so it also runs with `ignore-scripts`.

## Where content comes from

- **Benchmarks and saves** are not in this repo. At build time `scripts/sync-content.mjs` reads the factorio-benchmarks clone and writes `src/generated/` and `public/benchmarks/` (both gitignored). `content/manifest.json` lists the curated benchmarks (`slug`, `source` path, `title`, optional `date`, `summary`, `tags`, `featured`, `topic`, `chart`) and the topics. To add or remove a benchmark, edit the manifest and rebuild. The `/saves` index covers every `.zip` committed at `HEAD` of the source repo, read from git-lfs pointers; downloads go through `lfsWorkerUrl` in the manifest. Sync fails rather than publish a broken page.
- **Blueprints** are fetched in the browser on each visit from the live catalog at `https://blueprints.abucnasty.dev/index.json`, published from [abucnasty/factorio-blueprints](https://github.com/abucnasty/factorio-blueprints). See `src/catalog.ts` (types and pure helpers in `src/catalogCore.ts`, which the Worker shares).
- **Blog posts** live in `src/blog/posts/` (Markdown or TSX) and are registered in `src/blog/registry.ts`. `scripts/sync-blog-images.mjs` copies their images to `public/blog/`.
- **Tools** are listed in `src/data/tools.ts`.

## The Worker

`worker/` is a small Worker in front of the static assets. `run_worker_first` in `wrangler.jsonc` sends it only `/api/*`, `/blueprints/*`, `/benchmarks/<slug>` and `/blog/<slug>`; every other request, and every file under those paths, is served from `dist/` without running it.

- **`GET /api/latest-video`** returns the channel's newest upload as `{ id, title, published, url }`, fetched from the YouTube Data API with the `YOUTUBE_API_KEY` secret, so the key is not in the client bundle. An answer is kept for an hour; when YouTube fails, the last good answer is served. With nothing to serve it answers `{ "error", "message" }` with 503 (`not_configured`: no key) or 502 (`upstream_error`).
- **Link previews.** For a blueprint (from the live catalog, cached for 60 s, including `?entry=<slot>`), a benchmark (`src/generated/index.json`) or a blog post (`src/blog/registry.ts`), it serves `index.html` with that page's `<title>`, description, canonical, Open Graph and Twitter tags. Benchmark and post data are bundled into the Worker by wrangler at deploy time. Canonical and `og:url` use the `SITE_URL` var; unknown pages get the page untouched.

The Worker sends `Referer: <SITE_URL>/` on its YouTube request, so the key can keep a website (HTTP referrer) restriction in Google Cloud: allow `https://abucnasty.dev/*` and restrict the key to the YouTube Data API v3. If `SITE_URL` changes, change the allowed referrer to match.

## Deployment

The site is a Cloudflare Worker that serves `dist/` as static assets, plus the script in `worker/` (`wrangler.jsonc`). Paths that match no file return `index.html` with status 200, so the client-side router handles deep links.

It is served at `https://abucnasty.dev`, a custom domain in `routes` in `wrangler.jsonc` (wrangler creates its DNS record and certificate on deploy), and still at the `workers.dev` address, which `workers_dev` keeps on as a preview. `www.abucnasty.dev` is not attached to the Worker; a Redirect Rule on the zone sends it to `https://abucnasty.dev` with 301, keeping path and query. Keep `SITE_URL` and the canonical, `og:url` and JSON-LD `url` in `index.html` on the same origin; `npm test` checks that they agree.

Cloudflare Web Analytics is a dashboard setting (automatic setup on the proxied zone), not a script in this repo.

**Checks.** Every pull request runs `.github/workflows/check.yml` (no secrets needed): the same benchmarks checkout and `npm run build` as a deploy, `npm test`, `npx wrangler deploy --dry-run`, and `npm run check -- --only home,blueprints,benchmark-detail` in headless Chromium. The page checks fetch nothing live: the blueprint catalog and the avatar come from fixtures, and any other outside request fails the run.

On every push to `main` (or a manual run), `.github/workflows/deploy.yml`:

1. reads `content/manifest.json` and sparse-clones factorio-benchmarks with only the curated paths checked out (`--filter=blob:limit=1k`, so every git-lfs pointer still arrives for the save index), then pulls the chart CSVs from git-lfs;
2. runs `npm ci --ignore-scripts`, `npm run build` and `npm test`;
3. runs `npx wrangler deploy --secrets-file <temp file>`, which uploads the Worker's secrets from repository secrets along with the new version.

Repository secrets it needs:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `YOUTUBE_API_KEY` (YouTube Data API v3 key for `/api/latest-video`; it becomes the Worker secret of the same name). `wrangler.jsonc` lists it under `secrets.required`, so a deploy fails if the Worker has no value for it; when the repository secret is empty the Worker keeps the value it already has.

To try a deploy without credentials: `npm run build && npx wrangler deploy --dry-run`.
