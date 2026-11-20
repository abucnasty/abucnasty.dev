// Gives chosen benchmarks an `authors` list in the page, whatever the built data holds.
//
// The pages read their benchmark data from a script chunk of the build (the generated index), which
// comes from the published READMEs of factorio-benchmarks. Until every README has an `authors` key
// the build holds none, so a check that wants the "By ..." chip asks for it here: the chunk is
// served with the keys added. The build side (frontmatter in, `authors` out) is tested in
// scripts/lib/*.test.mjs; this fixture is only for how the page shows what the index holds.

/** Matches the generated index chunk, e.g. /assets/generated-C9_6aOeD.js. */
const INDEX_CHUNK = /\/assets\/generated-[\w-]+\.js$/;

/**
 * @param {import('playwright').BrowserContext} context
 * @param {Record<string, string[]>} authorsBySlug benchmark slug -> authors to show
 */
async function install(context, authorsBySlug) {
  await context.route((url) => INDEX_CHUNK.test(url.pathname), async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    for (const [slug, authors] of Object.entries(authorsBySlug)) {
      const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const at = new RegExp(`slug:(["'\`])${escaped}\\1,`);
      if (!at.test(body)) throw new Error(`benchmark-meta fixture: slug "${slug}" not found in the generated index chunk`);
      body = body.replace(at, (m) => `${m}authors:${JSON.stringify(authors)},`);
    }
    await route.fulfill({ response, body });
  });
}

module.exports = { install };
