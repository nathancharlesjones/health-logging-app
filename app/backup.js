// backup.js — export to / import from a zip. Uses storage but no DOM, so the
// browser tests can call it directly.
import * as db from './db.js';
import { makeZip, readZip } from './zip.js';
import { buildExportFiles, parseExportFiles } from './logic.js';

export async function exportBackup({ startDay, now = new Date(), timezone = Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
  const entries = await db.allEntries();
  const stored = await db.allPhotos();
  const photos = await Promise.all(stored.map(async (p) => ({
    id: p.id, type: p.type, data: new Uint8Array(await p.blob.arrayBuffer()),
  })));
  const blob = makeZip(buildExportFiles({ entries, photos, startDay, now, timezone }), now);
  return { blob, entries: entries.length, photos: photos.length };
}

// Validates the whole zip before writing anything. Same ids overwrite, so
// importing the same backup twice is harmless.
export async function importBackup(arrayBuffer, { now = new Date() } = {}) {
  const { meta, entries, photos } = parseExportFiles(readZip(arrayBuffer));
  await db.importAll(entries, photos.map((p) => ({
    id: p.id, type: p.type, blob: new Blob([p.data], { type: p.type }), created_at: now.toISOString(),
  })));
  return meta;
}
