// Integration: the real storage + backup modules running in real Chrome/IndexedDB.
import { join } from 'node:path';
import { test, expect, open, dump, seedStudy, field, dialogOk, FIXTURES } from './helpers.mjs';

const entry = (id, photos = [], day = '2026-11-16') => ({ id, kind: 'meal', day, occurred_at: '2026-11-16T18:00:00Z',
  logged_at: '2026-11-16T18:00:00Z', updated_at: '2026-11-16T18:00:00Z', fields: { meal: 'lunch' }, photos });

test('saveEntry stores entry + photos together; deleteEntry removes both', async ({ page }) => {
  await open(page);
  const after = await page.evaluate(async (e) => {
    const db = await import('/db.js');
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    await db.saveEntry(e, { newPhotos: [{ id: 'p1', blob, type: 'image/jpeg' }, { id: 'p2', blob, type: 'image/jpeg' }] });
    const saved = { day: (await db.entriesForDay('2026-11-16')).length, photos: (await db.allPhotos()).length };
    await db.deleteEntry(e);
    return { saved, deleted: await db.counts() };
  }, entry('e1', ['p1', 'p2']));
  expect(after.saved).toEqual({ day: 1, photos: 2 });
  expect(after.deleted).toEqual({ entries: 0, photos: 0 });
});

test('removing a photo while editing leaves no orphaned photos', async ({ page }) => {
  await open(page);
  await page.getByTestId('quick-meal').click();
  await page.getByTestId('gallery-input').setInputFiles([join(FIXTURES, 'big-landscape.jpg'), join(FIXTURES, 'exif-rotated.jpg')]);
  await expect(page.locator('.thumb')).toHaveCount(2);
  await page.getByTestId('save').click();
  await page.getByTestId('entry-meal').click();
  await page.getByTestId('remove-photo').first().click();
  await dialogOk(page);
  await expect(page.locator('.thumb')).toHaveCount(1);
  await page.getByTestId('save').click();
  await expect(page.locator('.view-home')).toBeVisible();
  const { entries, photos } = await dump(page);
  expect(entries[0].photos).toHaveLength(1);
  expect(photos.map((p) => p.id)).toEqual(entries[0].photos);
});

test('export -> wipe -> import restores identical data, byte for byte', async ({ page }) => {
  await open(page);
  await seedStudy(page, { seed: 2 });
  const before = await dump(page);
  expect(before.entries.length).toBeGreaterThan(80);
  await page.evaluate(async () => {
    const { exportBackup, importBackup } = await import('/backup.js');
    const db = await import('/db.js');
    const { blob } = await exportBackup({ startDay: '2026-11-16' });
    await db.clearAll();
    if ((await db.counts()).entries !== 0) throw new Error('wipe failed');
    await importBackup(await blob.arrayBuffer());
  });
  expect(await dump(page)).toEqual(before);
});

test('importing the same backup twice creates no duplicates', async ({ page }) => {
  await open(page);
  await seedStudy(page, { seed: 3, days: 3 });
  const once = await dump(page);
  await page.evaluate(async () => {
    const { exportBackup, importBackup } = await import('/backup.js');
    const { blob } = await exportBackup({});
    await importBackup(await blob.arrayBuffer());
    await importBackup(await blob.arrayBuffer());
  });
  expect(await dump(page)).toEqual(once);
});

test('a bad backup is rejected and changes nothing', async ({ page }) => {
  await open(page);
  await seedStudy(page, { seed: 5, days: 2 });
  const before = await dump(page);
  const err = await page.evaluate(async () => {
    const { makeZip } = await import('/zip.js');
    const { importBackup } = await import('/backup.js');
    const enc = new TextEncoder();
    const meta = { app: 'turtle-log', schema: 1, entries: [{ id: 'new', kind: 'meal', day: '2026-11-20', occurred_at: '2026-11-20T18:00:00Z',
      logged_at: '2026-11-20T18:00:00Z', updated_at: '2026-11-20T18:00:00Z', fields: {}, photos: ['missing-photo'] }] };
    const zip = makeZip([{ name: 'entries.json', data: enc.encode(JSON.stringify(meta)) }]);
    try { await importBackup(await zip.arrayBuffer()); return null; } catch (e) { return e.message; }
  });
  expect(err).toMatch(/missing/);
  expect(await dump(page)).toEqual(before);
});

test('upgrading from the first database version keeps existing data', async ({ page }) => {
  // Build a v1 database (as shipped in the first release) before the app ever loads.
  await page.clock.setFixedTime(new Date('2026-11-16T09:00:00-06:00'));
  await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204 }));   // plain-text page has no icon link
  await page.goto('/fonts/OFL-LICENSE.txt');
  await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('turtle-log', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('entries', { keyPath: 'id' }).createIndex('day', 'day');
      db.createObjectStore('photos', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const tx = req.result.transaction('entries', 'readwrite');
      tx.objectStore('entries').put({ id: 'old', kind: 'note', day: '2026-11-16', occurred_at: '2026-11-16T14:00:00Z',
        logged_at: '2026-11-16T14:00:00Z', updated_at: '2026-11-16T14:00:00Z', fields: { text: 'from v1' }, photos: [] });
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.goto('/');
  await expect(page.getByTestId('entry-note')).toContainText('from v1');
  // and the new drafts store works
  await page.getByTestId('quick-note').click();
  await field(page, 'text').locator('textarea').fill('draft after upgrade');
  await page.goBack();
  await expect(page.getByTestId('draft-new:note')).toBeVisible();
});
