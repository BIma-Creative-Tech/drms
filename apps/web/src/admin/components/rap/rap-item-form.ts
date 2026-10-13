/**
 * DRMS 13/10 Wave 3 "Proyek › RAP": pure helpers of the RAP item table + dialog (RapItemsEditor; unit-tested). Same
 * limits as the /api/v1 contract (schemas-daily.ts RapItemCreate / RapItemUpdate) and the service
 * (domain/rap/service.ts itemIssues): kode 1–32, uraian 1–300, volume > 0 with ≤ 2 decimals, harga satuan whole
 * Rupiah ≥ 0 (empty = unpriced), bobot 0–100 with ≤ 2 decimals, tahapan required for konstruksi. The server stays the
 * judge (role, lock, duplicate kode, stage of the project) — these checks only spare a round trip.
 */
import { groupRupiah, parseRupiah } from '@/lib/rupiah-input'

export type RapKindValue = 'pekerjaan' | 'material'

/** One row of the editor (from loadRap's RapItemDto; money fields only for the price roles). */
export type RapItemView = {
  id: number
  code: string
  description: string
  kind: RapKindValue
  stageId: number | null
  stageName: string | null
  uomId: number
  uomCode: string
  volume: number
  unitPrice?: number | null
  value?: number | null
  realisedAmount?: number
  weightPct: number | null
  active: boolean
  /** Daily-report quantities (konstruksi). */
  realised: number
  received: number
  used: number
}

/** What the dialog inputs hold (text as typed). */
export type RapItemDraft = { code: string; description: string; kind: string; stageId: string; uomId: string; volume: string; unitPrice: string; weightPct: string; active: string; reason: string }
export type RapItemDraftErrors = Partial<Record<keyof RapItemDraft, string>>

export type RapItemValues = { code: string; description: string; kind: RapKindValue; stageId: number | null; uomId: number; volume: number; unitPrice: number | null; weightPct: number | null; active: boolean }

/**
 * Who may change the RAP on this page (mirrors loadRap `canEdit` / `needsReason` and the service's requireEditor):
 * edit = Direktur/Admin or project PM, RAP not locked · reason = Direktur/Admin on a locked RAP (alasan wajib) ·
 * locked = PM on a locked RAP (buttons shown disabled) · archived = editor role, project archived · read = no editor role.
 */
export type RapEditMode = 'edit' | 'reason' | 'locked' | 'archived' | 'read'

export function rapEditMode(roles: { director: boolean; pm: boolean }, locked: boolean, archived: boolean): RapEditMode {
  if (!roles.director && !roles.pm) return 'read'
  if (archived) return 'archived'
  if (locked) return roles.director ? 'reason' : 'locked'
  return 'edit'
}

export const RAP_LOCKED_HINT = 'RAP terkunci karena sudah ada realisasi: perubahan hanya oleh Direktur/Admin dengan alasan.'
export const RAP_ARCHIVED_HINT = 'Project sudah diarsipkan: RAP tidak dapat diubah.'

/** "1,5" / "1.5" → 1.5; '' → null; NaN for anything else (one decimal separator, no thousands grouping). */
export function parseDecimal(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (t === '') return null
  if (!/^\d{1,9}(\.\d+)?$/.test(t)) return Number.NaN
  return Number(t)
}

const dec2 = (v: number) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6

/** 1.5 → "1,5" (decimal comma, at most 2 decimals, no grouping — the dialog input format). */
export function formatDecimalInput(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return ''
  return String(Number(v.toFixed(2))).replace('.', ',')
}

/** Planned amount of a draft (round(volume × harga satuan), like the server) — null while incomplete. */
export function draftAmount(volume: string, unitPrice: string): number | null {
  const v = parseDecimal(volume)
  const p = parseRupiah(unitPrice, { allowZero: true })
  if (v === null || Number.isNaN(v) || p.error || p.value === null) return null
  return Math.round(v * p.value)
}

export function draftOf(item: RapItemView | null, defaults: { kind?: RapKindValue } = {}): RapItemDraft {
  return {
    code: item?.code ?? '',
    description: item?.description ?? '',
    kind: item?.kind ?? defaults.kind ?? 'pekerjaan',
    stageId: item?.stageId ? String(item.stageId) : '',
    uomId: item ? String(item.uomId) : '',
    volume: item ? formatDecimalInput(item.volume) : '',
    unitPrice: item?.unitPrice !== null && item?.unitPrice !== undefined ? groupRupiah(item.unitPrice) : '',
    weightPct: item?.weightPct !== null && item?.weightPct !== undefined ? formatDecimalInput(item.weightPct) : '',
    active: item && !item.active ? 'tidak' : 'ya',
    reason: '',
  }
}

const id = (v: string): number | null => (/^\d{1,10}$/.test(v.trim()) ? Number(v.trim()) : null)

/** Dialog → values + errors (Indonesian messages next to the inputs). */
export function parseRapDraft(d: RapItemDraft, opts: { stageRequired: boolean; needsReason: boolean }): { values: RapItemValues | null; errors: RapItemDraftErrors } {
  const errors: RapItemDraftErrors = {}
  const code = d.code.trim()
  if (!code) errors.code = 'Kode wajib diisi.'
  else if (code.length > 32) errors.code = 'Kode maksimal 32 karakter.'
  const description = d.description.trim()
  if (!description) errors.description = 'Uraian wajib diisi.'
  else if (description.length > 300) errors.description = 'Uraian maksimal 300 karakter.'
  const kind = d.kind === 'pekerjaan' || d.kind === 'material' ? d.kind : null
  if (!kind) errors.kind = 'Jenis wajib dipilih.'
  const stageId = id(d.stageId)
  if (opts.stageRequired && stageId === null) errors.stageId = 'Tahapan wajib untuk project konstruksi.'
  const uomId = id(d.uomId)
  if (uomId === null) errors.uomId = 'Satuan wajib dipilih.'
  const volume = parseDecimal(d.volume)
  if (volume === null) errors.volume = 'Volume wajib diisi.'
  else if (Number.isNaN(volume) || !(volume > 0) || volume > 100_000_000 || !dec2(volume)) errors.volume = 'Volume harus > 0, maks. 2 desimal (koma untuk desimal).'
  const price = parseRupiah(d.unitPrice, { allowZero: true })
  if (price.error) errors.unitPrice = price.error
  const weight = parseDecimal(d.weightPct)
  if (weight !== null && (Number.isNaN(weight) || weight < 0 || weight > 100 || !dec2(weight))) errors.weightPct = 'Bobot 0–100, maks. 2 desimal.'
  if (opts.needsReason && d.reason.trim().length < 3) errors.reason = 'RAP terkunci: isi alasan perubahan (min. 3 karakter).'
  else if (d.reason.trim().length > 1000) errors.reason = 'Alasan maksimal 1000 karakter.'
  if (Object.keys(errors).length > 0) return { values: null, errors }
  return { values: { code, description, kind: kind!, stageId, uomId: uomId!, volume: volume!, unitPrice: price.value, weightPct: weight, active: d.active !== 'tidak' }, errors }
}

const reasonOf = (reason: string) => (reason.trim() ? { reason: reason.trim() } : {})

/** POST /api/v1/projects/{id}/rap/items body (RapItemCreate; a new item is always active). */
export function createBody(v: RapItemValues, reason = ''): Record<string, unknown> {
  return { code: v.code, description: v.description, kind: v.kind, stageId: v.stageId, uomId: v.uomId, volume: v.volume, unitPrice: v.unitPrice, weightPct: v.weightPct, ...reasonOf(reason) }
}

/**
 * PATCH /api/v1/rap-items/{id} body (RapItemUpdate): only the changed fields — `kind` never (fixed once created).
 * null = nothing changed (no request).
 */
export function patchBody(item: RapItemView, v: RapItemValues, reason = ''): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  if (v.code !== item.code) out.code = v.code
  if (v.description !== item.description) out.description = v.description
  if (v.stageId !== item.stageId) out.stageId = v.stageId
  if (v.uomId !== item.uomId) out.uomId = v.uomId
  if (Math.round(v.volume * 100) !== Math.round(item.volume * 100)) out.volume = v.volume
  if (item.unitPrice !== undefined && v.unitPrice !== (item.unitPrice ?? null)) out.unitPrice = v.unitPrice
  if (v.weightPct !== item.weightPct) out.weightPct = v.weightPct
  if (v.active !== item.active) out.active = v.active
  return Object.keys(out).length === 0 ? null : { ...out, ...reasonOf(reason) }
}

/** The item already carries realisation (expense lines charged to it, or daily-report quantities). */
export const itemUsed = (i: Pick<RapItemView, 'realisedAmount' | 'realised' | 'received' | 'used'>): boolean => (i.realisedAmount ?? 0) > 0 || i.realised > 0 || i.received > 0 || i.used > 0

/** Grand total (footer) of the shown rows: Σ planned value of the ACTIVE priced items; null when none is priced. */
export function rapGrandTotal(items: ReadonlyArray<Pick<RapItemView, 'value' | 'active'>>): number | null {
  const priced = items.filter((i) => i.active && typeof i.value === 'number')
  return priced.length ? priced.reduce((s, i) => s + (i.value as number), 0) : null
}

/** Σ realised money (expense lines from the final approval onward) of the shown rows — price roles only. */
export function rapRealisedTotal(items: ReadonlyArray<Pick<RapItemView, 'realisedAmount'>>): number {
  return items.reduce((s, i) => s + (i.realisedAmount ?? 0), 0)
}
