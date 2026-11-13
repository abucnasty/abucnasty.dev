# abucnasty.github.io

Static showcase site for [abucnasty/factorio-benchmarks](https://github.com/abucnasty/factorio-benchmarks). Vite + React + TypeScript + MUI, deployed to GitHub Pages.

## What this is

A read-only frontend over the benchmarks repo — a curated subset of its write-ups, plus every save file in it:

- **Benchmarks** — a sortable table of every benchmark in the manifest, with detail pages that render each `README.md`, link to the original save files, and surface metadata (date, Factorio version, platform).
- **Saves** — a browser for every Factorio save (`*.zip`) committed to the benchmarks repo, curated or not: folders, sizes, search, direct downloads. See [Saves page](#saves-page).
- **Blueprints** — an index of builds beside one large render, read live from the blueprint vault. See [Blueprints page](#blueprints-page).
- **Home** — an intro strip, the latest benchmarks and posts (newest first, featured benchmarks below), a short "Also here" list linking to the other pages, and the latest video.
- **Tools** — benchmarking tools, utilities and mods, plus tutorials, from `src/data/tools.ts`.
- **Blog** — posts from `src/blog/`.
- **Search** — a dialog reachable from every page (header button, `/`, Ctrl/Cmd+K, the box on Home) that finds benchmarks, blueprints, tools, posts and save files; the save index is only fetched once something is typed.
- **About** — who runs the site and how to get in touch.

The site itself contains **no benchmark content in source control** beyond the curation manifest, and no blueprint data at all (the Blueprints page fetches it in the browser). A sync script at build time reads the local `factorio-benchmarks` clone (or a path set via `$FACTORIO_BENCHMARKS_PATH` in CI), copies / rewrites assets into `public/` and `src/generated/`, and produces typed JSON indexes the React app imports directly.

## Repo layout

```
content/manifest.json         # ← curation list — edit this to add/remove benchmarks
scripts/
  sync-content.mjs            # build-time sync: copies assets, rewrites markdown, writes indexes
  sync-blog-images.mjs        # copies blog post images into public/blog
  lib/save-index.mjs          # indexes every .zip in the source repo from git objects
  check/                      # `npm run check`: run.cjs, one module per page in pages/, fixtures/
src/
  components/                 # shared: PageHeader, SectionHeader, ListRow (+ RowGroup), DenseTable;
                              # also MarkdownRenderer, SaveRows, AppShell, …
  pages/                      # Home, BenchmarksIndex, BenchmarkDetail, Saves, Tools, BlogIndex,
                              # BlogPost, About, NotFound
  pages/blueprints/           # the Blueprints page (its own lazy chunk, with Titillium Web)
  catalog.ts                  # the live blueprint catalog: fetch, hook, URL helpers
  data/tools.ts               # the tools, mods and tutorials listed on /tools
  blog/                       # post sources and registry.ts
  layout.ts                   # shared sizes: header, page title, row heights, touch target, section gap
  generated/                  # ← gitignored; produced by sync-content.mjs
    index.json
    saves.json                # every save: [path, bytes, lfs oid] + per-folder metadata
    benchmarks/<slug>/README.md
  content.ts                  # types for everything in src/generated
  saves.ts                    # folder tree over saves.json + its on-demand loader
  theme.ts                    # MUI dark theme (orange/green on black)
public/
  benchmarks/<slug>/...       # ← gitignored; non-zip assets copied by sync
  404.html                    # SPA fallback for GitHub Pages
```

## Local development

Prerequisite: clone `factorio-benchmarks` next to this repo (`../factorio/factorio-benchmarks`) **or** set `FACTORIO_BENCHMARKS_PATH` in a local `.env` file. It has to be a git clone (any kind — full, shallow, partial or sparse), not an exported copy: the save index is read from git objects.

```sh
cp .env.example .env
# edit .env if your clone lives somewhere else
```

```sh
npm install
npm run dev      # runs sync, then vite dev server
npm run build    # runs sync, type-checks, builds to dist/
npm run sync     # just refresh src/generated and public/benchmarks
```

> Note: sync is invoked explicitly via `&&` chaining in `dev` / `build`, not via `predev` / `prebuild` lifecycle hooks — this means it works even with `npm config ignore-scripts=true`.

## Checking layout

`npm run check` opens the **built** site (`dist/`) in headless Chromium and asserts facts about every page, at desktop (1280 × 800) and phone (390 × 844) widths. Build first, with the content clone available:

```sh
npm run build
npm run check                       # all pages
npm run check -- --only tools,home  # some pages
npm run check -- --shots            # also write screenshots to check-output/ (git-ignored)
```

The runner starts `vite preview` on a free port and always stops it. It also fails any page that logs a console error or scrolls sideways on a phone. Chromium comes from Playwright; set `CHROMIUM_PATH` to use another binary.

One module per page lives in `scripts/check/pages/<page>.cjs`. To check a new page or add to one, export `{ name, run(ctx) }`; `ctx.open(path, 'desktop' | 'phone')` returns a Playwright page, `ctx.expect(label, ok, detail)` records an assertion, and `ctx.data` holds the parsed `src/generated` JSON plus `catalog`, the blueprint fixture (derive counts from them rather than hard-coding them). Every page is served [`scripts/check/fixtures/catalog.cjs`](scripts/check/fixtures/catalog.cjs) in place of `blueprints.abucnasty.dev` and the vault's READMEs on `raw.githubusercontent.com`, so no check depends on the live service.

## Adding a new benchmark

1. Make sure the benchmark folder exists in the local `factorio-benchmarks` clone with a `README.md` (and any images, csvs, save zips).
2. Add an entry to [`content/manifest.json`](content/manifest.json):

   ```jsonc
   {
     "slug": "my-new-benchmark",                          // URL slug → /benchmarks/my-new-benchmark
     "source": "benchmarks/2026-05-09-my-new-benchmark",  // path within the source repo
     "title": "My New Benchmark",
     "date": "2026-05-09",                                // optional; used for sorting
     "summary": "One-line teaser.",                       // optional; shown in table + cards
     "tags": ["circuits", "ups"],                         // optional
     "featured": true                                     // optional; shows on home page
   }
   ```

3. `npm run build` (or `npm run sync` for a quick refresh).

What sync does for each entry:

- Copies every non-`.zip` file (preserving sub-paths) → `public/benchmarks/<slug>/`
- Rewrites `README.md` image refs (`./image.png`, `<img src="…">`) → `/benchmarks/<slug>/…` and writes the result to `src/generated/benchmarks/<slug>/README.md`
- Rewrites relative links in the README (`[text](./file)`) to GitHub: a folder links to its `tree` page, a file tracked by git-lfs links to its download on the LFS worker (decided from the git object at `HEAD`, like saves), anything else to the raw file
- Skips `.zip` files in the copy; their entries in the index link to the download on the LFS worker (`lfsWorkerUrl` in the manifest) so saves remain downloadable without bundling them
- Extracts `**Factorio Version:**`, `**Platform:**` and `**CPU:**` from the README header and stores them on the index entry
- Reads the README's "The Question" / "Question" section into `question` and its "The Answer" / "Answer" section into `finding`, both as one line of plain text ([scripts/lib/readme-sections.mjs](scripts/lib/readme-sections.mjs)). Either may be the first item of a flat bullet list (not an item with nested items), and the question is cut after its last `?`. A finding never ends in a colon, and is left out when under 12 characters; a text under 30 characters is joined to the paragraph after it. With no usable answer, `finding` comes from the first paragraph of a "Conclusion" section. A field with no value is left out
- When there is a question, lifts its section out of the generated `README.md` into `question.md` next to it, and the answer section into `answer.md` (a "Conclusion" is never lifted). Links and images in all three files are rewritten the same way
- Logs a coverage line, e.g. `✓ topics 0/43 · questions 14/43 · findings 23/43 · cpu 6/43`

### Topics

The manifest may list topics, in display order, and give each benchmark one:

```jsonc
{
  "topics": [{ "id": "inserters", "label": "Inserters & clocking" }],
  "benchmarks": [{ "slug": "…", "topic": "inserters" }]   // topic is optional
}
```

A `topic` that is not the `id` of a listed topic, or two topics with the same `id`, fails the sync. A benchmark with no topic is allowed; sync warns with the count. `index.json` gets `topics: [{ id, label, count }]` in manifest order.

Independently of the manifest, sync also writes `src/generated/saves.json` — see the next section.

## Saves page

`/saves` lists **every** `.zip` committed to the benchmarks repo, not just the ones under curated benchmarks; `/saves/<path in the repo>` opens a folder and `?q=` searches across all of them. Nothing needs adding to the manifest for a save to show up: commit it (through git-lfs) to the benchmarks repo and rebuild.

Sync builds the index ([scripts/lib/save-index.mjs](scripts/lib/save-index.mjs)) from **git objects at `HEAD`** of the source clone, not from the working tree:

- `git ls-tree -r HEAD` finds every `.zip`; `git cat-file --batch` reads its git-lfs pointer, which holds the file's size and sha256 OID. That is all the page needs — no save is ever downloaded at build time.
- A download link is `<manifest.lfsWorkerUrl>/objects/<oid>/<file name>`, the same Cloudflare worker scheme the per-benchmark save lists use.
- Each top-level folder (`benchmarks/<name>`, `competitions/<name>`) gets a title, slug and date from the manifest when it is a curated benchmark's `source`, a Factorio version and platform from its `README.md` (also read from `HEAD`), and otherwise a date from a `YYYY-MM-DD-` folder-name prefix.
- Because it reads `HEAD`, only committed saves appear, and it works the same in a sparse or partial clone where most folders have no files on disk. In a partial clone any pointer blobs that are not local yet are fetched in one batch.
- Sync fails rather than publish a broken page if it finds no saves at all, a `.zip` that is not a git-lfs pointer, or no `lfsWorkerUrl` in the manifest.

The index (~110 kB) and the page's code are separate chunks loaded only on `/saves`; the other pages don't pay for them.

## Removing / hiding a benchmark

Just delete its entry from `content/manifest.json` and rebuild. The benchmark's source folder in the upstream repo is untouched.

## Blueprints page

Nothing about blueprints is built into the site. On every page load the browser fetches the catalog from [`blueprints.abucnasty.dev/index.json`](https://blueprints.abucnasty.dev/index.json), published from [abucnasty/factorio-blueprints](https://github.com/abucnasty/factorio-blueprints) (the vault); [`src/catalog.ts`](src/catalog.ts) holds the one shared fetch, a `useCatalog` hook and the URL helpers. Home's count and site search use the same fetch.

- `/blueprints/<path>` opens a build; `?entry=<slot path>` picks one entry of a book. On a wide screen `/blueprints` shows the newest build.
- The only link is the live string, `https://blueprints.abucnasty.dev/<path>.txt`. Renders come from `/<path>/renders/<file>`, one at a time; notes from the folder's `README.md` on `raw.githubusercontent.com`.
- Deprecated builds are hidden behind a switch; an unlisted one (`status: "unlisted"`) opens only by its address.

## Deployment

Pushed to `main`, [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) handles the rest:

1. Reads `content/manifest.json` and writes a sparse-checkout pattern list (every benchmark `source`).
2. Shallow-clones `abucnasty/factorio-benchmarks` with `--filter=blob:limit=1k --sparse` and applies the pattern list — only the curated paths are materialized. The 1 kB blob limit means every git-lfs pointer in the repo (they are ~130 bytes) arrives with the clone, which is what lets the save index cover folders that are never checked out; larger blobs are still only fetched for the curated paths.
3. Exports `FACTORIO_BENCHMARKS_PATH` to that clone, runs `npm ci --ignore-scripts && npm run build`.
4. Uploads `dist/` and deploys via `actions/deploy-pages@v4`.

Repo Settings → Pages → Source must be set to **GitHub Actions** for the deploy to publish. The `public/404.html` shim restores deep-link paths for the client-side router.

## Stack

- Vite 5 + React 18 + TypeScript 5 (strict)
- MUI v7 + Emotion (dark theme, pure black background to match chart renders)
- React Router v6 (`BrowserRouter`)
- react-markdown 9 + remark-gfm + rehype-raw + rehype-slug + rehype-autolink-headings
- Sync pipeline is plain Node ESM — no extra dependencies