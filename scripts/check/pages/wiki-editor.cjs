// The wiki editor, against the wiki API stand-in (fixtures/wiki-api.cjs): readers never download
// it; an editor opens it in place of the page (visual mode first), types, links a page with `[[`,
// pastes an image, switches modes, and saves (the request is checked: path, base blob, frontmatter
// as loaded, body, image); a conflict keeps the text with "Copy my text"; switching modes without
// changes keeps the text exactly; links edited, added and removed in visual mode; a new page from
// /wiki/all, and one in a new folder; ```mermaid blocks drawn live in visual mode; phones.
const { FRONTMATTER } = require('../fixtures/wiki-api.cjs');
const { MERMAID } = require('../fixtures/wiki.cjs');

const EDITOR_CHUNK = /\/assets\/(WikiEditor|MarkdownEditor)-[^/]*\.js$/;
const MERMAID_CHUNK = /\/assets\/mermaid-[\w-]+\.js$/;

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

    // Links in visual mode: a click places the cursor (never follows the link); the Link button edits
    // the link at the cursor (its address and text shown), links a selection, and removes a link.
    const lp = await open('/wiki/how-to-benchmark', 'desktop', { wiki: 'editor' });
    await main(lp).locator('[data-wiki-edit]').click();
    const lpm = lp.locator('[data-wiki-visual-editor] .ProseMirror');
    await lpm.waitFor({ timeout: 10000 }).catch(() => {});
    const before = lp.url();
    await lpm.locator('a', { hasText: 'Do not click' }).click({ position: { x: 20, y: 5 } });
    await lp.waitForTimeout(300);
    const inLink = await lp.evaluate(() => !!window.getSelection()?.anchorNode?.parentElement?.closest('.ProseMirror a'));
    expect('a click on a link in the editor stays in the editor, with the cursor in the link', lp.url() === before && (await lp.locator('[data-wiki-editor]').count()) === 1 && inLink);
    const linkButton = lp.getByRole('button', { name: 'Link', exact: true });
    await linkButton.click();
    const dialog = lp.locator('[data-wiki-link-dialog="link"]');
    // Closed, after its fade.
    const dialogGone = () => lp.locator('.MuiDialog-root').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    await dialog.waitFor({ timeout: 5000 }).catch(() => {});
    const shownUrl = await dialog.locator('[data-wiki-link-url]').inputValue().catch(() => null);
    const shownText = await dialog.locator('[data-wiki-link-text]').inputValue().catch(() => null);
    expect('Link in a link: the dialog shows its address and text, with "Remove link"', shownUrl === 'javascript:alert(1)' && shownText === 'Do not click' && (await dialog.locator('[data-wiki-link-remove]').count()) === 1, JSON.stringify({ shownUrl, shownText }));
    await dialog.locator('[data-wiki-link-url]').fill('https://example.com/new');
    await dialog.locator('[data-wiki-link-done]').click();
    await dialogGone();
    expect('the edited link keeps its text and gets the new address', (await lpm.locator('a[href="https://example.com/new"]', { hasText: 'Do not click' }).count()) === 1 && (await lpm.locator('a', { hasText: 'Do not click' }).count()) === 1);
    // After the dialog, a click still moves the cursor: Enter and typing land at the end.
    await toEnd(lpm, lp);
    await lp.keyboard.press('Enter');
    await lp.keyboard.type('Linked then unlinked');
    expect('after the dialog, clicks move the cursor (the new paragraph is the last)', ((await lpm.locator(':scope > p').last().innerText()) === 'Linked then unlinked'));
    // A selection without a link gets one; then Remove link takes it off again, keeping the text.
    await lp.keyboard.press('Shift+Home');
    await linkButton.click();
    await dialog.waitFor({ timeout: 5000 }).catch(() => {});
    expect('Link on a selection: an empty address, no text field', (await dialog.locator('[data-wiki-link-url]').inputValue()) === '' && (await dialog.locator('[data-wiki-link-text]').count()) === 0);
    await dialog.locator('[data-wiki-link-url]').fill('https://example.com/remove');
    await dialog.locator('[data-wiki-link-done]').click();
    await dialogGone();
    const added = lpm.locator('a[href="https://example.com/remove"]');
    expect('the selection is linked', (await added.innerText().catch(() => '')) === 'Linked then unlinked');
    await added.click({ position: { x: 30, y: 5 } });
    await linkButton.click();
    await dialog.waitFor({ timeout: 5000 }).catch(() => {});
    await dialog.locator('[data-wiki-link-remove]').click();
    await dialogGone();
    expect('Remove link leaves the text', (await added.count()) === 0 && (await lpm.innerText()).includes('Linked then unlinked'));
    // A selected wiki link: Link opens the page picker on it; Escape leaves it as it was.
    const wikiNode = lpm.locator('.wiki-link-node').last();
    const wikiValue = await wikiNode.getAttribute('data-value');
    await wikiNode.click();
    await linkButton.click();
    const lpicker = lp.locator('[data-wiki-page-picker] input');
    await lpicker.waitFor({ timeout: 5000 }).catch(() => {});
    expect('Link on a wiki link opens the page picker with its value', (await lpicker.inputValue().catch(() => null)) === wikiValue, wikiValue);
    await lp.keyboard.press('Escape');
    await lp.locator('[data-wiki-page-picker]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    expect('cancelled: the wiki link is unchanged', (await lpm.locator(`.wiki-link-node[data-value="${wikiValue}"]`).count()) === 1 && !(await lpm.innerText()).includes('[['));
    await lp.locator('[data-wiki-summary]').fill('Edit a link');
    await lp.locator('[data-wiki-save]').click();
    await lp.locator('[data-wiki-saved]').waitFor({ timeout: 5000 }).catch(() => {});
    const linkBody = wikiApiCalls(lp).saves[0]?.meta?.body ?? '';
    expect(
      'save: the edited link has the new address and the same text; the removed link is plain text',
      linkBody.includes('[Do not click](https://example.com/new)') && !linkBody.includes('javascript:') && /\nLinked then unlinked\n?$/.test(linkBody) && linkBody.includes(`[[${wikiValue}]]`),
      linkBody.slice(-200),
    );

    // Mermaid in visual mode: a page without a diagram never loads mermaid in the editor (checked
    // on every editor opened above); a page with them shows each drawn under its code, redrawn as
    // the code changes, the last good diagram kept (with a short note) while the code is broken.
    // The preview never changes the markdown: the save differs from the source only by the edit.
    for (const p of [page, same, conflict, lp]) expect('an edit without a mermaid block never loads mermaid', !requests(p).some((u) => MERMAID_CHUNK.test(u)), requests(p).filter((u) => /mermaid/i.test(u)).join(' '));
    const mp = await open('/wiki/setting-up-arch-to-run-factorio', 'desktop', { wiki: 'editor' });
    await main(mp).locator('[data-wiki-edit]').click();
    const mpm = mp.locator('[data-wiki-visual-editor] .ProseMirror');
    await mpm.waitFor({ timeout: 10000 }).catch(() => {});
    const blocks = mpm.locator('.wiki-code-block');
    const preview = (i) => blocks.nth(i).locator('.wiki-mermaid-preview');
    const settled = (i, state) => mp.waitForFunction(([i, s]) => document.querySelectorAll('.ProseMirror .wiki-code-block .wiki-mermaid-preview')[i]?.getAttribute('data-mermaid-preview') === s, [i, state], { timeout: 15000 }).catch(() => {});
    await settled(0, 'drawn');
    expect('visual mode: a mermaid block opens with its diagram drawn under the code', (await blocks.count()) === MERMAID.length && (await preview(0).locator('.wiki-mermaid-diagram svg').count()) === 1 && (await preview(0).getAttribute('contenteditable')) === 'false' && (await blocks.nth(0).locator('pre code').innerText()).startsWith('flowchart TD'));
    expect('the editor loads mermaid for a page with a diagram', requests(mp).some((u) => MERMAID_CHUNK.test(u)));
    expect('the preview draws as on the page (its labels)', (await preview(0).locator('svg').textContent()).includes('Save file'));
    await settled(2, 'error');
    expect('a broken block: a short error note, no bomb picture', /^Diagram has an error: .{1,120}$/.test(await preview(2).locator('.wiki-mermaid-note').innerText()) && (await preview(2).locator('svg').count()) === 0, await preview(2).innerText());
    await mp.waitForTimeout(500);
    const hostile = await mp.evaluate(() => ({ pwned: window.__pwned ?? null, foreign: document.querySelectorAll('.ProseMirror foreignObject, .ProseMirror script, .ProseMirror iframe').length }));
    expect('hostile diagrams in the editor run nothing', hostile.pwned === null && hostile.foreign === 0, JSON.stringify(hostile));
    await shot(mp, 'wiki-editor-mermaid-desktop');

    // Type in the first block: the diagram follows once typing stops.
    const firstCode = blocks.nth(0).locator('pre code');
    await firstCode.click();
    // The cursor at the end of the first block's code.
    await mp.evaluate(() => {
      const code = document.querySelector('.ProseMirror .wiki-code-block pre code');
      const r = document.createRange();
      r.selectNodeContents(code);
      r.collapse(false);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await mp.keyboard.type(' --> extra[Added in preview]');
    await mp.waitForFunction(() => document.querySelector('.ProseMirror .wiki-mermaid-preview svg')?.textContent.includes('Added in preview'), null, { timeout: 15000 }).catch(() => {});
    expect('edit the code: the preview redraws with the change', (await preview(0).locator('svg').textContent()).includes('Added in preview'));
    // Break it: the last good diagram stays, with the note.
    await mp.keyboard.type(' --> ((');
    await settled(0, 'error');
    expect(
      'a syntax error: "Diagram has an error" and the last good diagram kept',
      /^Diagram has an error:/.test(await preview(0).locator('.wiki-mermaid-note').innerText().catch(() => '')) && (await preview(0).locator('svg').textContent()).includes('Added in preview'),
      await preview(0).innerText(),
    );
    await shot(mp, 'wiki-editor-mermaid-error-desktop');
    for (let i = 0; i < ' --> (('.length; i += 1) await mp.keyboard.press('Backspace');
    await settled(0, 'drawn');
    expect('fixed again: the note goes', (await preview(0).getAttribute('data-mermaid-preview')) === 'drawn' && (await preview(0).locator('.wiki-mermaid-note').isHidden()));
    // Hide and show.
    await preview(0).locator('.wiki-mermaid-toggle').click();
    expect('"Hide preview" hides the diagram', (await preview(0).locator('.wiki-mermaid-diagram').isHidden()) && (await preview(0).locator('.wiki-mermaid-toggle').innerText()) === 'Show preview');
    await preview(0).locator('.wiki-mermaid-toggle').click();
    expect('"Show preview" shows it again', await preview(0).locator('.wiki-mermaid-diagram').isVisible());

    // A new code block from the toolbar, given the language mermaid: its preview starts. It goes
    // in after the paragraph under "Prerequisites".
    await mpm.locator(':scope > p').first().click();
    await mp.keyboard.press('End');
    await mp.keyboard.press('Enter');
    await mp.getByRole('button', { name: 'Code block' }).click();
    await mp.keyboard.type('flowchart LR\n  new1[New block] --> new2[Drawn]');
    const newBlock = blocks.first();
    await newBlock.locator('.wiki-code-language').fill('mermaid');
    await newBlock.locator('.wiki-code-language').press('Enter');
    await mp.waitForFunction(() => [...document.querySelectorAll('.ProseMirror .wiki-mermaid-preview svg')].some((s) => s.textContent.includes('New block')), null, { timeout: 15000 }).catch(() => {});
    expect('toolbar code block + language "mermaid": the preview starts', (await newBlock.locator('.wiki-mermaid-preview svg').textContent().catch(() => '')).includes('New block'));

    // Round trip: Markdown mode and back, then save.
    await mp.getByRole('button', { name: 'Markdown' }).click();
    await mp.locator('.cm-content').waitFor({ timeout: 10000 }).catch(() => {});
    expect('markdown mode shows no preview', (await mp.locator('.wiki-mermaid-preview').count()) === 0);
    await mp.getByRole('button', { name: 'Visual' }).click();
    await mpm.waitFor({ timeout: 10000 }).catch(() => {});
    await mp.locator('[data-wiki-save]').click();
    await mp.locator('[data-wiki-saved]').waitFor({ timeout: 5000 }).catch(() => {});
    const mermaidBody = wikiApiCalls(mp).saves[0]?.meta?.body ?? '';
    const sourceBody = await mp.evaluate(() => fetch('https://vault.abucnasty.dev/wiki/setting-up-arch-to-run-factorio.md').then((r) => r.text()));
    // The house style ends a paragraph without the fixture's trailing space (any edit rewrites it so).
    const expected = sourceBody
      .replace(/ +\n/g, '\n')
      .replace(MERMAID[0], `${MERMAID[0]} --> extra[Added in preview]`)
      .replace('\n\n![64x64', '\n\n```mermaid\nflowchart LR\n  new1[New block] --> new2[Drawn]\n```\n\n![64x64');
    expect('save: the markdown is the source plus the edits, nothing from the preview', mermaidBody === expected, JSON.stringify(mermaidBody.slice(0, 600)) + ' vs ' + JSON.stringify(expected.slice(0, 600)));

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

    // A new page in a new folder: typed (nested with /), checked as typed, spelled like the
    // existing folder it starts in ("guides" is "Guides"), and sent with the page.
    const inFolder = await open('/wiki/all', 'desktop', { wiki: 'editor' });
    await main(inFolder).locator('[data-wiki-new]').click();
    await inFolder.locator('[data-wiki-new-title]').waitFor({ timeout: 5000 }).catch(() => {});
    await inFolder.locator('[data-wiki-new-title]').fill('Linux Setup');
    const folderInput = inFolder.locator('[data-wiki-new-folder]');
    await folderInput.fill('Guides/_drafts');
    const folderHelp = () => inFolder.locator('[data-wiki-new-page] .MuiFormHelperText-root').last().innerText();
    expect('new folder: a name starting with _ is refused', (await inFolder.locator('[data-wiki-new-create]').isDisabled()) && /can't start with \. or _/.test(await folderHelp()), await folderHelp());
    await folderInput.fill('guides/Linux');
    expect('new folder: allowed, nested, in the existing folder\'s spelling', !(await inFolder.locator('[data-wiki-new-create]').isDisabled()) && (await folderHelp()) === 'A new folder: Guides / Linux', await folderHelp());
    await inFolder.locator('[data-wiki-new-title]').click();
    await inFolder.locator('[data-wiki-new-create]').click();
    const fpm = inFolder.locator('[data-wiki-visual-editor] .ProseMirror');
    await fpm.waitFor({ timeout: 10000 }).catch(() => {});
    await fpm.click();
    await inFolder.keyboard.type('A page in a new folder.');
    await inFolder.locator('[data-wiki-save]').click();
    await inFolder.locator('[data-wiki-saved]').waitFor({ timeout: 5000 }).catch(() => {});
    const inFolderSave = wikiApiCalls(inFolder).saves[0]?.meta;
    expect('new folder: the page is saved with its title in the new folder', inFolderSave && inFolderSave.create && inFolderSave.create.title === 'Linux Setup' && inFolderSave.create.folder === 'Guides/Linux', JSON.stringify(inFolderSave && inFolderSave.create));

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
