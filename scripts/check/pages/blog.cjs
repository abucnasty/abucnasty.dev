// The blog, read from the vault in the browser (the fixture in scripts/check/fixtures/blog.cjs).
const { VAULT } = require('../fixtures/catalog.cjs');
const { BLOB } = require('../fixtures/blog.cjs');

module.exports = {
  name: 'blog',
  async run({ open, goto, expect, shot, data }) {
    const listed = data.blog.posts.filter((p) => p.status !== 'unlisted');
    const unlisted = data.blog.posts.filter((p) => p.status === 'unlisted');
    expect('fixture has listed and unlisted posts', listed.length > 0 && unlisted.length > 0);

    for (const viewport of ['desktop', 'phone']) {
      const page = await open('/blog', viewport);
      await shot(page, `blog-${viewport}`);
      const hrefs = await page.$$eval('main a[href^="/blog/"]', (as) => as.map((a) => a.getAttribute('href')));
      expect(`${viewport}: one row per listed post`, hrefs.length === listed.length, `${hrefs.length} rows, ${listed.length} posts`);
      expect(`${viewport}: every listed post is linked, newest first`, hrefs.join() === listed.map((p) => `/blog/${p.slug}`).join(), hrefs.join(', '));
      expect(`${viewport}: unlisted posts are not listed`, unlisted.every((p) => !hrefs.includes(`/blog/${p.slug}`)));
      const meta = await page.locator('main').innerText();
      expect(`${viewport}: the header counts listed posts`, meta.includes(`${listed.length} posts`), meta.slice(0, 80));
      if (viewport === 'desktop') {
        const heights = await page.$$eval('main tbody tr', (trs) => trs.map((tr) => tr.getBoundingClientRect().height));
        const tallest = Math.max(...heights);
        expect('desktop: body row height is at most 36 px', heights.length > 0 && tallest <= 36, `tallest ${tallest} px over ${heights.length} rows`);
      }
    }

    // Every current address keeps working, the unlisted one too.
    for (const post of data.blog.posts) {
      const page = await open(`/blog/${post.slug}`, 'desktop');
      const text = await page.locator('main').innerText();
      expect(`post ${post.slug} renders its markdown from the vault`, text.includes(post.title) && text.length > 300 && !/No blog post with slug/.test(text), `${text.length} characters`);
    }

    // Relative images resolve against the post's folder in the vault, with ?v=<blob> from the index.
    const page = await open('/blog/fps-limit-impact-on-factorio-ups', 'phone');
    await shot(page, 'blog-post-phone');
    const img = await page.$eval('main img', (el) => ({ src: el.getAttribute('src'), loaded: el.complete && el.naturalWidth > 0 }));
    expect(
      'post image resolves to the vault and loads',
      img.src === `${VAULT}/blog/fps-limit-impact-on-factorio-ups/screenshots/prom_ship_60.jpg?v=${BLOB}` && img.loaded,
      JSON.stringify(img),
    );
    expect('post table renders', (await page.locator('main table').count()) === 1);

    // An unknown slug says so.
    const missing = await open('/blog/no-such-post', 'desktop');
    expect('unknown post shows not found', /No blog post with slug "no-such-post"/.test(await missing.locator('main').innerText()));

    // The vault not answering: an error with "Try again", which then loads the list.
    const failing = await open('/', 'desktop');
    let fail = true;
    await failing.route(`${VAULT}/blog/index.json`, (route) => (fail ? route.fulfill({ status: 503, body: 'down' }) : route.fallback()));
    await goto(failing, '/blog');
    const retry = failing.getByRole('button', { name: 'Try again' });
    expect('blog index failure shows "Try again"', (await retry.count()) === 1 && (await failing.locator('[data-blog-state="failed"]').count()) === 1);
    fail = false;
    await retry.click();
    await failing.waitForSelector('main a[href^="/blog/"]', { timeout: 5000 }).catch(() => {});
    expect('"Try again" loads the posts', (await failing.locator('main a[href^="/blog/"]').count()) === listed.length);
  },
};
