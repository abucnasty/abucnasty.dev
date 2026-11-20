import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { gzipSync, zstdCompressSync } from 'node:zlib';
import { aggregateScenarioCsv, requireResultFile, resolveResultFile } from './aggregate.mjs';

const CSV = [
  'tick,run,wholeUpdate,entityUpdate',
  ...Array.from({ length: 400 }, (_, i) => {
    const tick = 31 + (i % 200);
    const run = Math.floor(i / 200);
    return `${tick},${run},${1000 * tick + run * 500},${200 * tick}`;
  }),
].join('\n');

/** Run `fn` with a fresh temporary directory, removed afterwards. */
async function inTmp(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'aggregate-test-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('plain, .zst and .gz files of the same CSV give equal series', async () => {
  await inTmp(async (dir) => {
    await writeFile(path.join(dir, 'a.csv'), CSV);
    await writeFile(path.join(dir, 'a.csv.zst'), zstdCompressSync(CSV));
    await writeFile(path.join(dir, 'a.csv.gz'), gzipSync(CSV));
    const plain = await aggregateScenarioCsv(path.join(dir, 'a.csv'));
    assert.ok(plain.metrics.wholeUpdate.length > 0);
    assert.deepEqual(await aggregateScenarioCsv(path.join(dir, 'a.csv.zst')), plain);
    assert.deepEqual(await aggregateScenarioCsv(path.join(dir, 'a.csv.gz')), plain);
  });
});

test('a corrupt .zst fails with a message naming the file', async () => {
  await inTmp(async (dir) => {
    const file = path.join(dir, 'bad.csv.zst');
    await writeFile(file, Buffer.from('this is not zstd data at all'));
    await assert.rejects(aggregateScenarioCsv(file), (err) => {
      assert.ok(err.message.includes(file), err.message);
      assert.match(err.message, /zst|compress|decompress/i);
      return true;
    });
  });
});

test('a corrupt .gz fails with a message naming the file', async () => {
  await inTmp(async (dir) => {
    const file = path.join(dir, 'bad.csv.gz');
    await writeFile(file, Buffer.from('this is not gzip data at all'));
    await assert.rejects(aggregateScenarioCsv(file), (err) => err.message.includes(file));
  });
});

test('resolveResultFile: the named file wins when it exists', async () => {
  await inTmp(async (dir) => {
    await writeFile(path.join(dir, 'a.csv'), CSV);
    await writeFile(path.join(dir, 'a.csv.zst'), zstdCompressSync(CSV));
    assert.equal(await resolveResultFile(path.join(dir, 'a.csv.zst')), path.join(dir, 'a.csv.zst'));
    assert.equal(await resolveResultFile(path.join(dir, 'a.csv')), path.join(dir, 'a.csv'));
  });
});

test('resolveResultFile: a missing file falls back to its sibling, order .csv, .csv.zst, .csv.gz', async () => {
  await inTmp(async (dir) => {
    const named = path.join(dir, 'a.csv');
    await writeFile(path.join(dir, 'a.csv.gz'), gzipSync(CSV));
    assert.equal(await resolveResultFile(named), path.join(dir, 'a.csv.gz'));
    await writeFile(path.join(dir, 'a.csv.zst'), zstdCompressSync(CSV));
    assert.equal(await resolveResultFile(named), path.join(dir, 'a.csv.zst'));
    await writeFile(path.join(dir, 'a.csv'), CSV);
    assert.equal(await resolveResultFile(path.join(dir, 'a.csv.gz')), path.join(dir, 'a.csv.gz'));
    await rm(path.join(dir, 'a.csv.gz'));
    assert.equal(await resolveResultFile(path.join(dir, 'a.csv.gz')), path.join(dir, 'a.csv'));
  });
});

test('resolveResultFile: no file at all returns null', async () => {
  await inTmp(async (dir) => {
    assert.equal(await resolveResultFile(path.join(dir, 'none.csv')), null);
    assert.equal(await resolveResultFile(path.join(dir, 'none.csv.zst')), null);
  });
});

test('requireResultFile: a missing file keeps the existing error text', async () => {
  await inTmp(async (dir) => {
    const named = path.join(dir, 'none.csv');
    await assert.rejects(
      requireResultFile(named, 'chart csv missing: some-slug → none.csv'),
      { message: `chart csv missing: some-slug → none.csv (looked at ${named})` },
    );
  });
});

test('requireResultFile: returns the sibling when the named file is missing', async () => {
  await inTmp(async (dir) => {
    await writeFile(path.join(dir, 'a.csv.zst'), zstdCompressSync(CSV));
    assert.equal(await requireResultFile(path.join(dir, 'a.csv'), 'missing'), path.join(dir, 'a.csv.zst'));
  });
});
