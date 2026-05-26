import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { parseXlsx } from '../src/xlsx.mjs';

// Build a minimal ZIP (deflate entries) from { name, data:Buffer } parts.
// CRC fields are left zero — parseXlsx does not validate them.
function buildZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const comp = zlib.deflateRawSync(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);           // method = deflate
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const localRec = Buffer.concat([lh, name, comp]);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);          // method = deflate
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);     // local header offset
    central.push(Buffer.concat([ch, name]));

    locals.push(localRec);
    offset += localRec.length;
  }
  const localBlob = Buffer.concat(locals);
  const centralBlob = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBlob.length, 12);
  eocd.writeUInt32LE(localBlob.length, 16);
  return Buffer.concat([localBlob, centralBlob, eocd]);
}

const sharedStrings = `<?xml version="1.0"?>
<sst><si><t>date</t></si><si><t>GPR</t></si><si><t>2026-04-01</t></si><si><t>2026-05-01</t></si></sst>`;

// Header row uses shared strings (t="s"); GPR values are numeric.
const sheet = `<?xml version="1.0"?>
<worksheet><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
  <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>96.4</v></c></row>
  <row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>231.7</v></c></row>
</sheetData></worksheet>`;

test('parseXlsx reads shared strings and numeric cells', () => {
  const buf = buildZip([
    { name: 'xl/sharedStrings.xml', data: Buffer.from(sharedStrings) },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) }
  ]);
  const rows = parseXlsx(buf);
  assert.deepEqual(rows[0], ['date', 'GPR']);
  assert.equal(rows[1][0], '2026-04-01');
  assert.equal(rows[1][1], '96.4');
  assert.equal(rows[2][1], '231.7');
});

test('parseXlsx rejects non-zip input', () => {
  assert.throws(() => parseXlsx(Buffer.from('not a zip')), /ZIP|xls/i);
});

test('parseXlsx handles a gap in columns', () => {
  const gapSheet = `<worksheet><sheetData>
    <row r="1"><c r="A1"><v>1</v></c><c r="C1"><v>3</v></c></row>
  </sheetData></worksheet>`;
  const buf = buildZip([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.from(gapSheet) }]);
  const rows = parseXlsx(buf);
  assert.equal(rows[0][0], '1');
  assert.equal(rows[0][1], '');  // gap filled
  assert.equal(rows[0][2], '3');
});
