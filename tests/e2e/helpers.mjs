import { test as base, expect } from '@playwright/test';
import { simulatedZip, simulateStudy } from '../../tools/simulate.mjs';

export { expect, simulateStudy };

// Every browser test fails if the page throws or logs a console error.
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.allowedErrors = [];                       // a test can whitelist errors it deliberately causes
    await use(page);
    expect(errors.filter((e) => !page.allowedErrors.some((re) => re.test(e))), 'browser errors during test').toEqual([]);
  },
});

// Fixed, known times (America/Chicago, set in playwright.config).
export const MON_9AM = new Date('2026-11-16T09:00:00-06:00');   // study day 1, a waist day
export const TUE_9AM = new Date('2026-11-17T09:00:00-06:00');
export const STUDY_START = '2026-11-16';

export async function open(page, { time = MON_9AM, path = '/' } = {}) {
  await page.clock.setFixedTime(time);
  await page.goto(path);
  await page.locator('.view-home').waitFor();
  await page.evaluate(() => document.fonts.ready);
}

// A cold launch from the home-screen icon: a brand-new navigation, so no
// history.state carries over (a same-URL reload would restore the open form).
let launches = 0;
export async function relaunch(page) {
  await page.goto(`/?launch=${++launches}`);
  await page.locator('.view-home').waitFor();
}

export async function goHome(page) {
  await page.locator('.view-home').waitFor();
}

// Load a simulated study straight into storage (fast path; the UI import path
// has its own test).
export async function seedStudy(page, { seed = 1, days = 14, startDay = STUDY_START } = {}) {
  const buf = Buffer.from(await simulatedZip({ seed, days, startDay }).arrayBuffer());
  await page.evaluate(async ({ b64, startDay }) => {
    const { importBackup } = await import('/backup.js');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await importBackup(bytes.buffer);
    localStorage.setItem('startDay', startDay);
  }, { b64: buf.toString('base64'), startDay });
  await page.reload();
  await goHome(page);
  return simulateStudy({ seed, days, startDay });
}

// Everything in storage, in a comparable form (photo bytes hashed).
export const dump = (page) => page.evaluate(async () => {
  const db = await import('/db.js');
  const hash = async (blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const photos = [];
  for (const p of await db.allPhotos()) photos.push({ id: p.id, type: p.type, size: p.blob.size, sha: await hash(p.blob) });
  return {
    entries: (await db.allEntries()).sort((a, b) => a.id.localeCompare(b.id)),
    photos: photos.sort((a, b) => a.id.localeCompare(b.id)),
    drafts: (await db.allDrafts()).map((d) => ({ key: d.key, vals: d.vals, photoIds: d.photoIds, when: d.when })),
  };
});

export const field = (page, k) => page.getByTestId(`field-${k}`);
export const pill = (page, k, label) => field(page, k).locator('.pill', { hasText: new RegExp(`^${label}$`) });
export const dialogOk = (page) => page.getByTestId('dialog-ok').click();
export const dialogCancel = (page) => page.getByTestId('dialog-cancel').click();

export async function waitForDraft(page, key) {
  await expect.poll(async () => (await dump(page)).drafts.map((d) => d.key)).toContain(key);
}

// Simulates Android sending the app to the background (switching apps, screen off).
export const hideApp = (page) => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
export const showApp = (page) => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});

export const FIXTURES = new URL('../fixtures/', import.meta.url).pathname;
