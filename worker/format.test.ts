import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatPlatform, formatPlatforms, splitPlatforms } from '../src/format.ts';

test('formatPlatforms: each platform is formatted on its own, so linux-vs-windows shows both', () => {
  assert.equal(formatPlatforms('windows-x86_64, linux-x86_64'), 'Windows, Linux');
  assert.deepEqual(splitPlatforms('windows-x86_64, linux-x86_64').map(formatPlatform), ['Windows', 'Linux']);
  assert.equal(formatPlatforms('linux-x86_64'), 'Linux');
  assert.equal(formatPlatforms('plan9-arm, darwin-arm64'), 'plan9-arm, macOS');
});

test('formatPlatform on the joined string shows only the first match (the old bug)', () => {
  assert.equal(formatPlatform('windows-x86_64, linux-x86_64'), 'Windows');
});
