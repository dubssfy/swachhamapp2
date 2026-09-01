import zlib from 'zlib';

/**
 * ADDS AN IN-CELL DROPDOWN TO A FINISHED .xlsx.
 *
 * SheetJS's community build READS data validation but does not WRITE it: set
 * `ws['!dataValidation']` and the element is simply absent from the output.
 * So the workbook is built by SheetJS exactly as before, and the one element
 * it cannot emit is injected into the finished file here.
 *
 * An .xlsx IS A ZIP of XML parts. This unpacks it with Node's own zlib, edits
 * one worksheet part, and packs it again -- no new dependency, and nothing but
 * the named part is touched.
 *
 * IF ANYTHING LOOKS UNFAMILIAR, THE ORIGINAL FILE IS RETURNED UNCHANGED.
 * A dropdown is a convenience on a template that already works by typing, so
 * a workbook this cannot patch must still download rather than fail. Every
 * bail-out below is that rule.
 */

/** CRC-32, which every zip entry's header has to carry. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0 ^ -1;
  for (let i = 0; i < buffer.length; i += 1) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ buffer[i]) & 0xff];
  }
  return (c ^ -1) >>> 0;
}

interface ZipEntry {
  name: string;
  /** Uncompressed content. */
  data: Buffer;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/**
 * Every entry of a zip, decompressed.
 *
 * Reads through the CENTRAL DIRECTORY rather than by scanning for local
 * headers: the central directory is the authoritative index, and a local
 * header's own name and extra-field lengths can differ from the central
 * copy's, so the data offset is computed from the local header once found.
 */
function readZip(buffer: Buffer): ZipEntry[] | null {
  // The end-of-central-directory record is last, after a comment of up to
  // 64kb, so it is found by scanning backwards for its signature.
  let end = buffer.length - 22;
  const limit = Math.max(0, buffer.length - 22 - 0xffff);
  while (end >= limit && buffer.readUInt32LE(end) !== SIG_EOCD) end -= 1;
  if (end < limit) return null;

  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  // Zip64. These workbooks are kilobytes, so this cannot legitimately happen;
  // if it ever does, the file is left alone rather than truncated.
  if (count === 0xffff || offset === 0xffffffff) return null;

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== SIG_CENTRAL) return null;

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== SIG_LOCAL) {
      return null;
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);

    let data: Buffer;
    try {
      // 8 is deflate, 0 is stored. SheetJS emits one or the other.
      if (method === 8) data = zlib.inflateRawSync(raw);
      else if (method === 0) data = Buffer.from(raw);
      else return null;
    } catch {
      return null;
    }

    entries.push({ name, data });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Packs entries back into a zip.
 *
 * A FIXED TIMESTAMP (1 Jan 1980, the DOS epoch) is written for every entry
 * rather than the current clock, so building the same template twice produces
 * byte-identical files. That is what lets a test assert on the output at all.
 */
function writeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = zlib.deflateRawSync(entry.data);
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x0021, 12); // date: 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralBuffer, eocd]);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * WHERE `dataValidations` IS ALLOWED TO GO.
 *
 * CT_Worksheet is an ORDERED sequence, so the element cannot simply be
 * appended before `</worksheet>`: it has to sit after `sheetData` and before
 * everything the schema puts later. SheetJS writes `<ignoredErrors>` after the
 * data, and `ignoredErrors` is one of those later elements -- appending at the
 * end would therefore produce a file Excel repairs on open.
 *
 * These are the elements that must follow `dataValidations`, in schema order.
 * The injection goes immediately before whichever appears first.
 */
const FOLLOWING_ELEMENTS = [
  '<hyperlinks',
  '<printOptions',
  '<pageMargins',
  '<pageSetup',
  '<headerFooter',
  '<rowBreaks',
  '<colBreaks',
  '<customProperties',
  '<cellWatches',
  '<ignoredErrors',
  '<smartTags',
  '<drawing',
  '<legacyDrawing',
  '<picture',
  '<oleObjects',
  '<controls',
  '<tableParts',
  '<extLst',
];

export interface ListValidationOptions {
  /** The part to patch, e.g. `xl/worksheets/sheet1.xml`. */
  sheetFile: string;
  /** The cells that get the dropdown, e.g. `A2:A2001`. */
  sqref: string;
  /**
   * What the list holds. A DEFINED NAME rather than a literal list: an inline
   * `"a,b,c"` formula is capped at 255 characters, which a real catalogue
   * passes within a dozen items.
   */
  formula: string;
  /** Shown when a typed value is not in the list. */
  errorTitle?: string;
  error?: string;
}

/** One `<dataValidation>` element, in the form the schema wants it. */
function validationElement(options: ListValidationOptions): string {
  return (
    `<dataValidation type="list" allowBlank="1" showInputMessage="1"` +
    ` showErrorMessage="1" errorStyle="warning"` +
    ` errorTitle="${escapeXml(options.errorTitle ?? 'Not in the list')}"` +
    ` error="${escapeXml(options.error ?? 'Pick a value from the dropdown.')}"` +
    ` sqref="${escapeXml(options.sqref)}">` +
    `<formula1>${escapeXml(options.formula)}</formula1>` +
    `</dataValidation>`
  );
}

/**
 * Returns the workbook with an in-cell dropdown on each `sqref`, or the
 * workbook exactly as given if it could not be patched.
 *
 * ONE OR SEVERAL. A worksheet may carry only ONE `<dataValidations>` element,
 * so every dropdown for a sheet has to be written in a single pass — calling
 * this twice would either produce a second element (invalid) or be refused by
 * the guard below. Passing an array is therefore how a sheet gets more than
 * one dropdown; each entry keeps its own range, list and error text.
 *
 * `errorStyle="warning"` rather than the default `stop`: the list is a
 * snapshot taken when the template was built, and a Super Admin holding
 * yesterday's file must not be BLOCKED from typing a name that has since
 * become valid. The upload validates against the live catalogue either way,
 * which is where a wrong name is actually caught.
 *
 * `showDropDown` is deliberately NOT set. In SpreadsheetML that attribute
 * means "suppress the arrow", so writing `showDropDown="1"` would remove the
 * very control this exists to add.
 */
export function addListValidation(
  workbook: Buffer,
  options: ListValidationOptions | ListValidationOptions[]
): Buffer {
  const all = (Array.isArray(options) ? options : [options]).filter(
    (option) => option.formula && option.sqref
  );
  if (all.length === 0) return workbook;

  // Every dropdown in one call has to land on the same worksheet part, for
  // the single-element reason above.
  const sheetFile = all[0].sheetFile;
  if (all.some((option) => option.sheetFile !== sheetFile)) return workbook;

  const entries = readZip(workbook);
  if (!entries) return workbook;

  const sheet = entries.find((entry) => entry.name === sheetFile);
  if (!sheet) return workbook;

  const xml = sheet.data.toString('utf8');
  // Already has one: leave it alone rather than writing a second element,
  // which would be invalid.
  if (xml.includes('<dataValidation')) return workbook;
  if (!xml.includes('</worksheet>')) return workbook;

  const validation =
    `<dataValidations count="${all.length}">` +
    all.map(validationElement).join('') +
    `</dataValidations>`;

  let at = -1;
  for (const element of FOLLOWING_ELEMENTS) {
    const found = xml.indexOf(element);
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  if (at === -1) at = xml.lastIndexOf('</worksheet>');
  // Nothing follows sheetData and no closing tag was found: not a worksheet
  // this understands.
  if (at === -1) return workbook;

  sheet.data = Buffer.from(xml.slice(0, at) + validation + xml.slice(at), 'utf8');
  return writeZip(entries);
}
