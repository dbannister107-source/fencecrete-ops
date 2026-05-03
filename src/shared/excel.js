// Shared XLSX parsing helpers. Replaces the SheetJS / `xlsx` package which
// had unfixable Prototype Pollution + ReDoS advisories (`GHSA-4r6h-8v6p-xvw6`,
// `GHSA-5pgg-2g8v-p4x9`). exceljs has no equivalent open advisories.
//
// Lazy-loads exceljs so it's not in the main bundle. Only the import flows
// (ImportProjectsPage, Pipeline lead import) trigger the chunk download,
// and only when the user actually picks an XLSX file.
//
// API mirrors xlsx's sheet_to_json behavior with {defval:null, raw:false}
// so call sites don't change their data-shape expectations.

let _excelModulePromise = null;
const loadExcelJS = () => {
  if (!_excelModulePromise) {
    _excelModulePromise = import('exceljs').then((m) => m.default || m);
  }
  return _excelModulePromise;
};

// Load and parse an XLSX file from an ArrayBuffer or Uint8Array.
// Returns an exceljs Workbook. Use `getSheetNames(wb)` to enumerate
// sheets and `wb.getWorksheet(name)` to access a specific sheet.
export async function readWorkbook(arrayBufferOrUint8) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBufferOrUint8);
  return wb;
}

export function getSheetNames(wb) {
  return wb.worksheets.map((ws) => ws.name);
}

// Returns array-of-arrays. First sub-array is the header row.
// Empty cells become null. Mirrors:
//   XLSX.utils.sheet_to_json(sheet, {header:1, defval:null, raw:false})
export function rowsAsArrays(sheet) {
  if (!sheet) return [];
  const out = [];
  const maxCol = sheet.columnCount;
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const arr = [];
    for (let col = 1; col <= maxCol; col++) {
      arr.push(normalizeCell(row.getCell(col)));
    }
    out.push(arr);
  });
  return out;
}

// Returns array-of-objects keyed by header text from row 1.
// Mirrors:
//   XLSX.utils.sheet_to_json(sheet, {defval:null, raw:false})
export function rowsAsObjects(sheet) {
  const arrs = rowsAsArrays(sheet);
  if (arrs.length === 0) return [];
  const headers = arrs[0].map((h) => (h == null ? '' : String(h).trim()));
  return arrs.slice(1).map((arr) => {
    const obj = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = arr[i] ?? null;
    });
    return obj;
  });
}

// Coerce a cell to the value xlsx would have produced.
// Handles: null/empty, dates, hyperlinks, formula results, rich text.
function normalizeCell(cell) {
  if (!cell) return null;
  let v = cell.value;
  if (v == null || v === '') return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.text !== undefined) return v.text;             // hyperlink cell
    if (v.result !== undefined) return v.result;         // formula cell
    if (Array.isArray(v.richText)) {
      return v.richText.map((t) => t.text).join('');
    }
  }
  return v;
}
