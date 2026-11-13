# abucnasty.dev

Source for abucnasty's Factorio site: UPS benchmark write-ups, a browser for every save in [abucnasty/factorio-benchmarks](https://github.com/abucnasty/factorio-benchmarks), a blueprint catalog, tools, and a blog. It is a single-page app built with Vite 5, React 18, TypeScript, MUI and React Router (`BrowserRouter`).

## Run it locally

The build reads a local git clone of factorio-benchmarks (any kind: full, shallow, partial or sparse, but a git clone, not an exported copy, because the save index is read from git objects). It looks in `../factorio/factorio-benchmarks`, or wherever `FACTORIO_BENCHMARKS_PATH` points. Chart CSVs in that repo are in git-lfs, so run `git lfs pull --include="*.csv"` there or the sync fails.

```sh
cp .env.example .env   # set FACTORIO_BENCHMARKS_PATH and, optionally, VITE_YT_API_KEY
npm install
npm run dev            # sync content, then start the Vite dev server
npm run build          # sync content, type-check, build to dist/
npm run sync           # only refresh the synced content
npm run lint           # type-check (needs synced content in src/generated)
npm run check          # check every page of the built site in headless Chromium
```

`npm run check` serves `dist/` with `vite preview` and asserts facts about each page at desktop and phone widths; `-- --only tools,home` limits it to some pages and `-- --shots` writes screenshots to `check-output/`. Page modules live in `scripts/check/pages/`, and the blueprint catalog is served from a fixture in `scripts/check/fixtures/`.

Sync runs through `&&` in the `dev` and `build` scripts, not lifecycle hooks, so it also runs with `ignore-scripts`.

## Where content comes from

- **Benchmarks and saves** are not in this repo. At build time `scripts/sync-content.mjs` reads the factorio-benchmarks clone and writes `src/generated/` and `public/benchmarks/` (both gitignored). `content/manifest.json` lists the curated benchmarks (`slug`, `source` path, `title`, optional `date`, `summary`, `tags`, `featured`, `topic`, `chart`) and the topics. To add or remove a benchmark, edit the manifest and rebuild. The `/saves` index covers every `.zip` committed at `HEAD` of the source repo, read from git-lfs pointers; downloads go through `lfsWorkerUrl` in the manifest. Sync fails rather than publish a broken page.
- **Blueprints** are fetched in the browser on each visit from the live catalog at `https://blueprints.abucnasty.dev/index.json`, published from [abucnasty/factorio-blueprints](https://github.com/abucnasty/factorio-blueprints). See `src/catalog.ts`.
- **Blog posts** live in `src/blog/posts/` (Markdown or TSX) and are registered in `src/blog/registry.ts`. `scripts/sync-blog-images.mjs` copies their images to `public/blog/`.
- **Tools** are listed in `src/data/tools.ts`.

## Deployment

The site is a Cloudflare Worker that serves `dist/` as static assets (`wrangler.jsonc`). Paths that match no file return `index.html` with status 200, so the client-side router handles deep links. There is no Worker script yet.

On every push to `main` (or a manual run), `.github/workflows/deploy.yml`:

1. reads `content/manifest.json` and sparse-clones factorio-benchmarks with only the curated paths checked out (`--filter=blob:limit=1k`, so every git-lfs pointer still arrives for the save index), then pulls the chart CSVs from git-lfs;
2. runs `npm ci --ignore-scripts` and `npm run build`;
3. runs `npx wrangler deploy`.

Repository secrets it needs:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `VITE_YT_API_KEY` (YouTube Data API v3 key for the latest-video card on Home; it ends up in the client bundle, so restrict it by HTTP referrer to the site's domains)

To try a deploy without credentials: `npm run build && npx wrangler deploy --dry-run`.
