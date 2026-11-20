// Sets the `authors` list of chosen benchmarks in the page, whatever the built data holds (null: no authors).
//
// The pages read their benchmark data from a script chunk of the build (the generated index), which
// comes from the published READMEs of factorio-benchmarks, which all carry `authors`. A check that wants
// two names, one name or none asks for it here: the chunk is served with that entry's `authors`
// replaced (or removed for null). The build side (frontmatter in, `authors` out) is tested in
// scripts/lib/*.test.mjs; this fixture is only for how the page shows what the index holds.

/** Matches the generated index chunk, e.g. /assets/generated-C9_6aOeD.js. */
const INDEX_CHUNK = /\/assets\/generated-[\w-]+\.js$/;

/**
 * @param {import('playwright').BrowserContext} context
 * @param {Record<string, string[] | null>} authorsBySlug benchmark slug -> authors to show, or null for none
 */
async function install(context, authorsBySlug) {
  await context.route((url) => INDEX_CHUNK.test(url.pathname), async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    for (const [slug, authors] of Object.entries(authorsBySlug)) {
      const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const at = new RegExp(`slug:(["'\`])${escaped}\\1,`);
      if (!at.test(body)) throw new Error(`benchmark-meta fixture: slug "${slug}" not found in the generated index chunk`);
      const found = at.exec(body);
      const start = found.index + found[0].length;
      const next = body.indexOf('slug:', start);
      const end = next === -1 ? body.length : next;
      // Drop the entry's own `authors:[...]` (before the next entry), then add the asked one.
      const own = /authors:\[[^\]]*\],?/.exec(body.slice(start, end));
      if (own) body = body.slice(0, start + own.index) + body.slice(start + own.index + own[0].length);
      if (authors) body = body.slice(0, start) + `authors:${JSON.stringify(authors)},` + body.slice(start);
    }
    await route.fulfill({ response, body });
  });
}

module.exports = { install };
