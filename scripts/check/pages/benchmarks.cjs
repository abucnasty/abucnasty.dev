module.exports = {
  name: 'benchmarks',
  async run({ open, goto, expect, data, shot, aboveFold }) {
    const list = data.index.benchmarks;
    // Same order the page uses: newest first, undated last (stable sort).
    const sorted = [...list].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

    // Per body row, what is visible: title href, chart marker count, save links.
    const readRows = (page) => page.$$eval('main tbody tr', (trs) => {
      const visible = (el) => el.getClientRects().length > 0;
      return trs.map((tr) => {
        const title = tr.querySelector('a[href^="/benchmarks/"]');
        const saves = [...tr.querySelectorAll('a[href^="/saves/"]')].filter(visible);
        return {
          href: title ? title.getAttribute('href') : null,
          height: tr.getBoundingClientRect().height,
          charts: [...tr.querySelectorAll('[aria-label="Interactive metrics"]')].filter(visible).length,
          saves: saves.map((a) => ({
            href: a.getAttribute('href'),
            label: a.getAttribute('aria-label'),
            text: a.textContent.trim(),
            height: a.getBoundingClientRect().height,
          })),
        };
      });
    });
    const saveHref = (source) => `/saves/${source.split('/').map(encodeURIComponent).join('/')}`;

    const page = await open('/benchmarks', 'desktop');
    // Each benchmark has exactly one link to its page in <main>: its title.
    await shot(page, 'benchmarks-desktop');
    const links = await page.$$eval('main a[href^="/benchmarks/"]', (as) => as.map((a) => ({ href: a.getAttribute('href'), text: a.textContent.trim() })));
    expect('one row per benchmark in the index', links.length === list.length, `${links.length} rows, ${list.length} benchmarks`);
    expect('first row is the newest benchmark', links[0]?.href === `/benchmarks/${sorted[0].slug}`, `${links[0]?.href} (newest: ${sorted[0].slug})`);
    expect('rows follow date order, newest first', links.every((l, i) => l.href === `/benchmarks/${sorted[i].slug}`));
    const wrong = links.filter((l) => {
      const b = list.find((x) => `/benchmarks/${x.slug}` === l.href);
      return !b || b.title !== l.text;
    });
    expect('every title links to /benchmarks/<slug>', wrong.length === 0, wrong.map((w) => w.href).join(', '));

    const desktopRows = await readRows(page);
    const tallest = Math.max(...desktopRows.map((r) => r.height));
    expect('desktop: body row height is at most 36 px', desktopRows.length > 0 && tallest <= 36, `tallest ${tallest} px over ${desktopRows.length} rows`);
    const fold = await aboveFold(page, 'main tbody tr');
    expect('desktop: at least 16 body rows above the fold', fold >= 16, `${fold} rows above the fold`);

    const markers = (rows, label) => {
      const bad = [];
      rows.forEach((r, i) => {
        const b = sorted[i];
        const problems = [];
        if (r.href !== `/benchmarks/${b.slug}`) problems.push(`row is ${r.href}`);
        if (r.charts !== (b.timeseries ? 1 : 0)) problems.push(`charts ${r.charts}, expected ${b.timeseries ? 1 : 0}`);
        if (b.saves.length > 0) {
          const s = r.saves;
          if (s.length !== 1) problems.push(`${s.length} save links`);
          else {
            if (s[0].href !== saveHref(b.source)) problems.push(`save link ${s[0].href}`);
            if (s[0].text !== String(b.saves.length)) problems.push(`save count "${s[0].text}"`);
            if (s[0].label !== `${b.saves.length} save files for ${b.title}`) problems.push(`save label "${s[0].label}"`);
          }
        } else if (r.saves.length > 0) problems.push('save link on a row with no saves');
        if (problems.length) bad.push(`${b.slug}: ${problems.join('; ')}`);
      });
      expect(`${label}: chart and save markers match data.index`, bad.length === 0 && rows.length === sorted.length, bad.slice(0, 5).join(' | ') || `${rows.length} rows, ${sorted.length} benchmarks`);
    };
    markers(desktopRows, 'desktop');

    const withQuestion = sorted.filter((b) => b.question);
    const rowTexts = await page.$$eval('main tbody tr', (trs) => trs.map((tr) => tr.textContent));
    const missing = withQuestion.filter((b) => {
      const i = sorted.indexOf(b);
      return !rowTexts[i] || !rowTexts[i].includes(b.question.slice(0, 30));
    });
    expect(`desktop: a row shows the start of its question (${withQuestion.length} benchmarks have one)`,
      withQuestion.length > 0 && missing.length === 0, missing.map((b) => b.slug).join(','));

    const phone = await open('/benchmarks', 'phone');
    await shot(phone, 'benchmarks-phone');
    expect('phone: one row per benchmark', (await phone.locator('main a[href^="/benchmarks/"]').count()) === list.length);
    const phoneRows = await readRows(phone);
    const shortest = Math.min(...phoneRows.map((r) => r.height));
    expect('phone: no row is shorter than 44 px', phoneRows.length > 0 && shortest >= 44, `shortest ${shortest} px`);
    const saveLinks = phoneRows.flatMap((r) => r.saves);
    const shortSaves = saveLinks.filter((s) => s.height < 24).map((s) => Math.round(s.height));
    expect(`phone: every save link is at least 24 px tall (${saveLinks.length} links)`,
      saveLinks.length > 0 && shortSaves.length === 0, `shorter: ${shortSaves.join(',')}`);
    markers(phoneRows, 'phone');

    // ---- Filters. Expected rows are computed here, independently of src/benchmarkFilters.ts.
    const topics = data.index.topics;
    const labelOf = (id) => (topics.find((t) => t.id === id) || {}).label || '';
    const versions = [...new Set(list.filter((b) => b.factorioVersion).map((b) => b.factorioVersion.split('.').slice(0, 2).join('.')))]
      .sort((a, b) => { const [a1, a2] = a.split('.').map(Number); const [b1, b2] = b.split('.').map(Number); return b1 - a1 || b2 - a2; });
    const expectedFor = (f) => sorted.filter((b) => {
      if (f.topic && b.topic !== f.topic) return false;
      if (f.v && !(b.factorioVersion && (b.factorioVersion === f.v || b.factorioVersion.startsWith(f.v + '.')))) return false;
      if (f.charts && !b.timeseries) return false;
      if (f.saves && b.saves.length === 0) return false;
      const hay = [b.title, b.question, b.finding, b.summary, b.topic ? labelOf(b.topic) : '', b.factorioVersion, b.platform, b.cpu].filter(Boolean).join('\n').toLowerCase();
      return (f.q || '').toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
    });
    const shownSlugs = (pg) => pg.$$eval('main tbody tr a[href^="/benchmarks/"]', (as) => as.map((a) => a.getAttribute('href').replace('/benchmarks/', '')));
    const sameRows = async (label, pg, expected) => {
      const got = await shownSlugs(pg);
      const want = expected.map((b) => b.slug);
      expect(label, got.length === want.length && got.every((x, i) => x === want[i]), `${got.length} rows, expected ${want.length}`);
    };
    const f = await open('/benchmarks', 'desktop');
    const firstTopic = topics[0];
    expect('topics are listed', topics.length > 0);
    expect('the toggle buttons show totals over all benchmarks',
      (await f.getByRole('button', { name: /^Interactive metrics/ }).getAttribute('aria-label')) === `Interactive metrics ${list.filter((b) => b.timeseries).length}` &&
      (await f.getByRole('button', { name: /^Save files/ }).getAttribute('aria-label')) === `Save files ${list.filter((b) => b.saves.length > 0).length}`);
    await sameRows('filters: no parameters lists every benchmark', f, sorted);
    expect('filters: no count line without a filter', (await f.getByText(/ of \d+ benchmarks$/).count()) === 0);

    await goto(f, `/benchmarks?topic=${firstTopic.id}`);
    await sameRows(`filters: ?topic=${firstTopic.id}`, f, expectedFor({ topic: firstTopic.id }));
    const chip = f.locator('main .MuiChip-root[aria-pressed]', { hasText: firstTopic.label });
    expect('filters: the selected topic chip is aria-pressed', (await chip.getAttribute('aria-pressed')) === 'true');
    expect('filters: count line reads "n of total benchmarks"',
      (await f.getByText(`${expectedFor({ topic: firstTopic.id }).length} of ${list.length} benchmarks`).count()) === 1);
    await shot(f, 'benchmarks-topic-desktop');

    await goto(f, `/benchmarks?v=${versions[0]}`);
    await sameRows(`filters: ?v=${versions[0]}`, f, expectedFor({ v: versions[0] }));
    await goto(f, '/benchmarks?charts=1');
    await sameRows('filters: ?charts=1', f, expectedFor({ charts: true }));
    await goto(f, '/benchmarks?saves=1');
    await sameRows('filters: ?saves=1', f, expectedFor({ saves: true }));
    await goto(f, `/benchmarks?topic=${firstTopic.id}&saves=1`);
    await sameRows('filters: topic and saves together', f, expectedFor({ topic: firstTopic.id, saves: true }));

    const qb = sorted.find((b) => b.question);
    const words = qb.question.toLowerCase().split(/\s+/).filter((w) => /^[a-z]{4,}$/.test(w));
    const twoTerms = `${words[0]} ${words[words.length - 1]}`;
    await goto(f, `/benchmarks?q=${encodeURIComponent(twoTerms)}`);
    const qExpected = expectedFor({ q: twoTerms });
    expect('filters: two-term query keeps the benchmark it came from', qExpected.includes(qb));
    await sameRows(`filters: ?q=${twoTerms}`, f, qExpected);

    await goto(f, '/benchmarks?topic=nonsense&v=9.9');
    await sameRows('filters: unknown topic and version are no filter', f, sorted);
    expect('filters: unknown values stay in the URL', new URL(f.url()).search === '?topic=nonsense&v=9.9', f.url());

    await goto(f, '/benchmarks?q=zzzzqqqq');
    expect('filters: no match shows the empty state', (await f.getByText('No benchmarks match these filters.').count()) === 1 && (await shownSlugs(f)).length === 0);
    await shot(f, 'benchmarks-empty-desktop');
    await f.getByRole('button', { name: 'Clear filters' }).last().click();
    await f.waitForFunction(() => document.querySelectorAll('main tbody tr').length > 0);
    await sameRows('filters: Clear filters brings every row back', f, sorted);
    expect('filters: Clear filters leaves a URL with no parameters', new URL(f.url()).search === '', f.url());
    expect('filters: Clear filters empties the input', (await f.getByLabel('Filter benchmarks').inputValue()) === '');

    // Interaction.
    await goto(f, '/benchmarks');
    const input = f.getByLabel('Filter benchmarks');
    await input.click();
    const typed = 'quality purple science';
    await f.keyboard.type(typed);
    await sameRows('typing: rows match the query', f, expectedFor({ q: typed }));
    expect('typing: the input keeps its text', (await input.inputValue()) === typed, await input.inputValue());
    expect('typing: the input keeps focus', await f.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label') === 'Filter benchmarks'));
    expect('typing: q is in the URL', new URL(f.url()).searchParams.get('q') === typed, f.url());
    await f.keyboard.press('Home');
    await f.keyboard.type('x');
    expect('typing: an edit at the start lands at the start', (await input.inputValue()) === `x${typed}`, await input.inputValue());
    await goto(f, '/benchmarks');

    const rowWithTopic = sorted.find((b) => b.topic);
    const rowChip = f.locator('main tbody tr', { has: f.locator(`a[href="/benchmarks/${rowWithTopic.slug}"]`) }).getByRole('button', { name: labelOf(rowWithTopic.topic) });
    await rowChip.click();
    const topicRows = expectedFor({ topic: rowWithTopic.topic });
    await f.waitForFunction((n) => document.querySelectorAll('main tbody tr').length === n, topicRows.length);
    await sameRows('clicking a row topic chip selects that topic', f, topicRows);
    expect('row chip: topic is in the URL', new URL(f.url()).searchParams.get('topic') === rowWithTopic.topic, f.url());
    await f.locator('main .MuiChip-root[aria-pressed="true"]', { hasText: labelOf(rowWithTopic.topic) }).click();
    await f.waitForFunction((n) => document.querySelectorAll('main tbody tr').length === n, list.length);
    await sameRows('clicking the selected topic chip clears it', f, sorted);
    expect('clearing the topic leaves no parameters', new URL(f.url()).search === '', f.url());

    // Phone layout with every control visible.
    const fp = await open('/benchmarks', 'phone');
    await shot(fp, 'benchmarks-filters-phone');
    const controls = await fp.$$eval('main button, main input', (els) => els
      .filter((el) => el.getClientRects().length > 0 && !el.closest('table'))
      .map((el) => ({ name: el.getAttribute('aria-label') || el.textContent.trim(), h: Math.round((el.closest('.MuiInputBase-root') || el).getBoundingClientRect().height) })));
    const small = controls.filter((c) => c.h < 44);
    expect(`phone: the text input and buttons are at least 44 px tall (${controls.length} controls)`, controls.length >= 6 && small.length === 0, small.map((c) => `${c.name}:${c.h}`).join(', '));
    const chipHeights = await fp.$$eval('main .MuiChip-root[aria-pressed]', (els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
    expect('phone: topic chips are at least 32 px tall', chipHeights.length === topics.length + 1 && Math.min(...chipHeights) >= 32, chipHeights.join(','));
    const tops = async (sel) => fp.$$eval(sel, (els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    const toggleTops = await tops('main button[aria-label^="Interactive metrics"], main button[aria-label^="Save files"]');
    expect('phone: the two toggle buttons share one row', toggleTops.length === 2 && toggleTops[0] === toggleTops[1], toggleTops.join(','));
    const toggleNames = await fp.$$eval('main button[aria-pressed]', (els) => els.map((el) => el.getAttribute('aria-label') || '').filter(Boolean));
    expect('phone: toggle accessible names stay in full',
      toggleNames.length === 2 && /^Interactive metrics\b/.test(toggleNames[0]) && /^Save files\b/.test(toggleNames[1]), toggleNames.join(' | '));
    const chipTops = await tops('main .MuiChip-root[aria-pressed]');
    expect('phone: all topic chips are on one row', chipTops.length === topics.length + 1 && new Set(chipTops).size === 1, chipTops.join(','));
    const firstRowTop = await fp.$eval('main tbody tr', (tr) => Math.round(tr.getBoundingClientRect().top));
    expect('phone: the first body row starts above y = 420', firstRowTop < 420, `starts at ${firstRowTop} px`);
    const lastTopic = topics[topics.length - 1];
    await goto(fp, `/benchmarks?topic=${lastTopic.id}`);
    const inView = await fp.evaluate(() => {
      const chip = document.querySelector('main .MuiChip-root[aria-pressed="true"]');
      const row = chip.parentElement;
      const c = chip.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      return { ok: c.left >= r.left - 1 && c.right <= r.right + 1, c: [c.left, c.right].map(Math.round), r: [r.left, r.right].map(Math.round), page: window.scrollX };
    });
    expect(`phone: with ?topic=${lastTopic.id} the selected chip is inside the chip row's box`, inView.ok && inView.page === 0, JSON.stringify(inView));
    await shot(fp, 'benchmarks-topic-last-phone');
    await goto(fp, `/benchmarks?topic=${firstTopic.id}`);
    await shot(fp, 'benchmarks-topic-phone');
    const phoneTopicRows = await readRows(fp);
    expect('phone: filtered rows are at least 44 px', phoneTopicRows.length > 0 && Math.min(...phoneTopicRows.map((r) => r.height)) >= 44);
    await goto(fp, '/benchmarks?q=zzzzqqqq');
    await shot(fp, 'benchmarks-empty-phone');
    const emptyBtn = await fp.getByRole('button', { name: 'Clear filters' }).last().boundingBox();
    expect('phone: the empty state button is at least 44 px tall', Boolean(emptyBtn) && emptyBtn.height >= 44, emptyBtn && String(emptyBtn.height));
  },
};
