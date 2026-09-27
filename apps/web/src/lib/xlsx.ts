/**
 * XLSX writer wrapper (F3 export-library-decision §4, user decision Q-F3-3 2026-09-24):
 * `write-excel-file@4.1.1` (MIT), server-side only, loaded lazily (no RAM at idle), in-memory
 * workbook → capped at XLSX_MAX_ROWS data rows per file (≈ +45 MiB at 10 000 rows measured).
 * Amounts are numbers with format `#,##0` (Excel shows the user's locale grouping), dates are real
 * Excel dates `dd/mm/yyyy` built from Date.UTC (no TZ shift). Every text cell is written with
 * `type: String` (shared string) — never 'Formula' — so text like "=1+1" is not evaluated.
 * Switch: EXPORT_XLSX_ENABLED=false hides the button and turns the endpoint into 404 (rollback).
 */
export const XLSX_MAX_ROWS = 10_000

export function xlsxEnabled(): boolean {
  return process.env.EXPORT_XLSX_ENABLED !== 'false'
}

export type XlsxColumnType = 'text' | 'money' | 'int' | 'date' | 'datetime' | 'pct'
export type XlsxColumn = { label: string; type: XlsxColumnType; width?: number }
export type XlsxSheet = { name: string; title: string[]; columns: XlsxColumn[]; rows: Array<Array<string | number | null>>; totals?: Array<string | number | null> }

type Cell = { value?: string | number | Date; type?: StringConstructor | NumberConstructor | DateConstructor; format?: string; fontWeight?: 'bold' } | null

function dateOf(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(v)
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)))
}

export function xlsxCell(v: string | number | null, type: XlsxColumnType, bold = false): Cell {
  const b = bold ? { fontWeight: 'bold' as const } : {}
  if (v === null || v === undefined || v === '') return null
  if (type === 'money' || type === 'int') return typeof v === 'number' ? { value: v, type: Number, format: '#,##0', ...b } : { value: String(v), type: String, ...b }
  if (type === 'pct') return typeof v === 'number' ? { value: v, type: Number, format: '0.00', ...b } : { value: String(v), type: String, ...b }
  if ((type === 'date' || type === 'datetime') && typeof v === 'string') {
    const d = dateOf(v)
    if (d) return { value: d, type: Date, format: type === 'date' ? 'dd/mm/yyyy' : 'dd/mm/yyyy hh:mm', ...b }
  }
  return { value: String(v), type: String, ...b }
}

/** Builds the sheet data (title rows, bold header, rows, bold totals) — pure, unit-tested. */
export function sheetData(s: XlsxSheet): Cell[][] {
  const data: Cell[][] = s.title.map((t, i) => [{ value: t, type: String, ...(i === 0 ? { fontWeight: 'bold' as const } : {}) }])
  data.push([])
  data.push(s.columns.map((c) => ({ value: c.label, type: String, fontWeight: 'bold' as const })))
  for (const r of s.rows) data.push(s.columns.map((c, i) => xlsxCell(r[i] ?? null, c.type)))
  if (s.totals) data.push(s.columns.map((c, i) => xlsxCell(s.totals![i] ?? null, c.type, true)))
  return data
}

export async function writeXlsx(sheets: XlsxSheet[]): Promise<Buffer> {
  const { default: writeXlsxFile } = await import('write-excel-file/node')
  const list = sheets.map((s) => ({
    data: sheetData(s) as never,
    sheet: s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31),
    columns: s.columns.map((c) => ({ width: c.width ?? (c.type === 'text' ? 28 : 16) })),
    stickyRowsCount: s.title.length + 2,
  }))
  return writeXlsxFile(list as never, { fontFamily: 'Calibri', fontSize: 11 }).toBuffer()
}
