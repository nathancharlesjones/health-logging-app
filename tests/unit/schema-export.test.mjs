import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA, KINDS, QUICK, exportReadme, buildExportFiles, parseExportFiles, validate, fieldsToForm, logicalDay, addDays, ymd } from '../../app/logic.js';
import { makeZip, readZip } from '../../app/zip.js';
import { simulateStudy } from '../../tools/simulate.mjs';

const TYPES = new Set(['number', 'time', 'text', 'scale', 'chips', 'stepper', 'photos']);
const enc = new TextEncoder();

test('schema is internally consistent', () => {
  assert.deepEqual(Object.keys(SCHEMA).sort(), Object.keys(KINDS).sort());
  for (const k of QUICK) assert.ok(KINDS[k] && !KINDS[k].checkin, `quick button ${k}`);
  for (const [kind, fields] of Object.entries(SCHEMA)) {
    const keys = fields.map((f) => f.k);
    assert.equal(new Set(keys).size, keys.length, `${kind} has duplicate keys`);
    for (const f of fields) {
      assert.ok(TYPES.has(f.t), `${kind}.${f.k} has unknown type ${f.t}`);
      assert.ok(f.label, `${kind}.${f.k} has no label`);
      if (f.t === 'number') assert.ok(f.min < f.max && f.unit, `${kind}.${f.k} needs min<max and a unit`);
      if (f.t === 'scale') assert.ok(f.n >= 2 && f.lo && f.hi, `${kind}.${f.k} scale needs n, lo, hi`);
      if (f.t === 'chips') assert.equal(new Set(f.opts).size, f.opts.length, `${kind}.${f.k} duplicate options`);
    }
  }
});

test('export README documents every kind and every field (so the end-of-study analysis can read it)', () => {
  const readme = exportReadme();
  for (const [kind, fields] of Object.entries(SCHEMA)) {
    assert.match(readme, new RegExp(`\\b${kind}\\b`));
    for (const f of fields) assert.match(readme, new RegExp(`\\b${f.k}\\b`), `${kind}.${f.k} missing from README`);
  }
});

const roundTrip = (entries, photos) => {
  const files = buildExportFiles({ entries, photos, startDay: '2026-11-16', now: new Date(), timezone: 'America/Chicago' });
  return makeZip(files).arrayBuffer().then((buf) => parseExportFiles(readZip(buf)));
};

test('export -> zip -> import round-trips a whole simulated study exactly', async () => {
  const { entries, photos } = simulateStudy({ seed: 7 });
  const back = await roundTrip(entries, photos);
  const sort = (a) => [...a].sort((x, y) => x.id.localeCompare(y.id));
  assert.deepEqual(sort(back.entries), sort(entries));
  assert.deepEqual(sort(back.photos).map((p) => [p.id, p.type, Buffer.from(p.data).toString('hex')]),
    sort(photos).map((p) => [p.id, p.type, Buffer.from(p.data).toString('hex')]));
  assert.equal(back.meta.study_start_day, '2026-11-16');
});

test('import rejects bad backups with readable errors (before anything is written)', async () => {
  const good = simulateStudy({ seed: 3, days: 2 });
  const json = (obj) => [{ name: 'entries.json', data: enc.encode(typeof obj === 'string' ? obj : JSON.stringify(obj)) }];
  const meta = (o) => ({ app: 'turtle-log', schema: 1, entries: [], ...o });
  assert.throws(() => parseExportFiles([]), /no entries\.json/);
  assert.throws(() => parseExportFiles(json('{oops')), /not valid JSON/);
  assert.throws(() => parseExportFiles(json(meta({ app: 'other' }))), /not a Turtle Log export/);
  assert.throws(() => parseExportFiles(json(meta({ schema: 99 }))), /newer version/);
  assert.throws(() => parseExportFiles(json(meta({ entries: [{ id: 'x', kind: 'bogus', occurred_at: 'x', fields: {}, photos: [] }] }))), /Entry 1.*malformed/);
  const withPhoto = good.entries.find((e) => e.photos.length);
  assert.throws(() => parseExportFiles(json(meta({ entries: [withPhoto] }))), /photo\(s\).*missing/);
  assert.equal(parseExportFiles(json(meta({}))).entries.length, 0);   // an empty backup is valid
});

test('simulator: deterministic per seed, varied across seeds', () => {
  const a = JSON.stringify(simulateStudy({ seed: 1 }).entries);
  assert.equal(a, JSON.stringify(simulateStudy({ seed: 1 }).entries));
  assert.notEqual(a, JSON.stringify(simulateStudy({ seed: 2 }).entries));
});

test('simulator: every simulated entry is something the app itself would accept', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const { entries } = simulateStudy({ seed });
    for (const e of entries) {
      const r = validate({ kind: e.kind, vals: fieldsToForm(e.kind, e.fields), photoIds: e.photos,
        occurred: new Date(e.occurred_at), now: new Date('2030-01-01') });
      assert.deepEqual(r.errors, [], `${e.id}`);
      assert.deepEqual(r.warnings, [], `${e.id} ${JSON.stringify(e.fields)}`);
      assert.equal(e.day, logicalDay(new Date(e.occurred_at)), `${e.id} day`);
    }
  }
});

test('simulator: one morning and one evening per day, plus after-midnight snacks on the right day', () => {
  const start = '2026-11-16';
  const { entries } = simulateStudy({ seed: 1, startDay: start });
  for (let i = 0; i < 14; i++) {
    const day = addDays(start, i);
    for (const k of ['morning', 'evening']) assert.equal(entries.filter((e) => e.day === day && e.kind === k).length, 1, `${day} ${k}`);
  }
  const midnightSnacks = entries.filter((e) => e.kind === 'meal' && new Date(e.occurred_at).getHours() < 4);
  assert.ok(midnightSnacks.length > 0, 'expected at least one after-midnight snack');
  for (const s of midnightSnacks) assert.equal(s.day, addDays(ymd(new Date(s.occurred_at)), -1), 'snack after midnight counts toward the previous evening');
  assert.ok(entries.some((e) => e.logged_at > e.occurred_at), 'expected some after-the-fact entries');
});
