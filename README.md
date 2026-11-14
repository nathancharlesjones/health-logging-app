# Turtle Log

A two-week health & habits logger, built as an installable PWA. Vanilla JS, no build
step, no dependencies, no network requests. Your data stays on the phone (IndexedDB)
until you export it.

## Files (~900 lines total)

| File | What it does |
|---|---|
| `index.html` | Shell page; CSP restricts everything to this origin |
| `app.js` | UI, field schema (`SCHEMA`), export/import |
| `db.js` | IndexedDB wrapper (`entries` + `photos` stores) |
| `zip.js` | Minimal uncompressed ZIP writer/reader with CRC-32 |
| `sw.js` | Service worker: caches app files for offline use |
| `styles.css` | LightTurtles styling (emerald/alabaster, IBM Plex) |
| `fonts/` | IBM Plex Mono & Serif, latin subset (OFL license) |

To change what gets logged, edit `SCHEMA` near the top of `app.js`; the forms are
generated from it. Other knobs live just above it (`DAY_START_HOUR`, `WAIST_DAYS`, …).

## Deploy (GitHub Pages)

1. Create a repo (it can be private if your plan allows Pages on private repos) and push these files to the root.
2. Repo → Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. On the phone, open `https://<you>.github.io/<repo>/` in Chrome → ⋮ → **Add to Home screen / Install app**.
4. Open it from the home-screen icon once, then go to Settings → "Ask Chrome to keep data".

Only the code is hosted; GitHub never sees your entries.

**Updating:** after changing any file, bump `VERSION` in `sw.js`, push, then open the app
twice (the first launch downloads the update, the second uses it).

**Local testing:** `python3 -m http.server` in this folder, then visit `http://localhost:8000`.

## Daily use

- **Morning card (~45 s):** weight, waist (Mon/Wed/Fri), sleep, energy, today's planned activity.
- **Quick buttons:** Meal opens the camera immediately; Drink/Activity/Measure/Note are tap-and-save.
- **Evening card (~45 s):** did the plan happen, what got in the way, stress, energy, caffeine.
- **Voice:** tap the 🎤 on Gboard in any text box.
- **Forgot something?** Use ‹ › to go to that day, or use the "1h ago" buttons / time field.
  Tap any entry to edit or delete it.
- A "day" runs 4 am → 4 am. Set two phone alarms as check-in reminders.

## Backup and analysis

Settings → **Export zip** gives you `entries.json`, `photos/` and a `README.txt` that
explains the schema. That README is written so you can give the whole zip to an LLM
for analysis at the end. **Import zip** restores a backup or moves the data to a new phone.
