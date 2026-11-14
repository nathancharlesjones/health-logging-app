import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNumber, formToFields, fieldsToForm, validate, buildEntry, snapshot, summary, byTime, SCHEMA, KINDS,
} from '../../app/logic.js';

const now = new Date(2026, 10, 16, 12, 0);   // Mon Nov 16 2026, noon local

test('parseNumber accepts what people type and rejects what they dictate', () => {
  for (const [s, n] of [['201.4', 201.4], ['201,4', 201.4], [' 38 ', 38], ['.5', 0.5], ['40.', 40], [7, 7]]) assert.equal(parseNumber(s), n, s);
  for (const s of ['two hundred', '201.4 lb', '38in', '1e3', '', '--1', 'NaN', Infinity]) assert.ok(Number.isNaN(parseNumber(s)), String(s));
});

test('formToFields: converts numbers, drops empties, reports unparseable input instead of losing it', () => {
  const { fields, errors } = formToFields('morning', { weight: '201.4', waist: '', plan: [], text: 'hi', sleep_quality: 4 });
  assert.deepEqual(fields, { weight: 201.4, text: 'hi', sleep_quality: 4 });
  assert.deepEqual(errors, []);
  const bad = formToFields('morning', { weight: 'two hundred and one' });
  assert.equal(bad.errors.length, 1);
  assert.match(bad.errors[0], /Weight.*two hundred and one.*isn't a number/);
});

test('fieldsToForm -> formToFields round-trips stored entries', () => {
  for (const [kind, fields] of [
    ['morning', { weight: 201.4, waist: 38.5, bed_time: '22:30', sleep_quality: 4, plan: ['climb', 'yoga'], wakeups: 0 }],
    ['measure', { waist: 38, hips: 41.25, neck: 15.5, weight: 200 }],
    ['activity', { activity: 'run', minutes: 30, effort: 7 }],
  ]) {
    const form = fieldsToForm(kind, fields);
    const expected = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== 0 || true));
    assert.deepEqual(formToFields(kind, form).fields, expected);
  }
});

test('validate: errors block saving', () => {
  const v = (o) => validate({ kind: 'meal', vals: {}, photoIds: [], occurred: now, now, ...o });
  assert.deepEqual(v({}).errors, ['Nothing to save yet']);
  assert.deepEqual(v({ photoIds: ['p1'] }).errors, []);                      // photo-only meal is fine
  assert.deepEqual(v({ vals: { meal: 'lunch' }, occurred: new Date('nope') }).errors, ['Pick a valid date and time']);
  assert.equal(validate({ kind: 'morning', vals: { weight: 'abc' }, occurred: now, now }).errors.length, 1);
});

test('validate: implausible values, future times and duplicate check-ins are warnings', () => {
  const w = validate({ kind: 'morning', vals: { weight: '2014' }, occurred: now, now }).warnings;
  assert.equal(w.length, 1);
  assert.match(w[0], /Weight 2014 lb is outside the usual 80–450/);
  assert.deepEqual(validate({ kind: 'morning', vals: { weight: '201' }, occurred: now, now }).warnings, []);

  const future = new Date(now.getTime() + 60 * 60e3);
  assert.deepEqual(validate({ kind: 'note', vals: { text: 'x' }, occurred: future, now }).warnings, ['The time is in the future']);
  const soon = new Date(now.getTime() + 5 * 60e3);
  assert.deepEqual(validate({ kind: 'note', vals: { text: 'x' }, occurred: soon, now }).warnings, []);

  const existing = [{ id: 'm1', kind: 'morning' }, { id: 'x', kind: 'meal' }];
  const dup = validate({ kind: 'morning', vals: { weight: '201' }, occurred: now, now, sameDayEntries: existing });
  assert.match(dup.warnings[0], /already a morning check-in/);
  // editing that same check-in is not a duplicate
  assert.deepEqual(validate({ kind: 'morning', vals: { weight: '201' }, occurred: now, now, sameDayEntries: existing, id: 'm1' }).warnings, []);
  // meals can repeat freely
  assert.deepEqual(validate({ kind: 'meal', vals: { meal: 'snack' }, occurred: now, now, sameDayEntries: existing }).warnings, []);
});

test('buildEntry: new entries get ids and timestamps; edits keep id and logged_at', () => {
  const occurred = new Date(2026, 10, 17, 1, 30);          // 1:30am Tue -> belongs to Mon
  const e = buildEntry({ kind: 'meal', fields: { meal: 'snack' }, photoIds: ['p'], occurred, now });
  assert.equal(e.day, '2026-11-16');
  assert.equal(e.occurred_at, occurred.toISOString());
  assert.equal(e.logged_at, now.toISOString());
  assert.match(e.id, /^[0-9a-f-]{36}$/);
  const later = new Date(now.getTime() + 3600e3);
  const edited = buildEntry({ existing: e, kind: 'meal', fields: { meal: 'dinner' }, photoIds: [], occurred, now: later });
  assert.equal(edited.id, e.id);
  assert.equal(edited.logged_at, e.logged_at);
  assert.equal(edited.updated_at, later.toISOString());
  assert.deepEqual(edited.photos, []);
});

test('snapshot: ignores empty values and key order, notices real changes', () => {
  const a = snapshot({ vals: { b: 1, a: 'x', c: '', d: [] }, when: 't', photoIds: [] });
  const b = snapshot({ vals: { a: 'x', b: 1 }, when: 't', photoIds: [] });
  assert.equal(a, b);
  assert.notEqual(a, snapshot({ vals: { a: 'x', b: 2 }, when: 't', photoIds: [] }));
  assert.notEqual(a, snapshot({ vals: { a: 'x', b: 1 }, when: 'u', photoIds: [] }));
  assert.notEqual(a, snapshot({ vals: { a: 'x', b: 1 }, when: 't', photoIds: ['p'] }));
});

test('summary: readable for every kind with full, partial and empty data', () => {
  const full = {
    morning: { weight: 201.4, waist: 38.5, sleep_quality: 4, plan: ['climb'] },
    evening: { plan_done: 'partly', stress: 3, energy: 2 },
    meal: { meal: 'lunch', text: 'x'.repeat(200) },
    drink: { drink: 'beer', count: 2 },
    activity: { activity: 'climb', minutes: 60, effort: 7, text: 'good session' },
    measure: { waist: 38, hips: 41, neck: 15, weight: 200 },
    note: { text: 'hello' },
  };
  for (const kind of Object.keys(KINDS)) {
    for (const [fields, photos] of [[full[kind], ['p']], [{}, []], [{}, ['p', 'q']]]) {
      const s = summary({ kind, fields, photos });
      assert.ok(s.length > 0, `${kind} empty summary`);
      assert.doesNotMatch(s, /undefined|null|NaN|\[object/, `${kind}: ${s}`);
      assert.ok(s.length < 140, `${kind} summary too long: ${s}`);
    }
  }
  assert.equal(summary({ kind: 'drink', fields: { drink: 'beer', count: 2 }, photos: [] }), '2× beer');
  assert.equal(summary({ kind: 'morning', fields: { weight: 0 }, photos: [] }), '0 lb');   // zero is a value, not "missing"
});

test('every schema field round-trips through validate without errors when filled sensibly', () => {
  const sample = { number: (f) => String((f.min + f.max) / 2), time: () => '07:15', text: () => 'note', scale: (f) => f.n,
    chips: (f) => (f.multi ? [f.opts[0]] : f.opts[0]), stepper: () => 1 };
  for (const [kind, fields] of Object.entries(SCHEMA)) {
    const vals = Object.fromEntries(fields.filter((f) => f.t !== 'photos').map((f) => [f.k, sample[f.t](f)]));
    const r = validate({ kind, vals, occurred: now, now });
    assert.deepEqual(r.errors, [], kind);
    assert.deepEqual(r.warnings, [], kind);
  }
});

test('byTime: stable order even when times are identical', () => {
  const t = '2026-11-16T15:00:00.000Z';
  const es = [
    { id: 'c', occurred_at: t, logged_at: '2026-11-16T15:05:00.000Z' },
    { id: 'b', occurred_at: t, logged_at: '2026-11-16T15:01:00.000Z' },
    { id: 'a', occurred_at: t, logged_at: '2026-11-16T15:01:00.000Z' },
    { id: 'z', occurred_at: '2026-11-16T14:00:00.000Z', logged_at: '2026-11-16T16:00:00.000Z' },
  ];
  for (let i = 0; i < 10; i++) {
    const shuffled = [...es].sort(() => Math.random() - 0.5);
    assert.deepEqual(shuffled.sort(byTime).map((e) => e.id), ['z', 'a', 'b', 'c']);
  }
});
