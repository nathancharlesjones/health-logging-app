// app.js — Turtle Log UI. No frameworks, no network calls.
import * as db from './db.js';
import { makeZip, readZip } from './zip.js';

// ---------- configuration ----------
const DAY_START_HOUR = 4;        // a "day" runs 04:00 -> 04:00, so late snacks count toward the evening
const STUDY_DAYS = 14;
const WAIST_DAYS = [1, 3, 5];    // Mon, Wed, Fri (JS: 0 = Sunday)
const EXPORT_NAG_DAYS = 2;
const PHOTO_MAX_PX = 1280;
const ACTIVITIES = ['climb', 'yoga', 'lift', 'run', 'walk', 'hike', 'sport', 'other'];

const KINDS = {
  morning:  { label: 'Morning',  icon: '☀️' },
  evening:  { label: 'Evening',  icon: '🌙' },
  meal:     { label: 'Meal',     icon: '🍽️', cameraFirst: true },
  drink:    { label: 'Drink',    icon: '🍺' },
  activity: { label: 'Activity', icon: '🏃' },
  measure:  { label: 'Measure',  icon: '📏' },
  note:     { label: 'Note',     icon: '📝' },
};
const QUICK = ['meal', 'drink', 'activity', 'measure', 'note'];

// Field types: number | time | text | scale | chips | stepper | photos
const TEXT_HINT = 'Type, or tap 🎤 on the keyboard to talk';
const SCHEMA = {
  morning: [
    { k: 'weight', t: 'number', label: 'Weight (lb) — after bathroom, before eating' },
    { k: 'waist', t: 'number', label: 'Waist at navel (in) — relaxed, after normal exhale', show: (c) => c.isWaistDay },
    { k: 'bed_time', t: 'time', label: 'Went to bed' },
    { k: 'wake_time', t: 'time', label: 'Woke up' },
    { k: 'sleep_quality', t: 'scale', n: 5, label: 'Sleep quality', lo: 'awful', hi: 'great' },
    { k: 'wakeups', t: 'stepper', label: 'Times woke in the night' },
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
    { k: 'caffeine', t: 'stepper', label: 'Caffeinated drinks today' },
    { k: 'text', t: 'text', label: 'How was the day?' },
  ],
  meal: [
    { k: 'photos', t: 'photos', label: 'Photo' },
    { k: 'meal', t: 'chips', opts: ['breakfast', 'lunch', 'dinner', 'snack'], label: 'Which' },
    { k: 'text', t: 'text', label: 'What was it? (optional — the photo may be enough)' },
  ],
  drink: [
    { k: 'drink', t: 'chips', opts: ['beer', 'wine', 'liquor', 'cocktail', 'coffee', 'soda', 'other'], label: 'What' },
    { k: 'count', t: 'stepper', label: 'How many', def: 1 },
    { k: 'photos', t: 'photos', label: 'Photo (optional)' },
    { k: 'text', t: 'text', label: 'Notes' },
  ],
  activity: [
    { k: 'activity', t: 'chips', opts: ACTIVITIES, label: 'What' },
    { k: 'minutes', t: 'number', label: 'Minutes' },
    { k: 'effort', t: 'scale', n: 10, label: 'Effort', lo: 'easy', hi: 'max' },
    { k: 'photos', t: 'photos', label: 'Photo (optional)' },
    { k: 'text', t: 'text', label: 'Notes' },
  ],
  measure: [
    { k: 'photos', t: 'photos', label: 'Body photos — front, side, back; same spot & lighting each time' },
    { k: 'waist', t: 'number', label: 'Waist at navel (in)' },
    { k: 'hips', t: 'number', label: 'Hips, widest point (in)' },
    { k: 'neck', t: 'number', label: 'Neck (in)' },
    { k: 'weight', t: 'number', label: 'Weight (lb)' },
    { k: 'text', t: 'text', label: 'Notes' },
  ],
  note: [
    { k: 'text', t: 'text', label: 'Note' },
    { k: 'photos', t: 'photos', label: 'Photo (optional)' },
  ],
};

// ---------- date helpers (all local time) ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const logicalDay = (d) => ymd(new Date(d.getTime() - DAY_START_HOUR * 3600e3));
const today = () => logicalDay(new Date());
const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400e3);
const toLocalInput = (d) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDay = (s) => parseDay(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

// ---------- small settings store ----------
const settings = {
  get startDay() { return localStorage.getItem('startDay'); },
  set startDay(v) { localStorage.setItem('startDay', v); },
  get lastExport() { return localStorage.getItem('lastExport'); },
  set lastExport(v) { localStorage.setItem('lastExport', v); },
};

// ---------- DOM helper ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : String(kid));
  }
  return el;
}

function toast(msg) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2500);
}

// Object URLs for photo thumbnails; revoked on every screen change.
let objectUrls = [];
const mkUrl = (blob) => { const u = URL.createObjectURL(blob); objectUrls.push(u); return u; };
async function photoUrl(id) {
  const p = await db.getPhoto(id);
  return p ? mkUrl(p.blob) : null;
}

// ---------- routing ----------
// Opening a form/settings pushes a history entry, so Android's back gesture
// closes the form instead of leaving the app.
const $app = document.getElementById('app');
const state = { day: today(), followToday: true };

function go(view, params) {
  history.pushState({ view }, '');
  show(view, params);
}
window.addEventListener('popstate', () => show('home'));

let renderSeq = 0;
async function show(view, params = {}) {
  const seq = ++renderSeq;
  objectUrls.forEach((u) => URL.revokeObjectURL(u));
  objectUrls = [];
  const root = h('div', { class: `view view-${view}` });
  if (view === 'home') await renderHome(root);
  else if (view === 'form') await renderForm(root, params);
  else if (view === 'settings') await renderSettings(root);
  if (seq !== renderSeq) return;             // a newer navigation won
  $app.replaceChildren(root);
  window.scrollTo(0, 0);
  root.dispatchEvent(new Event('shown'));
}

// When the app is reopened on a later day, jump to the new "today".
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const onHome = !history.state || history.state.view === 'home';
  if (onHome && state.followToday && state.day !== today()) { state.day = today(); show('home'); }
});

function setDay(day) {
  state.day = day;
  state.followToday = day === today();
  show('home');
}

// ---------- entry summaries ----------
function summary(e) {
  const f = e.fields || {};
  const nPhotos = (e.photos || []).length;
  const snip = f.text ? `“${f.text.length > 70 ? f.text.slice(0, 70) + '…' : f.text}”` : '';
  switch (e.kind) {
    case 'morning':
      return [f.weight && `${f.weight} lb`, f.waist && `waist ${f.waist}″`, f.sleep_quality && `sleep ${f.sleep_quality}/5`,
        f.plan?.length && `plan: ${f.plan.join(', ')}`].filter(Boolean).join(' · ') || 'done';
    case 'evening':
      return [f.plan_done && `plan: ${f.plan_done}`, f.stress && `stress ${f.stress}/5`, f.energy && `energy ${f.energy}/5`]
        .filter(Boolean).join(' · ') || 'done';
    case 'meal': return [f.meal || 'meal', snip || (nPhotos ? '' : '(no details)')].filter(Boolean).join(' — ');
    case 'drink': return [`${f.count ?? 1}× ${f.drink || 'drink'}`, snip].filter(Boolean).join(' — ');
    case 'activity':
      return [f.activity || 'activity', f.minutes && `${f.minutes} min`, f.effort && `effort ${f.effort}/10`, snip]
        .filter(Boolean).join(' · ');
    case 'measure':
      return [f.waist && `waist ${f.waist}″`, f.hips && `hips ${f.hips}″`, f.neck && `neck ${f.neck}″`,
        f.weight && `${f.weight} lb`, nPhotos && `${nPhotos} photo${nPhotos > 1 ? 's' : ''}`].filter(Boolean).join(' · ');
    default: return snip || (nPhotos ? 'photo' : '');
  }
}

// ---------- HOME ----------
async function renderHome(root) {
  const day = state.day;
  const isToday = day === today();
  const entries = (await db.entriesForDay(day)).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const morning = entries.find((e) => e.kind === 'morning');
  const evening = entries.find((e) => e.kind === 'evening');
  const timeline = entries.filter((e) => e.kind !== 'morning' && e.kind !== 'evening');
  const isWaistDay = WAIST_DAYS.includes(parseDay(day).getDay());

  if (!settings.startDay) settings.startDay = today();
  const n = daysBetween(settings.startDay, day) + 1;
  const dayLabel = n >= 1 && n <= STUDY_DAYS ? `Day ${n} of ${STUDY_DAYS}` : n > STUDY_DAYS ? `Day ${n} (past ${STUDY_DAYS})` : '';

  root.append(h('header', { class: 'dayhead' },
    h('button', { class: 'nav', 'aria-label': 'Previous day', onclick: () => setDay(addDays(day, -1)) }, '‹'),
    h('button', { class: 'daytitle', onclick: () => setDay(today()) },
      h('h1', {}, isToday ? 'Today' : fmtDay(day)),
      h('div', { class: 'sub' }, [isToday ? fmtDay(day) : 'tap for today', dayLabel].filter(Boolean).join(' · '))),
    h('button', { class: 'nav', 'aria-label': 'Next day', disabled: isToday, onclick: () => setDay(addDays(day, 1)) }, '›'),
  ));

  const last = settings.lastExport;
  const { entries: total } = await db.counts();
  if (total > 0 && (!last || (Date.now() - new Date(last)) / 86400e3 > EXPORT_NAG_DAYS)) {
    root.append(h('div', { class: 'banner' },
      h('span', {}, last ? `Last backup ${Math.floor((Date.now() - new Date(last)) / 86400e3)} days ago` : 'Not backed up yet'),
      h('button', { class: 'btn small', onclick: () => doExport().then(() => show('home')) }, 'Export now')));
  }

  const card = (kind, entry, hint) => h('button', {
    class: `card checkin${entry ? ' done' : ''}`,
    onclick: () => go('form', { kind, id: entry?.id }),
  },
    h('div', { class: 'cardtop' }, h('span', { class: 'emoji' }, KINDS[kind].icon),
      h('span', { class: 'cardlabel' }, KINDS[kind].label), entry ? h('span', { class: 'check' }, '✓') : null),
    h('div', { class: 'cardsub' }, entry ? summary(entry) : hint));

  root.append(h('section', { class: 'checkins' },
    card('morning', morning, isWaistDay ? 'Check in — waist day' : 'Check in'),
    card('evening', evening, 'Check in')));

  root.append(h('section', { class: 'quick' },
    QUICK.map((k) => h('button', { class: 'qbtn', onclick: () => go('form', { kind: k }) },
      h('span', { class: 'emoji' }, KINDS[k].icon), h('span', {}, KINDS[k].label)))));

  const list = h('section', { class: 'timeline' });
  if (!timeline.length) list.append(h('p', { class: 'empty' }, 'Nothing logged yet for this day.'));
  for (const e of timeline) {
    const thumb = h('div', { class: 'tthumb' }, KINDS[e.kind].icon);
    if (e.photos?.length) photoUrl(e.photos[0]).then((u) => u && thumb.replaceChildren(h('img', { src: u, alt: '' })));
    list.append(h('button', { class: 'trow', onclick: () => go('form', { kind: e.kind, id: e.id }) },
      thumb,
      h('div', { class: 'tbody' },
        h('div', { class: 'tmeta' }, `${fmtTime(e.occurred_at)} · ${KINDS[e.kind].label}`),
        h('div', { class: 'ttext' }, summary(e)))));
  }
  root.append(h('h2', {}, 'Log'), list);

  root.append(h('footer', {}, h('button', { class: 'btn ghost', onclick: () => go('settings') }, '⚙ Settings & export')));
}

// ---------- FORM ----------
function defaultTime(kind, day) {
  if (day === today()) return new Date();
  const d = parseDay(day);
  const [hh, mm] = kind === 'morning' ? [7, 30] : kind === 'evening' ? [21, 0] : [12, 0];
  d.setHours(hh, mm, 0, 0);
  return d;
}

async function lastMorningBefore(day) {
  for (let i = 1; i <= 7; i++) {
    const m = (await db.entriesForDay(addDays(day, -i))).find((e) => e.kind === 'morning');
    if (m) return m;
  }
  return null;
}

async function downscale(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const s = Math.min(1, PHOTO_MAX_PX / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s);
    c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return blob || file;
  } catch {
    return file;   // keep the original rather than lose the photo
  }
}

async function renderForm(root, { kind, id }) {
  const K = KINDS[kind];
  const existing = id ? await db.getEntry(id) : null;
  const day = existing?.day ?? state.day;

  // Values being edited. Check-ins prefill sleep times from the previous morning.
  let vals = existing ? structuredClone(existing.fields) : {};
  if (!existing) {
    for (const f of SCHEMA[kind]) if (f.def !== undefined) vals[f.k] = f.def;
    if (kind === 'morning') {
      const prev = await lastMorningBefore(day);
      if (prev) for (const k of ['bed_time', 'wake_time']) if (prev.fields[k]) vals[k] = prev.fields[k];
    }
  }

  const ctx = {
    isWaistDay: WAIST_DAYS.includes(parseDay(day).getDay()) || (existing?.fields.waist != null),
    morningPlan: kind === 'evening'
      ? ((await db.entriesForDay(day)).find((e) => e.kind === 'morning')?.fields.plan || []).filter((p) => p !== 'rest')
      : [],
  };

  let photoIds = existing ? [...existing.photos] : [];
  const pending = new Map();    // new photo id -> Blob (not yet saved)
  const removed = new Set();    // saved photo ids to delete on save
  let cameraInput = null;

  // --- field widgets ---
  function photosField() {
    const grid = h('div', { class: 'photos' });
    let drawSeq = 0;
    async function draw() {
      const my = ++drawSeq;
      const items = [];
      for (const pid of photoIds) {
        const src = pending.has(pid) ? mkUrl(pending.get(pid)) : await photoUrl(pid);
        items.push(h('div', { class: 'thumb' }, h('img', { src: src || '', alt: '' }),
          h('button', { type: 'button', class: 'x', 'aria-label': 'Remove photo', onclick: () => {
            photoIds = photoIds.filter((x) => x !== pid);
            if (pending.has(pid)) pending.delete(pid); else removed.add(pid);
            draw();
          } }, '✕')));
      }
      if (my === drawSeq) grid.replaceChildren(...items);
    }
    const picker = (useCamera) => {
      const input = h('input', {
        type: 'file', accept: 'image/*', hidden: true, multiple: !useCamera,
        onchange: async (e) => {
          for (const file of e.target.files) {
            const pid = crypto.randomUUID();
            pending.set(pid, await downscale(file));
            photoIds.push(pid);
          }
          e.target.value = '';
          draw();
        },
      });
      if (useCamera) { input.setAttribute('capture', 'environment'); cameraInput = input; }
      return h('label', { class: 'btn' }, useCamera ? '📷 Camera' : '🖼 Gallery', input);
    };
    draw();
    return [grid, h('div', { class: 'row' }, picker(true), picker(false))];
  }

  function widget(f) {
    switch (f.t) {
      case 'number':
        return h('input', { type: 'text', inputMode: 'decimal', value: vals[f.k] ?? '', oninput: (e) => {
          const n = parseFloat(e.target.value.replace(',', '.'));
          vals[f.k] = Number.isFinite(n) ? n : undefined;
        } });
      case 'time':
        return h('input', { type: 'time', value: vals[f.k] ?? '', oninput: (e) => { vals[f.k] = e.target.value || undefined; } });
      case 'text': {
        const ta = h('textarea', { rows: 3, placeholder: TEXT_HINT, value: vals[f.k] ?? '', oninput: (e) => {
          vals[f.k] = e.target.value || undefined;
          grow();
        } });
        const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
        root.addEventListener('shown', grow);
        return ta;
      }
      case 'scale': {
        const btns = [];
        const paint = () => btns.forEach((b, i) => b.classList.toggle('on', vals[f.k] === i + 1));
        for (let i = 1; i <= f.n; i++) {
          btns.push(h('button', { type: 'button', class: 'pill', onclick: () => {
            vals[f.k] = vals[f.k] === i ? undefined : i;   // tap again to clear
            paint();
          } }, i));
        }
        paint();
        return h('div', {}, h('div', { class: `scale n${f.n}` }, btns),
          f.lo ? h('div', { class: 'scalelabels' }, h('span', {}, f.lo), h('span', {}, f.hi)) : null);
      }
      case 'chips': {
        const btns = f.opts.map((o) => h('button', { type: 'button', class: 'pill', onclick: () => {
          if (f.multi) {
            const cur = new Set(vals[f.k] || []);
            cur.has(o) ? cur.delete(o) : cur.add(o);
            vals[f.k] = [...cur];
          } else {
            vals[f.k] = vals[f.k] === o ? undefined : o;
          }
          paint();
        } }, o));
        const paint = () => btns.forEach((b, i) => {
          const o = f.opts[i];
          b.classList.toggle('on', f.multi ? (vals[f.k] || []).includes(o) : vals[f.k] === o);
        });
        paint();
        return h('div', { class: 'chips' }, btns);
      }
      case 'stepper': {
        const out = h('span', { class: 'stepval' });
        const paint = () => { out.textContent = vals[f.k] ?? 0; };
        const bump = (d) => { vals[f.k] = Math.max(0, (vals[f.k] ?? 0) + d); paint(); };
        paint();
        return h('div', { class: 'stepper' },
          h('button', { type: 'button', class: 'pill', onclick: () => bump(-1) }, '−'), out,
          h('button', { type: 'button', class: 'pill', onclick: () => bump(1) }, '+'));
      }
      case 'photos':
        return photosField();
    }
  }

  // --- layout ---
  root.append(h('header', { class: 'formhead' },
    h('button', { class: 'nav', 'aria-label': 'Cancel', onclick: () => history.back() }, '‹'),
    h('h1', {}, `${K.icon} ${K.label}${existing ? ' (edit)' : ''}`)));

  const form = h('div', { class: 'form' });
  for (const f of SCHEMA[kind]) {
    if (f.show && !f.show(ctx)) continue;
    const label = typeof f.label === 'function' ? f.label(ctx) : f.label;
    form.append(h('div', { class: 'field' }, h('div', { class: 'flabel' }, label), widget(f)));
  }

  // When it happened
  const occurred = existing ? new Date(existing.occurred_at) : defaultTime(kind, day);
  const when = h('input', { type: 'datetime-local', value: toLocalInput(occurred) });
  const shortcuts = (!existing && day === today())
    ? h('div', { class: 'chips' }, [['Now', 0], ['30m ago', 30], ['1h ago', 60], ['2h ago', 120], ['4h ago', 240]]
      .map(([lbl, m]) => h('button', { type: 'button', class: 'pill', onclick: () => {
        when.value = toLocalInput(new Date(Date.now() - m * 60e3));
      } }, lbl)))
    : null;
  form.append(h('div', { class: 'field' }, h('div', { class: 'flabel' }, 'When'), shortcuts, when));
  root.append(form);

  async function save() {
    const occ = new Date(when.value);
    if (isNaN(occ)) return toast('Pick a valid date/time');
    const fields = Object.fromEntries(Object.entries(vals).filter(([, v]) =>
      v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)));
    if (!Object.keys(fields).length && !photoIds.length) return toast('Nothing to save yet');

    for (const [pid, blob] of pending) {
      await db.putPhoto({ id: pid, blob, type: blob.type || 'image/jpeg', created_at: new Date().toISOString() });
    }
    const now = new Date().toISOString();
    const entry = {
      id: existing?.id ?? crypto.randomUUID(),
      kind,
      day: logicalDay(occ),
      occurred_at: occ.toISOString(),
      logged_at: existing?.logged_at ?? now,
      updated_at: now,
      fields,
      photos: photoIds,
    };
    await db.putEntry(entry);
    for (const pid of removed) await db.deletePhoto(pid);
    state.day = entry.day;
    state.followToday = entry.day === today();
    history.back();
  }

  async function remove() {
    if (!confirm(`Delete this ${K.label.toLowerCase()} entry?`)) return;
    await db.deleteEntry(existing);
    history.back();
  }

  root.append(h('div', { class: 'actions' },
    existing ? h('button', { class: 'btn danger', onclick: remove }, 'Delete') : null,
    h('button', { class: 'btn ghost', onclick: () => history.back() }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: save }, 'Save')));

  // Meals: try to open the camera straight away (Chrome allows it while the
  // tap that opened this form still counts as a user gesture).
  if (!existing && K.cameraFirst && cameraInput) {
    root.addEventListener('shown', () => { try { cameraInput.click(); } catch { /* ignore */ } });
  }
}

// ---------- SETTINGS / EXPORT ----------
const EXPORT_README = `Turtle Log export
=================
entries.json   all entries (schema below)
photos/        photos, named <photo id>.jpg (referenced from entries[].photos)

Entry fields
  id            unique id
  kind          morning | evening | meal | drink | activity | measure | note
  day           logical day YYYY-MM-DD; a day runs ${pad(DAY_START_HOUR)}:00 to ${pad(DAY_START_HOUR)}:00 local time
  occurred_at   when it happened (ISO 8601, UTC)
  logged_at     when it was first entered (ISO 8601, UTC); differs from occurred_at for after-the-fact entries
  updated_at    last edit
  fields        kind-specific values; anything not entered is omitted
  photos        list of photo ids

fields by kind
  morning   weight (lb), waist (in, Mon/Wed/Fri), bed_time, wake_time (HH:MM local),
            sleep_quality (1-5), wakeups (count), energy (1-5), plan (list of planned activities), text
  evening   plan_done (yes/partly/no), barrier (text), stress (1-5), energy (1-5), caffeine (count), text
  meal      meal (breakfast/lunch/dinner/snack), text; usually a photo
  drink     drink (beer/wine/liquor/cocktail/coffee/soda/other), count, text
  activity  activity (${ACTIVITIES.join('/')}), minutes, effort (1-10), text
  measure   waist, hips, neck (in), weight (lb), body photos, text
  note      text
Scales: higher = more of the named thing (stress 5 = very stressed; sleep_quality 5 = great).
"text" fields are often voice-dictated, so expect speech-to-text quirks.
`;

async function doExport() {
  const enc = new TextEncoder();
  const entries = (await db.allEntries()).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const photos = await db.allPhotos();
  const meta = {
    app: 'turtle-log', schema: 1, exported_at: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    day_start_hour: DAY_START_HOUR, study_start_day: settings.startDay, entries,
  };
  const files = [
    { name: 'README.txt', data: enc.encode(EXPORT_README) },
    { name: 'entries.json', data: enc.encode(JSON.stringify(meta, null, 2)) },
  ];
  for (const p of photos) {
    const ext = (p.type || '').includes('png') ? 'png' : 'jpg';
    files.push({ name: `photos/${p.id}.${ext}`, data: new Uint8Array(await p.blob.arrayBuffer()) });
  }
  const blob = makeZip(files);
  const a = h('a', { href: URL.createObjectURL(blob), download: `turtle-log-${ymd(new Date())}.zip` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60e3);
  settings.lastExport = new Date().toISOString();
  toast(`Exported ${entries.length} entries, ${photos.length} photos`);
}

async function doImport(file) {
  const files = readZip(await file.arrayBuffer());
  const json = files.find((f) => f.name === 'entries.json');
  if (!json) throw new Error('No entries.json in that zip');
  const meta = JSON.parse(new TextDecoder().decode(json.data));
  for (const f of files) {
    if (!f.name.startsWith('photos/')) continue;
    const id = f.name.slice('photos/'.length).replace(/\.[^.]+$/, '');
    const type = f.name.endsWith('.png') ? 'image/png' : 'image/jpeg';
    await db.putPhoto({ id, blob: new Blob([f.data], { type }), type, created_at: new Date().toISOString() });
  }
  for (const e of meta.entries) await db.putEntry(e);   // same id = overwrite, so re-importing is safe
  if (meta.study_start_day) settings.startDay = meta.study_start_day;
  return meta.entries.length;
}

async function renderSettings(root) {
  const { entries, photos } = await db.counts();
  const persisted = await navigator.storage?.persisted?.();
  const est = await navigator.storage?.estimate?.();
  const mb = est ? (est.usage / 1e6).toFixed(1) : '?';
  const last = settings.lastExport;

  root.append(h('header', { class: 'formhead' },
    h('button', { class: 'nav', 'aria-label': 'Back', onclick: () => history.back() }, '‹'),
    h('h1', {}, '⚙ Settings')));

  const start = h('input', { type: 'date', value: settings.startDay || today(), onchange: (e) => {
    if (e.target.value) { settings.startDay = e.target.value; toast('Start day saved'); }
  } });

  const importInput = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true, onchange: async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !confirm('Import this backup? Entries with the same id will be overwritten.')) return;
    try { toast(`Imported ${await doImport(file)} entries`); show('settings'); }
    catch (err) { toast(`Import failed: ${err.message}`); }
  } });

  root.append(h('div', { class: 'form' },
    h('div', { class: 'field' }, h('div', { class: 'flabel' }, `Study start day (day 1 of ${STUDY_DAYS})`), start),

    h('div', { class: 'field' }, h('div', { class: 'flabel' }, 'Backup / export'),
      h('p', { class: 'note' }, `${entries} entries, ${photos} photos, ~${mb} MB. `,
        last ? `Last export ${new Date(last).toLocaleString()}.` : 'Never exported.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: doExport }, '⬇ Export zip'),
        h('label', { class: 'btn' }, '⬆ Import zip', importInput))),

    h('div', { class: 'field' }, h('div', { class: 'flabel' }, 'Storage'),
      h('p', { class: 'note' }, persisted
        ? '✓ Chrome has agreed to keep this data. (Clearing site data for this app would still erase it — export regularly.)'
        : 'Chrome may clear this data if the phone runs low on space. Installing the app to your home screen usually lets it be kept.'),
      persisted ? null : h('button', { class: 'btn', onclick: async () => {
        const ok = await navigator.storage?.persist?.();
        toast(ok ? 'Storage will be kept' : 'Chrome declined — install to home screen and try again');
        show('settings');
      } }, 'Ask Chrome to keep data')),

    h('div', { class: 'field' }, h('div', { class: 'flabel' }, 'Danger zone'),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!confirm('Delete ALL entries and photos on this phone?')) return;
        if (!confirm('Really? This cannot be undone. Export first if unsure.')) return;
        await db.clearAll();
        toast('All data deleted');
        show('settings');
      } }, 'Delete all data')),

    h('p', { class: 'note' }, 'Turtle Log makes no network requests. Data lives only on this phone until you export it.'),
  ));
}

// ---------- boot ----------
history.replaceState({ view: 'home' }, '');
show('home');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
navigator.storage?.persisted?.().then((p) => { if (!p) navigator.storage.persist?.(); });
