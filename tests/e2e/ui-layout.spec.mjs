// UI layout audit: every screen and dialog, on several phone shapes, checked for
//   - sideways scrolling of the whole page
//   - controls off-screen, under the sticky header / action bar, or hidden behind other elements
//   - tap targets smaller than 44×44 CSS px
//   - button/chip text clipped or wrapped onto a second line
//   - buttons with no accessible name
//   - the action bar (Save/Cancel/Delete) and dialog buttons fully on screen
//   - the last form field able to scroll clear of the action bar
// Screenshots of every screen are attached to the HTML report for a human look.
import { test, expect, open, relaunch, seedStudy, field, pill, MON_9AM } from './helpers.mjs';

const VIEWPORTS = [
  { name: 'small phone 320×568', viewport: { width: 320, height: 568 } },
  { name: 'typical 360×780', viewport: { width: 360, height: 780 } },
  { name: 'large 412×915', viewport: { width: 412, height: 915 } },
  { name: 'landscape 780×360', viewport: { width: 780, height: 360 } },
  // Android's font-size setting scales text, not layout: the app's fonts are all rem-based, so scale the root.
  { name: 'large text 360×780 @130%', viewport: { width: 360, height: 780 }, fontScale: 1.3 },
  { name: 'huge text 412×915 @160%', viewport: { width: 412, height: 915 }, fontScale: 1.6 },
];

// Runs inside the page. Returns a list of human-readable problems.
async function auditInPage() {
  const out = [];
  const W = innerWidth;
  const H = innerHeight;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const name = (el) => el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.textContent.trim().replace(/\s+/g, ' ').slice(0, 30) || el.tagName;
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };

  if (document.documentElement.scrollWidth > W + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth}px wide in a ${W}px screen)`);

  // Anything at all (text, images, cards) running past the right edge.
  for (const el of document.querySelectorAll('#app *, .overlay *')) {
    if (!visible(el) || el.closest('.toast')) continue;
    const r = el.getBoundingClientRect();
    if (r.right > W + 1) { out.push(`content runs off the right edge: ${el.className || el.tagName} "${name(el)}"`); break; }
  }

  const overlay = document.querySelector('.overlay');
  const scope = overlay || document;
  const controls = [...scope.querySelectorAll('button, label.btn, input:not([type=file]), textarea, select, a[href]')].filter(visible);
  for (const el of controls) {
    if (!overlay) { el.scrollIntoView({ block: 'center', inline: 'nearest' }); await frame(); }
    const r = el.getBoundingClientRect();
    const n = name(el);
    if (r.left < -0.5 || r.right > W + 0.5) out.push(`${n}: off-screen sideways (${Math.round(r.left)}..${Math.round(r.right)} of ${W})`);
    if (r.top < -0.5 || r.bottom > H + 0.5) out.push(`${n}: can't be scrolled fully on screen (${Math.round(r.top)}..${Math.round(r.bottom)} of ${H})`);
    if (r.width < 43.5 || r.height < 43.5) out.push(`${n}: tap target ${Math.round(r.width)}×${Math.round(r.height)} is under 44×44`);
    if (el.matches('button, label.btn')) {
      if (el.scrollWidth > el.clientWidth + 1) out.push(`${n}: text is clipped (${el.scrollWidth} > ${el.clientWidth})`);
      if (!el.textContent.trim() && !el.getAttribute('aria-label')) out.push('a button has no accessible name');
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      const text = [...el.childNodes].filter((c) => c.nodeType === 3 && c.textContent.trim());
      for (const t of text) {
        const range = document.createRange(); range.selectNodeContents(t);
        const lines = new Set([...range.getClientRects()].map((rc) => Math.round(rc.top))).size;
        if (lines > 1) out.push(`${n}: label wraps onto ${lines} lines`);
      }
      void lh;
    }
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), W - 1);
    const cy = Math.min(Math.max(r.top + r.height / 2, 1), H - 1);
    const hit = document.elementFromPoint(cx, cy);
    if (hit && !el.contains(hit) && !hit.contains(el) && !(el.labels && [...el.labels].some((l) => l.contains(hit)))) {
      out.push(`${n}: covered by ${hit.closest('[class]')?.className || hit.tagName}`);
    }
  }

  // Fixed action bar fully on screen; last field can scroll above it.
  const bar = document.querySelector('.actions');
  if (bar && !overlay) {
    for (const b of bar.querySelectorAll('button')) {
      const r = b.getBoundingClientRect();
      if (r.left < 0 || r.right > W || r.top < 0 || r.bottom > H) out.push(`${name(b)}: action button not fully on screen`);
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await frame();
    const fields = document.querySelectorAll('.form .field');
    const last = fields[fields.length - 1];
    if (last && last.getBoundingClientRect().bottom > bar.getBoundingClientRect().top + 1) out.push('last field is stuck under the action bar');
    const head = document.querySelector('.formhead, .dayhead');
    if (head && Math.abs(head.getBoundingClientRect().top) > 1) out.push('header did not stay at the top when scrolled');
  }

  // Dialog fully on screen with its buttons side by side or neatly stacked.
  const dlg = document.querySelector('.dialog');
  if (dlg) {
    const r = dlg.getBoundingClientRect();
    if (r.left < 0 || r.right > W || r.top < 0 || r.bottom > H) out.push('dialog is not fully on screen');
  }

  // Chips / scale buttons in one group should be the same height (no odd wrapping).
  for (const group of document.querySelectorAll('.chips, .scale, .quick, .checkins, .stepper, .dialog-actions, .row')) {
    const hs = [...group.children].filter(visible).map((c) => Math.round(c.getBoundingClientRect().height));
    if (hs.length && Math.max(...hs) - Math.min(...hs) > 2 && !group.matches('.checkins')) {
      out.push(`${group.className} items have uneven heights (${[...new Set(hs)].join('/')})`);
    }
  }
  window.scrollTo(0, 0);
  return [...new Set(out)];
}

async function audit(page, testInfo, screen) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(50);
  await testInfo.attach(`${screen}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  const problems = await page.evaluate(auditInPage);
  return problems.map((p) => `[${screen}] ${p}`);
}

// Each screen: how to get there from a seeded home screen (study day 1).
const SCREENS = {
  'home (busy day)': async () => {},
  ...Object.fromEntries(['meal', 'drink', 'activity', 'measure', 'note'].map((k) => [`new ${k}`, (page) => page.getByTestId(`quick-${k}`).click()])),
  'morning check-in (edit)': (page) => page.getByTestId('checkin-morning').click(),
  'evening check-in (edit)': (page) => page.getByTestId('checkin-evening').click(),
  'measure with 3 photos (edit)': (page) => page.getByTestId('entry-measure').click(),
  settings: (page) => page.getByTestId('settings').click(),
  'delete-entry dialog': async (page) => { await page.getByTestId('entry-measure').click(); await page.getByTestId('delete').click(); },
  'error dialog': async (page) => {
    await page.getByTestId('quick-measure').click();
    await field(page, 'waist').locator('input').fill('thirty eight');
    await field(page, 'neck').locator('input').fill('fifteen and a half');
    await page.getByTestId('save').click();
  },
  'warning dialog (4 lines)': async (page) => {
    await page.getByTestId('quick-measure').click();
    for (const [k, v] of [['waist', '380'], ['hips', '410'], ['neck', '155']]) await field(page, k).locator('input').fill(v);
    await page.getByTestId('when').fill('2026-11-17T21:00');
    await page.getByTestId('save').click();
  },
  'delete-all step 2 dialog': async (page) => {
    await page.getByTestId('settings').click();
    await page.getByTestId('delete-all').click();
    await page.getByTestId('dialog-ok').click();
  },
};

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: vp.viewport });

    test('empty home screen', async ({ page }, testInfo) => {
      await open(page);
      if (vp.fontScale) await page.addStyleTag({ content: `html { font-size: ${vp.fontScale * 100}% }` });
      expect(await audit(page, testInfo, 'home (first launch)')).toEqual([]);
    });

    test('every screen and dialog with real data', async ({ page }, testInfo) => {
      await open(page, { time: new Date('2026-11-16T21:30:00-06:00') });
      await seedStudy(page, { seed: 1 });
      // an unsaved draft too, so its banner is part of the home screen
      await page.getByTestId('quick-note').click();
      await field(page, 'text').locator('textarea').fill('draft');
      await page.goBack();
      await expect(page.locator('.banner.draft')).toBeVisible();

      const problems = [];
      for (const [screen, go] of Object.entries(SCREENS)) {
        await relaunch(page);
        if (vp.fontScale) await page.addStyleTag({ content: `html { font-size: ${vp.fontScale * 100}% }` });
        await go(page);
        if (screen.includes('dialog')) await page.getByTestId('dialog').waitFor();
        else if (screen !== 'home (busy day)') await page.locator('.view-form, .view-settings').waitFor();
        problems.push(...(await audit(page, testInfo, screen)));
      }
      expect(problems).toEqual([]);
    });
  });
}

test('quick buttons, check-in cards and action bar sit where expected', async ({ page }) => {
  await open(page, { time: MON_9AM });
  const box = async (sel) => page.locator(sel).first().boundingBox();
  const head = await box('.dayhead');
  const cards = await box('.checkins');
  const quick = await box('.quick');
  expect(head.y).toBeLessThan(cards.y);
  expect(cards.y + cards.height).toBeLessThanOrEqual(quick.y);
  const qs = await page.locator('.qbtn').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(qs).size).toBe(1);                                   // one row on a normal phone

  await page.getByTestId('quick-note').click();
  const vh = page.viewportSize().height;
  const save = await box('[data-testid=save]');
  expect(save.y + save.height).toBeLessThanOrEqual(vh);
  expect(save.y + save.height).toBeGreaterThan(vh - 80);              // pinned to the bottom, thumb-reachable
  const cancel = await box('[data-testid=cancel]');
  expect(cancel.x).toBeLessThan(save.x);                              // Cancel left of Save
  expect(save.width).toBeGreaterThan(cancel.width);                   // Save is the big one
});

test('Save stays reachable with the on-screen keyboard open', async ({ page }) => {
  // Android shrinks the visual viewport when the keyboard opens; simulate a keyboard-height squeeze.
  await open(page, { time: MON_9AM });
  await page.getByTestId('checkin-evening').click();
  await field(page, 'text').locator('textarea').focus();
  await page.setViewportSize({ width: 390, height: 844 - 330 });
  const save = await page.getByTestId('save').boundingBox();
  expect(save.y + save.height).toBeLessThanOrEqual(844 - 330);
  await expect(field(page, 'text').locator('textarea')).toBeInViewport();
  void pill;
});
