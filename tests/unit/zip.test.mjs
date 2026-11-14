import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, makeZip, readZip } from '../../app/zip.js';

const enc = new TextEncoder();
const toBuf = async (blob) => Buffer.from(await blob.arrayBuffer());
// Node may hand back a slice of a shared pool, so copy out exactly this file's bytes.
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
const has = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;

test('crc32 matches published check values', () => {
  assert.equal(crc32(new Uint8Array()), 0);
  assert.equal(crc32(enc.encode('123456789')), 0xCBF43926);
  assert.equal(crc32(enc.encode('The quick brown fox jumps over the lazy dog')), 0x414FA339);
});

const sample = () => {
  const big = new Uint8Array(1_000_000);
  for (let i = 0; i < big.length; i++) big[i] = (i * 2654435761) >>> 24;
  return [
    { name: 'README.txt', data: enc.encode('hello\n') },
    { name: 'empty.bin', data: new Uint8Array() },
    { name: 'photos/ünïcødé 🐢.jpg', data: enc.encode('not really a jpeg') },
    { name: 'photos/big.bin', data: big },
  ];
};

test('makeZip -> readZip round-trips names and bytes exactly', async () => {
  const files = sample();
  const back = readZip(ab(await toBuf(makeZip(files))));
  assert.deepEqual(back.map((f) => f.name), files.map((f) => f.name));
  back.forEach((f, i) => assert.deepEqual(f.data, files[i].data));
});

test('our zips pass independent validators (Python zipfile, unzip -t)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tlzip-'));
  const path = join(dir, 'out.zip');
  writeFileSync(path, await toBuf(makeZip(sample())));
  if (has('python3')) {
    const py = spawnSync('python3', ['-c',
      'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(len(z.namelist()))', path]);
    assert.equal(py.status, 0, py.stderr.toString());
    assert.equal(py.stdout.toString().trim(), '4');
  } else t.diagnostic('python3 not found; skipped');
  if (has('unzip')) {
    const uz = spawnSync('unzip', ['-t', path]);
    assert.equal(uz.status, 0, uz.stdout.toString());
  } else t.diagnostic('unzip not found; skipped');
});

test('readZip reads a stored zip written by another tool', (t) => {
  if (!has('python3')) return t.skip('python3 not found');
  const dir = mkdtempSync(join(tmpdir(), 'tlzip-'));
  const path = join(dir, 'py.zip');
  spawnSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_STORED); z.writestr("entries.json","{}"); z.close()', path]);
  const files = readZip(ab(readFileSync(path)));
  assert.equal(files[0].name, 'entries.json');
  assert.equal(Buffer.from(files[0].data).toString(), '{}');
});

test('readZip rejects compressed zips with a clear message', (t) => {
  if (!has('python3')) return t.skip('python3 not found');
  const dir = mkdtempSync(join(tmpdir(), 'tlzip-'));
  const path = join(dir, 'deflated.zip');
  spawnSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED); z.writestr("entries.json","{}"*100); z.close()', path]);
  assert.throws(() => readZip(ab(readFileSync(path))), /compressed/);
});

test('readZip rejects non-zip data', () => {
  assert.throws(() => readZip(enc.encode('definitely not a zip file at all, just text').buffer), /Not a zip/);
  assert.throws(() => readZip(new ArrayBuffer(0)), /Not a zip/);
});
