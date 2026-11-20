// Sets the `factorioVersions` (or another list key, e.g. `platforms`) of chosen benchmarks in the page, whatever the built data holds.
//
// The pages read their benchmark data from a script chunk of the build (the generated index), which
// comes from the published READMEs of factorio-benchmarks. Most of those name one version, so a check
// that wants a benchmark comparing two versions asks for it here: the chunk is served with that entry's
// `factorioVersions` replaced. The build side (frontmatter in, list out) is tested in scripts/lib/*.test.mjs;
// this fixture is only for how the page shows what the index holds. It reaches the index only, not
// summary.json, which the search and the home page read (their shared functions have a unit test:
// worker/benchmarkFilters.test.ts).

/** Matches the generated index chunk, e.g. /assets/generated-C9_6aOeD.js. */
const INDEX_CHUNK = /\/assets\/generated-[\w-]+\.js$/;

/**
 * @param {import('playwright').BrowserContext} context
 * @param {Record<string, string[]>} versionsBySlug benchmark slug -> the list to show
 * @param {string} [key] the entry key to replace
 */
async function install(context, versionsBySlug, key = 'factorioVersions') {
  await context.route((url) => INDEX_CHUNK.test(url.pathname), async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    for (const [slug, versions] of Object.entries(versionsBySlug)) {
      const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const at = new RegExp(`slug:(["'\`])${escaped}\\1,`);
      if (!at.test(body)) throw new Error(`benchmark-lists fixture: slug "${slug}" not found in the generated index chunk`);
      const found = at.exec(body);
      const start = found.index + found[0].length;
      const next = body.indexOf('slug:', start);
      const end = next === -1 ? body.length : next;
      // Drop the entry's own `${key}:[...]` (before the next entry), then add the asked one.
      const own = new RegExp(`${key}:\\[[^\\]]*\\],?`).exec(body.slice(start, end));
      if (own) body = body.slice(0, start + own.index) + body.slice(start + own.index + own[0].length);
      body = body.slice(0, start) + `${key}:${JSON.stringify(versions)},` + body.slice(start);
    }
    await route.fulfill({ response, body });
  });
}

module.exports = { install };
