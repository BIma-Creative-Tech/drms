/**
 * DRMS 10/10 8f–8h (D3): pure helpers of the expense-line table + dialog (LinesTableField; unit-tested).
 * Same rules as the server (src/domain/expense/lines.ts): total = qty × harga satuan (qty empty = 1),
 * computed and never typed; qty ≤ 3 decimals, a unit when qty is set, whole Rupiah amounts.
 */
import { computeLineTotal, isValidQty } from '@/domain/expense/lines'
import { ptOptions, type PtOption } from '@/lib/pt-options'
import { groupRupiah, parseRupiah } from '@/lib/rupiah-input'

export { computeLineTotal }

/** Shown in the line dialog's Kategori / Kendaraan pickers until the request has a PT (same text as CompanyScopedField). */
export const LINE_PICK_COMPANY_FIRST = 'Pilih PT terlebih dahulu'

/**
 * DRMS UI feedback 17/10 #4: Kategori / Kendaraan options of the line dialog = the request's PT only (per-PT masters carry
 * the same names in every PT, so a multi-PT user saw each one twice); unique ids; no PT chosen yet → none (the pickers
 * wait with "Pilih PT terlebih dahulu"). The server still rejects a cross-PT reference (company hook + DB trigger).
 */
export function lineMasterOptions<T extends PtOption>(list: readonly T[], company: number | null): T[] {
  return company === null ? [] : ptOptions(list, { code: (id) => `#${id}`, company })
}

/** Line fields of the Payload form state (`lines.<i>.<name>`). */
export const LINE_FIELD_NAMES = ['description', 'qty', 'uom', 'unitPrice', 'total', 'receiptAmount', 'category', 'vehicle', 'notes', 'rapItem'] as const
export type LineFieldName = (typeof LINE_FIELD_NAMES)[number]

export type LineValues = {
  description: string
  qty: number | null
  uom: number | null
  unitPrice: number | null
  total: number | null
  receiptAmount: number | null
  category: number | null
  vehicle: number | null
  notes: string
  /** D4: RAP item of the request's project. */
  rapItem: number | null
}

/** Text of the dialog inputs (what the user typed). */
export type LineDraft = {
  description: string
  qty: string
  uom: string
  unitPrice: string
  receiptAmount: string
  category: string
  vehicle: string
  notes: string
  rapItem: string
}

export type LineDraftErrors = Partial<Record<keyof LineDraft, string>>

/** Relationship value of the form state (id, `{ id }`, `{ value }`, numeric string) → id. */
export function relValue(v: unknown): number | null {
  if (typeof v === 'number' && Number.isSafeInteger(v)) return v
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v)
  if (v && typeof v === 'object') {
    if ('value' in v) return relValue((v as { value: unknown }).value)
    if ('id' in v) return relValue((v as { id: unknown }).id)
  }
  return null
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

/** Row `i` of the form state. */
export function rowValues(fields: Record<string, { value?: unknown } | undefined>, path: string, i: number): LineValues {
  const v = (f: LineFieldName) => fields[`${path}.${i}.${f}`]?.value
  return {
    description: typeof v('description') === 'string' ? (v('description') as string) : '',
    qty: num(v('qty')),
    uom: relValue(v('uom')),
    unitPrice: num(v('unitPrice')),
    total: num(v('total')),
    receiptAmount: num(v('receiptAmount')),
    category: relValue(v('category')),
    vehicle: relValue(v('vehicle')),
    notes: typeof v('notes') === 'string' ? (v('notes') as string) : '',
    rapItem: relValue(v('rapItem')),
  }
}

/** "1,5" / "1.5" / "24,80" → number; '' → null; NaN for anything else. */
export function parseQty(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (t === '') return null
  if (!/^\d+(\.\d+)?$/.test(t)) return Number.NaN
  return Number(t)
}

/** 1.5 → "1,5" (Indonesian decimal comma), integers unchanged. */
export function formatQty(q: number | null | undefined): string {
  if (q === null || q === undefined || !Number.isFinite(q)) return ''
  return String(Number(q.toFixed(3))).replace('.', ',')
}

export function draftOf(v: LineValues | null): LineDraft {
  return {
    description: v?.description ?? '',
    qty: v ? formatQty(v.qty ?? 1) : '1',
    uom: v?.uom ? String(v.uom) : '',
    unitPrice: v?.unitPrice !== null && v?.unitPrice !== undefined ? groupRupiah(v.unitPrice) : '',
    receiptAmount: v?.receiptAmount !== null && v?.receiptAmount !== undefined ? groupRupiah(v.receiptAmount) : '',
    category: v?.category ? String(v.category) : '',
    vehicle: v?.vehicle ? String(v.vehicle) : '',
    notes: v?.notes ?? '',
    rapItem: v?.rapItem ? String(v.rapItem) : '',
  }
}

/**
 * Dialog → line values + errors. The dialog asks for everything the submit needs (uraian, kategori, qty,
 * satuan, harga satuan; kendaraan when the category requires it), so a saved row is always sendable.
 */
export function parseDraft(d: LineDraft, opts: { requiresVehicle?: boolean; rapRequired?: boolean } = {}): { values: LineValues | null; errors: LineDraftErrors } {
  const errors: LineDraftErrors = {}
  const description = d.description.trim()
  if (!description) errors.description = 'Uraian wajib diisi.'
  else if (description.length > 500) errors.description = 'Uraian maksimal 500 karakter.'
  const qty = parseQty(d.qty)
  if (qty === null) errors.qty = 'Qty wajib diisi.'
  else if (!isValidQty(qty)) errors.qty = 'Qty harus > 0 (maks. 3 desimal, koma untuk desimal).'
  const uom = relValue(d.uom)
  if (uom === null) errors.uom = 'Satuan wajib dipilih.'
  const up = parseRupiah(d.unitPrice, { allowZero: false })
  if (up.error) errors.unitPrice = up.error
  else if (up.value === null) errors.unitPrice = 'Harga satuan wajib diisi.'
  const ra = parseRupiah(d.receiptAmount, { allowZero: true })
  if (ra.error) errors.receiptAmount = ra.error
  const category = relValue(d.category)
  if (category === null) errors.category = 'Kategori wajib dipilih.'
  const vehicle = relValue(d.vehicle)
  if (opts.requiresVehicle && vehicle === null) errors.vehicle = 'Kategori ini wajib ditautkan ke kendaraan.'
  if (d.notes.length > 500) errors.notes = 'Keterangan maksimal 500 karakter.'
  // D4: the project has a RAP → every line names one of its items (the server checks the item's project)
  const rapItem = relValue(d.rapItem)
  if (opts.rapRequired && rapItem === null) errors.rapItem = 'Item RAP wajib dipilih.'
  const total = qty !== null && !Number.isNaN(qty) ? computeLineTotal(qty, up.value) : null
  if (!errors.qty && !errors.unitPrice && total === null) errors.unitPrice = 'Total baris terlalu besar.'
  if (Object.keys(errors).length > 0) return { values: null, errors }
  return {
    values: { description, qty, uom, unitPrice: up.value, total, receiptAmount: ra.value, category, vehicle: opts.requiresVehicle || vehicle !== null ? vehicle : null, notes: d.notes.trim(), rapItem },
    errors,
  }
}

/** Live total of the dialog (null while qty / harga satuan are incomplete). */
export function draftTotal(d: Pick<LineDraft, 'qty' | 'unitPrice'>): number | null {
  const qty = parseQty(d.qty)
  const up = parseRupiah(d.unitPrice, { allowZero: true })
  if (qty === null || Number.isNaN(qty) || up.error || up.value === null) return null
  return computeLineTotal(qty, up.value)
}
