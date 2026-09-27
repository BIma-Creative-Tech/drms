/**
 * Minimal XLSX reader + writer for the go-live import (E11). Pure (no Payload, no DB), unit-tested.
 *
 * Why not `write-excel-file` (the F3 export library): it cannot write data validations (dropdowns,
 * number ranges, input hints), which the client template needs; and there is no reader in the
 * dependency tree. Both directions only need a small subset of SpreadsheetML, built on `fflate`
 * (already a runtime dependency of write-excel-file, pinned in package-lock).
 *
 * Reader safety (the file comes from outside): size caps before and while unzipping (zip bomb),
 * no XML entity expansion beyond the five predefined entities and numeric references, no formulas
 * evaluated (only the cached value `<v>` is read), row cap per sheet.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'

export const XLSX_MAX_FILE_BYTES = 10 * 1024 * 1024
export const XLSX_MAX_UNZIPPED_BYTES = 80 * 1024 * 1024
export const XLSX_MAX_ROWS_PER_SHEET = 5000

export type CellValue = string | number | boolean | null

/** A read sheet: `rows[r][c]` with r/c zero-based (row 0 = Excel row 1). */
export type ReadSheet = { name: string; rows: CellValue[][] }
export type ReadWorkbook = { sheets: ReadSheet[]; date1904: boolean }

export class XlsxError extends Error {}

// ------------------------------------------------------------------ XML helpers

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // control characters are not allowed in XML 1.0 → OOXML escape _xHHHH_
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, (c) => `_x${c.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}_`)
}

export function xmlUnescape(s: string): string {
  return s
    .replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_m, e: string) => {
      if (e === 'lt') return '<'
      if (e === 'gt') return '>'
      if (e === 'amp') return '&'
      if (e === 'quot') return '"'
      if (e === 'apos') return "'"
      const code = e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`).exec(attrs) ?? new RegExp(`(?:^|\\s)${name}\\s*=\\s*'([^']*)'`).exec(attrs)
  return m ? xmlUnescape(m[1]!) : undefined
}

/** Concatenated text of all <t> elements (rich text runs), phonetic runs removed. */
function textOf(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
  let out = ''
  for (const m of clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) out += m[1] !== undefined ? xmlUnescape(m[1]) : ''
  return out
}

/** "AB12" → { col: 27, row: 11 } (zero-based). */
export function parseRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]{1,3})(\d{1,7})$/.exec(ref)
  if (!m) return null
  let col = 0
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { col: col - 1, row: Number(m[2]) - 1 }
}

/** 0 → "A", 26 → "AA". */
export function colName(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function resolveTarget(target: string): string {
  const t = target.startsWith('/') ? target.slice(1) : `xl/${target}`
  const parts: string[] = []
  for (const p of t.split('/')) {
    if (p === '..') parts.pop()
    else if (p !== '.') parts.push(p)
  }
  return parts.join('/')
}

// ------------------------------------------------------------------ reader

export function readXlsx(data: Uint8Array): ReadWorkbook {
  if (data.byteLength > XLSX_MAX_FILE_BYTES) throw new XlsxError(`File terlalu besar (> ${XLSX_MAX_FILE_BYTES / 1024 / 1024} MB).`)
  if (!(data[0] === 0x50 && data[1] === 0x4b)) throw new XlsxError('Bukan file .xlsx (format ZIP/Office Open XML). File .xls lama: simpan ulang sebagai .xlsx.')
  let total = 0
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(data, {
      filter: (f) => {
        const wanted = f.name === 'xl/workbook.xml' || f.name === 'xl/_rels/workbook.xml.rels' || f.name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(f.name)
        if (!wanted) return false
        total += f.originalSize
        if (total > XLSX_MAX_UNZIPPED_BYTES) throw new XlsxError('Isi file terlalu besar setelah diekstrak.')
        return true
      },
    })
  } catch (err) {
    if (err instanceof XlsxError) throw err
    throw new XlsxError(`File .xlsx rusak atau tidak dapat dibaca (${(err as Error).message}).`)
  }
  const wb = files['xl/workbook.xml']
  const rels = files['xl/_rels/workbook.xml.rels']
  if (!wb || !rels) throw new XlsxError('File .xlsx tidak memuat workbook.')
  const wbXml = strFromU8(wb)
  const date1904 = /<workbookPr\b[^>]*\bdate1904\s*=\s*"(1|true)"/.test(wbXml)
  const relMap = new Map<string, string>()
  for (const m of strFromU8(rels).matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1]!, 'Id')
    const target = attr(m[1]!, 'Target')
    if (id && target) relMap.set(id, resolveTarget(target))
  }
  const shared: string[] = []
  const ss = files['xl/sharedStrings.xml']
  if (ss) for (const m of strFromU8(ss).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) shared.push(m[1] !== undefined ? textOf(m[1]) : '')

  const sheets: ReadSheet[] = []
  for (const m of wbXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = attr(m[1]!, 'name') ?? ''
    const rid = attr(m[1]!, 'r:id') ?? attr(m[1]!, 'id')
    const path = rid ? relMap.get(rid) : undefined
    const file = path ? files[path] : undefined
    if (!file) {
      sheets.push({ name, rows: [] })
      continue
    }
    sheets.push({ name, rows: readSheetXml(strFromU8(file), shared, name) })
  }
  return { sheets, date1904 }
}

function readSheetXml(xml: string, shared: string[], sheetName: string): CellValue[][] {
  const rows: CellValue[][] = []
  const data = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml)?.[1] ?? ''
  let nextRow = 0
  for (const rm of data.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rAttr = attr(rm[1]!, 'r')
    const r = rAttr ? Number(rAttr) - 1 : nextRow
    nextRow = r + 1
    if (r >= XLSX_MAX_ROWS_PER_SHEET + 1) throw new XlsxError(`Sheet "${sheetName}" melebihi ${XLSX_MAX_ROWS_PER_SHEET} baris data.`)
    const body = rm[2] ?? ''
    let nextCol = 0
    for (const cm of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = cm[1]!
      const ref = attr(a, 'r')
      const pos = ref ? parseRef(ref) : null
      const c = pos ? pos.col : nextCol
      nextCol = c + 1
      const inner = cm[2] ?? ''
      const t = attr(a, 't') ?? 'n'
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1]
      let value: CellValue = null
      if (t === 's') value = v !== undefined ? (shared[Number(v)] ?? '') : null
      else if (t === 'inlineStr') value = textOf(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? '')
      else if (t === 'str') value = v !== undefined ? xmlUnescape(v) : null
      else if (t === 'b') value = v === '1' || v === 'true'
      else if (t === 'e') value = v !== undefined ? `#ERROR ${xmlUnescape(v)}` : '#ERROR'
      else if (v !== undefined && v.trim() !== '') {
        const n = Number(v)
        value = Number.isFinite(n) ? n : xmlUnescape(v)
      }
      if (value === null || value === '') continue
      ;(rows[r] ??= [])[c] = value
    }
  }
  // dense rows (holes → null)
  const out: CellValue[][] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? []
    const dense: CellValue[] = []
    for (let j = 0; j < row.length; j++) dense.push(row[j] ?? null)
    out.push(dense)
  }
  return out
}

/** Excel serial date → 'YYYY-MM-DD' (1900 system with the Lotus leap-year bug; or 1904). */
export function excelSerialToDate(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null
  const days = Math.floor(serial)
  const ms = date1904 ? Date.UTC(1904, 0, 1) + days * 86400000 : Date.UTC(1899, 11, 30) + days * 86400000
  return new Date(ms).toISOString().slice(0, 10)
}

// ------------------------------------------------------------------ writer

export type CellStyle = 'default' | 'header' | 'headerRequired' | 'text' | 'title' | 'wrap' | 'hint' | 'bold'
export type WriteCell = { v: string | number; s?: CellStyle } | string | number | null

export type Validation =
  | { kind: 'list'; source: string; allowOther?: boolean; prompt?: string; title?: string }
  | { kind: 'whole' | 'decimal'; min?: number; max?: number; prompt?: string; title?: string }
  | { kind: 'prompt'; prompt: string; title?: string }

export type WriteSheet = {
  name: string
  rows: WriteCell[][]
  /** Column widths (characters) and default cell style of the column (e.g. text for codes). */
  cols?: Array<{ width: number; text?: boolean }>
  freezeHeader?: boolean
  hidden?: boolean
  tabColor?: string
  /** Validation per column, applied from row 2 to `validationRows`. */
  validations?: Array<{ col: number; rule: Validation }>
  validationRows?: number
}

const STYLE_INDEX: Record<CellStyle, number> = { default: 0, header: 1, headerRequired: 2, text: 3, title: 4, wrap: 5, hint: 6, bold: 7 }

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="14"/><color rgb="FF1F3A5F"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF595959"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F3A5F"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFB03A2E"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="49" fontId="1" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function cellXml(ref: string, cell: WriteCell, colText: boolean): string {
  if (cell === null || cell === undefined || cell === '') return ''
  const c = typeof cell === 'object' ? cell : { v: cell }
  const style = c.s ? STYLE_INDEX[c.s] : colText ? STYLE_INDEX.text : 0
  const s = style ? ` s="${style}"` : ''
  if (typeof c.v === 'number') return `<c r="${ref}"${s}><v>${c.v}</v></c>`
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(c.v)}</t></is></c>`
}

function validationXml(v: { col: number; rule: Validation }, lastRow: number): string {
  const sq = `${colName(v.col)}2:${colName(v.col)}${lastRow}`
  const r = v.rule
  const prompt = r.prompt ? ` showInputMessage="1" promptTitle="${xmlEscape((r.title ?? '').slice(0, 32))}" prompt="${xmlEscape(r.prompt.slice(0, 255))}"` : ''
  if (r.kind === 'prompt') return `<dataValidation allowBlank="1"${prompt} sqref="${sq}"/>`
  if (r.kind === 'list') {
    const style = r.allowOther ? ' errorStyle="warning"' : ''
    return `<dataValidation type="list" allowBlank="1"${style} showErrorMessage="1" errorTitle="Nilai tidak ada di daftar" error="Pilih nilai dari daftar (lihat sheet Petunjuk)."${prompt} sqref="${sq}"><formula1>${xmlEscape(r.source)}</formula1></dataValidation>`
  }
  const op = r.min !== undefined && r.max !== undefined ? 'between' : r.min !== undefined ? 'greaterThanOrEqual' : 'lessThanOrEqual'
  const f1 = r.min !== undefined ? r.min : r.max
  const f2 = r.min !== undefined && r.max !== undefined ? `<formula2>${r.max}</formula2>` : ''
  const range = r.min !== undefined && r.max !== undefined ? `${r.min} s.d. ${r.max}` : r.min !== undefined ? `minimal ${r.min}` : `maksimal ${r.max}`
  const kind = r.kind === 'whole' ? 'bilangan bulat' : 'angka'
  return `<dataValidation type="${r.kind}" operator="${op}" allowBlank="1" showErrorMessage="1" errorTitle="Nilai tidak valid" error="Isi ${kind} ${range}."${prompt} sqref="${sq}"><formula1>${f1}</formula1>${f2}</dataValidation>`
}

function sheetXml(sh: WriteSheet): string {
  const cols = sh.cols ?? []
  const parts: string[] = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">']
  if (sh.tabColor) parts.push(`<sheetPr><tabColor rgb="${sh.tabColor}"/></sheetPr>`)
  parts.push(
    sh.freezeHeader
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>',
  )
  parts.push('<sheetFormatPr defaultRowHeight="15"/>')
  if (cols.length > 0) {
    parts.push('<cols>')
    cols.forEach((c, i) => parts.push(`<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"${c.text ? ` style="${STYLE_INDEX.text}"` : ''}/>`))
    parts.push('</cols>')
  }
  parts.push('<sheetData>')
  sh.rows.forEach((row, r) => {
    const cells = row.map((cell, c) => cellXml(`${colName(c)}${r + 1}`, cell, cols[c]?.text === true && r > 0)).join('')
    parts.push(`<row r="${r + 1}">${cells}</row>`)
  })
  parts.push('</sheetData>')
  const v = sh.validations ?? []
  if (v.length > 0) {
    const last = sh.validationRows ?? 1000
    parts.push(`<dataValidations count="${v.length}">${v.map((x) => validationXml(x, last)).join('')}</dataValidations>`)
  }
  parts.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>')
  return parts.join('')
}

/** Deterministic .xlsx (fixed zip timestamps, no docProps dates) → the committed template is reproducible. */
export function writeXlsx(sheets: WriteSheet[]): Uint8Array {
  const names = new Set<string>()
  for (const s of sheets) {
    if (!/^[^\\/?*[\]:]{1,31}$/.test(s.name) || names.has(s.name)) throw new Error(`invalid sheet name ${s.name}`)
    names.add(s.name)
  }
  const ct = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ...sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`),
    '</Types>',
  ].join('')
  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
  const firstVisible = Math.max(0, sheets.findIndex((s) => !s.hidden))
  const workbook = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    `<workbookPr/><bookViews><workbookView activeTab="${firstVisible}"/></bookViews><sheets>`,
    ...sheets.map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`),
    '</sheets></workbook>',
  ].join('')
  const wbRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ...sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`),
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
    '</Relationships>',
  ].join('')
  const files: Zippable = {
    '[Content_Types].xml': strToU8(ct),
    '_rels/.rels': strToU8(rootRels),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(wbRels),
    'xl/styles.xml': strToU8(STYLES_XML),
  }
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s))
  })
  // fflate encodes the zip (DOS) mtime from the Date's LOCAL fields (getHours() etc.), so a UTC
  // instant would yield different bytes per TZ (CI runs in UTC, dev boxes in WITA/WIB). A date built
  // from local components is 2026-01-01 00:00 in every TZ → byte-identical output everywhere.
  return zipSync(files, { level: 6, mtime: new Date(2026, 0, 1, 0, 0, 0) })
}
