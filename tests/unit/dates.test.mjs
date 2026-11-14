// These run once per timezone (see tools/run-unit.mjs), so nothing here may
// assume a particular zone except the explicitly Chicago-only test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  logicalDay, ymd, parseDay, addDays, daysBetween, toLocalInput, isWaistDay, defaultTime,
  studyDayLabel, exportAgeDays, DAY_START_HOUR,
} from '../../app/logic.js';

const local = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm);

test('day boundary is 04:00 local: 03:59 is yesterday, 04:00 is today', () => {
  assert.equal(DAY_START_HOUR, 4);
  assert.equal(logicalDay(local(2026, 11, 17, 3, 59)), '2026-11-16');
  assert.equal(logicalDay(local(2026, 11, 17, 4, 0)), '2026-11-17');
  assert.equal(logicalDay(local(2026, 11, 17, 0, 30)), '2026-11-16');   // midnight snack
  assert.equal(logicalDay(local(2026, 11, 17, 23, 59)), '2026-11-17');
  assert.equal(logicalDay(local(2027, 1, 1, 1, 0)), '2026-12-31');       // across a year
});

test('every hour of 2026–2027 lands on the right day, including DST changes', () => {
  // Exhaustive: catches the classic bug of subtracting 4 elapsed hours, which
  // misfiles 04:00–05:00 on spring-forward mornings.
  for (let d = local(2026, 1, 1); d < local(2028, 1, 1); d.setDate(d.getDate() + 1)) {
    const today = ymd(d);
    const yesterday = addDays(today, -1);
    for (let hh = 0; hh < 24; hh++) {
      for (const mm of [0, 30, 59]) {
        const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm);
        if (ymd(t) !== today) continue;      // local time that doesn't exist (DST gap) rolled into another day
        const expected = t.getHours() < DAY_START_HOUR ? yesterday : today;
        assert.equal(logicalDay(t), expected, `${t.toString()}`);
      }
    }
  }
});

test('Chicago: spring-forward and fall-back mornings specifically', { skip: process.env.TZ !== 'America/Chicago' }, () => {
  assert.equal(logicalDay(local(2026, 3, 8, 4, 30)), '2026-03-08');   // 1 hour after the 2am jump
  assert.equal(logicalDay(local(2026, 3, 8, 3, 30)), '2026-03-07');
  // 01:30 happens twice on Nov 1; both belong to Oct 31.
  const first = new Date('2026-11-01T06:30:00Z');   // 01:30 CDT
  const second = new Date('2026-11-01T07:30:00Z');  // 01:30 CST
  assert.equal(logicalDay(first), '2026-10-31');
  assert.equal(logicalDay(second), '2026-10-31');
  assert.equal(logicalDay(new Date('2026-11-01T10:00:00Z')), '2026-11-01');  // 04:00 CST
});

test('addDays / daysBetween agree across month ends, leap days and DST', () => {
  for (let base = '2027-12-20'; base !== '2028-04-01'; base = addDays(base, 1)) {
    for (const n of [-400, -40, -1, 0, 1, 7, 13, 40, 400]) {
      const other = addDays(base, n);
      assert.equal(daysBetween(base, other), n, `${base} + ${n}`);
      assert.match(other, /^\d{4}-\d{2}-\d{2}$/);
    }
  }
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2027-02-28', 1), '2027-03-01');
});

test('parseDay / ymd round-trip', () => {
  for (const s of ['2026-01-01', '2026-03-08', '2026-11-01', '2028-02-29', '2026-12-31']) assert.equal(ymd(parseDay(s)), s);
});

test('toLocalInput produces a value <input type=datetime-local> parses back to the same minute', () => {
  const d = local(2026, 11, 16, 9, 5);
  assert.equal(toLocalInput(d), '2026-11-16T09:05');
  assert.equal(new Date(toLocalInput(d)).getTime(), d.getTime());
});

test('waist days are Monday, Wednesday and Friday', () => {
  const expect = { '2026-11-15': false, '2026-11-16': true, '2026-11-17': false, '2026-11-18': true,
    '2026-11-19': false, '2026-11-20': true, '2026-11-21': false };
  for (const [day, want] of Object.entries(expect)) assert.equal(isWaistDay(day), want, day);
});

test('defaultTime: now for today, sensible clock times for past days', () => {
  const now = local(2026, 11, 16, 13, 7);
  assert.equal(defaultTime('meal', '2026-11-16', now).getTime(), now.getTime());
  assert.equal(toLocalInput(defaultTime('morning', '2026-11-14', now)), '2026-11-14T07:30');
  assert.equal(toLocalInput(defaultTime('evening', '2026-11-14', now)), '2026-11-14T21:00');
  assert.equal(toLocalInput(defaultTime('meal', '2026-11-14', now)), '2026-11-14T12:00');
  // 01:00 is still "yesterday", so a new entry viewed on yesterday defaults to now
  const lateNight = local(2026, 11, 17, 1, 0);
  assert.equal(defaultTime('meal', '2026-11-16', lateNight).getTime(), lateNight.getTime());
});

test('studyDayLabel', () => {
  assert.equal(studyDayLabel('2026-11-16', '2026-11-16'), 'Day 1 of 14');
  assert.equal(studyDayLabel('2026-11-16', '2026-11-29'), 'Day 14 of 14');
  assert.equal(studyDayLabel('2026-11-16', '2026-11-30'), 'Day 15 (past 14)');
  assert.equal(studyDayLabel('2026-11-16', '2026-11-15'), '');
  assert.equal(studyDayLabel(null, '2026-11-15'), '');
});

test('exportAgeDays', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  assert.equal(exportAgeDays(null, now), null);
  assert.equal(exportAgeDays('2026-11-20T11:00:00Z', now), 0);
  assert.equal(exportAgeDays('2026-11-17T11:00:00Z', now), 3);
});
