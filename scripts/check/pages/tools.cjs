// The tool and tutorial links live in src/data/tools.ts. Read that file as text and
// take every `url:` value, so the check follows the data without importing TypeScript.
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', '..', 'src', 'data', 'tools.ts');

function dataUrls() {
  const text = fs.readFileSync(DATA, 'utf8');
  const urls = [];
  for (const m of text.matchAll(/url:\s*'([^']+)'/g)) urls.push(m[1]);
  return urls;
}

module.exports = {
  name: 'tools',
  async run({ open, expect, aboveFold, shot }) {
    const expected = dataUrls();
    const expectedSet = new Set(expected);
    // Entries (tools, utilities, mods) plus tutorials, from the same file.
    const entryCount = (fs.readFileSync(DATA, 'utf8').match(/^\s+name: '/gm) || []).length;
    const tutorialCount = (fs.readFileSync(DATA, 'utf8').match(/^\s+kind: '(guide|video)',/gm) || []).length;
    const rowsExpected = entryCount + tutorialCount;

    for (const viewport of ['desktop', 'phone']) {
      const page = await open('/tools', viewport);
      await shot(page, `tools-${viewport}`);

      const title = await page.locator('main h1, main h2, main h3').first().textContent();
      expect(`${viewport}: page has a title`, title && title.trim() === 'Tools', title);

      const hrefs = await page.$$eval('main a[href^="http"]', (as) => as.map((a) => a.getAttribute('href')));
      const pageSet = new Set(hrefs);
      const missing = [...expectedSet].filter((u) => !pageSet.has(u));
      const extra = [...pageSet].filter((u) => !expectedSet.has(u));
      expect(`${viewport}: outbound links equal the set in src/data/tools.ts`, missing.length === 0 && extra.length === 0,
        `missing: ${JSON.stringify(missing)} extra: ${JSON.stringify(extra)}`);
      expect(`${viewport}: outbound links open in a new tab`, (await page.locator('main a[href^="http"]:not([target="_blank"])').count()) === 0);

      if (viewport === 'desktop') {
        const rows = await page.locator('[data-row]').count();
        const visible = await aboveFold(page, '[data-row]');
        expect(`desktop: row count equals entries + tutorials (${rowsExpected})`, rows === rowsExpected, `rows=${rows}`);
        expect(`desktop: every row is above the fold (${visible} of ${rows})`, visible === rows, `${visible}/${rows}`);
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        expect(`desktop: page height is at most one window (${height} px)`, height <= 800, `${height}px`);
      } else {
        const buttons = await page.$$eval('main a.MuiButton-root[target="_blank"]', (els) =>
          els.map((e) => {
            const r = e.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height), label: e.getAttribute('aria-label') };
          }),
        );
        const small = buttons.filter((b) => b.w < 44 || b.h < 44);
        expect(`phone: every link button is at least 44 px in both directions (${buttons.length} buttons)`,
          buttons.length > 0 && small.length === 0, JSON.stringify(small));

        const offCentre = await page.$$eval('main a.MuiButton-root[target="_blank"]', (els) =>
          els.map((e) => {
            const icon = e.querySelector('.MuiButton-startIcon');
            if (!icon) return { label: e.getAttribute('aria-label'), dx: null };
            const b = e.getBoundingClientRect();
            const i = icon.getBoundingClientRect();
            return { label: e.getAttribute('aria-label'), dx: +(i.left + i.width / 2 - (b.left + b.width / 2)).toFixed(2) };
          }),
        );
        const bad = offCentre.filter((o) => o.dx === null || Math.abs(o.dx) > 1);
        expect(`phone: every link icon is centred in its button (${offCentre.length} buttons)`,
          offCentre.length > 0 && bad.length === 0, JSON.stringify(bad));
      }
    }
  },
};
