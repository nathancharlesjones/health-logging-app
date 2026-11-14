// End-to-end: real user journeys through the UI.
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, open, relaunch, dump, field, pill, dialogOk, seedStudy, showApp, MON_9AM, TUE_9AM, FIXTURES, simulateStudy } from './helpers.mjs';
import { readZip } from '../../app/zip.js';
import { simulatedZip } from '../../tools/simulate.mjs';

test('a full day of logging, then export', async ({ page }) => {
  await open(page);
  await expect(page.locator('h1')).toHaveText('Today');
  await expect(page.locator('.sub')).toContainText('Day 1 of 14');

  // Morning check-in (Monday, so waist is asked)
  await page.getByTestId('checkin-morning').click();
  await field(page, 'weight').locator('input').fill('201.4');
  await field(page, 'waist').locator('input').fill('38.5');
  await pill(page, 'sleep_quality', '4').click();
  await pill(page, 'plan', 'climb').click();
  await page.getByTestId('save').click();
  await expect(page.getByTestId('checkin-morning')).toContainText('201.4 lb');
  await expect(page.getByTestId('checkin-morning')).toContainText('✓');

  // Meal with a photo, logged an hour after the fact
  await page.getByTestId('quick-meal').click();
  await page.getByTestId('gallery-input').setInputFiles(join(FIXTURES, 'big-landscape.jpg'));
  await expect(page.locator('.thumb img')).toHaveCount(1);
  await pill(page, 'meal', 'breakfast').click();
  await field(page, 'text').locator('textarea').fill('two eggs and toast');
  await page.getByRole('button', { name: '1h ago' }).click();
  await expect(page.getByTestId('when')).toHaveValue('2026-11-16T08:00');
  await page.getByTestId('save').click();

  await page.getByTestId('quick-drink').click();
  await pill(page, 'drink', 'coffee').click();
  await page.getByTestId('save').click();

  await page.clock.setFixedTime(new Date(MON_9AM.getTime() + 60e3));   // logged a minute later
  await page.getByTestId('quick-activity').click();
  await pill(page, 'activity', 'climb').click();
  await field(page, 'minutes').locator('input').fill('60');
  await pill(page, 'effort', '7').click();
  await page.getByTestId('save').click();

  // Evening check-in knows the morning plan
  await page.getByTestId('checkin-evening').click();
  await expect(field(page, 'plan_done')).toContainText('Did the plan happen? (climb)');
  await pill(page, 'plan_done', 'yes').click();
  await pill(page, 'stress', '2').click();
  await page.getByTestId('save').click();

  // Timeline is in time order; check-ins live in the cards, not the list
  await expect(page.locator('.trow .tmeta')).toHaveText([/8:00 AM · Meal/, /9:00 AM · Drink/, /9:01 AM · Activity/]);
  const { entries, photos } = await dump(page);
  expect(entries.map((e) => e.kind).sort()).toEqual(['activity', 'drink', 'evening', 'meal', 'morning']);
  expect(entries.find((e) => e.kind === 'morning').fields).toEqual({ weight: 201.4, waist: 38.5, sleep_quality: 4, plan: ['climb'] });
  expect(photos).toHaveLength(1);

  // Edit the meal
  await page.getByTestId('entry-meal').click();
  await field(page, 'text').locator('textarea').fill('two eggs, toast, coffee');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('entry-meal')).toContainText('two eggs, toast, coffee');

  // Export
  await page.getByTestId('settings').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
  expect(download.suggestedFilename()).toBe('turtle-log-2026-11-16.zip');
  const bytes = await (await download.createReadStream()).toArray();
  const files = readZip(new Uint8Array(Buffer.concat(bytes)).buffer);
  expect(files.map((f) => f.name.split('/')[0])).toEqual(['README.txt', 'entries.json', 'photos']);
  const meta = JSON.parse(Buffer.from(files[1].data).toString());
  expect(meta.entries).toHaveLength(5);
  expect(meta.timezone).toBe('America/Chicago');
  await expect(page.getByTestId('counts')).toContainText('Last export');
});

test('photos are shrunk to 1280px and phone EXIF rotation is applied', async ({ page }) => {
  await open(page);
  await page.getByTestId('quick-meal').click();
  await page.getByTestId('gallery-input').setInputFiles([join(FIXTURES, 'big-landscape.jpg'), join(FIXTURES, 'exif-rotated.jpg')]);
  await expect(page.locator('.thumb img')).toHaveCount(2);
  await page.getByTestId('save').click();
  const dims = await page.evaluate(async () => {
    const db = await import('/db.js');
    const [entry] = await db.allEntries();
    const out = [];
    for (const id of entry.photos) {
      const bmp = await createImageBitmap((await db.getPhoto(id)).blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d');
      c.drawImage(bmp, 0, 0);
      out.push({ w: bmp.width, h: bmp.height, topPixel: [...c.getImageData(100, 50, 1, 1).data.slice(0, 3)] });
    }
    return out;
  });
  expect(dims[0]).toMatchObject({ w: 1280, h: 853 });
  expect(dims[1]).toMatchObject({ w: 200, h: 400 });            // stored sideways, displayed upright
  expect(dims[1].topPixel[0]).toBeGreaterThan(180);            // the red half ended up on top
});

test('logging on a past day lands on that day', async ({ page }) => {
  await open(page);
  await page.getByTestId('prev-day').click();
  await expect(page.locator('h1')).toHaveText('Sun, Nov 15');
  await page.getByTestId('quick-note').click();
  await expect(page.getByTestId('when')).toHaveValue('2026-11-15T12:00');
  await field(page, 'text').locator('textarea').fill('forgot to log this yesterday');
  await page.getByTestId('save').click();
  await expect(page.locator('h1')).toHaveText('Sun, Nov 15');
  await expect(page.getByTestId('entry-note')).toContainText('forgot to log');
  const [e] = (await dump(page)).entries;
  expect(e.day).toBe('2026-11-15');
  expect(e.logged_at > e.occurred_at).toBe(true);
});

test('an entry timed before 4am is filed under the previous day', async ({ page }) => {
  await open(page);
  await page.getByTestId('quick-meal').click();
  await pill(page, 'meal', 'snack').click();
  await page.getByTestId('when').fill('2026-11-16T01:30');
  await page.getByTestId('save').click();
  await expect(page.locator('h1')).toHaveText('Sun, Nov 15');     // home follows the entry
  await expect(page.getByTestId('entry-meal')).toContainText('snack');
  expect((await dump(page)).entries[0].day).toBe('2026-11-15');
});

test('waist is asked only on Mon/Wed/Fri', async ({ page }) => {
  await open(page, { time: MON_9AM });
  await expect(page.getByTestId('checkin-morning')).toContainText('waist day');
  await page.getByTestId('checkin-morning').click();
  await expect(field(page, 'waist')).toBeVisible();
  await page.clock.setFixedTime(TUE_9AM);
  await relaunch(page);
  await expect(page.getByTestId('checkin-morning')).not.toContainText('waist day');
  await page.getByTestId('checkin-morning').click();
  await expect(field(page, 'weight')).toBeVisible();
  await expect(field(page, 'waist')).toHaveCount(0);
});

test('reopening the app the next morning jumps to the new day', async ({ page }) => {
  await open(page, { time: new Date('2026-11-16T23:00:00-06:00') });
  await expect(page.locator('.sub')).toContainText('Mon, Nov 16');
  await page.clock.setFixedTime(TUE_9AM);
  await showApp(page);
  await expect(page.locator('.sub')).toContainText('Tue, Nov 17');
  await expect(page.locator('.sub')).toContainText('Day 2 of 14');
});

test('morning check-in prefills bed and wake times from the previous morning', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const db = await import('/db.js');
    await db.saveEntry({ id: 'm0', kind: 'morning', day: '2026-11-14', occurred_at: '2026-11-14T13:00:00Z', logged_at: '2026-11-14T13:00:00Z',
      updated_at: '2026-11-14T13:00:00Z', fields: { bed_time: '22:45', wake_time: '06:10', weight: 202 }, photos: [] });
  });
  await page.getByTestId('checkin-morning').click();
  await expect(field(page, 'bed_time').locator('input')).toHaveValue('22:45');
  await expect(field(page, 'wake_time').locator('input')).toHaveValue('06:10');
  await expect(field(page, 'weight').locator('input')).toHaveValue('');   // only times carry over
});

test('a simulated 14-day study imports through the UI and browses correctly', async ({ page }) => {
  const study = simulateStudy({ seed: 4 });
  const path = join(mkdtempSync(join(tmpdir(), 'tl-')), 'study.zip');
  writeFileSync(path, Buffer.from(await simulatedZip({ seed: 4 }).arrayBuffer()));

  await open(page, { time: new Date('2026-11-29T20:00:00-06:00') });   // day 14 evening
  await page.getByTestId('settings').click();
  await page.getByTestId('import-input').setInputFiles(path);
  await dialogOk(page);
  await expect(page.getByTestId('counts')).toContainText(`${study.entries.length} entries, ${study.photos.length} photos`);
  await page.getByTestId('back').click();

  const timelineCount = (day) => study.entries.filter((e) => e.day === day && !['morning', 'evening'].includes(e.kind)).length;
  await expect(page.locator('.sub')).toContainText('Day 14 of 14');
  await expect(page.locator('.trow')).toHaveCount(timelineCount('2026-11-29'));
  for (let i = 0; i < 3; i++) await page.getByTestId('prev-day').click();
  await expect(page.locator('.sub')).toContainText('Day 11 of 14');
  await expect(page.locator('.trow')).toHaveCount(timelineCount('2026-11-26'));
  await expect(page.getByTestId('checkin-morning')).toContainText('✓');
  await expect(page.getByTestId('checkin-evening')).toContainText('✓');
});
