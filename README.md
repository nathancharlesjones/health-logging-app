# Turtle Log

A two-week health & habits logger, built as an installable PWA. The app (`app/`) is
vanilla JS with no dependencies and makes no network requests: your data stays on the
phone (IndexedDB) until you export it. Playwright is used for tests only.

## Layout

```
app/                     ← everything that ships (deployed to GitHub Pages)
  logic.js               pure functions + config + field SCHEMA (no DOM, no storage, no clock)
  db.js                  IndexedDB: entries, photos, drafts
  backup.js              export/import zip (storage, no DOM)
  zip.js                 minimal uncompressed ZIP writer/reader with CRC-32
  app.js                 UI only: renders, collects input, routes
  sw.js                  offline cache (bump VERSION when you change anything)
  index.html, styles.css, manifest.webmanifest, icons/, fonts/
tools/
  serve.mjs              tiny static server for dev/tests
  simulate.mjs           deterministic N-day study generator → importable zip
  run-unit.mjs           runs unit tests in 5 timezones
tests/unit/              node:test — logic, dates/DST, zip, schema/export, simulator, offline cache list
tests/e2e/               Playwright — storage integration, user flows, human errors, layout audit, offline/privacy
.github/workflows/       test on every push; deploy app/ to Pages only if everything passes
```

To change what gets logged, edit `SCHEMA` in `app/logic.js`; forms, validation and the
export README are all generated from it (and a unit test fails if they drift apart).

## Deploy (GitHub Pages via Actions)

1. Push this folder to a GitHub repo (branch `main`).
2. Repo → Settings → Pages → Source: **GitHub Actions**.
3. Every push runs the tests; if they pass, `app/` is published.
4. On the phone: open `https://<you>.github.io/<repo>/` in Chrome → ⋮ → **Install app**,
   open it once, then Settings → **Ask Chrome to keep data**.

**Updating:** bump `VERSION` in `app/sw.js`, push, then open the app twice.

## Develop and test

```sh
npm install
npx playwright install chromium   # or: export CHROME_PATH=/usr/bin/google-chrome
npm run serve                     # http://localhost:4173
npm test                          # unit (5 timezones) + browser suites
npm run test:unit:quick           # unit tests, current timezone only
npx playwright test --ui          # browse/debug browser tests interactively
npm run simulate                  # writes simulated-study.zip (import it from Settings)
node tools/simulate.mjs out.zip --start 2026-11-16 --days 14 --seed 3
```

### What the tests cover

- **Unit tests** (`node:test`, run in Chicago, UTC, Lord Howe ½-hour DST, Kolkata and Auckland):
  - the 4 am day boundary, checked for every hour of 2026–2027 including DST changes
  - date math, waist days
  - number parsing (rejects dictated words), validation errors and warnings, stable timeline order
  - entry summaries, schema consistency, export README completeness
  - zip round-trip, also validated by Python's `zipfile` and `unzip -t`
  - export/import round-trip and rejection of bad backups
  - simulator determinism and realism
  - offline-cache completeness
- **Integration** (real IndexedDB in Chrome):
  - entries and photos are saved and deleted atomically, with no orphaned photos
  - export → wipe → import restores the data byte for byte
  - importing twice is idempotent, and a bad backup changes nothing
  - upgrading from the v1 database keeps existing data
- **End to end:**
  - a full day of logging, then export
  - photo downscaling and EXIF rotation
  - past-day and before-4 am entries land on the right day
  - waist field only on Mon/Wed/Fri
  - jumping to the new day overnight
  - bed/wake times prefilled from the previous morning
  - importing a 14-day simulated study through the UI
- **Human errors:**
  - the back gesture, the header ‹, a reload (app killed) or a rotation mid-entry never lose work: drafts can be resumed
  - every removal is confirmed: Cancel with changes, photo removal, entry deletion, discarding a draft, and Delete all (two steps plus typing DELETE)
  - dialogs dismiss safely via Escape, a tap outside, or the back gesture
  - double-tapping Save creates one entry
  - dictated numbers are refused but kept so you can fix them
  - implausible values, future times and duplicate check-ins trigger warnings
  - empty saves are refused
  - importing the wrong zip changes nothing
- **Layout audit**, on every screen and dialog at 320×568, 360×780, 412×915, landscape, 130% text and 160% text:
  - no sideways scrolling and no content past the right edge
  - every control is fully on screen, not covered by anything, and at least 44×44
  - no clipped or wrapped button labels, and no uneven heights within a row of controls
  - the action bar and dialog buttons are always visible
  - the last field scrolls clear of the action bar, and the header stays put
  - Save is still reachable with the keyboard open
  - screenshots of every screen are attached to the HTML report
- **Offline & privacy:**
  - after one visit, the app works fully in airplane mode
  - every request goes to the app's own origin
  - the Content-Security-Policy is present and enforced

Every browser test also fails if the page throws or logs a console error.

## Daily use

- **Morning card (~45 s):** weight, waist (Mon/Wed/Fri), sleep, energy, today's planned activity.
- **Quick buttons:** Meal opens the camera straight away; Drink/Activity/Measure/Note are tap-and-save.
- **Evening card (~45 s):** whether the plan happened, what got in the way, stress, energy, caffeine.
- **Voice:** tap 🎤 on Gboard in any text box.
- **Interrupted?** Back out any time: your entry is kept as a draft on the home screen.
- **Forgot something?** Use ‹ › to go to that day, or the "1h ago" buttons / time field. Tap any entry to edit it.
- A "day" runs 4 am → 4 am. Set two phone alarms as check-in reminders.
- **Export** from Settings regularly; the zip includes a README.txt describing every field, ready to hand to an LLM for analysis.
