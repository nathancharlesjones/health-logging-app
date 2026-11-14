// simulate.mjs — generates a realistic, deterministic N-day study so the app
// can be exercised (and the end-of-study analysis rehearsed) without two weeks
// of real logging.
//
//   node tools/simulate.mjs out.zip [--start 2026-11-16] [--days 14] [--seed 1]
//
// The output is a normal Turtle Log export: import it from Settings.
// Built-in patterns, so an analysis has something real to find:
//   - workouts get skipped more after poor sleep or on high-stress days
//   - beer is likelier on Fri/Sat; some evenings end with a late snack after midnight
//   - some entries are logged after the fact (logged_at > occurred_at)
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { crc32, makeZip } from '../app/zip.js';
import { addDays, parseDay, isWaistDay, logicalDay, buildExportFiles, STUDY_DAYS } from '../app/logic.js';

// Small seeded PRNG (mulberry32) so the same seed always gives the same study.
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    noise: (sd) => (next() + next() + next() - 1.5) * sd * 2,  // ~normal
  };
}

// Minimal PNG encoder: solid-colour RGB image (stands in for food/body photos).
export function solidPng(w, h, [r, g, b]) {
  const row = 1 + w * 3;
  const raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * row + 1 + x * 3);
  const chunk = (type, data) => {
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;  // 8-bit RGB
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}

const MEALS = {
  breakfast: ['oatmeal with banana and coffee', 'two eggs, toast, coffee', 'greek yogurt and granola', 'bagel with cream cheese'],
  lunch: ['turkey sandwich and chips', 'leftover chili', 'chicken salad', 'burrito bowl', 'pb&j and an apple'],
  dinner: ['spaghetti and meatballs', 'grilled chicken, rice, broccoli', 'pizza, three slices', 'tacos', 'salmon and potatoes'],
  snack: ['handful of almonds', 'ice cream', 'chips and salsa', 'protein bar', 'cookies'],
};
const BARRIERS = ['kids had practice so ran out of time', 'too tired after bad sleep', 'work ran late',
  'shoulder felt sore', 'rained, skipped the run', 'just didn’t feel like it'];

export function simulateStudy({ startDay = '2026-11-16', days = STUDY_DAYS, seed = 1 } = {}) {
  const r = rng(seed);
  let idn = 0;
  const id = (p) => `sim-${seed}-${p}-${String(++idn).padStart(4, '0')}`;
  const entries = [];
  const photos = [];
  const at = (day, hh, mm, plusDays = 0) => { const d = parseDay(addDays(day, plusDays)); d.setHours(hh, mm, 0, 0); return d; };
  const photo = (rgb) => { const pid = id('p'); photos.push({ id: pid, type: 'image/png', data: solidPng(64, 48, rgb) }); return pid; };
  const add = (kind, occurred, fields, photoIds = [], lateMinutes = 0) => {
    const logged = new Date(occurred.getTime() + lateMinutes * 60e3);
    entries.push({ id: id(kind[0]), kind, day: logicalDay(occurred), occurred_at: occurred.toISOString(),
      logged_at: logged.toISOString(), updated_at: logged.toISOString(), fields, photos: photoIds });
  };
  const late = () => (r.chance(0.2) ? r.int(60, 600) : r.int(0, 5));

  let weight = 201.5;
  for (let i = 0; i < days; i++) {
    const day = addDays(startDay, i);
    const dow = parseDay(day).getDay();
    const weekend = dow === 0 || dow === 6;

    if (i === 0 || i === days - 1) {
      add('measure', at(day, 6, 40), { waist: +(38.6 + r.noise(0.2)).toFixed(1), hips: 41.5, neck: 15.5, weight: +weight.toFixed(1) },
        [photo([200, 170, 150]), photo([190, 165, 145]), photo([185, 160, 140])]);
    }

    const sleepQ = Math.max(1, Math.min(5, Math.round(3.2 + r.noise(0.9))));
    const bedMin = 22 * 60 + 30 + r.int(-30, 90);
    weight += r.noise(0.35) - 0.03;
    const plan = r.chance(0.25) ? ['rest'] : [r.pick(['climb', 'lift', 'run', 'yoga', 'walk'])];
    const morning = {
      weight: +weight.toFixed(1), bed_time: `${String(Math.floor(bedMin / 60) % 24).padStart(2, '0')}:${String(bedMin % 60).padStart(2, '0')}`,
      wake_time: `0${r.int(5, 6)}:${String(r.int(0, 59)).padStart(2, '0')}`, sleep_quality: sleepQ,
      wakeups: r.int(0, 3), energy: Math.max(1, Math.min(5, sleepQ + r.int(-1, 1))), plan,
    };
    if (isWaistDay(day)) morning.waist = +(38.5 + r.noise(0.3)).toFixed(1);
    if (r.chance(0.15)) morning.text = 'woke up with a stiff back';
    add('morning', at(day, 6, 45 + r.int(0, 30)), morning, [], late());

    add('drink', at(day, 7, 15), { drink: 'coffee', count: r.int(1, 2) });
    for (const [meal, hh] of [['breakfast', 7], ['lunch', 12], ['dinner', 18]]) {
      if (meal === 'breakfast' && r.chance(0.2)) continue;   // skipped breakfast
      add('meal', at(day, hh, r.int(0, 50)), { meal, text: r.pick(MEALS[meal]) }, [photo([r.int(120, 230), r.int(80, 180), r.int(40, 120)])], late());
    }
    if (r.chance(0.4)) add('meal', at(day, 15, r.int(0, 59)), { meal: 'snack', text: r.pick(MEALS.snack) }, [photo([180, 140, 90])]);

    const stress = Math.max(1, Math.min(5, Math.round((weekend ? 2 : 3) + r.noise(0.8))));
    const planned = plan.filter((p) => p !== 'rest');
    let done = null;
    if (planned.length) {
      const p = 0.55 + 0.12 * (sleepQ - 3) - 0.12 * (stress - 3);
      done = r.chance(p) ? 'yes' : r.chance(0.3) ? 'partly' : 'no';
      if (done !== 'no') {
        add('activity', at(day, weekend ? 10 : 17, r.int(0, 45)),
          { activity: planned[0], minutes: done === 'yes' ? r.int(40, 90) : r.int(15, 30), effort: r.int(5, 9) }, [], late());
      }
    }
    if (r.chance(weekend ? 0.7 : 0.3)) add('drink', at(day, 19, r.int(0, 59)), { drink: 'beer', count: r.int(1, 3) });
    if (r.chance(0.25)) {   // late snack after midnight: belongs to *this* logical day
      add('meal', at(day, 0, r.int(10, 50), 1), { meal: 'snack', text: r.pick(MEALS.snack) }, [], r.int(400, 500));
    }
    const evening = { stress, energy: Math.max(1, Math.min(5, 4 - Math.round((stress - 3) / 2) + r.int(-1, 0))), caffeine: r.int(1, 3) };
    if (done) evening.plan_done = done;
    if (done && done !== 'yes') evening.barrier = r.pick(BARRIERS);
    if (r.chance(0.3)) evening.text = r.pick(['long day', 'good day with the kids', 'felt bloated after dinner', 'busy but fine']);
    add('evening', at(day, 21, r.int(0, 50)), evening, [], late());
  }
  return { entries, photos };
}

export function simulatedZip(opts = {}) {
  const { entries, photos } = simulateStudy(opts);
  const now = new Date();
  return makeZip(buildExportFiles({ entries, photos, startDay: opts.startDay ?? '2026-11-16', now, timezone: 'America/Chicago' }), now);
}

// CLI
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
  const out = args.find((a) => a.endsWith('.zip')) || 'simulated-study.zip';
  const opts = { startDay: opt('start', '2026-11-16'), days: Number(opt('days', STUDY_DAYS)), seed: Number(opt('seed', 1)) };
  const blob = simulatedZip(opts);
  writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
  const { entries, photos } = simulateStudy(opts);
  console.log(`Wrote ${out}: ${entries.length} entries, ${photos.length} photos, ${opts.days} days from ${opts.startDay}`);
}
