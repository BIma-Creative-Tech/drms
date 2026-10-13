import type { CollectionConfig, Field } from 'payload'

import { RUPIAH_MARK } from '@/fields/common'

/** Import-map paths of the boolean list cells (src/admin/components/BoolCell.tsx). */
export const ACTIVE_CELL = '@/admin/components/BoolCell#ActiveCell'
export const YES_NO_CELL = '@/admin/components/BoolCell#YesNoCell'
/** QA-25: read-only server timestamps (src/admin/components/ServerTime*.tsx). */
export const SERVER_TIME_FIELD = '@/admin/components/ServerTimeField#ServerTimeField'
export const SERVER_TIME_CELL = '@/admin/components/ServerTimeCell#ServerTimeCell'
/** Rupiah amounts in lists (src/admin/components/RupiahCell.tsx). */
export const RUPIAH_CELL = '@/admin/components/RupiahCell#RupiahCell'
/** DRMS 13/10 #10: other numbers (counts, quantities, hours) with id-ID separators (same module). */
export const NUMBER_CELL = '@/admin/components/RupiahCell#NumberCell'

/** Coordinates keep Payload's raw cell (no thousands grouping / rounding of 6-decimal degrees). */
const RAW_NUMBERS = new Set(['lat', 'lng'])

/**
 * A Rupiah amount (DRMS 13/10 #10): number field carrying the RUPIAH_MARK of rupiahField() in its
 * server-only `custom`, or (older convention) whose label ends with "(Rp)".
 */
export function isRupiahField(field: Field): boolean {
  if (field.type !== 'number') return false
  if ((field.custom as Record<string, unknown> | undefined)?.pkRupiah === RUPIAH_MARK.pkRupiah) return true
  return typeof field.label === 'string' && /\(Rp\)\s*$/.test(field.label)
}

/** Any other number field shown in a list: thousands '.', decimals ','. */
export function isPlainNumberField(field: Field): boolean {
  return field.type === 'number' && !isRupiahField(field) && !RAW_NUMBERS.has(field.name)
}

/** A read-only date+time field (server timestamp) → fixed company-TZ text in the form and the list. */
export function isServerTimestamp(field: Field): boolean {
  return field.type === 'date' && field.admin?.readOnly === true && field.admin?.date?.pickerAppearance === 'dayAndTime'
}

function withCell(field: Field): Field {
  if (isServerTimestamp(field) && field.type === 'date') {
    const components = field.admin?.components ?? {}
    return { ...field, admin: { ...field.admin, components: { ...components, Field: components.Field ?? SERVER_TIME_FIELD, Cell: components.Cell ?? SERVER_TIME_CELL } } }
  }
  if (isRupiahField(field) && field.type === 'number') {
    if (field.admin?.components?.Cell) return field
    return { ...field, admin: { ...field.admin, components: { ...field.admin?.components, Cell: RUPIAH_CELL } } }
  }
  if (isPlainNumberField(field) && field.type === 'number') {
    if (field.admin?.components?.Cell) return field
    return { ...field, admin: { ...field.admin, components: { ...field.admin?.components, Cell: NUMBER_CELL } } }
  }
  if (field.type === 'checkbox') {
    if (field.admin?.components?.Cell) return field
    return { ...field, admin: { ...field.admin, components: { ...field.admin?.components, Cell: field.name === 'active' ? ACTIVE_CELL : YES_NO_CELL } } }
  }
  if (field.type === 'row' || field.type === 'collapsible') return { ...field, fields: field.fields.map(withCell) }
  if (field.type === 'tabs') return { ...field, tabs: field.tabs.map((t) => ({ ...t, fields: t.fields.map(withCell) })) }
  return field
}

/**
 * Every Rupiah amount (rupiahField marker or "… (Rp)" label) is shown as "Rp 1.250.000" in the list,
 * every other number with id-ID separators ("1.250", "12,5"; DRMS 13/10 #10).
 * QA-29: every checkbox of every collection gets the "Aktif/Nonaktif" (field `active`) or "Ya/Tidak"
 * list cell instead of Payload's "benar/salah". QA-25: every read-only date+time field (a server
 * timestamp) is shown as fixed company-TZ text. No React import (config is also loaded by the worker
 * and the OpenAPI generator) — components are import-map paths.
 */
export function withDisplayCells(collections: CollectionConfig[]): CollectionConfig[] {
  return collections.map((c) => ({ ...c, fields: c.fields.map(withCell) }))
}
