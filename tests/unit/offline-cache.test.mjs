// The service worker must cache every file the app needs, or the app breaks
// offline the first time a new file is added and forgotten here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('../../app/', import.meta.url));
const NOT_NEEDED_OFFLINE = new Set(['sw.js', 'fonts/OFL-LICENSE.txt']);

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [relative(APP, p).split('\\').join('/')];
});

test('sw.js caches every app file, and nothing that does not exist', () => {
  const sw = readFileSync(join(APP, 'sw.js'), 'utf8');
  const list = [...sw.match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const files = walk(APP).filter((f) => !NOT_NEEDED_OFFLINE.has(f));
  assert.deepEqual([...list.filter((f) => f !== './')].sort(), files.sort());
});

test('every module import in the app points at a cached file', () => {
  const sw = readFileSync(join(APP, 'sw.js'), 'utf8');
  for (const f of walk(APP).filter((x) => x.endsWith('.js') && x !== 'sw.js')) {
    for (const [, dep] of readFileSync(join(APP, f), 'utf8').matchAll(/from '\.\/([^']+)'/g)) {
      assert.ok(sw.includes(`'${dep}'`), `${f} imports ${dep}, which sw.js doesn't cache`);
    }
  }
});
