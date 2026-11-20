// Where a benchmark's version, platform and CPU come from: the frontmatter first, the header lines second.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseReadmeMeta, readmeMeta, resolveDate } from './readme-meta.mjs';

const header = '**Factorio Version:** 2.0.60\n**Platform:** linux-x86_64  \n**CPU:** Old CPU\n';
const fm = (lines) => `---\npublish: true\n${lines}\n---\n\n`;

describe('parseReadmeMeta', () => {
  it('reads the three header lines, as before', () => {
    assert.deepEqual(parseReadmeMeta(header), { factorioVersion: '2.0.60', platform: 'linux-x86_64', cpu: 'Old CPU' });
  });
  it('finds nothing in a body without them', () => {
    assert.deepEqual(parseReadmeMeta('# Hi\n'), { factorioVersion: undefined, platform: undefined, cpu: undefined });
  });
});

describe('readmeMeta', () => {
  it('takes the frontmatter keys', () => {
    const m = readmeMeta(fm('factorioVersion: "2.0.72"\nplatform: windows-x86_64\ncpu: Ryzen 9800X3D') + '# Body\n');
    assert.deepEqual(m, { factorioVersions: ['2.0.72'], platforms: ['windows-x86_64'], cpu: 'Ryzen 9800X3D', publishedDate: undefined });
  });
  it('lets the frontmatter win over a different header line', () => {
    const m = readmeMeta(fm('factorioVersion: "2.0.72"\nplatform: windows-x86_64\ncpu: New CPU') + header);
    assert.deepEqual(m.factorioVersions, ['2.0.72']);
    assert.deepEqual(m.platforms, ['windows-x86_64']);
    assert.equal(m.cpu, 'New CPU');
  });
  it('takes a list of versions from the frontmatter, in order', () => {
    assert.deepEqual(readmeMeta(fm('factorioVersion: ["2.0.55", "2.1.9"]') + '# Body\n').factorioVersions, ['2.0.55', '2.1.9']);
  });
  it('lets a frontmatter list win over the header line', () => {
    assert.deepEqual(readmeMeta(fm('factorioVersion: ["2.0.55", "2.1.9"]') + header).factorioVersions, ['2.0.55', '2.1.9']);
  });
  it('reads the header line as a one-item list', () => {
    assert.deepEqual(readmeMeta(header).factorioVersions, ['2.0.60']);
  });
  it('falls back to the header line when the frontmatter list is bad', () => {
    assert.deepEqual(readmeMeta(fm('factorioVersion: [2.1]') + header).factorioVersions, ['2.0.60']);
  });
  it('takes a list of platforms from the frontmatter, in order', () => {
    assert.deepEqual(readmeMeta(fm('platform: [windows-x86_64, linux-x86_64]') + '# Body\n').platforms, ['windows-x86_64', 'linux-x86_64']);
  });
  it('splits a comma string of platforms, in the frontmatter and in the header line', () => {
    assert.deepEqual(readmeMeta(fm('platform: "windows-x86_64, linux-x86_64"') + '# Body\n').platforms, ['windows-x86_64', 'linux-x86_64']);
    assert.deepEqual(readmeMeta('**Platform:** windows-x86_64, linux-x86_64  \n').platforms, ['windows-x86_64', 'linux-x86_64']);
  });
  it('falls back to the header lines when the keys are missing', () => {
    const m = readmeMeta(fm('title: x') + header);
    assert.deepEqual([m.factorioVersions, m.platforms, m.cpu], [['2.0.60'], ['linux-x86_64'], 'Old CPU']);
  });
  it('falls back to the header lines in a README with no frontmatter at all', () => {
    assert.deepEqual(readmeMeta(header).platforms, ['linux-x86_64']);
  });
  it('mixes the two sources value by value', () => {
    const m = readmeMeta(fm('platform: windows-x86_64') + header);
    assert.deepEqual([m.factorioVersions, m.platforms, m.cpu], [['2.0.60'], ['windows-x86_64'], 'Old CPU']);
  });
  it('does not read header-like lines out of the frontmatter text itself', () => {
    const m = readmeMeta(fm('summary: "**Platform:** inside the frontmatter"') + '# Body\n');
    assert.equal(m.platforms, undefined);
  });
  it('carries published_date', () => {
    assert.equal(readmeMeta(fm('published_date: 2026-11-19') + '# Body\n').publishedDate, '2026-11-19');
  });
  it('survives frontmatter that never closes', () => {
    assert.deepEqual(readmeMeta('---\nplatform: x\n\n# Body\n' + header).platforms, ['linux-x86_64']);
  });
});

describe('resolveDate', () => {
  it('prefers published_date, then date, then nothing', () => {
    assert.equal(resolveDate({ published_date: '2026-11-19', date: '2026-11-01' }), '2026-11-19');
    assert.equal(resolveDate({ date: '2026-11-01' }), '2026-11-01');
    assert.equal(resolveDate({}), undefined);
  });
});
