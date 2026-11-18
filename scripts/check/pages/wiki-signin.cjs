// The wiki's sign-in and drafts, against the wiki API stand-in (fixtures/wiki-api.cjs): the
// footer's "Maintainer sign-in" (and nothing in the site header), a signed-in visitor without the
// role, an editor's first-sign-in notice, drafts for editors only, sign-out, a failed role check,
// and the notice after a sign-in that did not complete.
const { VAULT } = require('../fixtures/catalog.cjs');

module.exports = {
  name: 'wiki-signin',
  async run({ open, goto, expect, shot, data, wikiApiCalls }) {
    const draft = data.wiki.drafts.pages[0];
    const image = data.wiki.files[0];
    const main = (page) => page.locator('main');
    const footer = (page) => page.locator('main [data-wiki-footer]');

    // Signed out: a quiet link in the wiki footer, back to this page; nothing in the header.
    for (const viewport of ['desktop', 'phone']) {
      const page = await open('/wiki/how-to-benchmark?x=1', viewport);
      await footer(page).locator('[data-wiki-signin]').waitFor({ timeout: 5000 }).catch(() => {});
      const link = await footer(page).locator('a[data-wiki-signin]').evaluate((a) => ({ text: a.textContent, href: a.getAttribute('href') })).catch(() => null);
      expect(
        `${viewport}: signed out, the wiki footer has "Maintainer sign-in" returning to the page`,
        link && link.text === 'Maintainer sign-in' && link.href === `/api/wiki/auth/login?return=${encodeURIComponent('/wiki/how-to-benchmark?x=1')}`,
        JSON.stringify(link),
      );
      expect(`${viewport}: the site header has no sign-in`, (await page.locator('header').first().getByText(/sign.?in/i).count()) === 0);
      await shot(page, `wiki-signed-out-${viewport}`);
    }
    const homePage = await open('/', 'desktop');
    expect('pages outside the wiki do not ask who is signed in', wikiApiCalls(homePage).length === 0, wikiApiCalls(homePage).join(', '));

    // Signed out, a draft's address is a page that does not exist, and drafts are not listed or fetched.
    const out = await open(`/wiki/${draft.slug}`, 'desktop');
    expect('signed out: a draft is not found', /No wiki page at "benchmark-checklist"/.test(await main(out).innerText()));
    await goto(out, '/wiki/all');
    expect('signed out: /wiki/all lists no drafts', (await main(out).locator('[data-wiki-draft]').count()) === 0 && !(await main(out).innerText()).includes(draft.title));
    await goto(out, '/wiki/old-checklist');
    expect("a draft's former title redirects nowhere", new URL(out.url()).pathname === '/wiki/old-checklist');
    expect('signed out: the drafts are never requested', !wikiApiCalls(out).some((c) => c.includes('drafts/')), wikiApiCalls(out).join(', '));

    // Signed in without the role.
    const member = await open('/wiki', 'phone', { wiki: 'member' });
    await footer(member).locator('[data-wiki-no-access]').waitFor({ timeout: 5000 }).catch(() => {});
    const memberText = await footer(member).innerText();
    expect(
      'signed in without the role: name, "no wiki access, ask in the Discord" and Sign out',
      memberText.includes('Just A Member') && memberText.includes("You're signed in, but you don't have wiki access. Ask in the Discord.") && /Sign out/i.test(memberText),
      memberText,
    );
    await goto(member, `/wiki/${draft.slug}`);
    expect('signed in without the role: a draft is not found', /No wiki page at/.test(await main(member).innerText()));
    await shot(member, 'wiki-member-phone');

    // An editor's first sign-in: the notice, until "I understand".
    const first = await open('/wiki', 'desktop', { wiki: 'editor-first' });
    const dialog = first.locator('[data-wiki-first-signin]');
    await dialog.waitFor({ timeout: 5000 }).catch(() => {});
    const dialogText = (await dialog.innerText().catch(() => '')).replace(/\s+/g, ' ');
    expect(
      "first sign-in: the notice says the server display name is shown publicly on edits",
      dialogText.includes('Buc the Editor') && /shown publicly on the wiki edits you make/.test(dialogText),
      dialogText,
    );
    expect('first sign-in: no "How to edit the wiki" link while that page does not exist', (await dialog.locator('a').count()) === 0);
    await shot(first, 'wiki-first-signin-desktop');
    await first.getByRole('button', { name: 'I understand' }).click();
    await dialog.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    expect('"I understand" closes the notice and is remembered', (await dialog.count()) === 0 && wikiApiCalls(first).includes('POST ack'), wikiApiCalls(first).join(', '));
    await goto(first, '/wiki');
    await footer(first).locator('[data-wiki-user]').waitFor({ timeout: 5000 }).catch(() => {});
    expect('after a reload the notice stays away', (await first.locator('[data-wiki-first-signin]').count()) === 0);

    // An editor sees drafts: listed and marked, linked and marked, rendered with the banner.
    for (const viewport of ['desktop', 'phone']) {
      const page = await open('/wiki/all', viewport, { wiki: 'editor' });
      await main(page).locator('[data-wiki-draft]').first().waitFor({ timeout: 5000 }).catch(() => {});
      const row = await main(page).locator(`a[href="/wiki/${draft.slug}"]`).innerText().catch(() => '');
      expect(`${viewport}: editor: /wiki/all lists the draft with a Draft mark`, row.includes(draft.title) && row.includes('Draft'), row);
      expect(`${viewport}: editor: the count says pages and drafts`, (await main(page).locator('header').innerText()).includes('3 pages · 1 draft'));
      await shot(page, `wiki-all-editor-${viewport}`);

      await goto(page, `/wiki/${draft.slug}`);
      await main(page).locator('h2#before-you-start').waitFor({ timeout: 5000 }).catch(() => {});
      const banner = await main(page).locator('[data-wiki-draft-banner]').innerText().catch(() => '');
      expect(`${viewport}: editor: a draft renders under "Draft — only wiki editors can see this"`, banner.includes('Draft — only wiki editors can see this') && (await main(page).locator('h1').innerText()) === draft.title, banner);
      const img = await page.$eval('main img', (el) => ({ src: el.getAttribute('src'), loaded: el.complete && el.naturalWidth > 0 })).catch(() => null);
      expect(`${viewport}: editor: the draft's image comes from the public wiki files`, img && img.src === `${VAULT}/wiki/files/${image.published}?v=${image.v}` && img.loaded, JSON.stringify(img));
      expect(`${viewport}: editor: the draft links to published pages`, (await main(page).locator('a[href="/wiki/how-to-benchmark"]').count()) === 1);
      await shot(page, `wiki-draft-editor-${viewport}`);
      const avatar = await footer(page).locator('img').getAttribute('src').catch(() => null);
      expect(`${viewport}: editor: name and avatar in the wiki footer`, (await footer(page).innerText()).includes('Buc the Editor') && avatar === 'https://cdn.discordapp.com/embed/avatars/0.png', avatar);
    }
    const editor = await open('/wiki', 'desktop', { wiki: 'editor' });
    await main(editor).locator('.wiki-draft-link').waitFor({ timeout: 5000 }).catch(() => {});
    const draftLink = await main(editor).locator('.wiki-draft-link').innerText().catch(() => '');
    expect('editor: a link to a draft works and is marked Draft', draftLink.includes('Benchmark Checklist') && draftLink.includes('Draft') && (await main(editor).locator(`.wiki-draft-link a[href="/wiki/${draft.slug}"]`).count()) === 1, draftLink);
    expect('editor: only the page nobody wrote is missing', (await main(editor).locator('.wiki-missing').allInnerTexts()).join() === 'A Page Nobody Wrote');
    await editor.locator('header button[aria-label="Search the site"]:visible').click();
    await editor.keyboard.type('checklist');
    const hit = editor.locator('[role=dialog] [role=group]:has(> :first-child:text-is("Wiki")) [role=option]').first();
    await hit.waitFor({ timeout: 5000 }).catch(() => {});
    expect(
      'editor: search finds the draft, marked Draft',
      (await hit.getAttribute('href').catch(() => null)) === `/wiki/${draft.slug}` && (await hit.innerText().catch(() => '')).includes('Draft'),
      await hit.innerText().catch(() => ''),
    );
    await editor.keyboard.press('Escape');

    // Sign out: back to the sign-in link, and the drafts go away.
    await goto(editor, `/wiki/${draft.slug}`);
    await footer(editor).getByRole('button', { name: 'Sign out' }).click();
    await footer(editor).locator('a[data-wiki-signin]').waitFor({ timeout: 5000 }).catch(() => {});
    expect('Sign out posts to the API and shows "Maintainer sign-in" again', wikiApiCalls(editor).includes('POST auth/logout') && (await footer(editor).locator('a[data-wiki-signin]').count()) === 1);
    await main(editor).locator('[data-wiki-state="unknown"]').waitFor({ timeout: 5000 }).catch(() => {});
    expect('after signing out, the open draft is gone', /No wiki page at/.test(await main(editor).innerText()));

    // Discord could not be asked: say so, with "Try again"; no drafts.
    const failed = await open('/wiki/all', 'phone', { wiki: 'check-failed' });
    await footer(failed).locator('[data-wiki-check-failed]').waitFor({ timeout: 5000 }).catch(() => {});
    const failedText = await footer(failed).innerText();
    expect('a failed role check says it could not check, with Try again', /Couldn't check your wiki access/.test(failedText) && /Try again/i.test(failedText), failedText);
    expect('a failed role check shows no drafts', (await main(failed).locator('[data-wiki-draft]').count()) === 0);
    await shot(failed, 'wiki-check-failed-phone');

    // Back from a sign-in that did not complete: a dismissible notice.
    const back = await open('/wiki?wiki-signin=failed', 'desktop');
    const notice = main(back).locator('[data-wiki-signin-outcome]');
    await notice.waitFor({ timeout: 5000 }).catch(() => {});
    expect('a failed sign-in says so on the page it returned to', /Sign-in with Discord didn't work/.test(await notice.innerText().catch(() => '')));
    await notice.getByRole('button', { name: /close/i }).click().catch(() => {});
    expect('closing the notice removes it from the address', new URL(back.url()).search === '' && (await notice.count()) === 0, back.url());
  },
};
