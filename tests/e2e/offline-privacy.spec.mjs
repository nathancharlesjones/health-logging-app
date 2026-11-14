// Offline use and privacy: the app works with no network, and never talks to
// anything but its own origin.
import { join } from 'node:path';
import { test, expect, open, dump, field, pill, dialogOk, FIXTURES, MON_9AM } from './helpers.mjs';

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' });

  test('after one visit, the app loads and saves with no network', async ({ page, context }) => {
    await open(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();                                   // now controlled by the service worker
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.view-home')).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Today');
    const fontsOk = await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px "IBM Plex Mono"'); });
    expect(fontsOk).toBe(true);

    await page.getByTestId('quick-note').click();
    await field(page, 'text').locator('textarea').fill('written in airplane mode');
    await page.getByTestId('save').click();
    await expect(page.getByTestId('entry-note')).toContainText('airplane mode');
    await context.setOffline(false);
  });
});

test('every request goes to the app’s own origin (no trackers, CDNs or APIs)', async ({ page, baseURL }) => {
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await open(page, { time: MON_9AM });

  await page.getByTestId('quick-meal').click();
  await page.getByTestId('gallery-input').setInputFiles(join(FIXTURES, 'big-landscape.jpg'));
  await pill(page, 'meal', 'lunch').click();
  await page.getByTestId('save').click();
  await page.getByTestId('settings').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
  const path = await download.path();
  await page.getByTestId('import-input').setInputFiles(path);
  await dialogOk(page);
  await expect(page.getByTestId('counts')).toContainText('1 entries');

  const foreign = requests.filter((u) => !u.startsWith(baseURL) && !u.startsWith('blob:') && !u.startsWith('data:'));
  expect(foreign).toEqual([]);
  expect((await dump(page)).entries).toHaveLength(1);
});

test('a Content-Security-Policy restricts the page to its own origin', async ({ page }) => {
  await open(page);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  // and it is enforced: a fetch elsewhere fails (Chrome logs the refusal, which is the point)
  page.allowedErrors.push(/Content Security Policy|Failed to fetch/);
  const blocked = await page.evaluate(() => fetch('https://example.com/').then(() => false, () => true));
  expect(blocked).toBe(true);
});
