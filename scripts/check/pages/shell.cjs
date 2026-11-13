// Header, footer and not-found page.
module.exports = {
  name: 'shell',
  async run({ open, expect, data, shot }) {
    const page = await open('/', 'desktop');

    await shot(page, 'shell-home');
    expect('header renders', await page.locator('header').first().isVisible());
    expect('footer renders', await page.locator('footer').first().isVisible());

    for (const href of ['/benchmarks', '/saves', '/blueprints', '/tools', '/blog']) {
      expect(`header menu links to ${href}`, (await page.locator(`header a[href="${href}"]`).count()) > 0);
    }

    const bar = async (pg) => (await pg.locator('header').first().boundingBox())?.height;
    expect('header is 48px on desktop', Math.round(await bar(page)) === 48, String(await bar(page)));
    const phone = await open('/', 'phone');
    expect('header is 48px on phone', Math.round(await bar(phone)) === 48, String(await bar(phone)));

    const labels = (await page.locator('header nav a').allInnerTexts()).map((t) => t.trim());
    expect(
      'desktop menu is Benchmarks, Blueprints, Saves, Tools, Blog',
      labels.join(', ').toLowerCase() === 'benchmarks, blueprints, saves, tools, blog',
      labels.join(', '),
    );

    expect('footer links to /about', (await page.locator('footer a[href="/about"]').count()) > 0);
    const about = await open('/about', 'desktop');
    expect('/about renders', (await about.locator('main').innerText()).trim().length > 0);

    expect(
      'index.json saveStats.count matches the save index',
      data.index.saveStats && data.index.saveStats.count === data.saves.files.length,
      JSON.stringify(data.index.saveStats),
    );

    const missing = await open('/no-such-page', 'desktop');
    const text = await missing.locator('main').innerText();
    expect('unknown URL shows the not-found page', /page not found/i.test(text), text.slice(0, 80));
    expect('not-found page keeps the header', await missing.locator('header').first().isVisible());
  },
};
