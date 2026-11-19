// The wiki editor, against the wiki API stand-in (fixtures/wiki-api.cjs): readers never download
// it; an editor opens it in place of the page (visual mode first), types, links a page with `[[`,
// pastes an image, switches modes, and saves (the request is checked: path, base blob, frontmatter
// as loaded, body, image); a conflict keeps the text with "Copy my text"; switching modes without
// changes keeps the text exactly; links edited, added and removed in visual mode; a new page from
// /wiki/all, and one in a new folder; ```mermaid blocks drawn live in visual mode; the style
// picker (Text, Heading 1 to 4) and its shortcuts in both modes; phones. Then the
// page history (readers: the list; editors: a diff and restore), rename, delete and recently
// deleted, each request checked.
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

    // The style picker: it shows the style of the block at the cursor and sets it, from its menu or a
    // shortcut (Ctrl+Alt+0 to 4), in both modes; in markdown a heading's `#` marker is replaced.
    const sp = await open('/wiki/how-to-benchmark', 'desktop', { wiki: 'editor' });
    await main(sp).locator('[data-wiki-edit]').click();
    const spm = sp.locator('[data-wiki-visual-editor] .ProseMirror');
    await spm.waitFor({ timeout: 10000 }).catch(() => {});
    const styleButton = sp.locator('[data-wiki-style-picker]');
    const shownStyle = async () => (await styleButton.innerText().catch(() => '')).trim();
    // The editor takes a click's cursor from the browser a moment later.
    const showsStyle = (label, p = sp) =>
      p.waitForFunction((l) => document.querySelector('[data-wiki-style-picker]')?.innerText.trim() === l, label, { timeout: 3000 }).then(() => true, () => false);
    const pickStyle = async (level) => {
      await styleButton.click();
      await sp.locator(`[data-wiki-style="${level}"]`).click();
      await sp.locator('[role="menu"]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    };
    await spm.locator('h2', { hasText: 'Step 2.1' }).click();
    expect('style picker: "Heading 2" on a ## heading (visual)', await showsStyle('Heading 2'), await shownStyle());
    await spm.locator(':scope > p').first().click();
    expect('style picker: "Text" in a paragraph', await showsStyle('Text'), await shownStyle());
    await spm.locator('h2', { hasText: 'Step 2.1' }).click();
    await showsStyle('Heading 2');
    await styleButton.click();
    const styleMenu = sp.locator('[role="menu"]');
    await styleMenu.waitFor({ timeout: 5000 }).catch(() => {});
    const menuText = await styleMenu.innerText().catch(() => '');
    const sizes = await styleMenu.locator('[data-wiki-style] > span:first-child').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
    expect(
      'the style menu: Text, Heading 1 to 4, each with its markdown and shortcut, the current one marked, larger as the heading is',
      /Text[\s\S]*Heading 1[\s\S]*#[\s\S]*Ctrl\+Alt\+1[\s\S]*Heading 4[\s\S]*####[\s\S]*Ctrl\+Alt\+4/.test(menuText) &&
        (await styleMenu.locator('[data-wiki-style="2"].Mui-selected').count()) === 1 &&
        sizes.length === 5 && sizes[1] > sizes[2] && sizes[2] > sizes[3] && sizes[3] > sizes[4] && sizes[4] >= sizes[0],
      JSON.stringify({ menuText, sizes }),
    );
    await sp.waitForTimeout(300); // the menu's fade-in
    await shot(sp, 'wiki-editor-style-menu-desktop');
    await sp.locator('[data-wiki-style="3"]').click();
    await styleMenu.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    expect('visual: Heading 3 from the menu makes the block an h3', (await spm.locator('h3', { hasText: 'Step 2.1' }).count()) === 1 && (await spm.locator('h2', { hasText: 'Step 2.1' }).count()) === 0 && await showsStyle('Heading 3'), await shownStyle());
    const pickerBox = await styleButton.boundingBox();
    await spm.locator(':scope > p').first().click();
    await sp.keyboard.press('Control+Alt+4');
    const pickerBoxAfter = await styleButton.boundingBox();
    expect('visual: Ctrl+Alt+4 makes the paragraph a Heading 4', (await spm.locator('h4', { hasText: 'This guide will walk' }).count()) === 1 && await showsStyle('Heading 4'), await shownStyle());
    expect('the picker keeps its width as the style changes', pickerBox && pickerBoxAfter && pickerBox.width === pickerBoxAfter.width && pickerBox.x === pickerBoxAfter.x, JSON.stringify([pickerBox, pickerBoxAfter]));

    await sp.getByRole('button', { name: 'Markdown' }).click();
    await sp.locator('.cm-content').waitFor({ timeout: 10000 }).catch(() => {});
    const cmLine = (re) => sp.locator('.cm-line', { hasText: re });
    const spMd = await markdownText(sp);
    expect('markdown mode: the visual changes as # markers', spMd.includes('\n### Step 2.1: Generate a Test Map\n') && spMd.startsWith('#### This guide will walk'), spMd.slice(0, 200));
    expect('markdown mode: the picker reads the cursor line ("Heading 4" on ####)', await showsStyle('Heading 4'), await shownStyle());
    await cmLine(/^## Prerequisites$/).click();
    expect('markdown mode: "Heading 2" on a ## line', await showsStyle('Heading 2'), await shownStyle());
    await pickStyle(3);
    expect('markdown mode: Heading 3 replaces the ## marker', (await cmLine(/^### Prerequisites$/).count()) === 1 && !/#+ #/.test(await markdownText(sp)) && (await showsStyle('Heading 3')), (await markdownText(sp)).slice(0, 400));
    await cmLine(/^#### This guide/).click();
    await sp.keyboard.press('Control+Alt+1');
    expect('markdown mode: Ctrl+Alt+1 makes the line "# "', (await cmLine(/^# This guide will walk/).count()) === 1 && (await showsStyle('Heading 1')), await shownStyle());
    await pickStyle(0);
    expect('markdown mode: Text removes the marker', (await cmLine(/^This guide will walk/).count()) === 1 && (await showsStyle('Text')), await shownStyle());
    await cmLine(/^### Step 2\.1/).click();
    await sp.keyboard.press('Control+Alt+0');
    await sp.keyboard.press('Control+Alt+3');
    expect('markdown mode: Ctrl+Alt+0 then Ctrl+Alt+3 on a heading line: ### once', (await cmLine(/^### Step 2\.1: Generate a Test Map$/).count()) === 1);
    await sp.locator('[data-wiki-save]').click();
    await sp.locator('[data-wiki-saved]').waitFor({ timeout: 5000 }).catch(() => {});
    const styleBody = wikiApiCalls(sp).saves[0]?.meta?.body ?? '';
    expect(
      'save: ### for the headings set to Heading 3 in each mode, no stacked markers, the paragraph back to text',
      styleBody.startsWith('This guide will walk') && styleBody.includes('\n### Prerequisites\n') && styleBody.includes('\n### Step 2.1: Generate a Test Map\n') && !/#+ #/.test(styleBody) && !/^##? /m.test(styleBody),
      styleBody.slice(0, 600),
    );

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
    await ppm.locator('h2', { hasText: 'Prerequisites' }).click();
    const phoneShort = await phone.waitForFunction(() => document.querySelector('[data-wiki-style-picker]')?.innerText.trim() === 'H2', null, { timeout: 3000 }).then(() => true, () => false);
    expect('phone: the style picker shows a short label ("H2")', phoneShort, await phone.locator('[data-wiki-style-picker]').innerText().catch(() => ''));
    await shot(phone, 'wiki-editor-visual-phone');

    await historyAndPages({ open, goto, expect, shot, requests, wikiApiCalls });
  },
};

const DIFF_CHUNK = /\/assets\/WikiDiff-[^/]*\.js$/;
const ACTIONS_CHUNK = /\/assets\/WikiPageActions-[^/]*\.js$/;
const sha = (c) => c.repeat(40);

/**
 * History, restore, rename, delete and recently deleted: readers see the list only; editors see a
 * diff, restore a version, rename, delete (with a confirm step) and restore deleted pages. Each
 * change's request is checked.
 */
async function historyAndPages({ open, goto, expect, shot, requests, wikiApiCalls }) {
  const main = (page) => page.locator('main');
  const changes = (page, what) => wikiApiCalls(page).changes.filter((c) => c.what === what);

  // A reader: a History link, no page menu; the list without diffs or restore; no editor code.
  const reader = await open('/wiki/how-to-benchmark', 'desktop');
  expect('reader: a History link on the page', (await main(reader).locator('[data-wiki-history-link]').count()) === 1);
  expect('reader: no page menu (rename, delete)', (await main(reader).locator('[data-wiki-page-menu]').count()) === 0);
  await main(reader).locator('[data-wiki-history-link]').click();
  const entries = main(reader).locator('[data-wiki-history-entry]');
  await entries.first().waitFor({ timeout: 5000 }).catch(() => {});
  const readerText = await main(reader).innerText();
  expect('reader: /wiki/<slug>/history lists the edits, newest first, with names and the rename', new URL(reader.url()).pathname === '/wiki/how-to-benchmark/history' && (await entries.count()) === 3 && /Explain the new flags[\s\S]*Renamed from Benchmarking Guide[\s\S]*abucnasty/.test(readerText), readerText.slice(0, 400));
  expect('reader: no "Changes" or "Restore this version", and no diff or page-menu code', (await main(reader).locator('[data-wiki-show-diff], [data-wiki-restore-version]').count()) === 0 && !requests(reader).some((u) => DIFF_CHUNK.test(u) || ACTIONS_CHUNK.test(u)));
  expect('reader: no emails in the history', !/@/.test(readerText));
  await goto(reader, '/wiki/benchmark-checklist/history');
  await main(reader).locator('[data-wiki-state="unknown"]').waitFor({ timeout: 5000 }).catch(() => {});
  expect("reader: a draft's history is a page that does not exist", /No wiki page at "benchmark-checklist"/.test(await main(reader).innerText()) && !requests(reader).some((u) => u.includes('/api/wiki/history') && u.includes('Checklist')));
  await shot(reader, 'wiki-history-reader-desktop');

  // An editor: a diff of the rename edit, side by side, then restore that version.
  const ed = await open('/wiki/how-to-benchmark/history', 'desktop', { wiki: 'editor' });
  const row = main(ed).locator(`[data-wiki-history-entry="${sha('2')}"]`);
  await row.waitFor({ timeout: 5000 }).catch(() => {});
  expect('editor: "Changes" on every edit, "Restore this version" on all but the current one', (await main(ed).locator('[data-wiki-show-diff]').count()) === 3 && (await main(ed).locator('[data-wiki-restore-version]').count()) === 2);
  await row.locator('[data-wiki-show-diff]').click();
  const diff = row.locator('[data-wiki-diff]');
  await diff.locator('.cm-mergeView').waitFor({ timeout: 10000 }).catch(() => {});
  const diffText = await diff.innerText().catch(() => '');
  // The rename added the old title to the frontmatter; unchanged stretches are folded.
  expect('editor: the diff shows both versions side by side, the change marked, the rest folded', (await diff.getAttribute('data-wiki-diff').catch(() => null)) === 'side-by-side' && (await diff.locator('.cm-merge-b .cm-changedLine').count()) > 0 && diffText.includes('aliases: [Benchmarking Guide]') && /\d+ unchanged lines/.test(diffText), diffText.slice(0, 200));
  expect('editor: the versions before and after the edit were read (across the rename)', wikiApiCalls(ed).some((c) => c.startsWith('GET version')) && requests(ed).some((u) => u.includes('version?path=wiki%2FGuides%2FBenchmarking%20Guide.md&ref=' + sha('3'))) && requests(ed).some((u) => DIFF_CHUNK.test(u)));
  await shot(ed, 'wiki-history-diff-desktop');
  await row.locator('[data-wiki-restore-version]').click();
  await ed.locator('[data-wiki-restore-dialog] [data-wiki-restore-confirm]').click();
  await main(ed).locator('[data-wiki-restored]').waitFor({ timeout: 5000 }).catch(() => {});
  const restored = changes(ed, 'restore')[0];
  expect('restore: one same-origin POST with the page, the blob it is now, the commit and its path then', restored && restored.body.path === 'wiki/Guides/How to Benchmark.md' && restored.body.base === sha('b') && restored.body.commit === sha('2') && restored.body.from === 'wiki/Guides/How to Benchmark.md' && /application\/json/.test(restored.headers['content-type']), JSON.stringify(restored && restored.body));
  expect('restore: "Restored as a new edit"', /Restored as a new edit/.test(await main(ed).innerText()));
  await main(ed).locator('[data-wiki-restored] a, [data-wiki-restored] button', { hasText: 'View the page' }).click();
  await main(ed).locator('h2', { hasText: 'Before you start' }).waitFor({ timeout: 5000 }).catch(() => {});
  expect('restore: the page shows the restored text at once', (await main(ed).locator('h2', { hasText: 'Before you start' }).count()) === 1);

  // Rename: a taken title is refused in the dialog; the rename's request; the page at its new address.
  const rn = await open('/wiki/how-to-benchmark', 'desktop', { wiki: 'editor' });
  await main(rn).locator('[data-wiki-page-menu]').waitFor({ timeout: 5000 }).catch(() => {});
  await main(rn).locator('[data-wiki-page-menu]').click();
  await rn.locator('[data-wiki-rename]').click();
  const title = rn.locator('[data-wiki-rename-title]');
  await title.fill('Setting Up Arch to Run Factorio');
  expect('rename: a taken title is refused', await rn.locator('[data-wiki-rename-confirm]').isDisabled());
  await title.fill('Benchmarking 101');
  await rn.locator('[data-wiki-rename-confirm]').click();
  await rn.waitForURL('**/wiki/benchmarking-101', { timeout: 5000 }).catch(() => {});
  const renamed = changes(rn, 'rename')[0];
  expect('rename: the page, its blob, the new title and the folder', renamed && renamed.body.path === 'wiki/Guides/How to Benchmark.md' && renamed.body.base === sha('b') && renamed.body.title === 'Benchmarking 101' && renamed.body.folder === 'Guides', JSON.stringify(renamed && renamed.body));
  await main(rn).locator('[data-wiki-saved]').waitFor({ timeout: 5000 }).catch(() => {});
  expect('rename: the page opens at its new address with a notice', new URL(rn.url()).pathname === '/wiki/benchmarking-101' && /Renamed\./.test(await main(rn).innerText()) && (await main(rn).locator('h1').innerText()) === 'Benchmarking 101', (await main(rn).innerText()).slice(0, 300));
  await rn.evaluate(() => { history.pushState(null, '', '/wiki/how-to-benchmark'); dispatchEvent(new PopStateEvent('popstate')); });
  await rn.waitForURL('**/wiki/benchmarking-101', { timeout: 5000 }).catch(() => {});
  expect('rename: the old address leads to the new one', new URL(rn.url()).pathname === '/wiki/benchmarking-101');

  // Home has no rename or delete; an editor's old draft title reaches the draft.
  const home = await open('/wiki', 'desktop', { wiki: 'editor' });
  await main(home).locator('[data-wiki-page-menu]').waitFor({ timeout: 5000 }).catch(() => {});
  expect('Home: the page menu is off', await main(home).locator('[data-wiki-page-menu]').isDisabled());
  await goto(home, '/wiki/old-checklist');
  await home.waitForURL('**/wiki/benchmark-checklist', { timeout: 5000 }).catch(() => {});
  expect("editor: a renamed draft's old address leads to it", new URL(home.url()).pathname === '/wiki/benchmark-checklist');

  // Delete, with a confirm step.
  const del = await open('/wiki/setting-up-arch-to-run-factorio', 'desktop', { wiki: 'editor' });
  await main(del).locator('[data-wiki-page-menu]').click();
  await del.locator('[data-wiki-delete]').click();
  expect('delete: asks first, nothing sent yet', (await del.locator('[data-wiki-delete-dialog]').count()) === 1 && changes(del, 'delete').length === 0);
  await del.locator('[data-wiki-delete-reason]').fill('Merged into the guide');
  await del.locator('[data-wiki-delete-confirm]').click();
  await main(del).locator('[data-wiki-deleted-notice]').waitFor({ timeout: 5000 }).catch(() => {});
  const deleted = changes(del, 'delete')[0];
  expect('delete: the page, its blob and the reason', deleted && deleted.body.path === 'wiki/Guides/Setting Up Arch to Run Factorio.md' && deleted.body.base === sha('c') && deleted.body.summary === 'Merged into the guide', JSON.stringify(deleted && deleted.body));
  expect('delete: "Deleted", with a way to Recently deleted', (await main(del).locator('[data-wiki-deleted-notice]').count()) === 1);
  await main(del).getByRole('link', { name: 'All pages' }).click();
  await main(del).locator('[data-wiki-folder]').first().waitFor({ timeout: 5000 }).catch(() => {});
  expect('delete: the page is gone from All pages', !(await main(del).innerText()).includes('Setting Up Arch to Run Factorio'));

  // Recently deleted: listed with who and when; restore one; one whose title is taken asks for a new title.
  await main(del).locator('[data-wiki-deleted-link]').click();
  const gone = main(del).locator('[data-wiki-deleted-page]');
  await gone.first().waitFor({ timeout: 5000 }).catch(() => {});
  const goneText = await main(del).innerText();
  expect('recently deleted: the pages, who deleted them, and a taken title', (await gone.count()) === 2 && /Old Notes[\s\S]*deleted by abucnasty/.test(goneText) && /has its title now/.test(goneText), goneText.slice(0, 400));
  await gone.nth(0).locator('[data-wiki-undelete]').click();
  await del.locator('[data-wiki-undelete-confirm]').click();
  await main(del).locator('[data-wiki-undeleted]').waitFor({ timeout: 5000 }).catch(() => {});
  const undeleted = changes(del, 'undelete')[0];
  expect('restore deleted: the path and the commit that deleted it', undeleted && undeleted.body.path === 'wiki/Guides/Old Notes.md' && undeleted.body.commit === sha('4') && undeleted.body.title === undefined, JSON.stringify(undeleted && undeleted.body));
  expect('restore deleted: "Restored Old Notes"', /Restored Old Notes/.test(await main(del).innerText()));
  await gone.nth(1).locator('[data-wiki-undelete]').click();
  const newTitle = del.locator('[data-wiki-undelete-title]');
  await newTitle.waitFor({ timeout: 5000 }).catch(() => {});
  expect('restore deleted, title taken: asks for another title', (await newTitle.count()) === 1);
  await newTitle.fill('Setting Up Arch (old)');
  await del.locator('[data-wiki-undelete-confirm]').click();
  await main(del).locator('[data-wiki-undeleted]', { hasText: 'Setting Up Arch (old)' }).waitFor({ timeout: 5000 }).catch(() => {});
  const second = changes(del, 'undelete')[1];
  expect('restore deleted under a new title: sent with it', second && second.body.commit === sha('5') && second.body.title === 'Setting Up Arch (old)', JSON.stringify(second && second.body));
  await main(del).locator('[data-wiki-undeleted] a', { hasText: 'Open it' }).click();
  await main(del).locator('h1', { hasText: 'Setting Up Arch (old)' }).waitFor({ timeout: 5000 }).catch(() => {});
  expect('restore deleted: the page opens at once', /Restored by the check/.test(await main(del).innerText()));
  await shot(del, 'wiki-deleted-desktop');

  // Readers can't open recently deleted.
  const outsider = await open('/wiki/deleted', 'desktop');
  expect('reader: recently deleted is for editors', /for wiki editors/.test(await main(outsider).innerText()) && !wikiApiCalls(outsider).includes('GET deleted'));

  // A phone: the diff in one column, no sideways scroll.
  const phone = await open('/wiki/how-to-benchmark/history', 'phone', { wiki: 'editor' });
  const prow = main(phone).locator(`[data-wiki-history-entry="${sha('2')}"]`);
  await prow.waitFor({ timeout: 5000 }).catch(() => {});
  await prow.locator('[data-wiki-show-diff]').click();
  await prow.locator('[data-wiki-diff] .cm-editor').waitFor({ timeout: 10000 }).catch(() => {});
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect('phone: the diff is stacked in one column, no sideways scroll', (await prow.locator('[data-wiki-diff]').getAttribute('data-wiki-diff').catch(() => null)) === 'stacked' && (await prow.locator('.cm-deletedChunk, .cm-insertedLine, .cm-changedLine').count()) > 0 && over <= 0, `overflow ${over}px`);
  await shot(phone, 'wiki-history-diff-phone');
}
