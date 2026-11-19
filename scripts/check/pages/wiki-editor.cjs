// The wiki editor, against the wiki API stand-in (fixtures/wiki-api.cjs): readers never download
// it; an editor opens it in place of the page (visual mode first), types, links a page with `[[`,
// pastes an image, switches modes, and saves (the request is checked: path, base blob, frontmatter
// as loaded, body, image); a conflict keeps the text with "Copy my text"; switching modes without
// changes keeps the text exactly; a new page from /wiki/all; phones.
const { FRONTMATTER } = require('../fixtures/wiki-api.cjs');

const EDITOR_CHUNK = /\/assets\/(WikiEditor|MarkdownEditor)-[^/]*\.js$/;

/** Paste a small PNG (drawn in the page) into the focused editor. */
async function pasteImage(page, selector) {
  await page.evaluate(async (sel) => {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 30;
    const g = canvas.getContext('2d');
    g.fillStyle = '#fca300';
    g.fillRect(0, 0, 40, 30);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'Screenshot 2026.png', { type: 'image/png' }));
    const target = document.querySelector(sel);
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, selector);
}

/** Put the cursor at the end of the editor's last paragraph. */
async function toEnd(pm, page) {
  await pm.locator(':scope > p').last().click();
  await page.keyboard.press('End');
}

const markdownText = (page) => page.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map((l) => l.textContent).join('\n'));

module.exports = {
  name: 'wiki-editor',
  async run({ open, goto, expect, shot, requests, wikiApiCalls }) {
    const main = (page) => page.locator('main');

    // Readers: no Edit button and no editor code, signed out or not editing.
    const reader = await open('/wiki/how-to-benchmark', 'desktop');
    expect('signed out: no Edit button', (await main(reader).locator('[data-wiki-edit]').count()) === 0);
    expect('signed out: the editor code is never downloaded', !requests(reader).some((u) => EDITOR_CHUNK.test(u)), requests(reader).filter((u) => /assets/.test(u)).join(' '));

    const page = await open('/wiki/how-to-benchmark', 'desktop', { wiki: 'editor' });
    const edit = main(page).locator('[data-wiki-edit]');
    await edit.waitFor({ timeout: 5000 }).catch(() => {});
    expect('editor: an Edit button on the page', (await edit.count()) === 1);
    expect('editor, reading: the editor code is not downloaded yet', !requests(page).some((u) => EDITOR_CHUNK.test(u)));

    // Edit: the visual editor in place of the page, showing the page's own pieces.
    await edit.click();
    const pm = page.locator('[data-wiki-visual-editor] .ProseMirror');
    await pm.waitFor({ timeout: 10000 }).catch(() => {});
    expect('Edit opens the visual editor (the first time)', (await pm.count()) === 1 && (await page.locator('[data-wiki-editor]').getAttribute('data-mode')) === 'visual');
    expect('only the visual editor chunk is loaded, not CodeMirror', requests(page).some((u) => /WikiEditor-/.test(u)) && !requests(page).some((u) => /MarkdownEditor-/.test(u)));
    expect('the source was read from the API', wikiApiCalls(page).includes('GET source'), wikiApiCalls(page).join(', '));
    const pmText = await pm.innerText();
    expect('the page shows as the page: headings, table, callout marker, wiki link', pmText.includes('Prerequisites') && (await pm.locator('table').count()) === 1 && (await pm.locator('.callout-marker').count()) === 1 && (await pm.locator('.wiki-link-node').count()) >= 1, pmText.slice(0, 200));
    expect('frontmatter is not shown', !pmText.includes('aliases'));
    await shot(page, 'wiki-editor-visual-desktop');

    // Type at the end, link a page with [[, paste an image.
    await toEnd(pm, page);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Added by the check, with **bold** and a link to ');
    await page.keyboard.type('[[');
    const picker = page.locator('[data-wiki-page-picker] input');
    await picker.waitFor({ timeout: 5000 }).catch(() => {});
    expect('[[ opens the page picker', (await picker.count()) === 1);
    await picker.fill('Setting Up');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.locator('[data-wiki-page-picker]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    expect('the picked page is a wiki link in the text', (await pm.locator('.wiki-link-node[data-value="Setting Up Arch to Run Factorio"]').count()) === 1);
    expect('markdown typed in visual mode converts as you type (**bold**)', (await pm.locator('strong', { hasText: 'bold' }).count()) >= 1);
    await pasteImage(page, '[data-wiki-visual-editor] .ProseMirror');
    const img = pm.locator('img.wiki-embed-image[src^="blob:"]');
    await img.waitFor({ timeout: 5000 }).catch(() => {});
    const imgName = await img.getAttribute('data-value').catch(() => null);
    expect('a pasted image is converted to WebP, named by its content and shown', !!imgName && /^Screenshot-2026-[0-9a-f]{8}\.webp$/.test(imgName), imgName);

    // Markdown mode shows the same page as markdown, Obsidian syntax intact.
    await page.getByRole('button', { name: 'Markdown' }).click();
    await page.locator('.cm-content').waitFor({ timeout: 10000 }).catch(() => {});
    const md = await markdownText(page);
    expect(
      'markdown mode: the edit as markdown, with [[link]], ![[image]] and the callout as written',
      md.includes('Added by the check, with **bold** and a link to [[Setting Up Arch to Run Factorio]]') && md.includes(`![[${imgName}]]`) && md.includes('> [!warning] Close other programs') && !md.includes('aliases'),
      md.slice(-400),
    );
    await shot(page, 'wiki-editor-markdown-desktop');
    await page.getByRole('button', { name: 'Visual' }).click();
    await pm.waitFor({ timeout: 10000 }).catch(() => {});
    expect('back to visual mode keeps the edit', (await pm.innerText()).includes('Added by the check'));

    // Save, with a summary: the request carries what the step needs.
    await page.locator('[data-wiki-summary]').fill('Check the editor');
    await page.locator('[data-wiki-save]').click();
    await page.locator('[data-wiki-saved]').waitFor({ timeout: 5000 }).catch(() => {});
    const saves = wikiApiCalls(page).saves;
    const sent = saves[saves.length - 1];
    const meta = sent?.meta ?? {};
    expect('save: one same-origin multipart POST', saves.length === 1 && /multipart\/form-data/.test(sent.headers['content-type']), JSON.stringify(sent?.headers));
    expect('save: the page path, the blob it started from and the frontmatter as loaded', meta.path === 'wiki/Guides/How to Benchmark.md' && meta.base === 'b'.repeat(40) && meta.frontmatter === FRONTMATTER && meta.draft === false && meta.summary === 'Check the editor', JSON.stringify({ ...meta, body: undefined }));
    expect('save: the body has the edit, the wiki link and the image', typeof meta.body === 'string' && meta.body.includes('[[Setting Up Arch to Run Factorio]]') && meta.body.includes(`![[${imgName}]]`) && meta.body.includes('> [!warning] Close other programs'), meta.body && meta.body.slice(-300));
    const part = sent?.parts[`image:${imgName}`];
    expect('save: the image goes with it, as WebP', !!part && part.head.startsWith('RIFF') && part.text.slice(8, 12) === 'WEBP', part && part.head);
    const savedText = await main(page).innerText();
    const savedImg = main(page).locator('img[src^="/api/wiki/image/"]');
    await savedImg.waitFor({ timeout: 5000 }).catch(() => {});
    expect('after saving: the new image shows (from the Worker until the vault publishes it)', (await savedImg.evaluate((i) => i.complete && i.naturalWidth > 0).catch(() => false)) === true);
    expect('after saving: "Saved", the site updates in about a minute, and the saved version shows', /Saved\. The site updates in about a minute/.test(savedText) && savedText.includes('Added by the check') && (await page.locator('[data-wiki-editor]').count()) === 0, savedText.slice(0, 300));
    await shot(page, 'wiki-editor-saved-desktop');

    // Switching modes without changing anything keeps the text exactly; only the draft switch changes.
    const same = await open('/wiki/how-to-benchmark', 'desktop', { wiki: 'editor' });
    await main(same).locator('[data-wiki-edit]').click();
    await same.locator('[data-wiki-visual-editor] .ProseMirror').waitFor({ timeout: 10000 }).catch(() => {});
    await same.getByRole('button', { name: 'Markdown' }).click();
    await same.locator('.cm-content').waitFor({ timeout: 10000 }).catch(() => {});
    await same.getByRole('button', { name: 'Visual' }).click();
    await same.locator('[data-wiki-visual-editor] .ProseMirror').waitFor({ timeout: 10000 }).catch(() => {});
    await same.locator('[data-wiki-draft-switch]').click();
    expect('the draft note shows when Draft is on', (await same.locator('#wiki-draft-note').innerText()).includes('Drafts are hidden on the site but visible in the public vault on GitHub.'));
    await same.locator('[data-wiki-save]').click();
    await same.locator('[data-wiki-saved]').waitFor({ timeout: 5000 }).catch(() => {});
    const sameSave = wikiApiCalls(same).saves[0]?.meta;
    const fixtureBody = await same.evaluate(() => fetch('https://vault.abucnasty.dev/wiki/how-to-benchmark.md').then((r) => r.text()));
    expect('no edits, two mode switches: the body is sent exactly as loaded, as a draft', sameSave && sameSave.body === fixtureBody && sameSave.draft === true, sameSave && JSON.stringify(sameSave.body.slice(0, 120)));
    expect('a draft save says so', /Saved as a draft/.test(await main(same).innerText()));

    // The mode is remembered on this device.
    await main(same).locator('[data-wiki-edit]').click();
    await same.locator('[data-wiki-editor]').waitFor({ timeout: 10000 }).catch(() => {});
    expect('the next edit opens in the last mode used (visual)', (await same.locator('[data-wiki-editor]').getAttribute('data-mode')) === 'visual');

    // A conflict: the text stays, with the reason and "Copy my text".
    const conflict = await open('/wiki/how-to-benchmark', 'desktop', { wiki: 'editor' });
    await main(conflict).locator('[data-wiki-edit]').click();
    const cpm = conflict.locator('[data-wiki-visual-editor] .ProseMirror');
    await cpm.waitFor({ timeout: 10000 }).catch(() => {});
    await toEnd(cpm, conflict);
    await conflict.keyboard.type(' Conflicting words.');
    await conflict.locator('[data-wiki-summary]').fill('force conflict');
    await conflict.locator('[data-wiki-save]').click();
    const err = conflict.locator('[data-wiki-save-error="conflict"]');
    await err.waitFor({ timeout: 5000 }).catch(() => {});
    expect('409: "changed since you opened it", text kept, "Copy my text"', /changed since you opened it/.test(await err.innerText().catch(() => '')) && (await cpm.innerText()).includes('Conflicting words.') && (await err.getByRole('button', { name: 'Copy my text' }).count()) === 1);
    await err.getByRole('button', { name: 'Copy my text' }).click();
    const clip = await conflict.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    expect('"Copy my text" copies the page as markdown', clip.includes('Conflicting words.') && clip.includes('[!warning]'), clip.slice(-100));
    await shot(conflict, 'wiki-editor-conflict-desktop');

    // A new page from /wiki/all.
    const all = await open('/wiki/all', 'desktop', { wiki: 'editor' });
    await main(all).locator('[data-wiki-new]').click();
    const title = all.locator('[data-wiki-new-title]');
    await title.waitFor({ timeout: 5000 }).catch(() => {});
    await title.fill('how to benchmark');
    expect('new page: a taken title is refused', (await all.locator('[data-wiki-new-create]').isDisabled()) && /already a page/.test(await all.locator('[data-wiki-new-page]').innerText()));
    await title.fill('Check Page');
    await all.locator('[data-wiki-new-create]').click();
    const npm = all.locator('[data-wiki-visual-editor] .ProseMirror');
    await npm.waitFor({ timeout: 10000 }).catch(() => {});
    expect('new page: the editor opens at its address', new URL(all.url()).pathname === '/wiki/check-page' && (await npm.count()) === 1);
    await npm.click();
    await all.keyboard.type('A brand new page.');
    await all.locator('[data-wiki-save]').click();
    await all.locator('[data-wiki-saved]').waitFor({ timeout: 5000 }).catch(() => {});
    const created = wikiApiCalls(all).saves[0]?.meta;
    expect('new page: saved with its title and the top-level folder, from no blob', created && created.create && created.create.title === 'Check Page' && created.create.folder === '' && created.base === null && created.body.trim() === 'A brand new page.', JSON.stringify(created));
    expect('new page: shown at once after saving', (await main(all).innerText()).includes('A brand new page.'));

    // A missing page offers to create it.
    await goto(all, '/wiki/a-page-nobody-wrote');
    expect('a missing page offers "Create this page" to editors', (await main(all).locator('[data-wiki-create-missing]').count()) === 1);

    // Phones: the editor fits and types.
    const phone = await open('/wiki/how-to-benchmark', 'phone', { wiki: 'editor' });
    await main(phone).locator('[data-wiki-edit]').click();
    const ppm = phone.locator('[data-wiki-visual-editor] .ProseMirror');
    await ppm.waitFor({ timeout: 10000 }).catch(() => {});
    await toEnd(ppm, phone);
    await phone.keyboard.type(' Typed on a phone.');
    const over = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect('phone: the editor types and has no sideways scroll', (await ppm.innerText()).includes('Typed on a phone.') && over <= 0, `overflow ${over}px`);
    await shot(phone, 'wiki-editor-visual-phone');
  },
};
