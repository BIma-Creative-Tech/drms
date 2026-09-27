/**
 * CSV for Indonesian Excel (F3 export-library-decision §4.3): UTF-8 with BOM, separator `;` (id-ID
 * Excel uses the comma as decimal separator), CRLF, RFC 4180 quoting. Amounts are plain integers
 * (no grouping), dates ISO. Formula injection (CWE-1236): a text cell starting with = + - @ TAB or
 * CR is prefixed with `'` so spreadsheets never evaluate it. Numbers are written as numbers (a
 * negative amount is not text, so it is not prefixed). Pure module (unit-tested).
 */
export const CSV_BOM = '﻿'
export const CSV_SEP = ';'
export const CSV_EOL = '\r\n'

export type CsvCell = string | number | null | undefined

const FORMULA_START = /^[=+\-@\t\r]/

export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  let s = String(v)
  if (FORMULA_START.test(s)) s = `'${s}`
  return /[";\r\n,]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s
}

export function csvLine(cells: readonly CsvCell[]): string {
  return cells.map(csvCell).join(CSV_SEP) + CSV_EOL
}
