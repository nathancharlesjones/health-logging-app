// Common human errors: backing out too early, rotating, double-tapping,
// fat-fingering, dictating into a number box, deleting by accident.
import { join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { test, expect, open, dump, field, pill, dialogOk, dialogCancel, waitForDraft, hideApp, seedStudy, FIXTURES } from './helpers.mjs';
import { makeZip } from '../../app/zip.js';

async function startMeal(page) {
  await page.getByTestId('quick-meal').click();
  await page.getByTestId('gallery-input').setInputFiles(join(FIXTURES, 'big-landscape.jpg'));
  await expect(page.locator('.thumb img')).toHaveCount(1);
  await pill(page, 'meal', 'lunch').click();
  await field(page, 'text').locator('textarea').fill('half-dictated sentence about lun');
}

async function expectMealRestored(page) {
  await expect(page.getByTestId('draft-restored')).toBeVisible();
  await expect(field(page, 'text').locator('textarea')).toHaveValue('half-dictated sentence about lun');
  await expect(pill(page, 'meal', 'lunch')).toHaveClass(/on/);
  await expect(page.locator('.thumb img')).toHaveCount(1);
}

test.describe('in-progress work is never lost', () => {
  test('Android back gesture mid-entry keeps a draft that can be resumed', async ({ page }) => {
    await open(page);
    await startMeal(page);
    await page.goBack();
    await expect(page.locator('.view-home')).toBeVisible();
    await expect(page.locator('.toast')).toContainText('Unsaved changes kept');
    await expect(page.getByTestId('draft-new:meal')).toBeVisible();
    expect((await dump(page)).entries).toHaveLength(0);          // nothing saved by accident either
    await page.getByTestId('draft-new:meal').getByTestId('draft-resume').click();
    await expectMealRestored(page);
    await page.getByTestId('save').click();
    const { entries, photos, drafts } = await dump(page);
    expect(entries).toHaveLength(1);
    expect(photos).toHaveLength(1);
    expect(drafts).toHaveLength(0);
  });

  test('the header ‹ button behaves like back (keeps the draft)', async ({ page }) => {
    await open(page);
    await startMeal(page);
    await page.getByTestId('back').click();
    await expect(page.getByTestId('draft-new:meal')).toBeVisible();
  });

  test('tapping the same quick button again also resumes the draft', async ({ page }) => {
    await open(page);
    await startMeal(page);
    await page.goBack();
    await page.getByTestId('quick-meal').click();
    await expectMealRestored(page);
  });

  test('the app being killed mid-entry (reload) restores the form', async ({ page }) => {
    await open(page);
    await startMeal(page);
    await hideApp(page);                       // Android backgrounds the app first
    await waitForDraft(page, 'new:meal');
    await page.reload();
    await expect(page.locator('.view-form')).toBeVisible();
    await expectMealRestored(page);
  });

  test('rotating the phone mid-entry keeps everything', async ({ page }) => {
    await open(page);
    await page.getByTestId('checkin-morning').click();
    await field(page, 'weight').locator('input').fill('201.4');
    await pill(page, 'sleep_quality', '3').click();
    await field(page, 'text').locator('textarea').fill('rotating now');
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(field(page, 'weight').locator('input')).toHaveValue('201.4');
    await expect(pill(page, 'sleep_quality', '3')).toHaveClass(/on/);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(field(page, 'text').locator('textarea')).toHaveValue('rotating now');
    await page.getByTestId('save').click();
    expect((await dump(page)).entries[0].fields).toEqual({ weight: 201.4, sleep_quality: 3, text: 'rotating now' });
  });

  test('opening a form and backing out without changes leaves no draft', async ({ page }) => {
    await open(page);
    for (const k of ['meal', 'drink', 'activity', 'measure', 'note']) {
      await page.getByTestId(`quick-${k}`).click();
      await expect(page.locator('.view-form')).toBeVisible();
      await page.goBack();
      await expect(page.locator('.view-home')).toBeVisible();
    }
    await page.getByTestId('checkin-morning').click();
    await page.goBack();
    await expect(page.locator('.banner.draft')).toHaveCount(0);
    expect((await dump(page)).drafts).toEqual([]);
  });

  test('editing an existing entry and backing out keeps the edit as a draft, not saved', async ({ page }) => {
    await open(page);
    await page.getByTestId('quick-note').click();
    await field(page, 'text').locator('textarea').fill('original');
    await page.getByTestId('save').click();
    await page.getByTestId('entry-note').click();
    await field(page, 'text').locator('textarea').fill('changed my mind');
    await page.goBack();
    await expect(page.getByTestId('entry-note')).toContainText('original');
    await expect(page.locator('.banner.draft')).toContainText('Unsaved note edit');
  });
});

test.describe('nothing is removed without confirmation', () => {
  test('Cancel on a form with changes asks first; "Keep editing" keeps them', async ({ page }) => {
    await open(page);
    await startMeal(page);
    await page.getByTestId('cancel').click();
    await expect(page.getByTestId('dialog')).toContainText('Discard changes?');
    await dialogCancel(page);
    await expect(field(page, 'text').locator('textarea')).toHaveValue('half-dictated sentence about lun');
    await page.getByTestId('cancel').click();
    await dialogOk(page);
    await expect(page.locator('.view-home')).toBeVisible();
    expect(await dump(page)).toMatchObject({ entries: [], drafts: [], photos: [] });
  });

  test('Cancel on an untouched form just closes', async ({ page }) => {
    await open(page);
    await page.getByTestId('quick-note').click();
    await page.getByTestId('cancel').click();
    await expect(page.locator('.view-home')).toBeVisible();
    await expect(page.getByTestId('dialog')).toHaveCount(0);
  });

  test('removing a photo asks first', async ({ page }) => {
    await open(page);
    await startMeal(page);
    await page.getByTestId('remove-photo').click();
    await expect(page.getByTestId('dialog')).toContainText('Remove this photo?');
    await dialogCancel(page);
    await expect(page.locator('.thumb')).toHaveCount(1);
    await page.getByTestId('remove-photo').click();
    await dialogOk(page);
    await expect(page.locator('.thumb')).toHaveCount(0);
  });

  test('deleting an entry asks first, and deletes its photos', async ({ page }) => {
    await open(page);
    await startMeal(page);
    await page.getByTestId('save').click();
    await page.getByTestId('entry-meal').click();
    await page.getByTestId('delete').click();
    await expect(page.getByTestId('dialog')).toContainText('Its photos will be deleted too');
    await dialogCancel(page);
    await expect(page.locator('.view-form')).toBeVisible();
    expect((await dump(page)).entries).toHaveLength(1);
    await page.getByTestId('delete').click();
    await dialogOk(page);
    await expect(page.locator('.view-home')).toBeVisible();
    expect(await dump(page)).toMatchObject({ entries: [], photos: [] });
  });

  test('discarding a draft from the home screen asks first', async ({ page }) => {
    await open(page);
    await startMeal(page);
    await page.goBack();
    await page.getByTestId('draft-new:meal').getByTestId('draft-discard').click();
    await dialogCancel(page);
    await expect(page.getByTestId('draft-new:meal')).toBeVisible();
    await page.getByTestId('draft-new:meal').getByTestId('draft-discard').click();
    await dialogOk(page);
    await expect(page.getByTestId('draft-new:meal')).toHaveCount(0);
    expect((await dump(page)).drafts).toEqual([]);
  });

  test('"Delete all data" needs two confirmations and typing DELETE', async ({ page }) => {
    await open(page);
    await seedStudy(page, { seed: 1, days: 2 });
    const before = (await dump(page)).entries.length;
    await page.getByTestId('settings').click();

    await page.getByTestId('delete-all').click();
    await dialogCancel(page);                                         // bail at step 1
    await page.getByTestId('delete-all').click();
    await dialogOk(page);
    await expect(page.getByTestId('dialog-ok')).toBeDisabled();       // step 2 locked until typed
    await page.getByTestId('dialog-input').fill('delet');
    await expect(page.getByTestId('dialog-ok')).toBeDisabled();
    await dialogCancel(page);                                         // bail at step 2
    expect((await dump(page)).entries).toHaveLength(before);

    await page.getByTestId('delete-all').click();
    await dialogOk(page);
    await page.getByTestId('dialog-input').fill('delete');            // case doesn't matter
    await dialogOk(page);
    await expect(page.getByTestId('counts')).toContainText('0 entries, 0 photos');
  });

  test('dialogs close on Escape, tap outside, and the back gesture — all as "cancel"', async ({ page }) => {
    await open(page);
    await startMeal(page);
    for (const dismiss of [
      () => page.keyboard.press('Escape'),
      () => page.getByTestId('dialog').click({ position: { x: 5, y: 5 } }),
      () => page.goBack(),
    ]) {
      await page.getByTestId('remove-photo').click();
      await expect(page.getByTestId('dialog')).toBeVisible();
      await dismiss();
      await expect(page.getByTestId('dialog')).toHaveCount(0);
      await expect(page.locator('.view-form')).toBeVisible();          // still on the form
      await expect(page.locator('.thumb')).toHaveCount(1);             // and nothing removed
    }
    await page.goBack();                                               // a real back now leaves
    await expect(page.locator('.view-home')).toBeVisible();
  });
});

test.describe('mistakes are caught before they become data', () => {
  test('double-tapping Save creates one entry', async ({ page }) => {
    await open(page);
    await page.getByTestId('quick-drink').click();
    await pill(page, 'drink', 'beer').click();
    await page.getByTestId('save').evaluate((b) => { b.click(); b.click(); b.click(); });
    await expect(page.locator('.view-home')).toBeVisible();
    expect((await dump(page)).entries).toHaveLength(1);
  });

  test('a dictated number ("two hundred") is refused, and the text is kept to fix', async ({ page }) => {
    await open(page);
    await page.getByTestId('checkin-morning').click();
    await field(page, 'weight').locator('input').fill('two hundred one');
    await page.getByTestId('save').click();
    await expect(page.getByTestId('dialog')).toContainText("“two hundred one” isn't a number");
    await dialogOk(page);
    await expect(field(page, 'weight').locator('input')).toHaveValue('two hundred one');
    await field(page, 'weight').locator('input').fill('201');
    await page.getByTestId('save').click();
    expect((await dump(page)).entries[0].fields.weight).toBe(201);
  });

  test('a fat-fingered value (2014 lb) warns; "Go back" keeps the form, "Save anyway" saves', async ({ page }) => {
    await open(page);
    await page.getByTestId('checkin-morning').click();
    await field(page, 'weight').locator('input').fill('2014');
    await page.getByTestId('save').click();
    await expect(page.getByTestId('dialog')).toContainText('Weight 2014 lb is outside the usual');
    await dialogCancel(page);
    await expect(page.locator('.view-form')).toBeVisible();
    expect((await dump(page)).entries).toHaveLength(0);
    await page.getByTestId('save').click();
    await dialogOk(page);
    expect((await dump(page)).entries[0].fields.weight).toBe(2014);
  });

  test('a time in the future warns', async ({ page }) => {
    await open(page);
    await page.getByTestId('quick-note').click();
    await field(page, 'text').locator('textarea').fill('x');
    await page.getByTestId('when').fill('2026-11-16T15:00');
    await page.getByTestId('save').click();
    await expect(page.getByTestId('dialog')).toContainText('The time is in the future');
  });

  test('moving a check-in onto a day that already has one warns', async ({ page }) => {
    await open(page);
    await page.getByTestId('checkin-morning').click();
    await field(page, 'weight').locator('input').fill('201');
    await page.getByTestId('save').click();
    await page.getByTestId('prev-day').click();
    await page.getByTestId('checkin-morning').click();
    await field(page, 'weight').locator('input').fill('202');
    await page.getByTestId('when').fill('2026-11-16T07:00');
    await page.getByTestId('save').click();
    await expect(page.getByTestId('dialog')).toContainText("already a morning check-in for Mon, Nov 16");
  });

  test('saving an empty entry is refused', async ({ page }) => {
    await open(page);
    await page.getByTestId('quick-meal').click();
    await page.getByTestId('save').click();
    await expect(page.getByTestId('dialog')).toContainText('Nothing to save yet');
  });

  test('importing the wrong zip says so and changes nothing', async ({ page }) => {
    await open(page);
    await seedStudy(page, { seed: 1, days: 1 });
    const before = await dump(page);
    const path = join(mkdtempSync(join(tmpdir(), 'tl-')), 'vacation-photos.zip');
    writeFileSync(path, Buffer.from(await makeZip([{ name: 'IMG_0001.jpg', data: new Uint8Array([1, 2, 3]) }]).arrayBuffer()));
    await page.getByTestId('settings').click();
    await page.getByTestId('import-input').setInputFiles(path);
    await dialogOk(page);                                             // "Import this backup?"
    await expect(page.getByTestId('dialog')).toContainText('Import failed');
    await expect(page.getByTestId('dialog')).toContainText('Nothing was changed');
    await dialogOk(page);
    expect(await dump(page)).toEqual(before);
  });
});
