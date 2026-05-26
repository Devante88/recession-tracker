// Minimal, dependency-free .xlsx reader. An .xlsx file is a ZIP container of
// XML parts; Node's built-in zlib inflates the deflate-compressed entries, so
// we can read the GPR spreadsheet without adding a parsing library. This is not
// a general Excel implementation — it handles the well-formed single-sheet
// exports the GPR data ships as: shared strings + one worksheet, ZIP methods 0
// (stored) and 8 (deflate). Throws on legacy binary .xls (BIFF), which is a
// different, non-ZIP format.

import zlib from 'node:zlib';

const decodeEntities = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, '&');

// Column letters ("A","B",...,"AA") → zero-based index.
function colToIndex(ref) {
  const letters = (ref.match(/^[A-Z]+/) || ['A'])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Locate and decompress one entry from the ZIP central directory.
function readZipEntries(buf) {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('not a ZIP/xlsx container (bad magic) — legacy .xls is unsupported; provide .xlsx or .csv');
  }
  // Find End Of Central Directory (scan backwards for its signature).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('xlsx: end-of-central-directory not found');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // central directory offset
  const entries = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method   = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen  = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen   = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name     = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // Local header tells us where the actual data starts.
    const lNameLen  = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    entries[name] = method === 0 ? raw : zlib.inflateRawSync(raw);

    p += 46 + nameLen + extraLen + cmtLen;
  }
  return entries;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  // Each <si> may contain one or more <t> runs (rich text).
  for (const si of xml.match(/<si\b[\s\S]*?<\/si>/g) || []) {
    const text = (si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [])
      .map(t => decodeEntities(t.replace(/<t[^>]*>/, '').replace(/<\/t>/, '')))
      .join('');
    out.push(text);
  }
  return out;
}

function parseSheet(xml, shared) {
  const rows = [];
  for (const rowXml of xml.match(/<row\b[\s\S]*?<\/row>/g) || []) {
    const cells = [];
    for (const cell of rowXml.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) || []) {
      const ref  = (cell.match(/\br="([A-Z]+\d+)"/) || [])[1] || `A${rows.length + 1}`;
      const type = (cell.match(/\bt="([^"]+)"/) || [])[1];
      let value = '';
      if (type === 'inlineStr') {
        const m = cell.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        value = m ? decodeEntities(m[1]) : '';
      } else {
        const m = cell.match(/<v>([\s\S]*?)<\/v>/);
        const raw = m ? m[1] : '';
        value = type === 's' ? (shared[Number(raw)] ?? '') : decodeEntities(raw);
      }
      cells[colToIndex(ref)] = value;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}

// Parse an .xlsx Buffer into an array of rows (each an array of cell strings).
export function parseXlsx(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const entries = readZipEntries(buf);
  const get = name => entries[name] ? entries[name].toString('utf8') : null;

  const shared = parseSharedStrings(get('xl/sharedStrings.xml'));

  // First worksheet by lowest sheetN.xml.
  const sheetName = Object.keys(entries)
    .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort()[0];
  if (!sheetName) throw new Error('xlsx: no worksheet found');

  return parseSheet(get(sheetName), shared);
}
