// app.js — Turtle Log UI. All decisions about data live in logic.js; this file
// only renders, collects input, and routes. No frameworks, no network calls.
import * as db from './db.js';
import * as L from './logic.js';
import { exportBackup, importBackup } from './backup.js';

const now = () => new Date();

// ---------- settings (tiny, so localStorage is fine) ----------
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};
const settings = {
  get startDay() { return ls.get('startDay'); },
  set startDay(v) { ls.set('startDay', v); },
  get lastExport() { return ls.get('lastExport'); },
  set lastExport(v) { ls.set('lastExport', v); },
};

// ---------- DOM helpers ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && !k.includes('-')) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : String(kid));
  }
  return el;
}

function toast(msg) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2800);
}

// In-app confirmation dialog. Resolves true (OK) or false (Cancel, Escape,
// tap outside, or the Android back gesture — see popstate below).
let activeDialog = null;
function dialog({ title, message, ok = 'OK', cancel = 'Cancel', danger = false, requireText = null }) {
  activeDialog?.cancel();
  return new Promise((resolve) => {
    const close = (result) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      activeDialog = null;
      resolve(result);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    const okBtn = h('button', { class: `btn ${danger ? 'danger-fill' : 'primary'}`, 'data-testid': 'dialog-ok',
      disabled: !!requireText, onclick: () => close(true) }, ok);
    const input = requireText ? h('input', { type: 'text', autocomplete: 'off', 'data-testid': 'dialog-input',
      'aria-label': `Type ${requireText} to confirm`, placeholder: `Type ${requireText}`,
      oninput: () => { okBtn.disabled = input.value.trim().toUpperCase() !== requireText; } }) : null;
    const lines = Array.isArray(message) ? message : message ? [message] : [];
    const body = lines.length > 1 ? h('ul', {}, lines.map((m) => h('li', {}, m))) : lines.length ? h('p', {}, lines[0]) : null;
    const box = h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' },
      h('h2', { id: 'dlg-title' }, title), body, input,
      h('div', { class: 'dialog-actions' },
        cancel ? h('button', { class: 'btn ghost', 'data-testid': 'dialog-cancel', onclick: () => close(false) }, cancel) : null,
        okBtn));
    const overlay = h('div', { class: 'overlay', 'data-testid': 'dialog', onclick: (e) => { if (e.target === overlay) close(false); } }, box);
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    activeDialog = { cancel: () => close(false) };
    (input || box.querySelector('[data-testid=dialog-cancel]') || okBtn).focus();
  });
}

// Object URLs for photo thumbnails; revoked on every screen change.
let objectUrls = [];
const mkUrl = (blob) => { const u = URL.createObjectURL(blob); objectUrls.push(u); return u; };
async function photoUrl(id) {
  const p = await db.getPhoto(id);
  return p ? mkUrl(p.blob) : null;
}

// ---------- routing ----------
// Every screen is a history entry whose state fully describes it, so the
// Android back gesture, a reload, or the OS killing the app all land back on
// a screen that can be rebuilt (forms restore their draft).
const $app = document.getElementById('app');
const state = { day: L.logicalDay(now()), followToday: true };
let current = { st: { view: 'home' }, ctl: {} };
let renderSeq = 0;

function go(view, params = {}) {
  const st = { view, day: state.day, ...params };
  history.pushState(st, '');
  show(st);
}

async function show(st) {
  const seq = ++renderSeq;
  const leaving = current.ctl;
  current = { st, ctl: {} };
  await leaving.leave?.();
  objectUrls.forEach((u) => URL.revokeObjectURL(u));
  objectUrls = [];
  const root = h('div', { class: `view view-${st.view}` });
  let ctl = {};
  if (st.view === 'form') ctl = (await renderForm(root, st)) || {};
  else if (st.view === 'settings') await renderSettings(root);
  else await renderHome(root);
  if (seq !== renderSeq) { await ctl.leave?.(); return; }   // a newer navigation won
  current.ctl = ctl;
  $app.replaceChildren(root);
  window.scrollTo(0, 0);
  root.dispatchEvent(new Event('shown'));
}

window.addEventListener('popstate', (e) => {
  if (activeDialog) {                      // back gesture closes the dialog, not the screen
    activeDialog.cancel();
    history.pushState(current.st, '');
    return;
  }
  show(e.state || { view: 'home' });
});

// When the app is reopened on a later day, jump to the new "today".
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || current.st.view !== 'home') return;
  const t = L.logicalDay(now());
  if (state.followToday && state.day !== t) { state.day = t; show(current.st); }
});

function setDay(day) {
  state.day = day;
  state.followToday = day === L.logicalDay(now());
  show({ view: 'home' });
}

// ---------- HOME ----------
async function renderHome(root) {
  const day = state.day;
  const today = L.logicalDay(now());
  const isToday = day === today;
  const entries = (await db.entriesForDay(day)).sort(L.byTime);
  const morning = entries.find((e) => e.kind === 'morning');
  const evening = entries.find((e) => e.kind === 'evening');
  const timeline = entries.filter((e) => !L.KINDS[e.kind].checkin);
  if (!settings.startDay) settings.startDay = today;

  root.append(h('header', { class: 'dayhead' },
    h('button', { class: 'nav', 'aria-label': 'Previous day', 'data-testid': 'prev-day', onclick: () => setDay(L.addDays(day, -1)) }, '‹'),
    h('button', { class: 'daytitle', 'data-testid': 'day-title', onclick: () => setDay(today) },
      h('h1', {}, isToday ? 'Today' : L.fmtDay(day)),
      h('div', { class: 'sub' }, [isToday ? L.fmtDay(day) : 'tap for today', L.studyDayLabel(settings.startDay, day)].filter(Boolean).join(' · '))),
    h('button', { class: 'nav', 'aria-label': 'Next day', 'data-testid': 'next-day', disabled: isToday, onclick: () => setDay(L.addDays(day, 1)) }, '›'),
  ));

  // Unsaved drafts first: they're the thing most likely to be forgotten.
  for (const d of await db.allDrafts()) {
    const K = L.KINDS[d.kind];
    root.append(h('div', { class: 'banner draft', 'data-testid': `draft-${d.key}` },
      h('span', {}, `Unsaved ${K.label.toLowerCase()}${d.id ? ' edit' : ''} · ${L.fmtDay(d.day)}`),
      h('span', { class: 'banner-actions' },
        h('button', { class: 'btn small ghost', 'data-testid': 'draft-discard', onclick: async () => {
          if (!(await dialog({ title: 'Discard unsaved changes?', message: `Your unsaved ${K.label.toLowerCase()} will be lost.`, ok: 'Discard', cancel: 'Keep', danger: true }))) return;
          await db.deleteDraft(d.key);
          show(current.st);
        } }, 'Discard'),
        h('button', { class: 'btn small', 'data-testid': 'draft-resume', onclick: () => go('form', { kind: d.kind, id: d.id, day: d.day }) }, 'Resume'))));
  }

  const { entries: total } = await db.counts();
  const age = L.exportAgeDays(settings.lastExport, now());
  if (total > 0 && (age === null || age > L.EXPORT_NAG_DAYS)) {
    root.append(h('div', { class: 'banner', 'data-testid': 'backup-banner' },
      h('span', {}, age === null ? 'Not backed up yet' : `Last backup ${age} days ago`),
      h('button', { class: 'btn small', onclick: () => doExport().then(() => show(current.st)) }, 'Export now')));
  }

  const card = (kind, entry, hint) => h('button', {
    class: `card checkin${entry ? ' done' : ''}`, 'data-testid': `checkin-${kind}`,
    onclick: () => go('form', { kind, id: entry?.id, day }),
  },
    h('div', { class: 'cardtop' }, h('span', { class: 'emoji' }, L.KINDS[kind].icon),
      h('span', { class: 'cardlabel' }, L.KINDS[kind].label), entry ? h('span', { class: 'check' }, '✓') : null),
    h('div', { class: 'cardsub' }, entry ? L.summary(entry) : hint));

  root.append(h('section', { class: 'checkins' },
    card('morning', morning, L.isWaistDay(day) ? 'Check in — waist day' : 'Check in'),
    card('evening', evening, 'Check in')));

  root.append(h('div', { class: 'quick-wrap' }, h('section', { class: 'quick' },
    L.QUICK.map((k) => h('button', { class: 'qbtn', 'data-testid': `quick-${k}`, onclick: () => go('form', { kind: k, day }) },
      h('span', { class: 'emoji' }, L.KINDS[k].icon), h('span', { class: 'qlabel' }, L.KINDS[k].label))))));

  const list = h('section', { class: 'timeline' });
  if (!timeline.length) list.append(h('p', { class: 'empty' }, 'Nothing logged yet for this day.'));
  for (const e of timeline) {
    const thumb = h('div', { class: 'tthumb' }, L.KINDS[e.kind].icon);
    if (e.photos?.length) photoUrl(e.photos[0]).then((u) => u && thumb.replaceChildren(h('img', { src: u, alt: '' })));
    list.append(h('button', { class: 'trow', 'data-testid': `entry-${e.kind}`, onclick: () => go('form', { kind: e.kind, id: e.id, day }) },
      thumb,
      h('div', { class: 'tbody' },
        h('div', { class: 'tmeta' }, `${L.fmtTime(e.occurred_at)} · ${L.KINDS[e.kind].label}`),
        h('div', { class: 'ttext' }, L.summary(e)))));
  }
  root.append(h('h2', {}, 'Log'), list);
  root.append(h('footer', {}, h('button', { class: 'btn ghost', 'data-testid': 'settings', onclick: () => go('settings') }, '⚙ Settings & export')));
}

// ---------- FORM ----------
async function lastMorningBefore(day) {
  for (let i = 1; i <= 7; i++) {
    const m = (await db.entriesForDay(L.addDays(day, -i))).find((e) => e.kind === 'morning');
    if (m) return m;
  }
  return null;
}

async function downscale(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const s = Math.min(1, L.PHOTO_MAX_PX / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s);
    c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    return (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85))) || file;
  } catch {
    return file;   // keep the original rather than lose the photo
  }
}

async function renderForm(root, st) {
  const kind = st.kind;
  const K = L.KINDS[kind];
  const existing = st.id ? await db.getEntry(st.id) : null;
  if (st.id && !existing) {
    root.append(h('header', { class: 'formhead' }, h('button', { class: 'nav', 'aria-label': 'Back', 'data-testid': 'back', onclick: () => history.back() }, '‹'), h('h1', {}, K.label)),
      h('p', { class: 'empty' }, 'This entry no longer exists.'));
    await db.deleteDraft(`edit:${st.id}`);
    return {};
  }
  const key = existing ? `edit:${existing.id}` : `new:${kind}`;
  const draft = await db.getDraft(key);
  const day = draft?.day ?? existing?.day ?? st.day ?? state.day;

  // Baseline = the form as it would open with no unsaved changes.
  let baseVals = existing ? L.fieldsToForm(kind, existing.fields) : {};
  if (!existing) {
    for (const f of L.SCHEMA[kind]) if (f.def !== undefined) baseVals[f.k] = f.def;
    if (kind === 'morning') {
      const prev = await lastMorningBefore(day);
      if (prev) for (const k of ['bed_time', 'wake_time']) if (prev.fields[k]) baseVals[k] = prev.fields[k];
    }
  }
  const baseWhen = L.toLocalInput(existing ? new Date(existing.occurred_at) : L.defaultTime(kind, day, now()));
  const basePhotos = existing ? [...existing.photos] : [];
  const baseline = L.snapshot({ vals: baseVals, when: baseWhen, photoIds: basePhotos });

  // Working state (restored from a draft if there is one).
  let vals = draft ? draft.vals : structuredClone(baseVals);
  let photoIds = draft ? [...draft.photoIds] : [...basePhotos];
  const pending = new Map((draft?.pending || []).map((p) => [p.id, p.blob]));  // new, unsaved photos
  const removed = new Set(draft?.removed || []);                               // saved photos to delete on save
  let finished = false;    // set once saved/discarded/deleted, so leaving doesn't re-save a draft

  const sameDay = await db.entriesForDay(day);
  const ctx = {
    isWaistDay: L.isWaistDay(day) || vals.waist != null,
    morningPlan: kind === 'evening'
      ? (sameDay.find((e) => e.kind === 'morning')?.fields.plan || []).filter((p) => p !== 'rest') : [],
  };

  // --- drafts: saved shortly after every change, and immediately when the app is hidden ---
  const whenInput = h('input', { type: 'datetime-local', 'data-testid': 'when', 'aria-label': 'When',
    value: draft?.when ?? baseWhen, oninput: () => changed() });
  const isDirty = () => L.snapshot({ vals, when: whenInput.value, photoIds }) !== baseline;
  let timer = null;
  async function persistDraft() {
    clearTimeout(timer);
    if (finished) return;
    if (!isDirty()) return db.deleteDraft(key);
    return db.putDraft({ key, kind, id: existing?.id ?? null, day, vals, when: whenInput.value, photoIds,
      pending: [...pending].map(([id, blob]) => ({ id, blob })), removed: [...removed], saved_at: now().toISOString() });
  }
  function changed() { clearTimeout(timer); timer = setTimeout(persistDraft, 300); }
  const onHide = () => { if (document.visibilityState === 'hidden') persistDraft(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', persistDraft);

  // --- field widgets ---
  let cameraInput = null;
  function photosField() {
    const grid = h('div', { class: 'photos' });
    let drawSeq = 0;
    async function draw() {
      const my = ++drawSeq;
      const items = [];
      for (const pid of photoIds) {
        const src = pending.has(pid) ? mkUrl(pending.get(pid)) : await photoUrl(pid);
        items.push(h('div', { class: 'thumb' }, h('img', { src: src || '', alt: '' }),
          h('button', { type: 'button', class: 'x', 'aria-label': 'Remove photo', 'data-testid': 'remove-photo', onclick: async () => {
            if (!(await dialog({ title: 'Remove this photo?', ok: 'Remove', cancel: 'Keep', danger: true }))) return;
            photoIds = photoIds.filter((x) => x !== pid);
            if (pending.has(pid)) pending.delete(pid); else removed.add(pid);
            draw();
            changed();
          } }, '✕')));
      }
      if (my === drawSeq) grid.replaceChildren(...items);
    }
    const picker = (useCamera) => {
      const input = h('input', {
        type: 'file', accept: 'image/*', hidden: true, multiple: !useCamera, 'data-testid': useCamera ? 'camera-input' : 'gallery-input',
        onchange: async (e) => {
          for (const file of e.target.files) {
            const pid = L.newId();
            pending.set(pid, await downscale(file));
            photoIds.push(pid);
          }
          e.target.value = '';
          draw();
          changed();
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
      case 'number':   // kept as text so dictated or mistyped input is never silently dropped
        return h('input', { type: 'text', inputMode: 'decimal', autocomplete: 'off', 'aria-label': L.shortLabel(f),
          value: vals[f.k] ?? '', oninput: (e) => { vals[f.k] = e.target.value; changed(); } });
      case 'time':
        return h('input', { type: 'time', 'aria-label': L.shortLabel(f), value: vals[f.k] ?? '',
          oninput: (e) => { vals[f.k] = e.target.value || undefined; changed(); } });
      case 'text': {
        const ta = h('textarea', { rows: 3, placeholder: L.TEXT_HINT, 'aria-label': L.shortLabel(f), value: vals[f.k] ?? '',
          oninput: (e) => { vals[f.k] = e.target.value; grow(); changed(); } });
        const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
        root.addEventListener('shown', grow);
        return ta;
      }
      case 'scale': {
        const btns = [];
        const paint = () => btns.forEach((b, i) => { b.classList.toggle('on', vals[f.k] === i + 1); b.setAttribute('aria-pressed', vals[f.k] === i + 1); });
        for (let i = 1; i <= f.n; i++) {
          btns.push(h('button', { type: 'button', class: 'pill', onclick: () => {
            vals[f.k] = vals[f.k] === i ? undefined : i;   // tap again to clear
            paint(); changed();
          } }, i));
        }
        paint();
        return h('div', {}, h('div', { class: `scale n${f.n}` }, btns),
          f.lo ? h('div', { class: 'scalelabels' }, h('span', {}, `1 = ${f.lo}`), h('span', {}, `${f.n} = ${f.hi}`)) : null);
      }
      case 'chips': {
        const isOn = (o) => (f.multi ? (vals[f.k] || []).includes(o) : vals[f.k] === o);
        const btns = f.opts.map((o) => h('button', { type: 'button', class: 'pill', onclick: () => {
          if (f.multi) {
            const cur = new Set(vals[f.k] || []);
            cur.has(o) ? cur.delete(o) : cur.add(o);
            vals[f.k] = f.opts.filter((x) => cur.has(x));   // keep a stable order
          } else {
            vals[f.k] = vals[f.k] === o ? undefined : o;
          }
          paint(); changed();
        } }, o));
        const paint = () => btns.forEach((b, i) => { b.classList.toggle('on', isOn(f.opts[i])); b.setAttribute('aria-pressed', isOn(f.opts[i])); });
        paint();
        return h('div', { class: 'chips' }, btns);
      }
      case 'stepper': {
        const out = h('span', { class: 'stepval', 'aria-live': 'polite' });
        const paint = () => { out.textContent = vals[f.k] ?? 0; };
        const bump = (d) => { vals[f.k] = Math.min(f.max ?? 99, Math.max(0, (vals[f.k] ?? 0) + d)); paint(); changed(); };
        paint();
        return h('div', { class: 'stepper' },
          h('button', { type: 'button', class: 'pill', 'aria-label': `Decrease ${L.shortLabel(f)}`, onclick: () => bump(-1) }, '−'), out,
          h('button', { type: 'button', class: 'pill', 'aria-label': `Increase ${L.shortLabel(f)}`, onclick: () => bump(1) }, '+'));
      }
      case 'photos':
        return photosField();
    }
  }

  // --- actions ---
  let saving = false;
  async function save() {
    if (saving) return;                 // double-tap guard
    saving = true;
    saveBtn.disabled = true;
    try {
      const occurred = new Date(whenInput.value);
      const sameDayEntries = Number.isNaN(occurred.getTime()) ? [] : await db.entriesForDay(L.logicalDay(occurred));
      const { fields, errors, warnings } = L.validate({ kind, vals, photoIds, occurred, now: now(), sameDayEntries, id: existing?.id });
      if (errors.length) { await dialog({ title: "Can't save yet", message: errors, ok: 'OK', cancel: null }); return; }
      if (warnings.length && !(await dialog({ title: 'Double-check', message: warnings, ok: 'Save anyway', cancel: 'Go back' }))) return;
      const entry = L.buildEntry({ existing, kind, fields, photoIds, occurred, now: now() });
      const newPhotos = [...pending].filter(([id]) => photoIds.includes(id))
        .map(([id, blob]) => ({ id, blob, type: blob.type || 'image/jpeg', created_at: now().toISOString() }));
      await db.saveEntry(entry, { newPhotos, removedPhotoIds: [...removed] });
      finished = true;
      await db.deleteDraft(key);
      state.day = entry.day;
      state.followToday = entry.day === L.logicalDay(now());
      toast('Saved');
      history.back();
    } finally {
      saving = false;
      saveBtn.disabled = false;
    }
  }

  async function cancel() {
    if (isDirty() && !(await dialog({ title: 'Discard changes?', message: 'What you entered on this screen will be lost.',
      ok: 'Discard', cancel: 'Keep editing', danger: true }))) return;
    finished = true;
    await db.deleteDraft(key);
    history.back();
  }

  async function remove() {
    if (!(await dialog({ title: `Delete this ${K.label.toLowerCase()} entry?`,
      message: existing.photos.length ? 'Its photos will be deleted too. This can’t be undone.' : 'This can’t be undone.',
      ok: 'Delete', cancel: 'Keep', danger: true }))) return;
    await db.deleteEntry(existing);
    finished = true;
    await db.deleteDraft(key);
    toast('Deleted');
    history.back();
  }

  // --- layout ---
  root.append(h('header', { class: 'formhead' },
    h('button', { class: 'nav', 'aria-label': 'Back (keeps your changes)', 'data-testid': 'back', onclick: () => history.back() }, '‹'),
    h('h1', {}, `${K.icon} ${K.label}${existing ? ' (edit)' : ''}`)));

  if (draft) {
    root.append(h('div', { class: 'banner draft', 'data-testid': 'draft-restored' },
      h('span', {}, `Restored unsaved changes from ${L.fmtTime(draft.saved_at)}`),
      h('button', { class: 'btn small ghost', 'data-testid': 'draft-discard-here', onclick: async () => {
        if (!(await dialog({ title: 'Discard unsaved changes?', ok: 'Discard', cancel: 'Keep', danger: true }))) return;
        finished = true;
        await db.deleteDraft(key);
        show(current.st);           // reopen the same form, fresh
      } }, 'Discard')));
  }

  const form = h('div', { class: 'form' });
  for (const f of L.SCHEMA[kind]) {
    if (f.show && !f.show(ctx)) continue;
    const label = typeof f.label === 'function' ? f.label(ctx) : f.label;
    form.append(h('div', { class: 'field', 'data-testid': `field-${f.k}` }, h('div', { class: 'flabel' }, label), widget(f)));
  }
  const shortcuts = !existing && day === L.logicalDay(now())
    ? h('div', { class: 'chips' }, [['Now', 0], ['30m ago', 30], ['1h ago', 60], ['2h ago', 120], ['4h ago', 240]]
      .map(([lbl, m]) => h('button', { type: 'button', class: 'pill', onclick: () => {
        whenInput.value = L.toLocalInput(new Date(now().getTime() - m * 60e3));
        changed();
      } }, lbl)))
    : null;
  form.append(h('div', { class: 'field', 'data-testid': 'field-when' }, h('div', { class: 'flabel' }, 'When'), shortcuts, whenInput));
  root.append(form);

  const saveBtn = h('button', { class: 'btn primary', 'data-testid': 'save', onclick: save }, 'Save');
  root.append(h('div', { class: 'actions' },
    existing ? h('button', { class: 'btn danger', 'data-testid': 'delete', 'aria-label': 'Delete', onclick: remove },
      '🗑', h('span', { class: 'btn-label' }, 'Delete')) : null,
    h('button', { class: 'btn ghost', 'data-testid': 'cancel', onclick: cancel }, 'Cancel'),
    saveBtn));

  // Meals: try to open the camera straight away (allowed while the tap that
  // opened this form still counts as a user gesture).
  if (!existing && !draft && K.cameraFirst && cameraInput) {
    root.addEventListener('shown', () => { try { cameraInput.click(); } catch { /* ignore */ } });
  }

  return {
    async leave() {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', persistDraft);
      if (finished) return;
      const dirty = isDirty();
      await persistDraft();
      if (dirty) toast('Unsaved changes kept — resume from the home screen');
    },
  };
}

// ---------- SETTINGS / EXPORT ----------
async function doExport() {
  const { blob, entries, photos } = await exportBackup({ startDay: settings.startDay, now: now() });
  const a = h('a', { href: URL.createObjectURL(blob), download: `turtle-log-${L.ymd(now())}.zip` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60e3);
  settings.lastExport = now().toISOString();
  toast(`Exported ${entries} entries, ${photos} photos`);
}

async function renderSettings(root) {
  const { entries, photos } = await db.counts();
  const persisted = await navigator.storage?.persisted?.();
  const est = await navigator.storage?.estimate?.();
  const mb = est ? (est.usage / 1e6).toFixed(1) : '?';
  const last = settings.lastExport;

  root.append(h('header', { class: 'formhead' },
    h('button', { class: 'nav', 'aria-label': 'Back', 'data-testid': 'back', onclick: () => history.back() }, '‹'),
    h('h1', {}, '⚙ Settings')));

  const start = h('input', { type: 'date', 'aria-label': 'Study start day', 'data-testid': 'start-day',
    value: settings.startDay || L.logicalDay(now()), onchange: (e) => {
      if (e.target.value) { settings.startDay = e.target.value; toast('Start day saved'); }
    } });

  const importInput = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true, 'data-testid': 'import-input',
    onchange: async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (!(await dialog({ title: 'Import this backup?', message: 'Entries already on this phone with the same id will be replaced by the backup’s version. Other entries are kept.',
        ok: 'Import', cancel: 'Cancel' }))) return;
      try {
        const meta = await importBackup(await file.arrayBuffer());
        if (meta.study_start_day) settings.startDay = meta.study_start_day;
        toast(`Imported ${meta.entries.length} entries`);
        show(current.st);
      } catch (err) {
        await dialog({ title: 'Import failed', message: `${err.message}. Nothing was changed.`, ok: 'OK', cancel: null });
      }
    } });

  root.append(h('div', { class: 'form' },
    h('div', { class: 'field' }, h('div', { class: 'flabel' }, `Study start day (day 1 of ${L.STUDY_DAYS})`), start),

    h('div', { class: 'field' }, h('div', { class: 'flabel' }, 'Backup / export'),
      h('p', { class: 'note', 'data-testid': 'counts' }, `${entries} entries, ${photos} photos, ~${mb} MB. `,
        last ? `Last export ${new Date(last).toLocaleString('en-US')}.` : 'Never exported.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', 'data-testid': 'export', onclick: () => doExport().then(() => show(current.st)) }, '⬇ Export zip'),
        h('label', { class: 'btn', 'data-testid': 'import' }, '⬆ Import zip', importInput))),

    h('div', { class: 'field' }, h('div', { class: 'flabel' }, 'Storage'),
      h('p', { class: 'note' }, persisted
        ? '✓ Chrome has agreed to keep this data. (Clearing site data for this app would still erase it — export regularly.)'
        : 'Chrome may clear this data if the phone runs low on space. Installing the app to your home screen usually lets it be kept.'),
      persisted ? null : h('button', { class: 'btn', onclick: async () => {
        const ok = await navigator.storage?.persist?.();
        toast(ok ? 'Storage will be kept' : 'Chrome declined — install to home screen and try again');
        show(current.st);
      } }, 'Ask Chrome to keep data')),

    h('div', { class: 'field' }, h('div', { class: 'flabel' }, 'Danger zone'),
      h('button', { class: 'btn danger', 'data-testid': 'delete-all', onclick: async () => {
        if (!(await dialog({ title: 'Delete ALL data?', message: `${entries} entries and ${photos} photos will be erased from this phone.`,
          ok: 'Continue', cancel: 'Cancel', danger: true }))) return;
        if (!(await dialog({ title: 'Are you sure?', message: 'This cannot be undone. Export first if unsure.',
          ok: 'Delete everything', cancel: 'Cancel', danger: true, requireText: 'DELETE' }))) return;
        await db.clearAll();
        toast('All data deleted');
        show(current.st);
      } }, 'Delete all data')),

    h('p', { class: 'note' }, 'Turtle Log makes no network requests. Data lives only on this phone until you export it.'),
  ));
}

// ---------- boot ----------
// If the page was reloaded (or the OS killed and restored it) mid-form,
// history.state still describes that form, and its draft is restored.
const initial = history.state?.view ? history.state : { view: 'home' };
if (!history.state?.view) history.replaceState(initial, '');
if (initial.day) state.day = initial.day;
show(initial);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
navigator.storage?.persisted?.().then((p) => { if (!p) navigator.storage.persist?.(); });
