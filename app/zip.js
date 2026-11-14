// zip.js — minimal ZIP writer/reader, "stored" (uncompressed) entries only.
// Photos are already JPEG-compressed and JSON is small, so compression
// would buy little; skipping it keeps this file short enough to audit.
// Format reference: PKWARE APPNOTE.TXT, sections 4.3.7 (local header),
// 4.3.12 (central directory header), 4.3.16 (end of central directory).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const UTF8_FLAG = 0x0800;

// files: [{ name: string, data: Uint8Array }]  ->  Blob
export function makeZip(files, date = new Date()) {
  const enc = new TextEncoder();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const body = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.name);
    const size = f.data.length;
    const crc = crc32(f.data);

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);  // local file header signature
    lh.setUint16(4, 20, true);          // version needed (2.0)
    lh.setUint16(6, UTF8_FLAG, true);   // flags
    lh.setUint16(8, 0, true);           // method 0 = stored
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);       // compressed size
    lh.setUint32(22, size, true);       // uncompressed size
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);          // extra field length
    body.push(lh, name, f.data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);  // central directory header signature
    ch.setUint16(4, 20, true);          // version made by
    ch.setUint16(6, 20, true);          // version needed
    ch.setUint16(8, UTF8_FLAG, true);
    ch.setUint16(10, 0, true);          // method
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true);
    ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true);
    // 30: extra len, 32: comment len, 34: disk no., 36: internal attrs, 38: external attrs (all 0)
    ch.setUint32(42, offset, true);     // offset of local header
    central.push(ch, name);

    offset += 30 + name.length + size;
  }

  const cdSize = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);   // end of central directory signature
  end.setUint16(8, files.length, true); // entries on this disk
  end.setUint16(10, files.length, true);// entries total
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);      // central directory offset
  return new Blob([...body, ...central, end], { type: 'application/zip' });
}

// ArrayBuffer -> [{ name, data: Uint8Array }]. Stored entries only.
export function readZip(buf) {
  const v = new DataView(buf);
  const dec = new TextDecoder();
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt zip directory');
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    if (method !== 0) throw new Error(`"${name}" is compressed; only this app's own exports can be imported`);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    if (!name.endsWith('/')) out.push({ name, data: new Uint8Array(buf.slice(start, start + csize)) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
