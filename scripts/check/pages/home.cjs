const fs = require('fs');
const path = require('path');

// The registry is TypeScript: read slug and date out of the file rather than import it.
function registryPosts() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'blog', 'registry.ts'), 'utf8');
  const slugs = [...src.matchAll(/\bslug:\s*(['"])([^'"]+)\1/g)].map((m) => m[2]);
  const dates = [...src.matchAll(/\bdate:\s*(['"])(\d{4}-\d{2}-\d{2})\1/g)].map((m) => m[2]);
  return slugs.map((slug, i) => ({ slug, date: dates[i] }));
}

module.exports = {
  name: 'home',
  async run({ open, expect, shot, box, aboveFold, data }) {
    const posts = registryPosts();
    const items = [
      ...data.index.benchmarks.filter((b) => b.date).map((b) => ({ to: `/benchmarks/${b.slug}`, date: b.date })),
      ...posts.map((p) => ({ to: `/blog/${p.slug}`, date: p.date })),
    ];
    const newest = items.reduce((a, b) => (b.date > a.date ? b : a));
    const newestDate = newest.date;
    const newestTos = items.filter((i) => i.date === newestDate).map((i) => i.to);
    const newestWithFinding = data.index.benchmarks
      .filter((b) => b.date && b.finding)
      .reduce((a, b) => (!a || b.date > a.date ? b : a), null);

    for (const viewport of ['desktop', 'phone']) {
      const phone = viewport === 'phone';
      const page = await open('/', viewport);
      await shot(page, `home-${viewport}`);
      expect(`${viewport}: renders a heading`, (await page.locator('main h1').count()) === 1);
      expect(`${viewport}: links to at least one benchmark page`, (await page.locator('main a[href^="/benchmarks/"]').count()) > 0);

      const strip = await box(page, '[data-home-strip]');
      const max = phone ? 200 : 90;
      expect(`${viewport}: identity strip is at most ${max}px tall`, !!strip && strip.height <= max, `${strip && strip.height}px`);

      const firstHref = await page.locator('main [data-row]').first().getAttribute('href');
      expect(`${viewport}: first Latest row is the newest dated item`, newestTos.includes(firstHref), `${firstHref}, newest ${newestTos.join(', ')}`);

      const findingRow = page.locator(`main [data-row][href="/benchmarks/${newestWithFinding.slug}"]`);
      const findingRows = await findingRow.count();
      const lines = findingRows === 1 ? (await findingRow.innerText()).split('\n').map((s) => s.trim()).filter(Boolean) : [];
      const second = lines[lines.indexOf(newestWithFinding.title) + 1] ?? '';
      expect(
        `${viewport}: newest benchmark with a finding shows it on its row's second line`,
        findingRows === 1 && second.startsWith(newestWithFinding.finding.slice(0, 30)),
        `${findingRows} rows, second line: "${second}"`,
      );

      const topicLinks = page.locator('main a[href^="/benchmarks?topic="]');
      expect(
        `${viewport}: one topic chip per topic`,
        (await topicLinks.count()) === data.index.topics.length,
        `${await topicLinks.count()} chips, ${data.index.topics.length} topics`,
      );
      for (const t of data.index.topics) {
        const chip = page.locator(`main a[href="/benchmarks?topic=${t.id}"]`);
        const n = await chip.count();
        const text = n === 1 ? (await chip.innerText()).trim() : '';
        expect(
          `${viewport}: topic chip "${t.id}" links to its benchmarks and shows its count`,
          n === 1 && text.startsWith(t.label) && text.endsWith(String(t.count)),
          `${n} links, text "${text}"`,
        );
      }
      if (data.index.topics.length > 0) {
        const lastChip = await topicLinks.last().boundingBox();
        const alsoHere = await page.locator('main a[href="/blueprints"]').first().boundingBox();
        expect(
          `${viewport}: topic chips sit above "Also here"`,
          !!lastChip && !!alsoHere && lastChip.y + lastChip.height <= alsoHere.y,
          `chips bottom ${lastChip && Math.round(lastChip.y + lastChip.height)}, Also here ${alsoHere && Math.round(alsoHere.y)}`,
        );
      }

      const firstRow = await box(page, 'main [data-row]');
      const vh = phone ? 844 : 800;
      if (phone) {
        expect('phone: first Latest row starts above the fold', !!firstRow && firstRow.y < vh, `y=${firstRow && firstRow.y}`);
      } else {
        const n = await aboveFold(page, 'main a[href^="/benchmarks/"]');
        expect('desktop: at least 6 benchmark links above the fold', n >= 6, `${n} links`);
        for (const to of ['/blueprints', '/saves', '/tools', '/blog', '/about']) {
          const k = await aboveFold(page, `main a[href="${to}"]`);
          expect(`desktop: link to ${to} above the fold`, k >= 1, `${k} links`);
        }
        const saves = await page.locator('main a[href="/saves"]').first().innerText();
        expect('desktop: Save files row shows the save count', saves.includes(`${data.index.saveStats.count} saves`), saves.replace(/\n/g, ' | '));
        // The blueprint count comes from the live catalog (the fixture here): listed, not deprecated.
        const activeBlueprints = data.catalog.blueprints.filter((e) => e.status !== 'unlisted' && !e.deprecated).length;
        const bpRow = page.locator('main a[href="/blueprints"]').first();
        await page.waitForFunction((n) => document.querySelector('main a[href="/blueprints"]')?.textContent.includes(`${n} active blueprints`), activeBlueprints, { timeout: 5000 }).catch(() => {});
        const bpText = await bpRow.innerText();
        expect('desktop: Blueprints row shows the live count of active blueprints', bpText.includes(`${activeBlueprints} active blueprints`), bpText.replace(/\n/g, ' | '));
      }
    }

    // Tablet widths keep the natural order: avatar, text, social links at the right.
    const tablet = await open('/', 'desktop');
    for (const width of [768, 900]) {
      await tablet.setViewportSize({ width, height: 800 });
      const m = await tablet.evaluate(() => {
        const strip = document.querySelector('[data-home-strip]');
        const [, text, links] = strip.children;
        return { h: Math.round(strip.getBoundingClientRect().height), text: Math.round(text.getBoundingClientRect().width), textLeft: text.getBoundingClientRect().left, linksLeft: links.getBoundingClientRect().left };
      });
      expect(`${width}px: the text block is left of the social links`, m.textLeft < m.linksLeft, JSON.stringify(m));
      expect(`${width}px: the identity strip is at most 90px tall`, m.h <= 90, JSON.stringify(m));
      expect(`${width}px: the strip's text block is at least 280px wide`, m.text >= 280, JSON.stringify(m));
      if (width === 768) await shot(tablet, 'home-768');
    }
  },
};
