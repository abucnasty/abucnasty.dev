const fs = require('fs');
const path = require('path');

// The registry is TypeScript: read the slugs out of the file rather than import it.
function registrySlugs() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'blog', 'registry.ts'), 'utf8');
  return [...src.matchAll(/\bslug:\s*(['"])([^'"]+)\1/g)].map((m) => m[2]);
}

module.exports = {
  name: 'blog',
  async run({ open, expect, shot }) {
    const slugs = registrySlugs();
    expect('registry has posts', slugs.length > 0, 'no slug: entries parsed from src/blog/registry.ts');

    for (const viewport of ['desktop', 'phone']) {
      const page = await open('/blog', viewport);
      await shot(page, `blog-${viewport}`);
      const hrefs = await page.$$eval('main a[href^="/blog/"]', (as) => as.map((a) => a.getAttribute('href')));
      expect(`${viewport}: one row per post`, hrefs.length === slugs.length, `${hrefs.length} rows, ${slugs.length} posts`);
      expect(`${viewport}: every post is linked`, slugs.every((s) => hrefs.includes(`/blog/${s}`)));
      if (viewport === 'desktop') {
        const heights = await page.$$eval('main tbody tr', (trs) => trs.map((tr) => tr.getBoundingClientRect().height));
        const tallest = Math.max(...heights);
        expect('desktop: body row height is at most 36 px', heights.length > 0 && tallest <= 36, `tallest ${tallest} px over ${heights.length} rows`);
      }
    }

    for (const slug of slugs.slice(0, 1)) {
      const page = await open(`/blog/${slug}`, 'desktop');
      const text = await page.locator('main').innerText();
      expect(`post ${slug} renders`, text.length > 200 && !/No blog post with slug/.test(text), `${text.length} characters`);
    }
  },
};
