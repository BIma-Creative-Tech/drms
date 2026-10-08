import type { CollectionConfig, Field } from 'payload'

/** Import-map paths of the boolean list cells (src/admin/components/BoolCell.tsx). */
export const ACTIVE_CELL = '@/admin/components/BoolCell#ActiveCell'
export const YES_NO_CELL = '@/admin/components/BoolCell#YesNoCell'
/** QA-25: read-only server timestamps (src/admin/components/ServerTime*.tsx). */
export const SERVER_TIME_FIELD = '@/admin/components/ServerTimeField#ServerTimeField'
export const SERVER_TIME_CELL = '@/admin/components/ServerTimeCell#ServerTimeCell'

/** A read-only date+time field (server timestamp) → fixed company-TZ text in the form and the list. */
export function isServerTimestamp(field: Field): boolean {
  return field.type === 'date' && field.admin?.readOnly === true && field.admin?.date?.pickerAppearance === 'dayAndTime'
}

function withCell(field: Field): Field {
  if (isServerTimestamp(field) && field.type === 'date') {
    const components = field.admin?.components ?? {}
    return { ...field, admin: { ...field.admin, components: { ...components, Field: components.Field ?? SERVER_TIME_FIELD, Cell: components.Cell ?? SERVER_TIME_CELL } } }
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
 * QA-29: every checkbox of every collection gets the "Aktif/Nonaktif" (field `active`) or "Ya/Tidak"
 * list cell instead of Payload's "benar/salah". QA-25: every read-only date+time field (a server
 * timestamp) is shown as fixed company-TZ text. No React import (config is also loaded by the worker
 * and the OpenAPI generator) — components are import-map paths.
 */
export function withDisplayCells(collections: CollectionConfig[]): CollectionConfig[] {
  return collections.map((c) => ({ ...c, fields: c.fields.map(withCell) }))
}
