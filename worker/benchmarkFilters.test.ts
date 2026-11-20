import assert from 'node:assert/strict';
import { test } from 'node:test';
import { benchmarkMatchText, matches, NO_FILTERS, versionOptions } from '../src/benchmarkFilters.ts';
import type { BenchmarkEntry, BenchmarkSummary } from '../src/content.ts';

const entry = (title: string, factorioVersions?: string[]) =>
  ({ slug: title, title, factorioVersions, saves: [] }) as unknown as BenchmarkEntry;

const both = entry('Both', ['2.0.55', '2.1.9']);
const old = entry('Old', ['2.0.72']);
const none = entry('None');
const label = (id: string) => id;

test('benchmarkMatchText: holds every version, and a benchmark without versions is still matched by its title', () => {
  const text = benchmarkMatchText(both as BenchmarkSummary, undefined);
  assert.ok(text.includes('2.0.55') && text.includes('2.1.9'));
  assert.ok(benchmarkMatchText(none as BenchmarkSummary, undefined).includes('none'));
  assert.ok(matches(both, { ...NO_FILTERS, q: '2.1.9' }, label));
  assert.ok(matches(none, { ...NO_FILTERS, q: 'none' }, label));
  assert.equal(matches(old, { ...NO_FILTERS, q: '2.1.9' }, label), false);
});

test('versionOptions: every major.minor of every list once, newest first', () => {
  assert.deepEqual(versionOptions([old, both, none]), ['2.1', '2.0']);
  assert.deepEqual(versionOptions([none]), []);
});

test('matches: a version filter keeps a benchmark that lists the minor, and drops one with none or another', () => {
  for (const version of ['2.0', '2.1']) assert.ok(matches(both, { ...NO_FILTERS, version }, label), version);
  assert.ok(matches(old, { ...NO_FILTERS, version: '2.0' }, label));
  assert.equal(matches(old, { ...NO_FILTERS, version: '2.1' }, label), false);
  assert.equal(matches(none, { ...NO_FILTERS, version: '2.0' }, label), false);
  assert.equal(matches(both, { ...NO_FILTERS, version: '2.2' }, label), false);
});
