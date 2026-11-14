// logic.js — pure functions and configuration. No DOM, no storage, no clock:
// anything that depends on "now" takes it as a parameter. Imported by the app,
// by backup.js, by the simulator, and directly by the Node unit tests.

// ---------- configuration ----------
export const DAY_START_HOUR = 4;        // a "day" runs 04:00 -> 04:00 local wall-clock time
export const STUDY_DAYS = 14;
export const WAIST_DAYS = [1, 3, 5];    // Mon, Wed, Fri (JS: 0 = Sunday)
export const EXPORT_NAG_DAYS = 2;
export const PHOTO_MAX_PX = 1280;
export const FUTURE_SLACK_MIN = 10;     // entries more than this far in the future get a warning
export const ACTIVITIES = ['climb', 'yoga', 'lift', 'run', 'walk', 'hike', 'sport', 'other'];

export const KINDS = {
  morning:  { label: 'Morning',  icon: '☀️', checkin: true },
  evening:  { label: 'Evening',  icon: '🌙', checkin: true },
  meal:     { label: 'Meal',     icon: '🍽️', cameraFirst: true },
  drink:    { label: 'Drink',    icon: '🍺' },
  activity: { label: 'Activity', icon: '🏃' },
  measure:  { label: 'Measure',  icon: '📏' },
  note:     { label: 'Note',     icon: '📝' },
};
export const QUICK = ['meal', 'drink', 'activity', 'measure', 'note'];

export const TEXT_HINT = 'Type, or tap 🎤 on the keyboard to talk';

// Field types: number | time | text | scale | chips | stepper | photos
// number fields: min/max are "plausible" bounds; outside them = warning, not error.
const weight = (label) => ({ k: 'weight', t: 'number', unit: 'lb', min: 80, max: 450, label });
const inches = (k, label, min, max) => ({ k, t: 'number', unit: 'in', min, max, label });

export const SCHEMA = {
  morning: [
    weight('Weight (lb) — after bathroom, before eating'),
    { ...inches('waist', 'Waist at navel (in) — relaxed, after normal exhale', 20, 70), show: (c) => c.isWaistDay },
    { k: 'bed_time', t: 'time', label: 'Went to bed' },
    { k: 'wake_time', t: 'time', label: 'Woke up' },
    { k: 'sleep_quality', t: 'scale', n: 5, label: 'Sleep quality', lo: 'awful', hi: 'great' },
    { k: 'wakeups', t: 'stepper', label: 'Times woke in the night', max: 20 },
    { k: 'energy', t: 'scale', n: 5, label: 'Energy on waking', lo: 'drained', hi: 'ready' },
    { k: 'plan', t: 'chips', multi: true, opts: [...ACTIVITIES, 'rest'], label: "Today's planned activity" },
    { k: 'text', t: 'text', label: 'Anything else?' },
  ],
  evening: [
    { k: 'plan_done', t: 'chips', opts: ['yes', 'partly', 'no'],
      label: (c) => `Did the plan happen? (${c.morningPlan.join(', ')})`, show: (c) => c.morningPlan.length > 0 },
    { k: 'barrier', t: 'text', label: 'If not, what got in the way?', show: (c) => c.morningPlan.length > 0 },
    { k: 'stress', t: 'scale', n: 5, label: 'Stress today', lo: 'calm', hi: 'maxed' },
    { k: 'energy', t: 'scale', n: 5, label: 'Energy today', lo: 'drained', hi: 'great' },
    { k: 'caffeine', t: 'stepper', label: 'Caffeinated drinks today', max: 20 },
    { k: 'text', t: 'text', label: 'How was the day?' },
  ],
  meal: [
    { k: 'photos', t: 'photos', label: 'Photo' },
    { k: 'meal', t: 'chips', opts: ['breakfast', 'lunch', 'dinner', 'snack'], label: 'Which' },
    { k: 'text', t: 'text', label: 'What was it? (optional — the photo may be enough)' },
  ],
  drink: [
    { k: 'drink', t: 'chips', opts: ['beer', 'wine', 'liquor', 'cocktail', 'coffee', 'soda', 'other'], label: 'What' },
    { k: 'count', t: 'stepper', label: 'How many', def: 1, max: 20 },
    { k: 'photos', t: 'photos', label: 'Photo (optional)' },
    { k: 'text', t: 'text', label: 'Notes' },
  ],
  activity: [
    { k: 'activity', t: 'chips', opts: ACTIVITIES, label: 'What' },
    { k: 'minutes', t: 'number', unit: 'min', min: 1, max: 600, label: 'Minutes' },
    { k: 'effort', t: 'scale', n: 10, label: 'Effort', lo: 'easy', hi: 'max' },
    { k: 'photos', t: 'photos', label: 'Photo (optional)' },
    { k: 'text', t: 'text', label: 'Notes' },
  ],
  measure: [
    { k: 'photos', t: 'photos', label: 'Body photos — front, side, back; same spot & lighting each time' },
    inches('waist', 'Waist at navel (in)', 20, 70),
    inches('hips', 'Hips, widest point (in)', 20, 80),
    inches('neck', 'Neck (in)', 10, 30),
    weight('Weight (lb)'),
    { k: 'text', t: 'text', label: 'Notes' },
  ],
  note: [
    { k: 'text', t: 'text', label: 'Note' },
    { k: 'photos', t: 'photos', label: 'Photo (optional)' },
  ],
};

// ---------- dates (local wall-clock time) ----------
export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Which study day a moment belongs to. Uses the wall-clock hour rather than
// subtracting elapsed time, so DST changes can't shift entries between days.
export function logicalDay(date) {
  const d = new Date(date.getTime());
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1);
  return ymd(d);
}
export const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return ymd(d); };
export const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400e3);
export const toLocalInput = (d) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const fmtDay = (s) => parseDay(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
export const isWaistDay = (day) => WAIST_DAYS.includes(parseDay(day).getDay());

export function studyDayLabel(startDay, day) {
  if (!startDay) return '';
  const n = daysBetween(startDay, day) + 1;
  if (n < 1) return '';
  return n <= STUDY_DAYS ? `Day ${n} of ${STUDY_DAYS}` : `Day ${n} (past ${STUDY_DAYS})`;
}

// Default "when" for a new entry viewed on `day`.
export function defaultTime(kind, day, now) {
  if (day === logicalDay(now)) return new Date(now.getTime());
  const d = parseDay(day);
  const [hh, mm] = kind === 'morning' ? [7, 30] : kind === 'evening' ? [21, 0] : [12, 0];
  d.setHours(hh, mm, 0, 0);
  return d;
}

export function exportAgeDays(lastExportIso, now) {
  if (!lastExportIso) return null;
  return Math.floor((now - new Date(lastExportIso)) / 86400e3);
}

// ---------- form values <-> stored fields ----------
// The form keeps number fields as the raw text typed/dictated, so nothing the
// user entered is silently dropped. Conversion happens here, at save time.
export function parseNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  const s = String(raw).trim().replace(',', '.');
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN;
}

const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

// Stored fields -> form values (numbers become strings for the text inputs).
export function fieldsToForm(kind, fields = {}) {
  const vals = structuredClone(fields);
  for (const f of SCHEMA[kind]) if (f.t === 'number' && typeof vals[f.k] === 'number') vals[f.k] = String(vals[f.k]);
  return vals;
}

// Form values -> { fields, errors }. Errors block saving; nothing is discarded quietly.
export function formToFields(kind, vals) {
  const fields = {};
  const errors = [];
  const schemaByKey = Object.fromEntries(SCHEMA[kind].map((f) => [f.k, f]));
  for (const [k, v] of Object.entries(vals)) {
    if (isEmpty(v)) continue;
    const f = schemaByKey[k];
    if (f?.t === 'number') {
      const n = parseNumber(v);
      if (Number.isNaN(n)) errors.push(`${shortLabel(f)}: “${v}” isn't a number`);
      else fields[k] = n;
    } else {
      fields[k] = v;
    }
  }
  return { fields, errors };
}

export const shortLabel = (f) => (typeof f.label === 'string' ? f.label : f.k).split(/ [—(]/)[0];

// Warnings the user can override ("save anyway"); errors they can't.
export function validate({ kind, vals, photoIds = [], occurred, now, sameDayEntries = [], id = null }) {
  const errors = [];
  const warnings = [];
  if (!(occurred instanceof Date) || Number.isNaN(occurred.getTime())) errors.push('Pick a valid date and time');
  const { fields, errors: parseErrors } = formToFields(kind, vals);
  errors.push(...parseErrors);
  if (!Object.keys(fields).length && !photoIds.length && !parseErrors.length) errors.push('Nothing to save yet');
  if (errors.length) return { fields, errors, warnings };

  for (const f of SCHEMA[kind]) {
    const v = fields[f.k];
    if (f.t === 'number' && v !== undefined && (v < f.min || v > f.max)) {
      warnings.push(`${shortLabel(f)} ${v} ${f.unit} is outside the usual ${f.min}–${f.max}`);
    }
  }
  if (occurred.getTime() - now.getTime() > FUTURE_SLACK_MIN * 60e3) warnings.push('The time is in the future');
  if (KINDS[kind].checkin && sameDayEntries.some((e) => e.kind === kind && e.id !== id)) {
    warnings.push(`There's already a ${KINDS[kind].label.toLowerCase()} check-in for ${fmtDay(logicalDay(occurred))}`);
  }
  return { fields, errors, warnings };
}

export function buildEntry({ existing, kind, fields, photoIds, occurred, now }) {
  const nowIso = now.toISOString();
  return {
    id: existing?.id ?? newId(),
    kind,
    day: logicalDay(occurred),
    occurred_at: occurred.toISOString(),
    logged_at: existing?.logged_at ?? nowIso,
    updated_at: nowIso,
    fields,
    photos: [...photoIds],
  };
}

export const newId = () => crypto.randomUUID();

// A stable snapshot of form state, used to decide whether there are unsaved changes.
export const snapshot = ({ vals, when, photoIds }) =>
  JSON.stringify({ vals: Object.fromEntries(Object.entries(vals).filter(([, v]) => !isEmpty(v)).sort(([a], [b]) => (a < b ? -1 : 1))), when, photoIds });

// Timeline order: when it happened, then when it was entered, then id, so
// entries with identical times never shuffle between renders.
export const byTime = (a, b) =>
  a.occurred_at.localeCompare(b.occurred_at) || a.logged_at.localeCompare(b.logged_at) || a.id.localeCompare(b.id);

// ---------- summaries ----------
export function summary(e) {
  const f = e.fields || {};
  const nPhotos = (e.photos || []).length;
  const snip = f.text ? `“${f.text.length > 70 ? f.text.slice(0, 70) + '…' : f.text}”` : '';
  const join = (parts, sep = ' · ') => parts.filter(Boolean).join(sep);
  switch (e.kind) {
    case 'morning':
      return join([f.weight != null && `${f.weight} lb`, f.waist != null && `waist ${f.waist}″`,
        f.sleep_quality && `sleep ${f.sleep_quality}/5`, f.plan?.length && `plan: ${f.plan.join(', ')}`]) || 'done';
    case 'evening':
      return join([f.plan_done && `plan: ${f.plan_done}`, f.stress && `stress ${f.stress}/5`,
        f.energy && `energy ${f.energy}/5`]) || 'done';
    case 'meal': return join([f.meal || 'meal', snip || (nPhotos ? '' : '(no details)')], ' — ');
    case 'drink': return join([`${f.count ?? 1}× ${f.drink || 'drink'}`, snip], ' — ');
    case 'activity':
      return join([f.activity || 'activity', f.minutes != null && `${f.minutes} min`, f.effort && `effort ${f.effort}/10`, snip]);
    case 'measure':
      return join([f.waist != null && `waist ${f.waist}″`, f.hips != null && `hips ${f.hips}″`, f.neck != null && `neck ${f.neck}″`,
        f.weight != null && `${f.weight} lb`, nPhotos && `${nPhotos} photo${nPhotos > 1 ? 's' : ''}`]) || 'measurement';
    default: return snip || (nPhotos ? 'photo' : 'note');
  }
}

// ---------- export / import format ----------
export const EXPORT_SCHEMA_VERSION = 1;

export function exportReadme() {
  const fieldList = Object.entries(SCHEMA).map(([kind, fs]) =>
    `  ${kind.padEnd(9)} ${fs.map((f) => f.k + (f.unit ? ` (${f.unit})` : f.t === 'scale' ? ` (1-${f.n})` : '')).join(', ')}`).join('\n');
  return `Turtle Log export
=================
entries.json   all entries (schema below)
photos/        photos, named <photo id>.<jpg|png> (referenced from entries[].photos)

Entry fields
  id            unique id
  kind          ${Object.keys(KINDS).join(' | ')}
  day           logical day YYYY-MM-DD; a day runs ${pad(DAY_START_HOUR)}:00 to ${pad(DAY_START_HOUR)}:00 local time
  occurred_at   when it happened (ISO 8601, UTC)
  logged_at     when it was first entered (ISO 8601, UTC); differs from occurred_at for after-the-fact entries
  updated_at    last edit
  fields        kind-specific values; anything not entered is omitted
  photos        list of photo ids

fields by kind
${fieldList}
Notes
  morning.waist is only asked on Mon/Wed/Fri. bed_time/wake_time are HH:MM local.
  morning.plan lists planned activities; evening.plan_done says whether they happened
  and evening.barrier says what got in the way.
  Scales: higher = more of the named thing (stress 5 = very stressed; sleep_quality 5 = great).
  "text" fields are often voice-dictated, so expect speech-to-text quirks.
`;
}

// photos: [{ id, type, data: Uint8Array }]  ->  [{ name, data }] for makeZip
export function buildExportFiles({ entries, photos, startDay, now, timezone }) {
  const enc = new TextEncoder();
  const meta = {
    app: 'turtle-log', schema: EXPORT_SCHEMA_VERSION, exported_at: now.toISOString(), timezone,
    day_start_hour: DAY_START_HOUR, study_start_day: startDay ?? null,
    entries: [...entries].sort(byTime),
  };
  return [
    { name: 'README.txt', data: enc.encode(exportReadme()) },
    { name: 'entries.json', data: enc.encode(JSON.stringify(meta, null, 2)) },
    ...photos.map((p) => ({ name: `photos/${p.id}.${(p.type || '').includes('png') ? 'png' : 'jpg'}`, data: p.data })),
  ];
}

// [{ name, data }] -> { meta, entries, photos }. Throws a readable Error for anything
// that isn't a valid Turtle Log export, before anything is written.
export function parseExportFiles(files) {
  const json = files.find((f) => f.name === 'entries.json');
  if (!json) throw new Error('This zip has no entries.json — is it a Turtle Log export?');
  let meta;
  try { meta = JSON.parse(new TextDecoder().decode(json.data)); } catch { throw new Error('entries.json is not valid JSON'); }
  if (meta.app !== 'turtle-log') throw new Error('This zip is not a Turtle Log export');
  if (meta.schema > EXPORT_SCHEMA_VERSION) throw new Error('This export is from a newer version of the app');
  if (!Array.isArray(meta.entries)) throw new Error('entries.json has no entries list');
  meta.entries.forEach((e, i) => {
    const ok = e && typeof e.id === 'string' && KINDS[e.kind] && !Number.isNaN(Date.parse(e.occurred_at))
      && typeof e.fields === 'object' && Array.isArray(e.photos);
    if (!ok) throw new Error(`Entry ${i + 1} in entries.json is malformed`);
  });
  const photos = files.filter((f) => f.name.startsWith('photos/') && f.name.length > 'photos/'.length).map((f) => ({
    id: f.name.slice('photos/'.length).replace(/\.[^.]+$/, ''),
    type: f.name.endsWith('.png') ? 'image/png' : 'image/jpeg',
    data: f.data,
  }));
  const have = new Set(photos.map((p) => p.id));
  const missing = meta.entries.flatMap((e) => e.photos).filter((id) => !have.has(id));
  if (missing.length) throw new Error(`${missing.length} photo(s) referenced by entries are missing from the zip`);
  return { meta, entries: meta.entries, photos };
}
