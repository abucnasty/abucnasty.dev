// The save browser (/saves). Every expectation is derived from src/generated
// (index.json, saves.json), so publishing a benchmark never breaks it.

const collator = new Intl.Collator('en-US', { numeric: true });

// Same rules as src/format.ts.
function formatBytes(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e8) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e5) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} kB`;
}
const saveCount = (n) => `${n} ${n === 1 ? 'save' : 'saves'}`;
const platform = (raw) => {
  const l = raw.toLowerCase();
  if (l.includes('windows') || l.startsWith('win')) return 'Windows';
  if (l.includes('linux')) return 'Linux';
  if (l.includes('mac') || l.includes('darwin')) return 'macOS';
  return raw;
};
const route = (p) => (p ? `/saves/${p.split('/').map(encodeURIComponent).join('/')}` : '/saves');
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Folder tree over the flat index, same shape as src/saves.ts. */
function buildTree(saves) {
  const root = { name: '', path: '', folders: [], files: [], count: 0, bytes: 0 };
  const byPath = new Map([['', root]]);
  const all = [];
  for (const [p, bytes, oid] of saves.files) {
    const parts = p.split('/');
    let node = root;
    node.count += 1;
    node.bytes += bytes;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const fp = parts.slice(0, i + 1).join('/');
      let child = byPath.get(fp);
      if (!child) {
        child = { name: parts[i], path: fp, folders: [], files: [], count: 0, bytes: 0 };
        byPath.set(fp, child);
        node.folders.push(child);
      }
      node = child;
      node.count += 1;
      node.bytes += bytes;
    }
    const name = parts[parts.length - 1];
    const meta = saves.meta[parts.slice(0, 2).join('/')];
    const file = {
      name,
      path: p,
      dir: node.path,
      bytes,
      oid,
      url: `${saves.lfsWorkerUrl}/objects/${oid}/${encodeURIComponent(name)}`,
      haystack: `${p} ${meta?.title ?? ''}`.toLowerCase(),
    };
    node.files.push(file);
    all.push(file);
  }
  return { root, all, byPath };
}

function chainEnd(folder) {
  const names = [folder.name];
  let cur = folder;
  while (cur.files.length === 0 && cur.folders.length === 1) {
    cur = cur.folders[0];
    names.push(cur.name);
  }
  return { folder: cur, label: names.join(' / ') };
}

module.exports = {
  name: 'saves',
  async run({ open, goto, expect, requests, data, shot, box, aboveFold }) {
    const { saves, index } = data;
    const meta = saves.meta;
    const { root, all, byPath } = buildTree(saves);
    const { owner, repo, branch } = index.sourceRepo;
    const workerRe = new RegExp(`^${escapeRe(saves.lfsWorkerUrl)}/objects/[0-9a-f]{64}/[^/]+\\.zip$`);

    const sortFolders = (folders, sort) => {
      const label = (f) => meta[f.path]?.title ?? f.name;
      const date = (f) => meta[f.path]?.benchmark_date ?? '';
      return [...folders].sort((a, b) => {
        if (sort === 'size') return b.bytes - a.bytes;
        if (sort === 'date' && date(a) !== date(b)) return date(a) < date(b) ? 1 : -1;
        return collator.compare(label(a), label(b));
      });
    };
    const sortFiles = (files, sort) => [...files].sort(sort === 'size' ? (a, b) => b.bytes - a.bytes : (a, b) => collator.compare(a.path, b.path));
    const hits = (q) => {
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      return all.filter((f) => terms.every((t) => f.haystack.includes(t)));
    };
    const statusFor = (q) => {
      const h = hits(q);
      const quoted = `“${squash(q)}”`; // the browser collapses runs of spaces when it renders the text
      if (h.length === 0) return `Nothing matches ${quoted}`;
      const shown = Math.min(h.length, 100);
      return `${saveCount(h.length)} ${h.length === 1 ? 'matches' : 'match'} ${quoted} · ${formatBytes(h.reduce((s, f) => s + f.bytes, 0))}${h.length > shown ? ` · showing the first ${shown}` : ''}`;
    };

    // ---- scenarios, picked from the data ----
    const sections = sortFolders(root.folders, 'name');
    const tops = sections.flatMap((s) => s.folders);
    const chainChildren = (top) => top.folders.map((f) => ({ f, ...chainEnd(f) })).filter((c) => c.label.includes(' / ') && c.folder.files.length > 0);
    // A top-level folder that opens as itself (the landing row doesn't skip past it) and has a collapsed-chain child.
    const hasChain = (t) => chainEnd(t).folder === t && chainChildren(t).length > 0;
    // A curated benchmark that has saves, so its page has a Save files tab.
    const curated = index.benchmarks.find((b) => b.saves.length > 0 && meta[b.source]?.benchmark_slug === b.slug && byPath.has(b.source));
    const top =
      (curated && hasChain(byPath.get(curated.source)) ? byPath.get(curated.source) : null) ?? tops.find((t) => meta[t.path]?.benchmark_slug && hasChain(t)) ?? tops.find(hasChain);
    expect('data has a top-level folder with a collapsed sub-folder chain', Boolean(top), 'cannot run the folder-navigation checks');
    expect('data has a curated benchmark with saves', Boolean(curated), 'cannot run the writeup and Save files tab checks');
    expect('data has saves', all.length > 0);
    if (!top || !curated || all.length === 0) return;

    const topMeta = meta[top.path] ?? {};
    const topTitle = topMeta.title ?? top.name;
    const topRoute = route(top.path);
    const chains = chainChildren(top);
    const chain = chains[0];
    const chainRoute = route(chain.folder.path);
    const firstFile = sortFiles(chain.folder.files, 'name')[0];
    const term = hits('wagon').length ? 'wagon' : (all[0].name.split(/[_.-]/)[1] ?? 'zip').toLowerCase();

    const rowsSel = 'main a[href^="/saves/"]:has(svg)';
    const fileRowsSel = 'main a[aria-label^="Download "]';
    const crumbsSel = 'nav[aria-label="Folder path"]';
    const cardSel = 'main section:has(a:has-text("View on GitHub"))';
    const search = 'input[aria-label="Search saves"]';
    const where = (page) => page.evaluate(() => location.pathname + location.search);
    const rowText = (a) => a.innerText.replace(/\s+/g, ' ').trim();
    const firstRow = (page) => page.$eval(rowsSel, rowText);
    const rowLabel = (f) => (meta[f.path]?.title ?? f.name);

    // ---------- desktop ----------
    const page = await open('/benchmarks', 'desktop');
    const early = requests(page);
    expect('other pages do not request the save index or page chunks', !early.some((u) => /\/assets\/[Ss]aves-/.test(u)), early.filter((u) => /assets/.test(u)).map((u) => u.split('/').pop()).join(', '));

    // landing, reached from the menu
    await page.locator('header a[href="/saves"]').first().click();
    await page.waitForSelector(rowsSel);
    expect('menu link lands on /saves', (await where(page)) === '/saves');
    const reqs = requests(page);
    expect('/saves requests the index chunk and the page chunk', reqs.some((u) => /\/assets\/saves-.*\.js/.test(u)) && reqs.some((u) => /\/assets\/Saves-.*\.js/.test(u)));

    await shot(page, 'saves-landing-desktop');
    const summary = await page.textContent('main h1 + p');
    expect('landing summary shows the total count and size', summary.startsWith(`${root.count} Factorio saves`) && summary.includes(`${formatBytes(root.bytes)} in total`), summary);

    const shown = await page.$$eval('main section', (ss) =>
      ss.map((s) => ({
        label: s.querySelector('h2').textContent,
        summary: s.querySelector('h2 + p').textContent,
        rows: [...s.querySelectorAll('a[href^="/saves/"]')].map((a) => a.innerText.replace(/\s+/g, ' ').trim()),
      })),
    );
    expect('landing has one section per top-level directory', shown.map((s) => s.label).join(',') === sections.map((s) => s.name).join(','), shown.map((s) => s.label).join(','));
    for (const [i, s] of sections.entries()) {
      const want = `${s.folders.length} ${s.folders.length === 1 ? 'folder' : 'folders'} · ${saveCount(s.count)} · ${formatBytes(s.bytes)}`;
      expect(`${s.name} section: ${want}`, shown[i]?.summary === want && shown[i].rows.length === s.folders.length + s.files.length, `${shown[i]?.summary}, ${shown[i]?.rows.length} rows`);
    }
    const perRow = shown.flatMap((s) => s.rows).map((t) => Number((t.match(/(\d+) saves?/) || [])[1]));
    expect('per-folder save counts add up to the total', perRow.reduce((a, b) => a + b, 0) === root.count, `${perRow.reduce((a, b) => a + b, 0)} vs ${root.count}`);
    const landingRowH = (await box(page, rowsSel))?.height ?? 0;
    expect('desktop landing: folder row is at most 36 px tall', landingRowH > 0 && landingRowH <= 36, `${landingRowH} px`);
    const landingAbove = await aboveFold(page, rowsSel);
    expect('desktop landing: at least 15 folder rows above the fold', landingAbove >= 15, `${landingAbove} rows above the fold`);

    const lead = (f) => `${meta[f.path]?.benchmark_date ?? '—'} ${rowLabel(f)}`;
    const s0 = sections[0];
    const byDate = sortFolders(s0.folders, 'date');
    expect('default sort: newest first', (await firstRow(page)).startsWith(lead(byDate[0])), `${await firstRow(page)} | want ${lead(byDate[0])}`);
    if (s0.folders.some((f) => !meta[f.path]?.benchmark_date)) {
      const last = await page.$$eval(`main section:first-of-type a[href^="/saves/"]`, (as) => as.map((a) => a.innerText.replace(/\s+/g, ' ').trim()).pop());
      expect('default sort: undated folders last', last.startsWith('— '), last);
    }
    expect('active menu item is highlighted', await page.$eval('header a[href="/saves"]', (a) => a.classList.contains('active')));

    // sort
    await page.click('main button:has-text("Size")');
    expect('sort Size: largest first, ?sort=size', (await firstRow(page)).startsWith(lead(sortFolders(s0.folders, 'size')[0])) && (await where(page)) === '/saves?sort=size', await firstRow(page));
    await page.click('main button:has-text("Name")');
    expect('sort Name: alphabetical, ?sort=name', (await firstRow(page)).startsWith(lead(sortFolders(s0.folders, 'name')[0])) && (await where(page)) === '/saves?sort=name', await firstRow(page));
    await page.click('main button:has-text("Newest")');
    expect('sort Newest: back to default, parameter dropped', (await firstRow(page)).startsWith(lead(byDate[0])) && (await where(page)) === '/saves');
    await goto(page, '/saves?sort=size');
    await page.waitForSelector(rowsSel);
    expect('deep link ?sort=size is honoured', (await firstRow(page)).startsWith(lead(sortFolders(s0.folders, 'size')[0])) && (await page.getAttribute('main button:has-text("Size")', 'aria-pressed')) === 'true');

    // into a folder
    await goto(page, '/saves');
    await page.waitForSelector(rowsSel);
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.click(`main a[href="${topRoute}"]`);
    await page.waitForSelector(crumbsSel);
    expect('clicking a landing row opens that folder', (await where(page)) === topRoute, await where(page));
    expect('opening a folder scrolls to the top', (await page.evaluate(() => window.scrollY)) === 0);

    const card = squash(await page.innerText(cardSel)).toLowerCase();
    const cardWant = [
      topMeta.benchmark_date,
      topTitle,
      topMeta.factorio_version && `Factorio ${topMeta.factorio_version}`,
      topMeta.benchmark_machine_platform && platform(topMeta.benchmark_machine_platform),
      `${saveCount(top.count)} · ${formatBytes(top.bytes)}`,
      topMeta.benchmark_slug && 'Read the writeup',
      'View on GitHub',
    ].filter(Boolean);
    const cardMissing = cardWant.filter((w) => !card.includes(w.toLowerCase()));
    expect('header card: date, title, chips, totals, buttons', cardMissing.length === 0, `missing ${JSON.stringify(cardMissing)} in "${card}"`);
    const gh = await page.getAttribute('main a:has-text("View on GitHub")', 'href');
    expect('View on GitHub href', gh === `https://github.com/${owner}/${repo}/tree/${branch}/${top.path.split('/').map(encodeURIComponent).join('/')}`, gh);

    const wantRows = top.folders.map((f) => `${chainEnd(f).label} -> ${route(chainEnd(f).folder.path)}`).sort();
    const gotRows = (await page.$$eval(rowsSel, (as) => as.map((a) => `${a.innerText.split('\n')[0].trim()} -> ${a.getAttribute('href')}`))).sort();
    expect('sub-folder rows jump to the end of a collapsed chain', JSON.stringify(gotRows) === JSON.stringify(wantRows), `${gotRows.join(' | ')} vs ${wantRows.join(' | ')}`);

    await page.click('main button:has-text("Size")');
    const bySize = (await page.$$eval(rowsSel, (as) => as.map((a) => a.innerText.split('\n')[0].trim())))[0];
    expect('folder sort Size puts the biggest sub-folder first', bySize === chainEnd(sortFolders(top.folders, 'size')[0]).label && (await where(page)).endsWith('?sort=size'), bySize);
    await page.click(`main a[href="${chainRoute}"]`);
    await page.waitForSelector(fileRowsSel);
    expect('collapsed row opens the chain end, sort parameter cleared', (await where(page)) === chainRoute, await where(page));
    expect('chain end lists its files', (await page.$$(fileRowsSel)).length === chain.folder.files.length, `${(await page.$$(fileRowsSel)).length} vs ${chain.folder.files.length}`);

    // back / forward
    await page.goBack();
    await page.waitForTimeout(200);
    expect('Back returns to the benchmark folder', (await where(page)).startsWith(topRoute) && (await page.$$(rowsSel)).length === top.folders.length + 0, await where(page));
    await page.goBack();
    await page.waitForTimeout(300);
    const backY = await page.evaluate(() => window.scrollY);
    expect('Back to the landing page restores scroll position', (await where(page)) === '/saves' && backY > 0, `scrollY=${backY}`);

    // deep link to a nested folder
    await goto(page, chainRoute);
    await page.waitForSelector(fileRowsSel);
    const segs = chain.folder.path.split('/');
    const crumbs = squash(await page.innerText(crumbsSel));
    expect('deep link: breadcrumbs', crumbs === `All saves / ${segs.join(' / ')}`, crumbs);
    const crumbHrefs = await page.$$eval(`${crumbsSel} a`, (as) => as.map((a) => a.getAttribute('href')));
    const wantCrumbs = ['/saves', '/saves', ...segs.slice(1, -1).map((_, i) => route(segs.slice(0, i + 2).join('/')))];
    expect('deep link: breadcrumb targets', crumbHrefs.join(' ') === wantCrumbs.join(' '), crumbHrefs.join(' '));
    expect('deep link: file rows and header card', (await page.$$(fileRowsSel)).length === chain.folder.files.length && (await page.isVisible(cardSel)));
    const fileText = squash(await page.$eval(`main div:has(> a[aria-label="Download ${firstFile.name}"])`, (d) => d.innerText));
    expect('file row: name and size', fileText === `${firstFile.name} ${formatBytes(firstFile.bytes)}`, fileText);
    const fileRowH = (await box(page, `main div:has(> a[aria-label="Download ${firstFile.name}"])`))?.height ?? 0;
    expect('desktop folder view: file row is at most 38 px tall', fileRowH > 0 && fileRowH <= 38, `${fileRowH} px`);
    await shot(page, 'saves-folder-desktop');
    const bulkWant = `git lfs pull --include="${chain.folder.path}/**"`;
    const bulk = await page.innerText('main code');
    expect('bulk download command', bulk === bulkWant, bulk);

    // download links
    const nameSel = `main a[href$="/${encodeURIComponent(firstFile.name)}"]:not([aria-label])`;
    const nameHref = await page.getAttribute(nameSel, 'href');
    const nameText = await page.$eval(nameSel, (a) => a.textContent);
    expect('file name link text is the plain file name', nameText === firstFile.name, nameText);
    const iconHref = await page.getAttribute(`main a[aria-label="Download ${firstFile.name}"]`, 'href');
    expect('download href is <worker>/objects/<oid>/<name>, on the name and the icon', nameHref === firstFile.url && iconHref === firstFile.url, nameHref);
    const allHrefs = await page.$$eval(fileRowsSel, (as) => as.map((a) => a.href));
    expect('every download href matches the worker URL shape', allHrefs.length > 0 && allHrefs.every((h) => workerRe.test(h)), allHrefs.find((h) => !workerRe.test(h)));

    // copy buttons
    const copyBtn = `main button[aria-label="Copy download link for ${firstFile.name}"]`;
    const iconBefore = await page.$eval(`${copyBtn} svg path`, (p) => p.getAttribute('d'));
    await page.click(copyBtn);
    await page.waitForTimeout(150);
    expect('copy-link button puts the download URL on the clipboard', (await page.evaluate(() => navigator.clipboard.readText())) === firstFile.url);
    const iconAfter = await page.$eval(`${copyBtn} svg path`, (p) => p.getAttribute('d'));
    await page.waitForTimeout(2300);
    const iconLater = await page.$eval(`${copyBtn} svg path`, (p) => p.getAttribute('d'));
    expect('copy-link button swaps to a tick, then back', iconAfter !== iconBefore && iconLater === iconBefore);
    await page.click('main button[aria-label="Copy command"]');
    await page.waitForTimeout(150);
    expect('copy-command button copies the git lfs command', (await page.evaluate(() => navigator.clipboard.readText())) === bulkWant);

    // writeup and the benchmark's Save files tab
    const cur = curated;
    await goto(page, route(cur.source));
    await page.waitForSelector(crumbsSel);
    await page.click('main a:has-text("Read the writeup")');
    await page.waitForSelector('main h3, main h1');
    expect('"Read the writeup" lands on the benchmark page', (await where(page)) === `/benchmarks/${cur.slug}` && squash(await page.locator('main h1, main h2, main h3').first().innerText()) === cur.title, await where(page));
    await page.click('button[role="tab"]:has-text("Save files")');
    const tabHref = await page.getAttribute('main a:has-text("save browser")', 'href');
    const listed = await page.getAttribute(`main a[href="${cur.saves[0].url}"]`, 'href');
    expect('Save files tab still lists saves with their worker URLs', listed === cur.saves[0].url, listed);
    await page.click('main a:has-text("save browser")');
    await page.waitForSelector(crumbsSel);
    expect("Save files tab links to that benchmark's folder", tabHref === route(cur.source) && (await where(page)) === tabHref && (await page.isVisible(cardSel)), tabHref);

    // every curated benchmark with saves resolves in the browser
    const withSaves = index.benchmarks.filter((x) => x.saves.length);
    const bad = [];
    for (const b of withSaves) {
      await page.evaluate((to) => {
        history.pushState({}, '', to);
        dispatchEvent(new PopStateEvent('popstate'));
      }, route(b.source));
      const last = b.source.split('/').pop();
      const ok = await page
        .waitForFunction((seg) => document.querySelector('nav[aria-label="Folder path"] [aria-current="page"]')?.textContent === seg, last, { timeout: 3000 })
        .then(() => true, () => false);
      if (!ok) bad.push(b.source);
    }
    expect(`all ${withSaves.length} curated benchmarks with saves resolve in the save browser`, bad.length === 0, bad.join(', '));

    // search
    await goto(page, topRoute);
    await page.waitForSelector(crumbsSel);
    const hitsTerm = hits(term);
    await page.locator(search).pressSequentially(term, { delay: 20 });
    await page.waitForTimeout(100);
    const label = squash(await page.innerText('main [role="status"]'));
    expect(`search "${term}": count, size and label`, label === statusFor(term) && (await page.$$(fileRowsSel)).length === Math.min(hitsTerm.length, 100), `${label} vs ${statusFor(term)}`);
    expect('search is in the query string and keeps the folder in the path', (await where(page)) === `${topRoute}?q=${term}`, await where(page));
    expect('search hides the breadcrumbs and header card', !(await page.$(crumbsSel)) && !(await page.$(cardSel)));
    await page.focus(search);
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('XY');
    expect('typing mid-string keeps the caret position', (await page.inputValue(search)) === `${term[0]}XY${term.slice(1)}`, await page.inputValue(search));
    await page.fill(search, term);
    const hitDir = sortFiles(hitsTerm, 'name')[0].dir;
    await page.locator(`main a[href="${route(hitDir)}"]`).first().click();
    await page.waitForSelector(crumbsSel);
    expect('search result folder link opens that folder and clears the search', (await where(page)) === route(hitDir) && (await page.inputValue(search)) === '', await where(page));
    await page.fill(search, term);
    await page.click('button[aria-label="Clear search"]');
    expect('clear button drops ?q and shows the folder again', (await where(page)) === route(hitDir) && (await page.isVisible(crumbsSel)), await where(page));

    await goto(page, `/saves?q=${term}`);
    await page.waitForSelector(fileRowsSel);
    expect(`deep link /saves?q=${term}`, (await page.$$(fileRowsSel)).length === Math.min(hitsTerm.length, 100) && (await page.inputValue(search)) === term);
    const word = (curated.title.match(/[A-Za-z0-9]{3,}/) || ['zip'])[0];
    const multi = `${word.toUpperCase()}  ${term}`;
    await goto(page, `/saves?q=${encodeURIComponent(multi)}`);
    await page.waitForSelector('main [role="status"]');
    expect('multi-term search ANDs the terms, matches the benchmark title, ignores case', squash(await page.innerText('main [role="status"]')) === statusFor(multi), `${squash(await page.innerText('main [role="status"]'))} vs ${statusFor(multi)}`);
    await goto(page, '/saves?q=zip');
    await page.waitForSelector(fileRowsSel);
    const capped = squash(await page.innerText('main [role="status"]'));
    expect('search shows at most 100 rows and says so', (await page.$$(fileRowsSel)).length === Math.min(all.length, 100) && capped === statusFor('zip'), capped);
    await page.click('main button:has-text("Size")');
    const firstHit = await page.$eval(fileRowsSel, (a) => a.getAttribute('aria-label'));
    expect('search sort Size', (await where(page)) === '/saves?q=zip&sort=size' && firstHit === `Download ${sortFiles(all, 'size')[0].name}`, `${await where(page)} ${firstHit}`);
    await goto(page, '/saves?q=zzzznope');
    await page.waitForSelector('main [role="status"]');
    const emptyText = await page.innerText('main');
    expect('search empty state', emptyText.includes('Nothing matches “zzzznope”') && emptyText.includes('No saves match that search') && (await page.$$(fileRowsSel)).length === 0);

    // unknown paths
    await goto(page, `${topRoute}/nope/maps`);
    await page.waitForSelector('main a:has-text("Browse all saves")');
    expect('unknown path shows a not-found state', /folder not found/i.test(await page.innerText('main')));
    await page.click('main a:has-text("Browse all saves")');
    await page.waitForSelector(rowsSel);
    expect('"Browse all saves" goes back to /saves', (await where(page)) === '/saves');
    await goto(page, '/saves/nope');
    await page.waitForSelector('main a:has-text("Browse all saves")');
    expect('unknown top-level path is also not found', /folder not found/i.test(await page.innerText('main')));
    await goto(page, `${topRoute}/`);
    await page.waitForSelector(crumbsSel);
    expect('trailing slash is tolerated', await page.isVisible(cardSel));

    // GitHub Pages 404 shim
    await goto(page, '/?path=' + encodeURIComponent(`${chainRoute}?q=${term}`));
    await page.waitForSelector(fileRowsSel);
    expect('404 shim restores folder and ?q', (await where(page)) === `${chainRoute}?q=${term}` && (await page.$$(fileRowsSel)).length === Math.min(hitsTerm.length, 100), await where(page));

    // a top-level folder that is not a curated benchmark
    const plain = tops.find((t) => !meta[t.path]?.title);
    if (plain) {
      await goto(page, route(plain.path));
      await page.waitForSelector(crumbsSel);
      const plainCard = squash(await page.innerText(cardSel)).toLowerCase();
      expect('uncurated folder: card without the writeup button', plainCard.includes(plain.name.toLowerCase()) && plainCard.includes('view on github') && !plainCard.includes('read the writeup') && plainCard.includes(`${saveCount(plain.count)} · ${formatBytes(plain.bytes)}`.toLowerCase()), plainCard);
    } else {
      expect('uncurated folder: card without the writeup button', true, 'every top-level folder is curated (skipped)');
    }

    // ---------- phone ----------
    const deepest = all.reduce((a, f) => (f.dir.split('/').length > a.dir.split('/').length ? f : a), all[0]).dir;
    const phone = await open('/saves', 'phone');
    for (const url of [topRoute, chainRoute, `/saves?q=${term}`, route(deepest), '/saves/nope/x']) {
      await goto(phone, url);
      await phone.waitForTimeout(100);
    }
    await goto(phone, chainRoute);
    await phone.waitForSelector(fileRowsSel);
    expect('phone: copy-link button hidden, download button visible', !(await phone.isVisible('main button[aria-label^="Copy download link"]')) && (await phone.isVisible(`main a[aria-label="Download ${firstFile.name}"]`)));
    const t = squash(await phone.$eval(`main div:has(> a[aria-label="Download ${firstFile.name}"])`, (d) => d.innerText));
    expect('phone: size folds under the file name', t === `${firstFile.name} ${formatBytes(firstFile.bytes)}`, t);
    const dl = await box(phone, `main a[aria-label="Download ${firstFile.name}"]`);
    expect('phone: download button is at least 44 × 44 px', Boolean(dl) && dl.width >= 44 && dl.height >= 44, JSON.stringify(dl));
    await shot(phone, 'saves-folder-phone');
    expect('phone: search placeholder is the short one', (await phone.getAttribute(search, 'placeholder')) === 'Search saves');
    await phone.click('button[aria-label="Open menu"]');
    await phone.click('.MuiDrawer-root a[href="/saves"]');
    await phone.waitForSelector(rowsSel);
    expect('phone: the menu has Saves and it navigates to /saves', (await where(phone)) === '/saves');
    const phoneRow = squash(await phone.$eval(`main a[href="${topRoute}"]`, (a) => a.innerText));
    const phoneWant = squash([topTitle, [topMeta.benchmark_date, topMeta.factorio_version && `Factorio ${topMeta.factorio_version}`].filter(Boolean).join(' · '), formatBytes(top.bytes), saveCount(top.count)].join(' '));
    await shot(phone, 'saves-landing-phone');
    expect('phone: landing row folds its metadata', phoneRow === phoneWant, `${phoneRow} vs ${phoneWant}`);
  },
};
