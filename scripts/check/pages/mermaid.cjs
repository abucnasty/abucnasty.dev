// ```mermaid code blocks drawn as diagrams, on a wiki page (the Arch page's diagrams in
// fixtures/wiki.cjs) and in a blog post (the hidden post in fixtures/blog.cjs): they draw, wide
// ones scroll inside their box on a phone, a broken one falls back to its code, hostile ones run
// nothing, and pages without a diagram do not download mermaid.
const { MERMAID } = require('../fixtures/wiki.cjs');

const MERMAID_CHUNK = /\/assets\/mermaid-[\w-]+\.js$/;

/** Waits until no diagram on the page is still loading; each diagram's state and what it shows. */
async function diagrams(page) {
  await page.waitForFunction(() => document.querySelectorAll('main .mermaid-diagram').length > 0 && !document.querySelector('main .mermaid-diagram[data-mermaid="loading"]'), null, { timeout: 15000 }).catch(() => {});
  return page.$$eval('main .mermaid-diagram', (els) =>
    els.map((el) => {
      const svg = el.querySelector('svg');
      const box = svg?.parentElement;
      return {
        state: el.getAttribute('data-mermaid'),
        svg: !!svg,
        code: el.querySelector('pre code.language-mermaid')?.textContent ?? null,
        note: el.innerText.includes("Couldn't draw this diagram"),
        text: svg?.textContent ?? '',
        boxWidth: box ? box.clientWidth : 0,
        scrollWidth: box ? box.scrollWidth : 0,
      };
    }),
  );
}

module.exports = {
  name: 'mermaid',
  async run({ open, expect, shot, requests }) {
    // Pages without a diagram do not download mermaid.
    for (const url of ['/wiki/how-to-benchmark', '/blog/fps-limit-impact-on-factorio-ups']) {
      const page = await open(url, 'desktop');
      await page.waitForTimeout(300);
      expect(`${url} (no diagram) does not load mermaid`, !requests(page).some((u) => MERMAID_CHUNK.test(u)), requests(page).filter((u) => /mermaid/i.test(u)).join(', '));
    }

    for (const viewport of ['desktop', 'phone']) {
      const page = await open('/wiki/setting-up-arch-to-run-factorio', viewport);
      const found = await diagrams(page);
      await shot(page, `mermaid-wiki-${viewport}`);
      expect(`${viewport}: the wiki page loads mermaid`, requests(page).some((u) => MERMAID_CHUNK.test(u)));
      expect(`${viewport}: every mermaid block on the page is handled`, found.length === MERMAID.length, JSON.stringify(found.map((d) => d.state)));
      const [fits, wide, broken] = found;
      expect(`${viewport}: a flowchart draws as an SVG with its labels`, fits?.state === 'drawn' && fits.svg && fits.text.includes('Save file') && fits.code === null, JSON.stringify(fits));
      expect(`${viewport}: a wide flowchart draws`, wide?.state === 'drawn' && wide.svg, JSON.stringify(wide));
      if (viewport === 'phone') {
        expect('phone: a wide diagram scrolls inside its box', wide && wide.scrollWidth > wide.boxWidth, JSON.stringify(wide));
      } else {
        expect('desktop: a diagram fits the content width', fits && fits.scrollWidth <= fits.boxWidth, JSON.stringify(fits));
      }
      expect(
        `${viewport}: a diagram with a syntax error shows its code and "Couldn't draw this diagram"`,
        broken?.state === 'failed' && !broken.svg && broken.note && broken.code === `${MERMAID[2]}\n`,
        JSON.stringify(broken),
      );
      const unsafe = await page.evaluate(() => ({
        pwned: window.__pwned ?? null,
        scripts: document.querySelectorAll('main script, body > script:not([type="module"])').length,
        iframes: document.querySelectorAll('main iframe').length,
        handlers: [...document.querySelectorAll('main *')].filter((el) => [...el.attributes].some((a) => a.name.toLowerCase().startsWith('on'))).length,
        js: [...document.querySelectorAll('main [href], main [*|href]')].filter((el) => /^\s*javascript:/i.test(el.getAttribute('href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '')).length,
        foreign: document.querySelectorAll('main foreignObject').length,
        leftovers: document.querySelectorAll('body > [id^="dmermaid"], body > [id^="imermaid"]').length,
      }));
      expect(
        `${viewport}: hostile diagrams (<script>, onerror, javascript: and click links, an init directive) run nothing`,
        unsafe.pwned === null && unsafe.scripts === 0 && unsafe.iframes === 0 && unsafe.handlers === 0 && unsafe.js === 0 && unsafe.foreign === 0 && unsafe.leftovers === 0,
        JSON.stringify(unsafe),
      );
      // Clicking the hostile nodes does nothing either.
      for (const node of await page.$$('main .mermaid-diagram svg .node')) await node.click({ force: true }).catch(() => {});
      await page.waitForTimeout(200);
      expect(`${viewport}: clicking the hostile diagrams' nodes runs nothing`, (await page.evaluate(() => window.__pwned ?? null)) === null && new URL(page.url()).pathname === '/wiki/setting-up-arch-to-run-factorio', page.url());
    }

    const post = await open('/blog/hidden-post', 'phone');
    const [seq] = await diagrams(post);
    await shot(post, 'mermaid-blog-phone');
    expect('a blog post draws its sequence diagram', seq?.state === 'drawn' && seq.svg && seq.text.includes('Limit FPS to 60'), JSON.stringify(seq));
  },
};
