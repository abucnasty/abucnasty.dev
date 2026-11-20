// The save browser's per-folder metadata: version and platform from the README (frontmatter first),
// and the date from the benchmark entry, else the README's published_date, else the folder name.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { buildSaveIndex } from './save-index.mjs';

const roots = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const POINTER = `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize 10\n`;

/** A git repo with one folder per entry: { folder: README text }, each holding one save pointer. */
function repo(folders) {
  const root = mkdtempSync(path.join(tmpdir(), 'save-index-test-'));
  roots.push(root);
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'pipe' });
  git('init', '-q');
  for (const [folder, readme] of Object.entries(folders)) {
    mkdirSync(path.join(root, 'benchmarks', folder), { recursive: true });
    writeFileSync(path.join(root, 'benchmarks', folder, 'save.zip'), POINTER);
    if (readme !== null) writeFileSync(path.join(root, 'benchmarks', folder, 'README.md'), readme);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'x');
  return root;
}

const build = (folders, benchmarks = []) =>
  buildSaveIndex({ repoPath: repo(folders), lfsWorkerUrl: 'https://lfs.example', benchmarks }).meta;

describe('save index metadata', () => {
  it('takes version and platform from the frontmatter before the header lines', () => {
    const readme = '---\nfactorioVersion: "2.0.72"\nplatform: windows-x86_64\n---\n\n**Factorio Version:** 2.0.10\n**Platform:** linux-x86_64\n';
    const m = build({ '2026-01-01-a': readme })['benchmarks/2026-01-01-a'];
    assert.equal(m.factorio_version, '2.0.72');
    assert.equal(m.benchmark_machine_platform, 'windows-x86_64');
  });
  it('joins the versions of a list with a comma', () => {
    const readme = '---\nfactorioVersion: ["2.0.55", "2.1.9"]\n---\n\n**Factorio Version:** 2.0.10\n';
    assert.equal(build({ '2026-01-01-a': readme })['benchmarks/2026-01-01-a'].factorio_version, '2.0.55, 2.1.9');
  });
  it('joins the platforms of a list, or of a comma string, with a comma', () => {
    const list = '---\nplatform: [windows-x86_64, linux-x86_64]\n---\n';
    assert.equal(build({ '2026-01-01-a': list })['benchmarks/2026-01-01-a'].benchmark_machine_platform, 'windows-x86_64, linux-x86_64');
    const header = '# A\n\n**Platform:** windows-x86_64, linux-x86_64\n';
    assert.equal(build({ '2026-01-01-a': header })['benchmarks/2026-01-01-a'].benchmark_machine_platform, 'windows-x86_64, linux-x86_64');
  });
  it('keeps one version as a plain string', () => {
    const readme = '---\nfactorioVersion: ["2.1.24"]\n---\n';
    assert.equal(build({ '2026-01-01-a': readme })['benchmarks/2026-01-01-a'].factorio_version, '2.1.24');
  });
  it('falls back to the header lines of an old README', () => {
    const readme = '# A\n\n**Factorio Version:** 2.0.10\n**Platform:** linux-x86_64\n';
    const m = build({ '2026-01-01-a': readme })['benchmarks/2026-01-01-a'];
    assert.equal(m.factorio_version, '2.0.10');
    assert.equal(m.benchmark_machine_platform, 'linux-x86_64');
  });
  it('reads a header line below a frontmatter block, mixing the sources', () => {
    const readme = '---\nplatform: windows-x86_64\n---\n\n**Factorio Version:** 2.0.10\n';
    const m = build({ '2026-01-01-a': readme })['benchmarks/2026-01-01-a'];
    assert.equal(m.factorio_version, '2.0.10');
    assert.equal(m.benchmark_machine_platform, 'windows-x86_64');
  });
  it('uses the README published_date before the folder-name date', () => {
    const readme = '---\npublished_date: 2026-05-05\n---\n\n# A\n';
    assert.equal(build({ '2026-01-01-a': readme })['benchmarks/2026-01-01-a'].benchmark_date, '2026-05-05');
  });
  it('uses the folder-name date when the README has none', () => {
    assert.equal(build({ '2026-01-01-a': '# A\n' })['benchmarks/2026-01-01-a'].benchmark_date, '2026-01-01');
  });
  it('uses the benchmark entry date before both', () => {
    const readme = '---\npublished_date: 2026-05-05\n---\n\n# A\n';
    const entry = { slug: 'a', source: 'benchmarks/2026-01-01-a', title: 'A', date: '2026-06-06' };
    assert.equal(build({ '2026-01-01-a': readme }, [entry])['benchmarks/2026-01-01-a'].benchmark_date, '2026-06-06');
  });
});
