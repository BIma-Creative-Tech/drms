import type { PayloadRequest } from 'payload'

import { userId } from '@/access/roles'
import { writeAudit } from '@/audit/writer'
import { displayName } from '@/domain/expense/common'
import { csvLine, CSV_BOM, type CsvCell } from '@/lib/csv'
import { withReqTransaction } from '@/lib/system-tx'
import { XLSX_MAX_ROWS, type XlsxSheet } from '@/lib/xlsx'
import { formatRupiah } from '@/lib/money'
import { formatServerTime } from '@/pdf/format'

import { auditRangeDays, AUDIT_EXPORT_MAX_DAYS, parseAuditFilter } from './audit-log'
import { reportContext } from './kpi'
import { describeFilters, type Cell, type ColType, type Format, type ReportDef, type ReportResult, type Table } from './registry'
import { formatPct } from './rules'
import type { ReportScope } from './scope'

/**
 * Report exports (F3 export-library-decision §4, Q-F3-3/Q-F3-5):
 * - CSV: always available; streamed, the list reports read keyset pages of 1 000 rows, each page in
 *   its own short transaction (no DB connection held while the client downloads); ≤ 100 000 rows.
 * - XLSX: ≤ 10 000 data rows (else 413 "Persempit filter atau pakai CSV"), EXPORT_XLSX_ENABLED.
 * - PDF: Rekap Kas / Pengeluaran per Kategori / Anggaran Project only, ≤ 500 rows.
 * XLSX and PDF share the web process semaphore (2 concurrent, 10 s wait → 503). Each download
 * writes ONE audit row `export` (report, format, filters, row count) before the file is produced.
 */
export const CSV_MAX_ROWS = 100_000
export const CSV_PAGE = 1_000
export const PDF_MAX_ROWS = 500

export class ExportRefused extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail)
  }
}

const MIME: Record<Format, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
}

/** Display text of a cell (screen + PDF). */
export function cellText(v: Cell, type: ColType): string {
  if (v === null || v === undefined || v === '') return type === 'money' || type === 'int' || type === 'pct' ? '' : ''
  if (type === 'money' && typeof v === 'number') return formatRupiah(v).replace(/^(-?)Rp /, '$1')
  if (type === 'int' && typeof v === 'number') return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  if (type === 'pct' && typeof v === 'number') return formatPct(v)
  if (type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`
  if (type === 'datetime' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2} /.test(v)) return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)} ${v.slice(11, 16)}`
  return String(v)
}

/** CSV value: amounts as plain integers, dates ISO, text as-is (csvCell guards formulas). */
function csvValue(v: Cell): CsvCell {
  return v
}

async function titleRows(req: PayloadRequest, def: ReportDef, scope: ReportScope, sp: URLSearchParams): Promise<string[]> {
  const ctx = await reportContext(req)
  const fields = await def.filters(req, scope, sp)
  const who = await displayName(req, userId(req)!)
  return [
    def.title,
    ctx.companyName,
    ...describeFilters(fields),
    ...(scope.kind === 'team' ? ['Cakupan: project/pusat biaya tim saya (PM)'] : []),
    `Dibuat oleh ${who} · ${formatServerTime(new Date().toISOString(), ctx.tz)}`,
  ]
}

const tableRow = (t: Table, r: { cells: Record<string, Cell> }) => t.columns.map((c) => r.cells[c.key] ?? null)
const totalsRow = (t: Table) => (t.totals ? t.columns.map((c) => t.totals![c.key] ?? null) : undefined)

export type PreparedExport = {
  def: ReportDef
  format: Format
  filename: string
  title: string[]
  first: ReportResult
}

/**
 * Checks + audit row, inside ONE transaction on `req`. Throws ExportRefused (4xx) when the format
 * is not offered, a cap is exceeded or the audit-log range is too long.
 */
export async function prepareExport(req: PayloadRequest, def: ReportDef, scope: ReportScope, sp: URLSearchParams, format: Format): Promise<PreparedExport> {
  return withReqTransaction(req, async () => {
    const ctx = await reportContext(req)
    if (def.code === 'audit-log' && auditRangeDays(parseAuditFilter(sp, ctx.today)) > AUDIT_EXPORT_MAX_DAYS) {
      throw new ExportRefused(400, `Export audit log maksimal ${AUDIT_EXPORT_MAX_DAYS} hari per file. Persempit rentang tanggal.`)
    }
    const limit = format === 'csv' ? CSV_PAGE : format === 'xlsx' ? XLSX_MAX_ROWS : PDF_MAX_ROWS
    const first = await def.run(req, scope, sp, { limit })
    const count = def.paged ? first.count : first.main.rows.length
    const biggest = Math.max(count, ...first.extra.map((t) => t.rows.length))
    if (format === 'xlsx' && biggest > XLSX_MAX_ROWS) throw new ExportRefused(413, `Lebih dari ${XLSX_MAX_ROWS.toLocaleString('id-ID')} baris. Persempit filter atau pakai CSV.`)
    if (format === 'pdf' && biggest > PDF_MAX_ROWS) throw new ExportRefused(413, `PDF maksimal ${PDF_MAX_ROWS} baris. Persempit filter atau pakai Excel/CSV.`)
    if (format === 'csv' && count > CSV_MAX_ROWS) throw new ExportRefused(413, `Lebih dari ${CSV_MAX_ROWS.toLocaleString('id-ID')} baris. Persempit filter.`)
    const title = await titleRows(req, def, scope, sp)
    await writeAudit(req, [
      {
        action: 'export',
        docType: 'report',
        docId: def.code,
        docNo: def.code,
        field: format,
        newValue: { report: def.code, format, filters: Object.fromEntries([...sp.entries()].slice(0, 30)), rows: count, scope: scope.kind },
      },
    ])
    return { def, format, filename: `${def.fileStem(ctx, sp)}.${format}`, title, first }
  })
}

/** Streams the CSV: title lines, blank line, header, data (list reports: page by page). */
export function csvStream(req: PayloadRequest, p: PreparedExport, scope: ReportScope, sp: URLSearchParams): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  let cursor = p.first.next
  let sent = 0
  let stage: 'head' | 'rows' | 'extra' | 'done' = 'head'
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (stage === 'head') {
          const t = p.first.main
          let out = CSV_BOM + p.title.map((l) => csvLine([l])).join('') + csvLine([])
          out += csvLine(t.columns.map((c) => c.label))
          for (const r of t.rows) out += csvLine(tableRow(t, r).map(csvValue))
          sent += t.rows.length
          controller.enqueue(enc.encode(out))
          stage = p.def.paged && cursor ? 'rows' : 'extra'
          return
        }
        if (stage === 'rows') {
          const page = await withReqTransaction(req, () => p.def.run(req, scope, sp, { cursor: cursor ?? undefined, limit: CSV_PAGE }))
          const t = page.main
          let out = ''
          for (const r of t.rows) {
            if (sent >= CSV_MAX_ROWS) break
            out += csvLine(tableRow(t, r).map(csvValue))
            sent++
          }
          controller.enqueue(enc.encode(out))
          cursor = page.next
          if (!cursor || sent >= CSV_MAX_ROWS) stage = 'extra'
          return
        }
        if (stage === 'extra') {
          const t = p.first.main
          let out = ''
          const tot = totalsRow(t)
          if (tot) out += csvLine(tot.map(csvValue))
          for (const x of p.first.extra) {
            out += csvLine([]) + csvLine([x.title]) + csvLine(x.columns.map((c) => c.label))
            for (const r of x.rows) out += csvLine(tableRow(x, r).map(csvValue))
            const xt = totalsRow(x)
            if (xt) out += csvLine(xt.map(csvValue))
          }
          for (const n of p.first.notes) out += csvLine([]) + csvLine([`* ${n}`])
          controller.enqueue(enc.encode(out))
          stage = 'done'
          return
        }
        controller.close()
      } catch (err) {
        req.payload.logger.error({ msg: 'csv export failed', report: p.def.code, err: (err as Error).message })
        controller.error(err)
      }
    },
  })
}

function sheetOf(name: string, title: string[], t: Table): XlsxSheet {
  return {
    name,
    title,
    columns: t.columns.map((c) => ({ label: c.label, type: c.type, width: c.width })),
    rows: t.rows.map((r) => tableRow(t, r)),
    totals: totalsRow(t),
  }
}

export async function xlsxBuffer(p: PreparedExport): Promise<Buffer> {
  const { writeXlsx } = await import('@/lib/xlsx')
  const main = sheetOf(p.def.title, [...p.title, ...p.first.notes.map((n) => `* ${n}`)], p.first.main)
  const extra = p.first.extra.map((t, i) => sheetOf(`${i + 2} ${t.title}`, [p.def.title, t.title], t))
  const { withHeavySlot } = await import('@/lib/heavy-gate')
  return withHeavySlot(() => writeXlsx([main, ...extra]))
}

export async function pdfBuffer(req: PayloadRequest, p: PreparedExport): Promise<Buffer> {
  const ctx = await reportContext(req)
  const settings = await req.payload.findGlobal({ slug: 'company-settings', depth: 0, overrideAccess: true /* SYSTEM-READ: PDF header */, req })
  const kop = [ctx.companyName, ...(settings.pdfHeader ?? '').split('\n'), settings.address ?? '', settings.phone ? `Telp. ${settings.phone}` : '']
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5)
  const toPdf = (t: Table) => {
    const weights = t.columns.map((c) => (c.type === 'text' ? (c.width ?? 18) : 11))
    const sum = weights.reduce((a, b) => a + b, 0)
    return {
      title: t.title,
      columns: t.columns.map((c, i) => ({ label: c.label, type: c.type, width: Math.floor((weights[i]! / sum) * 1000) / 10 })),
      rows: t.rows.map((r) => t.columns.map((c) => cellText(r.cells[c.key] ?? null, c.type))),
      totals: t.totals ? t.columns.map((c) => cellText(t.totals![c.key] ?? null, c.type)) : undefined,
    }
  }
  const { renderReportPdf } = await import('@/pdf/report-render')
  return renderReportPdf({ kop, title: p.def.title, meta: p.title.slice(2), tables: [toPdf(p.first.main), ...p.first.extra.map(toPdf)], notes: p.first.notes })
}

export function downloadHeaders(p: Pick<PreparedExport, 'format' | 'filename'>, length?: number): Headers {
  const h = new Headers({
    'Content-Type': MIME[p.format],
    'Content-Disposition': `attachment; filename="${p.filename.replace(/[^A-Za-z0-9._-]+/g, '-')}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  if (length !== undefined) h.set('Content-Length', String(length))
  return h
}
