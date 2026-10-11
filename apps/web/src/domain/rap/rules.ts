import { round2 } from '@/domain/field/rules'

/**
 * P3 (ADR 0020, owner decisions 2026-10-09/10): RAP (rencana anggaran pelaksanaan) of a construction
 * project — work items (`pekerjaan`, they drive the stage progress) and material items (`material`,
 * received / used / stock, never counted in %). Pure module: no Payload, no DB.
 */
export const RAP_KINDS = ['pekerjaan', 'material'] as const
export type RapKind = (typeof RAP_KINDS)[number]
export const RAP_KIND_LABELS: Record<RapKind, string> = { pekerjaan: 'Pekerjaan', material: 'Material' }

export const LINE_KINDS = ['work', 'material_in', 'material_used'] as const
export type LineKind = (typeof LINE_KINDS)[number]
export const LINE_KIND_LABELS: Record<LineKind, string> = { work: 'Volume pekerjaan', material_in: 'Material masuk', material_used: 'Material terpakai' }

/** Origin of a ledger line: the report itself, an edit by the reporter (24 h), a correction (PM/Direktur), a system recompute. */
export const LINE_ORIGINS = ['report', 'edit', 'correction'] as const
export type LineOrigin = (typeof LINE_ORIGINS)[number]

export const STAGE_PROGRESS_MODES = ['manual', 'rap'] as const
export type StageProgressMode = (typeof STAGE_PROGRESS_MODES)[number]

export const RESOURCE_KINDS = ['tenaga', 'alat'] as const
export type ResourceKind = (typeof RESOURCE_KINDS)[number]
export const RESOURCE_KIND_LABELS: Record<ResourceKind, string> = { tenaga: 'Tenaga kerja', alat: 'Alat' }

/** Seeded per PT (company-defaults + migration); configurable afterwards. */
export const DEFAULT_RESOURCE_TYPES: ReadonlyArray<{ kind: ResourceKind; code: string; name: string }> = [
  { kind: 'tenaga', code: 'MANDOR', name: 'Mandor' },
  { kind: 'tenaga', code: 'TK-BATU', name: 'Tukang batu' },
  { kind: 'tenaga', code: 'TK-BESI', name: 'Tukang besi' },
  { kind: 'tenaga', code: 'TK-KAYU', name: 'Tukang kayu' },
  { kind: 'tenaga', code: 'KENEK', name: 'Kenek / pekerja' },
  { kind: 'tenaga', code: 'OPERATOR', name: 'Operator alat' },
  { kind: 'alat', code: 'EXCAVATOR', name: 'Excavator' },
  { kind: 'alat', code: 'MOLEN', name: 'Molen / mixer' },
  { kind: 'alat', code: 'VIBRATOR', name: 'Vibrator beton' },
  { kind: 'alat', code: 'DUMP-TRUCK', name: 'Dump truck' },
]

export { round2 }

export const MAX_QTY = 100_000_000

/** A positive quantity with ≤ 2 decimals. */
export function isQty(v: unknown, max = MAX_QTY): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max && Math.abs(round2(v) - v) < 1e-9
}

/** A non-negative quantity with ≤ 2 decimals (report values: 0 = nothing that day). */
export function isQty0(v: unknown, max = MAX_QTY): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max && Math.abs(round2(v) - v) < 1e-9
}

/** Item progress 0…100: min(realised / planned, 1). Over-RAP volume is capped (flag MELEBIHI_RAP). */
export function itemPct(realised: number, planned: number): number {
  if (!(planned > 0)) return 0
  return round2(Math.min(Math.max(realised, 0) / planned, 1) * 100)
}

export type WorkItem = { volume: number; realised: number; unitPrice: number | null; active: boolean }

/**
 * Stage % from its ACTIVE work items: weighted by value (volume × price) when every item is priced
 * (value > 0), else every item counts equally (`basis: 'equal'` → admin warning).
 */
export function stagePct(items: readonly WorkItem[]): { pct: number; basis: 'value' | 'equal' | 'none' } {
  const work = items.filter((i) => i.active && i.volume > 0)
  if (work.length === 0) return { pct: 0, basis: 'none' }
  const priced = work.every((i) => typeof i.unitPrice === 'number' && i.unitPrice > 0)
  if (priced) {
    const total = work.reduce((s, i) => s + i.volume * (i.unitPrice as number), 0)
    const done = work.reduce((s, i) => s + (itemPct(i.realised, i.volume) / 100) * i.volume * (i.unitPrice as number), 0)
    return { pct: round2((done / total) * 100), basis: 'value' }
  }
  return { pct: round2(work.reduce((s, i) => s + itemPct(i.realised, i.volume), 0) / work.length), basis: 'equal' }
}

/** Material stock of an item = received − used (may be negative: used more than recorded as received). */
export const stockOf = (received: number, used: number): number => round2(received - used)

/** Uom aliases accepted in the RAP Excel ("m³" → M3 …), matched case-insensitively after this map. */
export const UOM_ALIASES: Readonly<Record<string, string>> = {
  'M³': 'M3', 'M^3': 'M3', 'M²': 'M2', 'M^2': 'M2', 'M¹': 'M1', 'M\'': 'M1', 'MTR': 'M', 'METER': 'M', 'KILOGRAM': 'KG', 'BATANG': 'BTG', 'LEMBAR': 'LBR', 'BUAH': 'BH', 'LITER': 'LTR', 'ORANG HARI': 'OH',
}

export function normUom(raw: string): string {
  const u = raw.trim().toUpperCase().replace(/\s+/g, ' ')
  return UOM_ALIASES[u] ?? u.replace(/\s/g, '')
}
