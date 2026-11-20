// Frontmatter keys of a benchmark README: version, platform, cpu, authors, published_date.
// Each case writes README files into a temporary folder and reads them back through discoverBenchmarks.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { discoverBenchmarks } from './benchmark-frontmatter.mjs';

const roots = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** A source repo with one folder per entry: { folder: frontmatter lines (without the --- fences) }. */
function repo(folders, { authors = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'fm-test-'));
  roots.push(root);
  for (const [folder, lines] of Object.entries(folders)) {
    mkdirSync(path.join(root, 'benchmarks', folder), { recursive: true });
    const slug = folder.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    const authorsLine = authors && !/^authors:/m.test(lines) ? 'authors: [abucnasty]\n' : '';
    const text = `---\npublish: true\nslug: ${slug}\ntitle: T ${slug}\n${authorsLine}${lines}\n---\n\n# Body\n`;
    writeFileSync(path.join(root, 'benchmarks', folder, 'README.md'), text);
  }
  return root;
}

const one = (lines) => discoverBenchmarks(repo({ a: lines }), null)[0];
/** Builds a README that has no `authors` line at all. */
const oneWithout = (lines) => discoverBenchmarks(repo({ a: lines }, { authors: false }), null)[0];
const refused = (lines, pattern) => assert.throws(() => one(lines), pattern);

describe('version, platform, cpu', () => {
  it('are accepted and returned on the entry', () => {
    const e = one('factorioVersion: "2.0.72"\nplatform: windows-x86_64\ncpu: Ryzen 9800X3D');
    assert.equal(e.factorioVersion, '2.0.72');
    assert.equal(e.platform, 'windows-x86_64');
    assert.equal(e.cpu, 'Ryzen 9800X3D');
  });
  it('are absent from the entry when the README has none', () => {
    const e = one('');
    for (const k of ['factorioVersion', 'platform', 'cpu']) assert.equal(k in e, false, k);
  });
  it('refuse a YAML number as version and say to quote it', () => {
    refused('factorioVersion: 2.1', /a\/README\.md: "factorioVersion" must be text like "2\.0\.72".*quote/);
  });
  it('refuse an empty or malformed version', () => {
    refused('factorioVersion: ""', /"factorioVersion"/);
    refused('factorioVersion: "two"', /"factorioVersion"/);
  });
  it('refuse an empty platform or cpu', () => {
    refused('platform: ""', /"platform" must be non-empty text/);
    refused('cpu: "  "', /"cpu" must be non-empty text/);
    refused('cpu: 5', /"cpu" must be non-empty text/);
  });
});

describe('authors', () => {
  it('are kept as written, in order', () => {
    assert.deepEqual(one('authors: [abucnasty, tappi]').authors, ['abucnasty', 'tappi']);
    assert.deepEqual(one('authors: [abucnasty]').authors, ['abucnasty']);
  });
  it('are required: no key refuses with missing required field "authors"', () => {
    assert.throws(() => oneWithout(''), /a\/README\.md: missing required field "authors"/);
  });
  it('refuse an empty list, a non-list and a list with empty or non-text names', () => {
    refused('authors: []', /"authors" must be a non-empty list/);
    refused('authors: abucnasty', /"authors" must be a non-empty list/);
    refused('authors: ["abucnasty", ""]', /"authors" must be a non-empty list/);
    refused('authors: [""]', /"authors" must be a non-empty list/);
    refused('authors: [1]', /"authors" must be a non-empty list/);
  });
});

describe('published_date and date', () => {
  it('published_date is accepted and is the entry date', () => {
    const e = one('published_date: 2026-11-19');
    assert.equal(e.date, '2026-11-19');
    assert.equal('published_date' in e, false);
  });
  it('published_date wins over a different date', () => {
    assert.equal(one('published_date: 2026-11-19\ndate: 2026-11-01').date, '2026-11-19');
  });
  it('date alone still works', () => {
    assert.equal(one('date: 2026-11-01').date, '2026-11-01');
  });
  it('neither builds, with no date on the entry', () => {
    assert.equal('date' in one(''), false);
  });
  it('refuse a bad published_date: not a day, a number, wrong format', () => {
    refused('published_date: 2026-13-40', /"published_date" must be a real day as YYYY-MM-DD/);
    refused('published_date: 2026-02-30', /"published_date" must be a real day/);
    refused('published_date: 20261119', /"published_date" must be a real day/);
    refused('published_date: "19/11/2026"', /"published_date" must be a real day/);
  });
  it('refuse a calendar-invalid date as well', () => {
    refused('date: 2026-13-40', /"date" must be a real day as YYYY-MM-DD/);
    refused('date: 2026-02-30', /"date" must be a real day/);
  });
  it('accept 29 February of a leap year only', () => {
    assert.equal(one('published_date: 2028-02-29').date, '2028-02-29');
    refused('published_date: 2027-02-29', /real day/);
  });
  it('sort by the resolved date with old and new READMEs mixed', () => {
    const root = repo({
      'old-a': 'date: 2026-03-01',
      'new-b': 'published_date: 2026-05-01',
      'both-c': 'published_date: 2026-04-01\ndate: 2026-09-09',
      'none-d': '',
    });
    const sorted = discoverBenchmarks(root, null)
      .filter((e) => e.date)
      .sort((x, y) => y.date.localeCompare(x.date))
      .map((e) => e.slug);
    assert.deepEqual(sorted, ['new-b', 'both-c', 'old-a']);
  });
});

describe('unknown keys', () => {
  it('name the new keys among the known ones', () => {
    let message = '';
    try {
      one('coauthors: [x]');
    } catch (err) {
      message = err.message;
    }
    assert.match(message, /unknown frontmatter field "coauthors"/);
    const known = /\(known: (.*)\)/.exec(message)[1].split(', ');
    for (const key of ['factorioVersion', 'platform', 'cpu', 'authors', 'published_date']) assert.ok(known.includes(key), key);
  });
});
