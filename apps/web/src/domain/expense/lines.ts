/**
 * Expense request lines (requirements v1.1 §7 T1 table, US-37, architecture §4.1).
 * D3 (owner decision DRMS 10/10, 2026-10-11) replaces Q-05: the line `total` is COMPUTED by the server,
 * `total = qty × unitPrice` (qty empty = 1, rounded to whole Rupiah), never entered; approval and transfer
 * use it (`grandTotal` = Σ line totals). `receiptAmount` ("Nominal sesuai nota") is an optional, separate
 * per-line value; when it differs from the total, Finance sees the awareness flag "Selisih nota"
 * (`receipt_amount_mismatch`, flags.ts) — it never changes the amounts.
 * Compatibility: a client that sends only `total` (APK ≤ 0.7, old API callers) gets
 * `unitPrice = total ÷ qty` when that is a whole Rupiah amount; otherwise the line stays incomplete
 * (no unit price) and cannot be submitted. Lines saved before D3 without a unit price ("legacy") keep
 * their stored total until edited. Pure module (unit-tested).
 */

export type LineInput = {
  id?: string | null
  description?: string | null
  qty?: number | null
  uom?: number | null
  unitPrice?: number | null
  total?: number | null
  receiptAmount?: number | null
  notes?: string | null
  category?: number | null
  vehicle?: number | null
}

export type LineError = { path: string; message: string }

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const MAX_RUPIAH = 1e13

/** ≤ 3 decimals (e.g. 24,80 L), > 0. */
export function isValidQty(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1e9 && Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6
}

/**
 * `forSubmit` adds the completeness rules (min 1 line, category, total > 0). Drafts may be
 * incomplete but never carry malformed values. Vehicle-required categories are checked by the
 * service (needs master data).
 */
export function validateLines(lines: readonly LineInput[], opts: { forSubmit: boolean }): LineError[] {
  const errors: LineError[] = []
  if (opts.forSubmit && lines.length === 0) errors.push({ path: 'lines', message: 'Minimal 1 baris item.' })
  if (lines.length > 200) errors.push({ path: 'lines', message: 'Maksimal 200 baris item.' })
  lines.forEach((l, i) => {
    const p = (f: string) => `lines.${i}.${f}`
    const desc = typeof l.description === 'string' ? l.description.trim() : ''
    if (opts.forSubmit && desc.length === 0) errors.push({ path: p('description'), message: 'Uraian wajib diisi.' })
    if (desc.length > 500) errors.push({ path: p('description'), message: 'Uraian maksimal 500 karakter.' })
    if (l.qty !== null && l.qty !== undefined && !isValidQty(l.qty)) errors.push({ path: p('qty'), message: 'Jumlah harus > 0 (maks. 3 desimal).' })
    if (l.qty !== null && l.qty !== undefined && (l.uom === null || l.uom === undefined)) {
      errors.push({ path: p('uom'), message: 'Satuan wajib bila jumlah diisi.' })
    }
    if (l.unitPrice !== null && l.unitPrice !== undefined && !(isInt(l.unitPrice) && l.unitPrice >= 0 && l.unitPrice <= MAX_RUPIAH)) {
      errors.push({ path: p('unitPrice'), message: 'Harga satuan harus bilangan bulat Rupiah ≥ 0.' })
    } else if (opts.forSubmit && (l.unitPrice === null || l.unitPrice === undefined)) {
      // D3: total = qty × harga satuan → the unit price is required to send the request
      errors.push({ path: p('unitPrice'), message: 'Harga satuan wajib diisi (total baris = jumlah × harga satuan).' })
    }
    if (l.total === null || l.total === undefined) {
      if (opts.forSubmit) errors.push({ path: p('total'), message: 'Total baris wajib diisi (isi jumlah dan harga satuan).' })
    } else if (!(isInt(l.total) && l.total > 0 && l.total <= MAX_RUPIAH)) {
      errors.push({ path: p('total'), message: 'Total baris (jumlah × harga satuan) harus bilangan bulat Rupiah > 0.' })
    }
    if (l.receiptAmount !== null && l.receiptAmount !== undefined && !(isInt(l.receiptAmount) && l.receiptAmount >= 0 && l.receiptAmount <= MAX_RUPIAH)) {
      errors.push({ path: p('receiptAmount'), message: 'Nominal sesuai nota harus bilangan bulat Rupiah ≥ 0.' })
    }
    if (opts.forSubmit && (l.category === null || l.category === undefined)) errors.push({ path: p('category'), message: 'Kategori wajib diisi.' })
    if (typeof l.notes === 'string' && l.notes.length > 500) errors.push({ path: p('notes'), message: 'Keterangan maksimal 500 karakter.' })
  })
  return errors
}

/** Σ line totals (server-side; any client-sent grand total is ignored). */
export function grandTotal(lines: readonly LineInput[]): number {
  return lines.reduce((s, l) => s + (isInt(l.total) ? l.total : 0), 0)
}

/**
 * D3: line total = qty × unitPrice (qty empty = 1), rounded half-up to whole Rupiah. Exact: qty has at most
 * 3 decimals, so the product is computed in thousandths with BigInt. null = not computable (no valid
 * unit price, invalid qty, or above the Rupiah maximum).
 */
export function computeLineTotal(qty: number | null | undefined, unitPrice: number | null | undefined): number | null {
  if (!isInt(unitPrice) || unitPrice < 0) return null
  const q = qty === null || qty === undefined ? 1 : qty
  if (!isValidQty(q)) return null
  const milli = BigInt(Math.round(q * 1000))
  const total = Number((milli * BigInt(unitPrice) + 500n) / 1000n)
  return total <= MAX_RUPIAH ? total : null
}

/**
 * D3: the server-side line values of a write — `total` recomputed from qty × unitPrice (a client total is
 * ignored), the total-only compatibility path (unit price derived when it divides exactly), and legacy rows
 * (no unit price, saved before D3) keeping their stored total. `prev` = the stored lines of the document.
 */
export function normalizeLines<T extends LineInput>(lines: readonly T[], prev: readonly LineInput[] = []): T[] {
  const before = new Map(prev.filter((l) => l.id).map((l) => [l.id as string, l]))
  return lines.map((l) => {
    const out = { ...l }
    if (isInt(l.unitPrice)) {
      out.total = computeLineTotal(l.qty, l.unitPrice)
      return out
    }
    out.unitPrice = null
    if (isInt(l.total) && l.total > 0) {
      // total-only client: unit price = total ÷ qty when that reproduces the total exactly
      const q = l.qty === null || l.qty === undefined ? 1 : l.qty
      if (isValidQty(q)) {
        const up = Math.round(l.total / q)
        if (computeLineTotal(q, up) === l.total) {
          out.unitPrice = up
          return out
        }
      }
    }
    const old = l.id ? before.get(l.id) : undefined
    // legacy row unchanged (no unit price, same qty + total) → keeps its stored total until edited
    if (old && !isInt(old.unitPrice) && isInt(old.total) && l.total === old.total && (l.qty ?? null) === (old.qty ?? null)) return out
    out.total = null
    return out
  })
}

/** "Selisih nota": the line's receipt amount is set and differs from its total. */
export function receiptMismatch(l: Pick<LineInput, 'receiptAmount' | 'total'>): boolean {
  return isInt(l.receiptAmount) && isInt(l.total) && l.receiptAmount !== l.total
}

/** Display-only unit price: the entered value, else total ÷ qty rounded (US-37; legacy rows). */
export function displayUnitPrice(l: Pick<LineInput, 'unitPrice' | 'qty' | 'total'>): number | null {
  if (isInt(l.unitPrice)) return l.unitPrice
  if (isInt(l.total) && isValidQty(l.qty)) return Math.round(l.total / l.qty)
  return null
}
