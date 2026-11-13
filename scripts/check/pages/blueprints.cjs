// The Blueprints page, against the catalog fixture (scripts/check/fixtures/catalog.cjs) that
// run.cjs serves in place of the live vault.
const { VAULT, stringFor } = require('../fixtures/catalog.cjs');

const REPO = 'https://github.com/abucnasty/factorio-blueprints';

module.exports = {
  name: 'blueprints',
  async run({ open, goto, expect, data, shot, box, requests }) {
    const all = data.catalog.blueprints;
    const listed = all.filter((e) => e.status !== 'unlisted');
    const active = listed.filter((e) => !e.deprecated);
    const deprecated = listed.filter((e) => e.deprecated);
    const unlisted = all.filter((e) => e.status === 'unlisted');
    const wide = all.find((e) => e.path === 'megabasing/space-science/wide-build');
    const book = all.find((e) => e.path === 'general/tools/test-book');
    const ghost = all.find((e) => e.renders.length === 0);
    const old = deprecated[0];
    const hidden = unlisted[0];

    const rows = (page) => page.locator('[data-index-row]');
    const rowTitles = (page) => page.$$eval('[data-index-row] > span:first-child', (els) => els.map((e) => e.textContent.trim()));
    const title = (page) => page.locator('[data-stage] h2').first().textContent();
    const liveLink = (page) => page.locator('[data-stage] a[href$=".txt"]').first().getAttribute('href');
    const copyButton = (page) => page.getByRole('button', { name: /^(Copy string|Copied)$/ });
    const ready = (page) => page.waitForSelector('[data-stage] h2', { timeout: 10000 });
    const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText());

    // --- desktop: the index and the opening build --------------------------------------------
    {
      const page = await open('/blueprints', 'desktop');
      await ready(page);
      await shot(page, 'blueprints-desktop');
      const sentence = (await page.locator('[data-count]').textContent()).trim();
      expect('desktop: the header sentence counts the active builds', sentence === `${active.length} builds, straight from the vault on GitHub.`, sentence);
      const repo = await page.locator('[data-count] a').getAttribute('href');
      expect('desktop: the header sentence links to the vault repository', repo === REPO, repo);
      expect('desktop: one row per listed, active build', (await rows(page).count()) === active.length, `${await rows(page).count()} rows, ${active.length} builds`);
      const titles = await rowTitles(page);
      expect('desktop: an unlisted build is not in the index', !titles.includes(hidden.title), titles.join(', '));
      expect('desktop: deprecated builds are hidden by default', !titles.includes(old.title));
      const groups = await page.$$eval('[data-index] [role=group]', (els) => els.map((e) => e.getAttribute('aria-label')));
      expect('desktop: "Megabasing" is the first group', groups[0] === 'Megabasing', groups.join(', '));
      const h = (await box(page, '[data-index-row]'))?.height;
      expect('desktop: index rows are 34 px tall', h === 34, `${h}px`);
      expect('desktop: the stage opens on the newest listed build with a cover', (await title(page)) === wide.title, await title(page));
      expect('desktop: no row is marked before one is picked', (await page.locator('[data-index-row][aria-current]').count()) === 0);
      expect('desktop: the URL stays /blueprints', new URL(page.url()).pathname === '/blueprints', page.url());
      const html = (await page.content()).toLowerCase();
      expect('desktop: nothing on the page mentions FactorioBin', !html.includes('factoriobin'));
      const font = await page.locator('[data-stage] h2').evaluate((el) => getComputedStyle(el).fontFamily);
      expect('desktop: the title is set in Titillium Web', font.includes('Titillium Web'), font);
      const loaded = await page.evaluate(() => document.fonts.check('600 34px "Titillium Web"'));
      expect('desktop: Titillium Web is loaded with the page', loaded);

      // Filter: by title, then nothing, then Clear.
      await page.fill('input[aria-label="Find a build"]', 'book');
      expect('desktop: the filter narrows the index by title', JSON.stringify(await rowTitles(page)) === JSON.stringify([book.title]), (await rowTitles(page)).join(', '));
      await page.fill('input[aria-label="Find a build"]', 'yuu');
      expect('desktop: the filter matches authors', JSON.stringify(await rowTitles(page)) === JSON.stringify([wide.title]), (await rowTitles(page)).join(', '));
      await page.fill('input[aria-label="Find a build"]', 'zzzz');
      const none = (await page.locator('[data-index] [role=status]').textContent()) ?? '';
      expect('desktop: no match says so', none.includes('Nothing matches “zzzz”.'), none);
      await shot(page, 'blueprints-no-match');
      await page.getByRole('button', { name: 'Clear' }).click();
      expect('desktop: Clear brings every row back', (await rows(page).count()) === active.length);
      await page.fill('input[aria-label="Find a build"]', hidden.title);
      expect('desktop: the filter never finds an unlisted build', (await rows(page).count()) === 0);
      await page.fill('input[aria-label="Find a build"]', '');

      // Deprecated switch.
      const toggle = page.getByRole('checkbox', { name: `Show deprecated (${deprecated.length})` });
      expect('desktop: the deprecated switch is off by default', !(await toggle.isChecked()));
      await toggle.check();
      const withOld = await rowTitles(page);
      expect('desktop: the switch reveals deprecated builds', withOld.includes(old.title) && (await rows(page).count()) === listed.length, withOld.join(', '));
      const oldRow = page.locator('[data-index-row]', { hasText: old.title });
      expect('desktop: a deprecated row says "deprecated" where the version goes', ((await oldRow.locator('span').nth(1).textContent()) ?? '').trim() === 'deprecated');
      await toggle.uncheck();

      // Selecting a row.
      await page.locator('[data-index-row]', { hasText: wide.title }).click();
      await page.waitForURL(`**/blueprints/${wide.path}`);
      expect('desktop: a row selects its build', (await title(page)) === wide.title);
      expect('desktop: the live link is the build\'s string', (await liveLink(page)) === `${VAULT}/${wide.path}.txt`, await liveLink(page));
      expect('desktop: the picked row is marked', ((await page.locator('[data-index-row][aria-current="page"]').textContent()) ?? '').includes(wide.title));
      const meta = (await page.locator('[data-meta]').textContent()) ?? '';
      expect('desktop: the meta line is the version and the authors', meta === `${wide.version}by ${wide.authors.join(', ')}`, meta);
      const plate = await page.locator('[data-plate="image"]').evaluate((el) => getComputedStyle(el).aspectRatio);
      expect('desktop: the plate reserves the render\'s shape from the index', plate.replace(/\s/g, '') === '64/32', plate);
      const versions = await page.locator('[data-versions] button').count();
      expect('desktop: older versions each have a Copy button', versions === wide.history.length - 1, `${versions}`);
      const facts = await page.$$eval('[data-facts] dt', (els) => els.map((e) => e.textContent));
      expect('desktop: facts are Entities, Tiles, Factorio, Posted', JSON.stringify(facts) === JSON.stringify(['Entities', 'Tiles', 'Factorio', 'Posted']), facts.join(','));

      await copyButton(page).click();
      await page.getByRole('button', { name: 'Copied' }).waitFor({ timeout: 5000 });
      const text = await clipboard(page);
      expect('desktop: Copy string puts the fetched string on the clipboard', text === stringFor(wide.path), text);
      await shot(page, 'blueprints-build');

      // The viewer.
      await page.locator('[data-plate="image"]').click();
      await page.locator('[data-viewer]').waitFor();
      expect('desktop: the plate opens the full-screen viewer', (await page.locator('[data-viewer]').count()) === 1);
      await page.keyboard.press('Escape');
      await page.locator('[data-viewer]').waitFor({ state: 'detached' });
      expect('desktop: Escape closes the viewer and focus returns to the plate', (await page.evaluate(() => document.activeElement?.getAttribute('data-plate'))) === 'image');

      const images = requests(page).filter((u) => u.startsWith(VAULT) && u.endsWith('.jpg'));
      expect('desktop: only the one render on screen was downloaded', new Set(images).size === 1, images.join(' '));
    }

    // --- a book, and an entry of it -------------------------------------------------------------
    {
      const page = await open(`/blueprints/${book.path}`, 'desktop');
      await ready(page);
      await page.waitForSelector('[data-arrangement="book"]', { timeout: 5000 }).catch(() => {});
      expect('book: a book whose render is measured on load is arranged beside its contents', (await page.locator('[data-arrangement="book"]').count()) === 1);
      const box = await page.locator('[data-contents]').evaluate((el) => ({ overflow: getComputedStyle(el).overflowY, border: getComputedStyle(el).borderTopWidth, flag: el.dataset.overflowing ?? null }));
      expect('book: a short contents list beside the plate neither scrolls nor shows rules', box.overflow === 'visible' && box.border === '0px' && box.flag === null, JSON.stringify(box));
      const contents = await page.$$eval('[data-contents] a', (els) => els.map((e) => e.textContent.trim()));
      expect(
        'book: contents start with "Whole book" and name unlabelled entries by kind and slot',
        JSON.stringify(contents) === JSON.stringify(['Whole book', 'Outer Book', 'Inner One', 'Blueprint (slot 3)', 'Upgrade planner (slot 1)']),
        contents.join(' | '),
      );
      await page.locator('[data-contents] a', { hasText: 'Inner One' }).click();
      await page.waitForURL(/entry=0\/0$/);
      expect('book: an entry retargets the live link', (await liveLink(page)) === `${VAULT}/${book.path}/0/0.txt`, await liveLink(page));
      expect('book: the entry\'s label is the title', (await title(page)) === 'Inner One');
      const crumbs = ((await page.locator('[data-crumbs]').textContent()) ?? '').trim();
      expect('book: the book and outer book sit above the title', crumbs === `${book.title} / Outer Book`, crumbs);
      await page.getByText('Fixture note for general/tools/test-book/0-inner-one.').waitFor({ timeout: 5000 }).catch(() => {});
      expect('book: an entry with a folder shows its own notes, generated block stripped', (await page.getByText('Fixture note for general/tools/test-book/0-inner-one.').count()) === 1 && (await page.getByRole('link', { name: 'Part', exact: true }).count()) === 0);
      await copyButton(page).click();
      await page.getByRole('button', { name: 'Copied' }).waitFor({ timeout: 5000 });
      expect('book: Copy string copies the entry', (await clipboard(page)) === stringFor(`${book.path}/0/0`));
      await shot(page, 'blueprints-book-entry');
      await page.locator('[data-contents] a', { hasText: 'Blueprint (slot 3)' }).click();
      await page.waitForURL(/entry=0\/3$/);
      expect('book: an entry with no render shows the ghost plate', (await page.locator('[data-plate="ghost"]').count()) === 1);
    }

    // --- deep links ------------------------------------------------------------------------------
    {
      const page = await open(`/blueprints/${ghost.path}`, 'desktop');
      await ready(page);
      expect('deep link: /blueprints/<path> opens that build', (await title(page)) === ghost.title);
      expect('deep link: a build with no render shows "Not rendered yet"', ((await page.locator('[data-plate="ghost"]').textContent()) ?? '').includes('Not rendered yet'));
      await goto(page, `/blueprints/${old.path}`);
      await ready(page);
      expect('deep link: a deprecated build opens by its address', (await title(page)) === old.title && ((await page.locator('[data-meta]').textContent()) ?? '').includes('Deprecated'));
      await goto(page, `/blueprints/${hidden.path}`);
      await ready(page);
      expect('deep link: an unlisted build opens by its address and stays out of the index', (await title(page)) === hidden.title && !(await rowTitles(page)).includes(hidden.title));
      await goto(page, '/blueprints/no/such/build');
      await page.waitForSelector('[data-stage-message="unknown"]');
      expect('deep link: an unknown address says so and links back', (await page.getByRole('link', { name: 'See all blueprints' }).count()) === 1);
    }

    // --- the catalog failing, then "Try again" -------------------------------------------------
    {
      const page = await open('/', 'desktop');
      await page.route(`${VAULT}/index.json`, (r) => r.fulfill({ status: 503, body: 'down' }));
      // A fresh document, so the shared fetch starts again under the failing route.
      await goto(page, '/blueprints');
      await page.waitForSelector('[data-stage-message="failed"]', { timeout: 10000 });
      const msg = (await page.locator('[data-stage-message="failed"]').textContent()) ?? '';
      expect('failure: the stage says the catalog didn\'t load', msg.includes("The blueprint catalog didn't load.") && msg.includes('Check your connection, then try again.'), msg);
      expect('failure: the index is empty', (await rows(page).count()) === 0);
      await shot(page, 'blueprints-failed');
      await page.unroute(`${VAULT}/index.json`);
      await page.getByRole('button', { name: 'Try again' }).click();
      await ready(page);
      expect('failure: "Try again" loads the catalog', (await rows(page).count()) === active.length);
    }

    // --- phone: the index page, then a build page ----------------------------------------------
    {
      const page = await open('/blueprints', 'phone');
      await page.waitForSelector('[data-index-row]');
      await shot(page, 'blueprints-phone');
      expect('phone: /blueprints is the index alone', (await page.locator('[data-stage]').count()) === 0 && (await rows(page).count()) === active.length);
      const heights = await page.$$eval('[data-index-row]', (els) => els.map((e) => e.getBoundingClientRect().height));
      expect('phone: index rows are at least 44 px tall', Math.min(...heights) >= 44, heights.join(','));
      await page.locator('[data-index-row]', { hasText: wide.title }).click();
      await page.waitForURL(`**/blueprints/${wide.path}`);
      await ready(page);
      await shot(page, 'blueprints-phone-build');
      expect('phone: a build page is the stage alone', (await page.locator('[data-index]').count()) === 0);
      expect('phone: "All blueprints" leads back', (await page.getByRole('link', { name: 'All blueprints' }).getAttribute('href')) === '/blueprints');
      const btn = await copyButton(page).boundingBox();
      expect('phone: Copy string spans the width', btn && btn.width >= 390 - 32 - 1, JSON.stringify(btn));
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect('phone: the build page does not scroll sideways', over <= 0, `${over}px`);
    }
  },
};
