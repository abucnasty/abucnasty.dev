// index.html's static tags (what every page without its own preview gets) and the Worker's
// SITE_URL (what it writes for blueprint, benchmark and blog pages) must name the same origin,
// and that origin must be the custom domain the Worker is deployed to.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { absoluteUrl } from './previews.ts';

const root = new URL('../', import.meta.url);
// wrangler.jsonc has only whole-line comments, so dropping those lines leaves plain JSON.
const wrangler = JSON.parse(
  readFileSync(new URL('wrangler.jsonc', root), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n'),
) as { vars: { SITE_URL: string }; routes?: { pattern: string; custom_domain?: boolean }[] };
const html = readFileSync(new URL('index.html', root), 'utf8');

const home = absoluteUrl(wrangler.vars.SITE_URL, '/');

test('SITE_URL is the origin of a custom domain the Worker is deployed to', () => {
  const site = new URL(wrangler.vars.SITE_URL);
  assert.equal(site.protocol, 'https:');
  assert.equal(site.origin, wrangler.vars.SITE_URL.replace(/\/+$/, ''));
  const domains = (wrangler.routes ?? []).filter((r) => r.custom_domain).map((r) => r.pattern);
  assert.ok(domains.includes(site.host), `${site.host} is not in routes: ${domains.join(', ')}`);
});

test("index.html's canonical, og:url and JSON-LD url are SITE_URL's home page", () => {
  assert.equal(/<link rel="canonical" href="([^"]*)"/.exec(html)?.[1], home);
  assert.equal(/<meta property="og:url" content="([^"]*)"/.exec(html)?.[1], home);
  const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(ld, 'no JSON-LD block');
  assert.equal((JSON.parse(ld) as { url: string }).url, home);
});

test('index.html names no other origin for the site', () => {
  assert.doesNotMatch(html, /github\.io/i);
});
