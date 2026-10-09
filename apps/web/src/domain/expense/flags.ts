/**
 * Receipt validation flags (requirements v1.1 §7 T4, US-47…US-50, architecture §5.6): FLAGS,
 * never blockers. Pure computation of the desired flag set; the service persists the difference
 * (new → raised, vanished → resolved, reviewed ones keep their review). Unit-tested.
 *
 * Compared values are the TOTAL PRINTED on the receipt (K10: Pertamina 24,80 L × 24.200 = 600.160
 * but printed 600.000 → 600.000 is used).
 */
import { formatRupiah } from '@/lib/money'

import { addDays, type FlagKind, type FlagLevel, type RequestType } from './types'

export type FlagLine = { id: string; lineNo: number; total: number; uom?: number | null; category?: number | null }
export type FlagReceipt = { id: number; lineId: string; receiptDate: string; amount: number }
export type FlagCategory = { id: number; name: string; allowedUoms: number[] }
/**
 * A match in another active request. `otherCompanyId` = PT of that request when it is NOT the PT of
 * the request being checked (cross-PT hit, QA-MC4-06), else null. `otherReceiptId` is set only for a
 * match INSIDE the same request (QA-08): the earlier receipt of the pair.
 */
export type DuplicateHit = { receiptId: number; otherRequestId: number; otherDocNo: string | null; via: 'fields' | 'image'; otherCompanyId?: number | null; otherReceiptId?: number }

export type FlagInput = {
  type: RequestType
  /** Reimburse: tanggal pengajuan (server date of submit, or today while Draft) — Q-04 default. */
  requestDate: string
  /** Uang Muka: date of the (first) posted transfer, if any. */
  transferDate?: string | null
  lines: FlagLine[]
  /** Active receipts only (not rejected/removed). */
  receipts: FlagReceipt[]
  categories: Map<number, FlagCategory>
  uomNames: Map<number, string>
  duplicates: DuplicateHit[]
  /** company-settings.receiptRoundingTolerance (Q-14 default Rp 1.000 per line). */
  tolerance: number
  /** company-settings.receiptMaxAgeDays (usulan 30). */
  maxAgeDays: number
}

export type FlagSpec = {
  key: string
  kind: FlagKind
  level: FlagLevel
  lineId: string
  lineNo: number
  receiptId?: number
  relatedRequestId?: number
  /** Cross-PT duplicate: PT of the related request (the flag is shown only to users mapped to it). */
  relatedCompanyId?: number
  message: string
  detail: Record<string, unknown>
}

/** "TX0101.0001.000123" → "TX01010001000123" (US-50 "nomor nota ternormalisasi"). */
export function normalizeReceiptNo(v: string | null | undefined): string {
  return (v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Vendor name for duplicate matching: lower case, letters/digits only, single spaces. */
export function normalizeVendor(v: string | null | undefined): string {
  return (v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function computeFlags(input: FlagInput): FlagSpec[] {
  const out: FlagSpec[] = []
  const lineById = new Map(input.lines.map((l) => [l.id, l]))

  // US-47 amount difference per line (only lines that have receipts).
  for (const line of input.lines) {
    const rs = input.receipts.filter((r) => r.lineId === line.id)
    if (rs.length === 0) continue
    const sum = rs.reduce((s, r) => s + r.amount, 0)
    const diff = line.total - sum
    if (diff === 0) continue
    const level: FlagLevel = Math.abs(diff) <= input.tolerance ? 'info' : 'warning'
    out.push({
      key: `amount_diff:${line.id}`,
      kind: 'amount_diff',
      level,
      lineId: line.id,
      lineNo: line.lineNo,
      message: `Selisih ${formatRupiah(Math.abs(diff))} (baris ${formatRupiah(line.total)}, nota ${formatRupiah(sum)}; toleransi ${formatRupiah(input.tolerance)}).`,
      detail: { lineTotal: line.total, receiptsTotal: sum, difference: diff, tolerance: input.tolerance },
    })
  }

  // US-49 unusual unit per line (category's allowed UoM list; empty list = no check).
  for (const line of input.lines) {
    if (!line.uom || !line.category) continue
    const cat = input.categories.get(line.category)
    if (!cat || cat.allowedUoms.length === 0 || cat.allowedUoms.includes(line.uom)) continue
    const uomName = input.uomNames.get(line.uom) ?? String(line.uom)
    out.push({
      key: `uom_suspicious:${line.id}`,
      kind: 'uom_suspicious',
      level: 'warning',
      lineId: line.id,
      lineNo: line.lineNo,
      message: `Satuan "${uomName}" tidak wajar untuk kategori ${cat.name}.`,
      detail: { uom: line.uom, uomName, category: cat.id, allowed: cat.allowedUoms },
    })
  }

  // US-48 receipt dates.
  for (const r of input.receipts) {
    const line = lineById.get(r.lineId)
    if (!line) continue
    const push = (kind: FlagKind, message: string, detail: Record<string, unknown>) =>
      out.push({ key: `${kind}:${line.id}:${r.id}`, kind, level: 'warning', lineId: line.id, lineNo: line.lineNo, receiptId: r.id, message, detail })
    if (input.type === 'reimburse') {
      if (r.receiptDate > input.requestDate) {
        push('date_after_request', `Tanggal nota ${r.receiptDate} setelah tanggal pengajuan ${input.requestDate}.`, { receiptDate: r.receiptDate, requestDate: input.requestDate })
      } else if (r.receiptDate < addDays(input.requestDate, -input.maxAgeDays)) {
        push('date_too_old', `Nota lebih tua dari ${input.maxAgeDays} hari sebelum pengajuan.`, { receiptDate: r.receiptDate, requestDate: input.requestDate, maxAgeDays: input.maxAgeDays })
      }
    } else if (input.transferDate && r.receiptDate < addDays(input.transferDate, -input.maxAgeDays)) {
      push('date_too_old', `Nota lebih tua dari ${input.maxAgeDays} hari sebelum transfer.`, { receiptDate: r.receiptDate, transferDate: input.transferDate, maxAgeDays: input.maxAgeDays })
    }
    // `date_out_of_period` is no longer raised: the activity period was replaced by "Tingkat Urgensi"
    // (owner decision 2026-10-09). The kind stays in FLAG_KINDS for historic flags (append-only).
  }

  // US-50 duplicates (matches found by the service in OTHER active requests and — QA-08 — inside the
  // same request: `otherReceiptId`, flagged once on the later receipt of the pair).
  const seen = new Set<string>()
  for (const d of input.duplicates) {
    const r = input.receipts.find((x) => x.id === d.receiptId)
    const line = r ? lineById.get(r.lineId) : undefined
    if (!r || !line) continue
    const key = `duplicate:${line.id}:${r.id}:${d.otherRequestId}`
    if (seen.has(key)) continue
    seen.add(key)
    if (d.otherReceiptId !== undefined) {
      const first = input.receipts.find((x) => x.id === d.otherReceiptId)
      const firstLine = first ? lineById.get(first.lineId) : undefined
      out.push({
        key,
        kind: 'duplicate',
        level: 'warning',
        lineId: line.id,
        lineNo: line.lineNo,
        receiptId: r.id,
        message: `Nota ganda dalam pengajuan ini: sama dengan nota ${firstLine ? `baris ${firstLine.lineNo}` : `#${d.otherReceiptId}`} (${d.via === 'image' ? 'foto identik' : 'nomor + toko sama'}).`,
        detail: { sameRequest: true, otherReceiptId: d.otherReceiptId, otherLineNo: firstLine?.lineNo ?? null, via: d.via },
      })
      continue
    }
    out.push({
      key,
      kind: 'duplicate',
      level: 'warning',
      lineId: line.id,
      lineNo: line.lineNo,
      receiptId: r.id,
      relatedRequestId: d.otherRequestId,
      ...(typeof d.otherCompanyId === 'number' ? { relatedCompanyId: d.otherCompanyId } : {}),
      message: `Nota sudah dipakai di pengajuan ${d.otherDocNo ?? `#${d.otherRequestId}`} (${d.via === 'image' ? 'foto identik' : 'nomor + toko + nominal sama'}).`,
      detail: { otherRequestId: d.otherRequestId, otherDocNo: d.otherDocNo, via: d.via },
    })
  }
  return out
}
