// Site search: the header trigger, the dialog, its keyboard handling and the lazy save index.
// Every expectation is derived from src/generated, so publishing content never breaks it.

const SEARCH_LABEL = 'Search the site';
const GROUP_LIMIT = 6;

const group = (page, label) => page.locator(`[role=group]:has(> :first-child:text-is("${label}"))`);
const words = (s) => s.toLowerCase().split(/\s+/).filter(Boolean);

// Same haystack as staticEntries() in src/search.ts.
function benchmarkHaystack(b, topicLabels) {
  return [b.title, b.question, b.finding, b.summary, b.topic ? topicLabels.get(b.topic) : '', b.factorioVersion, b.platform, b.cpu]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

module.exports = {
  name: 'search',
  async run({ open, goto, expect, requests, data, shot }) {
    const { index, catalog, saves } = data;
    const topicLabels = new Map(index.topics.map((t) => [t.id, t.label]));
    const newest = index.benchmarks.reduce((a, b) => ((b.date ?? '') > (a.date ?? '') ? b : a));
    const savesChunk = (page) => requests(page).filter((u) => u.includes('/assets/saves-'));

    const trigger = (page) => page.locator(`header button[aria-label="${SEARCH_LABEL}"]:visible`);
    const dialog = (page) => page.locator('[role=dialog]');
    const input = (page) => page.locator('[role=dialog] input[role=combobox]');
    const options = (page) => page.locator('[role=dialog] [role=option]');
    const optionIds = (page) => page.$$eval('[role=dialog] [role=option]', (els) => els.map((e) => e.id));
    const active = (page) => input(page).getAttribute('aria-activedescendant');
    const isOpen = async (page) => (await dialog(page).count()) > 0;
    const closed = async (page) => {
      await dialog(page).waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
      return !(await isOpen(page));
    };
    const type = async (page, text) => {
      await input(page).focus();
      await page.keyboard.type(text);
    };

    // ---- Desktop -----------------------------------------------------------------------------
    const page = await open('/', 'desktop');
    expect('desktop: the header has a search trigger', (await trigger(page).count()) === 1);
    const triggerText = (await trigger(page).innerText()).replace(/\s+/g, ' ').trim();
    expect('desktop: the trigger reads "Search" with a "/" hint', triggerText === 'Search /', triggerText);
    expect('desktop: the trigger is 32px tall', (await trigger(page).boundingBox()).height === 32);
    expect('desktop: the save index is not requested when the page loads', savesChunk(page).length === 0, savesChunk(page).join(', '));

    await trigger(page).click();
    await dialog(page).waitFor();
    expect('desktop: clicking the trigger opens the dialog with the input focused', await input(page).evaluate((el) => el === document.activeElement));
    expect('desktop: the input is a combobox controlling a listbox', (await input(page).getAttribute('aria-controls')) !== null && (await input(page).getAttribute('aria-expanded')) === 'false');
    expect('desktop: the empty dialog invites typing', (await dialog(page).innerText()).includes('Start typing to search the whole site.'));
    await new Promise((r) => setTimeout(r, 400));
    expect('desktop: the save index is not requested while the query is empty', savesChunk(page).length === 0, savesChunk(page).join(', '));
    await page.keyboard.type('  ');
    expect('desktop: spaces alone do not request the save index', savesChunk(page).length === 0);
    await shot(page, 'search-desktop-empty');

    // Typing the newest benchmark's title: first in its group; Enter on the first row opens it.
    await page.keyboard.press('Control+a');
    await page.keyboard.type(newest.title);
    await group(page, 'Benchmarks').locator('[role=option]').first().waitFor();
    expect('desktop: typing starts the save index request', savesChunk(page).length === 1, savesChunk(page).join(', '));
    const firstBench = group(page, 'Benchmarks').locator('[role=option]').first();
    expect('desktop: the newest benchmark is first in the Benchmarks group', (await firstBench.getAttribute('href')) === `/benchmarks/${newest.slug}`, await firstBench.getAttribute('href'));
    expect('desktop: the first row is active after typing', (await active(page)) === (await optionIds(page))[0], await active(page));
    expect('desktop: the active row is shown as selected', (await page.locator('[role=dialog] [role=option][aria-selected=true]').count()) === 1);
    await shot(page, 'search-desktop-typed');
    await page.keyboard.press('Enter');
    await page.waitForURL(`**/benchmarks/${newest.slug}`);
    expect('desktop: Enter alone opens the best match and the dialog is gone', (await closed(page)) && new URL(page.url()).pathname === `/benchmarks/${newest.slug}`, page.url());

    // `/` and Ctrl+K.
    await goto(page, '/blog');
    await page.keyboard.press('/');
    await dialog(page).waitFor();
    expect('desktop: "/" with nothing focused opens the dialog', await isOpen(page));
    await page.keyboard.type('a/b');
    expect('desktop: "/" typed in the dialog input types a slash', (await input(page).inputValue()) === 'a/b', await input(page).inputValue());
    await page.keyboard.press('Escape');
    expect('desktop: Escape closes the dialog', await closed(page));

    await goto(page, '/benchmarks?q=zq');
    const filter = page.locator('main input[type=text], main input:not([type])').first();
    await filter.focus();
    await page.keyboard.press('/');
    expect('desktop: "/" typed in the benchmarks filter does not open the dialog', !(await isOpen(page)));
    expect('desktop: "/" typed in the benchmarks filter types a slash', (await filter.inputValue()) === 'zq/', await filter.inputValue());
    await page.keyboard.press('Control+k');
    await dialog(page).waitFor();
    expect('desktop: Ctrl+K opens the dialog from inside a text field', await isOpen(page));
    expect('desktop: Ctrl+K did not type into the field', (await filter.inputValue()) === 'zq/');
    await type(page, 'x');
    await page.keyboard.press('Escape');
    expect('desktop: Escape closes it', await closed(page));
    expect('desktop: Escape returns focus to the field that had it', await filter.evaluate((el) => el === document.activeElement));
    expect('desktop: Escape does not clear the page filter or the URL', (await filter.inputValue()) === 'zq/' && new URL(page.url()).search.includes('q='), `${await filter.inputValue()} ${page.url()}`);
    await page.keyboard.press('Meta+k');
    expect('desktop: Cmd+K opens the dialog too', await dialog(page).count().then((n) => n > 0));
    await page.keyboard.press('Escape');
    await closed(page);

    await goto(page, '/tools');
    await trigger(page).click();
    await dialog(page).waitFor();
    await page.keyboard.press('Escape');
    await closed(page);
    expect('desktop: after Escape, focus is back on the trigger', await trigger(page).evaluate((el) => el === document.activeElement));

    // Keyboard navigation over a query with many rows.
    await trigger(page).click();
    await type(page, 'a');
    await options(page).first().waitFor();
    await page.waitForFunction(() => document.querySelectorAll('[role=dialog] [role=group]').length >= 2);
    await page.waitForTimeout(200);
    let ids = await optionIds(page);
    expect('desktop: a broad query shows several rows', ids.length > 2, `${ids.length} rows`);
    const a1 = await active(page);
    await page.keyboard.press('ArrowDown');
    const a2 = await active(page);
    expect('desktop: the first row is active, and ArrowDown moves to the second', a1 === ids[0] && a2 === ids[1], `${a1} ${a2}`);
    expect('desktop: the active row is aria-selected', (await page.locator(`[id="${a2}"]`).getAttribute('aria-selected')) === 'true');
    await page.keyboard.press('ArrowUp');
    expect('desktop: ArrowUp returns to the first row', (await active(page)) === ids[0]);
    await page.keyboard.press('ArrowUp');
    expect('desktop: ArrowUp from the first row wraps to the last', (await active(page)) === ids[ids.length - 1], await active(page));
    await page.keyboard.press('ArrowDown');
    expect('desktop: ArrowDown from the last row wraps to the first', (await active(page)) === ids[0]);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.type('b');
    expect('desktop: typing after arrowing makes the first row active again', (await active(page)) === (await optionIds(page))[0], await active(page));
    expect('desktop: arrow keys leave the caret alone', await (async () => {
      await page.keyboard.press('Control+a');
      await page.keyboard.type('ab');
      await page.keyboard.press('ArrowLeft');
      const before = await input(page).evaluate((el) => el.selectionStart);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowUp');
      const after = await input(page).evaluate((el) => el.selectionStart);
      return before === 1 && after === 1;
    })());
    await page.keyboard.press('Escape');
    await closed(page);

    // The active row stays visible when the list scrolls (short window so it has to).
    await page.setViewportSize({ width: 1280, height: 420 });
    await trigger(page).click();
    await type(page, 'a');
    await page.waitForFunction(() => document.querySelectorAll('[role=dialog] [role=option]').length > 8);
    await page.waitForTimeout(200);
    ids = await optionIds(page);
    const scrolls = await page.evaluate(() => {
      const list = document.querySelector('[role=dialog] [role=listbox]').parentElement;
      return list.scrollHeight > list.clientHeight;
    });
    expect('desktop: the result list scrolls in a short window', scrolls);
    const scrollYBefore = await page.evaluate(() => window.scrollY);
    let allVisible = true;
    let detail = '';
    for (let i = 0; i < ids.length + 2; i += 1) {
      await page.keyboard.press('ArrowDown');
      const visible = await page.evaluate(() => {
        const list = document.querySelector('[role=dialog] [role=listbox]').parentElement;
        const row = document.getElementById(document.querySelector('[role=dialog] input').getAttribute('aria-activedescendant'));
        const l = list.getBoundingClientRect();
        const r = row.getBoundingClientRect();
        return r.top >= l.top - 1 && r.bottom <= l.bottom + 1;
      });
      if (!visible) {
        allVisible = false;
        detail = `row ${i}`;
        break;
      }
    }
    expect('desktop: the active row stays inside the scrolling list, down and wrapping', allVisible, detail);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    expect('desktop: the page behind does not scroll', (await page.evaluate(() => window.scrollY)) === scrollYBefore);
    const rect = await dialog(page).boundingBox();
    expect('desktop: the dialog stays within the window', rect.y >= 0 && rect.y + rect.height <= 420, JSON.stringify(rect));
    await page.keyboard.press('Escape');
    await closed(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Blueprints come from the live catalog (the fixture here) and open on this site.
    const bpEntries = catalog.blueprints.filter((e) => e.status !== 'unlisted' && !e.deprecated);
    {
      const pick = bpEntries[0];
      await goto(page, '/');
      await page.keyboard.press('/');
      await type(page, pick.title);
      const bp = group(page, 'Blueprints').locator(`[role=option][href="/blueprints/${pick.path}"]`);
      await bp.first().waitFor({ timeout: 5000 }).catch(() => {});
      expect('desktop: a blueprint is found by its title', (await bp.count()) === 1);
      expect('desktop: a blueprint result opens its page on this site', (await bp.first().getAttribute('target')) === null && (await bp.first().locator('svg').count()) === 0);
      await input(page).fill('');
      for (const e of catalog.blueprints.filter((x) => x.status === 'unlisted' || x.deprecated)) {
        await input(page).fill(e.title);
        await page.waitForTimeout(150);
        const n = await page.locator(`[role=dialog] [role=option][href="/blueprints/${e.path}"]`).count();
        expect(`desktop: search leaves out ${e.status === 'unlisted' ? 'an unlisted' : 'a deprecated'} blueprint`, n === 0);
      }
      await page.keyboard.press('Escape');
      await closed(page);
    }

    // More than six benchmarks.
    const terms = [...index.topics.map((t) => t.label), ...new Set(index.benchmarks.map((b) => b.factorioVersion).filter(Boolean))];
    let many = null;
    for (const t of terms) {
      const n = index.benchmarks.filter((b) => words(t).every((w) => benchmarkHaystack(b, topicLabels).includes(w))).length;
      if (n > GROUP_LIMIT) {
        many = { term: t, n };
        break;
      }
    }
    expect('desktop: the data has a term matching more than 6 benchmarks', !!many);
    if (many) {
      await page.keyboard.press('/');
      await type(page, many.term);
      const all = group(page, 'Benchmarks').locator('[role=option]').last();
      await all.waitFor();
      const label = (await all.innerText()).trim();
      expect('desktop: a broad term shows the "All n benchmarks matching" row with the right count', label === `All ${many.n} benchmarks matching`, label);
      expect('desktop: it links to the filtered Benchmarks page', (await all.getAttribute('href')) === `/benchmarks?q=${encodeURIComponent(many.term)}`, await all.getAttribute('href'));
      expect('desktop: the group shows 6 benchmarks and that row', (await group(page, 'Benchmarks').locator('[role=option]').count()) === GROUP_LIMIT + 1);
      await all.click();
      await page.waitForURL('**/benchmarks?q=*');
      expect('desktop: following it closes the dialog and filters the page', (await closed(page)) && (await page.locator('main input').first().inputValue()) === many.term);
      await page.locator('main tbody tr').first().waitFor();
      const pageRows = await page.locator('main tbody tr').count();
      expect('desktop: the "All n" count equals the rows on the page it links to', pageRows === many.n, `${many.n} in the dialog, ${pageRows} rows`);
    }

    // Save files.
    const saveTerm = 'wagon';
    const saveMatches = saves.files.filter(([p]) => {
      const meta = saves.meta[p.split('/').slice(0, 2).join('/')];
      return `${p} ${meta?.title ?? ''}`.toLowerCase().includes(saveTerm);
    });
    expect('desktop: the save index has files matching "wagon"', saveMatches.length > 0);
    await goto(page, '/');
    await page.keyboard.press('/');
    await type(page, saveTerm);
    const saveRows = group(page, 'Save files').locator('[role=option][href^="/saves"]');
    await saveRows.first().waitFor();
    const saveHrefs = await saveRows.evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    expect('desktop: save-file rows link under /saves/', saveHrefs.filter((h) => h.startsWith('/saves/')).length >= Math.min(GROUP_LIMIT, saveMatches.length), saveHrefs.join(', '));
    expect('desktop: save-file rows show the file name and folder', (await saveRows.first().innerText()).trim().split('\n').length === 2);
    if (saveMatches.length > GROUP_LIMIT) {
      const all = saveRows.last();
      expect('desktop: save files show an "All n save files matching" row', (await all.innerText()).trim() === `All ${saveMatches.length} save files matching` && (await all.getAttribute('href')) === `/saves?q=${saveTerm}`, (await all.innerText()).trim());
    }
    await shot(page, 'search-desktop-results');
    await page.keyboard.press('Escape');
    await closed(page);

    // Row sizes, on a query with one- and two-line rows.
    await page.keyboard.press('/');
    await type(page, 'a');
    await page.locator('[role=dialog] [role=option]').nth(3).waitFor();
    const heights = await page.$$eval('[role=dialog] [role=option]', (els) => els.map((e) => ({ h: Math.round(e.getBoundingClientRect().height), two: e.children[0].children.length === 2 })));
    expect('desktop: rows are at least 34px tall', heights.every((r) => r.h >= 34), JSON.stringify(heights.map((r) => r.h)));
    expect('desktop: two-line rows are at least 52px tall', heights.filter((r) => r.two).every((r) => r.h >= 52));
    await page.keyboard.press('Escape');
    await closed(page);

    // A nonsense query.
    await page.keyboard.press('/');
    await type(page, 'zzqxjvk');
    await page.waitForFunction(() => document.querySelector('[role=dialog]').innerText.includes('Nothing matches'));
    const nothing = (await dialog(page).innerText()).includes('Nothing matches “zzqxjvk”.');
    expect('desktop: a nonsense query says nothing matches', nothing);
    expect('desktop: the nothing-matches state has no rows', (await options(page).count()) === 0);
    await shot(page, 'search-desktop-nothing');
    await page.keyboard.press('Enter');
    expect('desktop: Enter on an empty result does nothing', await isOpen(page));
    await page.keyboard.press('Escape');
    await closed(page);

    // The header at every width.
    for (const width of [360, 600, 768, 900, 1024, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await goto(page, '/');
      await page.setViewportSize({ width, height: 800 });
      const m = await page.evaluate(() => {
        const header = document.querySelector('header');
        const bar = header.firstElementChild;
        const shown = [...bar.children].filter((c) => c.getBoundingClientRect().width > 0);
        const rects = shown.map((c) => c.getBoundingClientRect());
        const overlap = rects.some((r, i) => i > 0 && r.left < rects[i - 1].right - 0.5);
        return {
          header: { sw: header.scrollWidth, cw: header.clientWidth, h: header.getBoundingClientRect().height },
          bar: { sw: bar.scrollWidth, cw: bar.clientWidth, h: bar.getBoundingClientRect().height },
          overlap,
          lastRight: Math.round(rects[rects.length - 1].right),
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(`${width}px: the header does not scroll or wrap`, m.header.sw <= m.header.cw && m.bar.sw <= m.bar.cw && Math.round(m.header.h) === 48 && Math.round(m.bar.h) === 48, JSON.stringify(m));
      expect(`${width}px: nothing in the header overlaps and the page does not scroll sideways`, !m.overlap && m.page <= 0, JSON.stringify(m));
      expect(`${width}px: the search trigger is visible`, (await trigger(page).count()) === 1);
      if (width === 768) await shot(page, 'search-header-768');
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    // Home.
    await goto(page, '/');
    const homeSearch = page.locator('[data-home-search]');
    // The blueprint count arrives with the catalog.
    await page.waitForFunction(() => /\d+ blueprints/.test(document.querySelector('[data-home-search]')?.getAttribute('aria-label') ?? ''), null, { timeout: 5000 }).catch(() => {});
    const homeText = (await homeSearch.getAttribute('aria-label')) ?? '';
    const homeVisible = (await homeSearch.innerText()).replace(/\s+/g, ' ').trim();
    const activeBlueprints = bpEntries.length;
    expect(
      'home: the search box shows the benchmark, blueprint and save-file counts',
      homeText === `Search ${index.benchmarks.length} benchmarks, ${activeBlueprints} blueprints and ${index.saveStats.count} save files`,
      homeText,
    );
    expect('home: from sm up the box shows the full sentence', homeVisible === homeText, homeVisible);
    expect('home: the search box is 44px tall', (await homeSearch.boundingBox()).height === 44);
    await shot(page, 'search-home-desktop');
    await homeSearch.click();
    await dialog(page).waitFor();
    expect('home: the search box opens the dialog with the input focused', await input(page).evaluate((el) => el === document.activeElement));
    await page.keyboard.press('Escape');
    await closed(page);

    // ---- Phone -------------------------------------------------------------------------------
    const phone = await open('/', 'phone');
    const pt = phone.locator(`header button[aria-label="${SEARCH_LABEL}"]:visible`);
    const ptBox = await pt.boundingBox();
    expect('phone: the search trigger is at least 44x44', ptBox.width >= 44 && ptBox.height >= 44, JSON.stringify(ptBox));
    const hamburger = await phone.locator('header button[aria-label="Open menu"]').boundingBox();
    expect('phone: the search trigger sits before the menu button', ptBox.x + ptBox.width <= hamburger.x + 0.5);
    await shot(phone, 'search-home-phone');
    await pt.click();
    await dialog(phone).waitFor();
    const paper = await phone.locator('[role=dialog]').boundingBox();
    expect('phone: the dialog is full screen', paper.x === 0 && paper.y === 0 && paper.width === 390 && paper.height === 844, JSON.stringify(paper));
    const closeBox = await phone.locator('[role=dialog] button[aria-label="Close search"]').boundingBox();
    expect('phone: the close button is at least 44x44', closeBox.width >= 44 && closeBox.height >= 44, JSON.stringify(closeBox));
    await shot(phone, 'search-phone-empty');
    await phone.keyboard.type('a');
    await phone.locator('[role=dialog] [role=option]').nth(3).waitFor();
    await phone.waitForTimeout(300);
    const pheights = await phone.$$eval('[role=dialog] [role=option]', (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    expect('phone: rows are at least 44px tall', pheights.every((h) => h >= 44), JSON.stringify(pheights));
    const over = await phone.evaluate(() => {
      const list = document.querySelector('[role=dialog] [role=listbox]').parentElement;
      return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, list: list.scrollWidth - list.clientWidth };
    });
    expect('phone: no sideways scroll with the dialog open', over.page <= 0 && over.list <= 0, JSON.stringify(over));
    await shot(phone, 'search-phone-results');
    await phone.locator('[role=dialog] button[aria-label="Close search"]').click();
    expect('phone: the close button closes the dialog', await closed(phone));
    expect('phone: focus returns to the trigger', await pt.evaluate((el) => el === document.activeElement));

    await pt.click();
    await dialog(phone).waitFor();
    await phone.keyboard.type('zzqxjvk');
    await phone.waitForFunction(() => document.querySelector('[role=dialog]').innerText.includes('Nothing matches'));
    await shot(phone, 'search-phone-nothing');
    await phone.keyboard.press('Escape');
    await closed(phone);

    const homeBox = await phone.locator('[data-home-search]').boundingBox();
    expect('phone: the Home search box is 44px tall and fits the width', homeBox.height === 44 && homeBox.x + homeBox.width <= 390, JSON.stringify(homeBox));
    const phoneText = (await phone.locator('[data-home-search]').innerText()).replace(/\s+/g, ' ').trim();
    const lineBox = await phone.locator('[data-home-search] span:visible').evaluate((el) => ({ h: el.getBoundingClientRect().height, sw: el.scrollWidth, cw: el.clientWidth }));
    expect('phone: the Home search box reads "Search the site" on one line', phoneText === 'Search the site' && lineBox.h < 24 && lineBox.sw <= lineBox.cw, `${phoneText} ${JSON.stringify(lineBox)}`);
    expect('phone: its accessible name is still the full sentence', /^Search \d+ benchmarks, \d+ blueprints and \d+ save files$/.test(await phone.locator('[data-home-search]').getAttribute('aria-label')));
    const over2 = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect('phone: no sideways scroll with the dialog closed', over2 <= 0);
  },
};
