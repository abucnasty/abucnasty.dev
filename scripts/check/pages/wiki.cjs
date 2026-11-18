// The wiki, read from the vault in the browser (the fixture in scripts/check/fixtures/wiki.cjs):
// the front page, a page with every kind of content, both link forms, images, aliases, the list
// of pages, the loading states, search, and that other pages do not load the wiki's code.
const { VAULT } = require('../fixtures/catalog.cjs');

module.exports = {
  name: 'wiki',
  async run({ open, goto, expect, shot, requests, data }) {
    const { wiki } = data;
    const guide = wiki.pages.find((p) => p.slug === 'how-to-benchmark');
    const image = wiki.files[0];
    const main = (page) => page.locator('main');

    // Other pages do not download the wiki reader or the wiki index.
    const home = await open('/', 'desktop');
    const early = requests(home);
    expect('the home page loads no wiki code or index', !early.some((u) => /\/assets\/Wiki(Page|All)-|\/wiki\/index\.json/.test(u)), early.filter((u) => /wiki/i.test(u)).join(', '));

    for (const viewport of ['desktop', 'phone']) {
      const page = await open('/wiki', viewport);
      await shot(page, `wiki-home-${viewport}`);
      const text = await main(page).innerText();
      expect(`${viewport}: /wiki shows the front page`, /^Wiki/.test(text.trim()) && text.includes('community wiki for Factorio benchmarking'), text.slice(0, 120));
      const hrefs = await page.$$eval('main a[href^="/wiki/"]', (as) => as.map((a) => a.getAttribute('href')));
      expect(`${viewport}: a markdown link and a [[link]] both reach their pages`, hrefs.includes('/wiki/how-to-benchmark') && hrefs.includes('/wiki/setting-up-arch-to-run-factorio'), hrefs.join(', '));
      const missing = await page.locator('main .wiki-missing').allInnerTexts();
      expect(
        `${viewport}: a link to a page nobody wrote, or to a draft, shows as missing, not as a link`,
        missing.join() === 'A Page Nobody Wrote,Benchmark Checklist',
        missing.join(),
      );
    }

    // Following a link stays in the app.
    const nav = await open('/wiki', 'desktop');
    await nav.evaluate(() => (window.__sameDocument = true));
    await nav.locator('main a[href="/wiki/how-to-benchmark"]').first().click();
    await nav.waitForURL('**/wiki/how-to-benchmark');
    await nav.locator('main h2#prerequisites').waitFor({ timeout: 5000 }).catch(() => {});
    expect('a wiki link opens the page without reloading', (await nav.evaluate(() => window.__sameDocument === true)) && (await nav.locator('main h1').innerText()) === guide.title);

    for (const viewport of ['desktop', 'phone']) {
      const page = await open('/wiki/how-to-benchmark', viewport);
      await shot(page, `wiki-page-${viewport}`);
      expect(`${viewport}: the title is the page's title, shown once`, (await page.locator('main h1').allInnerTexts()).join('|') === guide.title);
      const overline = await page.locator('main header').innerText();
      expect(`${viewport}: the folder shows above the title`, overline.toLowerCase().includes('wiki / guides'), overline);
      for (const h of guide.headings) {
        expect(`${viewport}: heading #${h.id} has the index's id`, (await page.locator(`main [id="${h.id}"]`).count()) === 1);
      }
      const iframe = await page.$eval('main .youtube-embed iframe', (el) => ({ src: el.getAttribute('src'), w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height })).catch(() => null);
      expect(
        `${viewport}: a YouTube link on its own line is a 16:9 privacy-enhanced player`,
        iframe && iframe.src === 'https://www.youtube-nocookie.com/embed/pXz01Be-9hE' && Math.abs(iframe.w / iframe.h - 16 / 9) < 0.02,
        JSON.stringify(iframe),
      );
      const callout = await page.$eval('main .callout-warning', (el) => ({ title: el.querySelector('.callout-title')?.textContent, border: getComputedStyle(el).borderLeftWidth })).catch(() => null);
      expect(`${viewport}: a [!warning] callout is a styled box with its title`, callout && callout.title === 'Close other programs' && callout.border === '4px', JSON.stringify(callout));
      expect(`${viewport}: the table renders`, (await page.locator('main table').count()) === 1);
      const img = await page.$eval('main img', (el) => ({ src: el.getAttribute('src'), width: el.getAttribute('width'), loaded: el.complete && el.naturalWidth > 0 }));
      expect(
        `${viewport}: ![[image|64]] resolves to the published WebP with ?v and loads`,
        img.src === `${VAULT}/wiki/files/${image.published}?v=${image.v}` && img.width === '64' && img.loaded,
        JSON.stringify(img),
      );
      const unsafe = await page.evaluate(() => ({
        ran: window.__wikiScript === true,
        scripts: document.querySelectorAll('main script').length,
        js: [...document.querySelectorAll('main a')].filter((a) => /^\s*javascript:/i.test(a.getAttribute('href') ?? '')).length,
      }));
      expect(`${viewport}: raw <script> and javascript: links do not survive`, !unsafe.ran && unsafe.scripts === 0 && unsafe.js === 0, JSON.stringify(unsafe));
      const toHeading = await page.locator('main a[href="/wiki/setting-up-arch-to-run-factorio#prerequisites"]').count();
      expect(`${viewport}: [[Page#Heading|label]] links to the heading's id`, toHeading === 1);
    }

    // The Arch page's relative image resolves from its own _attachments folder.
    const arch = await open('/wiki/setting-up-arch-to-run-factorio', 'phone');
    const archImg = await arch.$eval('main img', (el) => el.getAttribute('src'));
    expect('![alt](_attachments/x.png) resolves to the published file', archImg === `${VAULT}/wiki/files/${image.published}?v=${image.v}`, archImg);

    // A deep link to a heading scrolls to it.
    const deep = await open('/wiki/how-to-benchmark#step-21-generate-a-test-map', 'desktop');
    await deep.waitForTimeout(300);
    const top = await deep.$eval('#step-21-generate-a-test-map', (el) => el.getBoundingClientRect().top);
    expect('a #heading address scrolls to the heading, clear of the top bar', top >= 48 && top < 200, `top ${top}`);

    // Former titles and /wiki/home redirect.
    const alias = await open('/wiki/benchmarking-guide', 'desktop');
    await alias.waitForURL('**/wiki/how-to-benchmark', { timeout: 5000 }).catch(() => {});
    expect('a former title (alias) redirects to the page', new URL(alias.url()).pathname === '/wiki/how-to-benchmark', alias.url());
    const homeAlias = await open('/wiki/home', 'desktop');
    expect('/wiki/home redirects to /wiki', new URL(homeAlias.url()).pathname === '/wiki', homeAlias.url());

    // Every page, grouped by folder.
    for (const viewport of ['desktop', 'phone']) {
      const page = await open('/wiki/all', viewport);
      await shot(page, `wiki-all-${viewport}`);
      const groups = await page.$$eval('main [data-wiki-folder]', (els) =>
        els.map((el) => ({ folder: el.getAttribute('data-wiki-folder'), links: [...el.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')) })),
      );
      expect(
        `${viewport}: /wiki/all lists every page grouped by folder, the top first`,
        JSON.stringify(groups) ===
          JSON.stringify([
            { folder: '', links: ['/wiki'] },
            { folder: 'Guides', links: ['/wiki/how-to-benchmark', '/wiki/setting-up-arch-to-run-factorio'] },
          ]),
        JSON.stringify(groups),
      );
    }

    // An unknown address says so.
    const unknown = await open('/wiki/no-such-page', 'desktop');
    expect('an unknown page shows not found', /No wiki page at "no-such-page"/.test(await main(unknown).innerText()));

    // The vault not answering: an error with "Try again", which then loads the page.
    const failing = await open('/', 'desktop');
    let fail = true;
    await failing.route(`${VAULT}/wiki/index.json`, (route) => (fail ? route.fulfill({ status: 503, body: 'down' }) : route.fallback()));
    await goto(failing, '/wiki/how-to-benchmark');
    const retry = failing.getByRole('button', { name: 'Try again' });
    expect('wiki index failure shows "Try again"', (await retry.count()) === 1 && (await failing.locator('[data-wiki-state="failed"]').count()) === 1);
    fail = false;
    await retry.click();
    await failing.locator('main h2#prerequisites').waitFor({ timeout: 5000 }).catch(() => {});
    expect('"Try again" loads the page', (await failing.locator('main h1').innerText().catch(() => '')) === guide.title);

    // Search finds wiki pages by a heading.
    const search = await open('/', 'desktop');
    await search.locator('header button[aria-label="Search the site"]:visible').click();
    await search.keyboard.type('generate a test map');
    const hit = search.locator('[role=dialog] [role=group]:has(> :first-child:text-is("Wiki")) [role=option]').first();
    await hit.waitFor({ timeout: 5000 }).catch(() => {});
    expect('search finds a wiki page by one of its headings', (await hit.getAttribute('href').catch(() => null)) === '/wiki/how-to-benchmark');
  },
};
