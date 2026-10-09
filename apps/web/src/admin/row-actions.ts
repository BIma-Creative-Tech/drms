import type { CollectionConfig } from 'payload'

import type { IconName } from './modules/icons'

/**
 * Row action column "Aksi" on the Payload list view of EVERY collection: an explicit button per row
 * ("Ubah" / "Buka" / "Lihat", src/admin/components/RowActionsCell.tsx) instead of only the linked
 * first column, which reads as plain text and was the sole way to open a record. Applied once in
 * payload.config.ts, so a new collection gets it automatically. The column is presentational
 * (`ui` field: no DB column, no API value, not sortable) and is appended LAST to `defaultColumns`;
 * saved column preferences that predate it get it appended once by migration
 * `20261009_120000_list_row_actions_column`. Plain data (import-map path); no React import —
 * collection configs also load in the worker.
 */
export const ROW_ACTIONS_FIELD = 'rowActions'
export const ROW_ACTIONS_CELL = '@/admin/components/RowActionsCell#RowActionsCell'

export function withRowActions(collections: CollectionConfig[]): CollectionConfig[] {
  return collections.map((c) => {
    if (c.fields.some((f) => 'name' in f && f.name === ROW_ACTIONS_FIELD)) return c
    const admin = c.admin ?? {}
    const cols = admin.defaultColumns
    return {
      ...c,
      fields: [
        ...c.fields,
        { name: ROW_ACTIONS_FIELD, type: 'ui', label: 'Aksi', admin: { disableListColumn: false, components: { Cell: ROW_ACTIONS_CELL } } },
      ],
      admin: { ...admin, ...(cols ? { defaultColumns: cols.includes(ROW_ACTIONS_FIELD) ? cols : [...cols, ROW_ACTIONS_FIELD] } : {}) },
    }
  })
}

/**
 * Collections whose records are workflow documents: never edited through the Payload form (update is
 * denied), but their detail page carries the actions (approve, transfer, settle, …) → "Buka".
 */
export const DOCUMENT_COLLECTIONS: ReadonlySet<string> = new Set([
  'expense-requests', 'cash-entries', 'transfers', 'settlements', 'receipts', 'budget-addenda', 'progress-reports',
  'attendances', 'attendance-corrections', 'period-closings',
])

export type RowAction = { kind: 'edit' | 'open' | 'view'; label: 'Ubah' | 'Buka' | 'Lihat'; icon: IconName }

type Where = Record<string, unknown>
const idOf = (v: unknown): unknown => (v && typeof v === 'object' && 'id' in v ? (v as { id: unknown }).id : v)
const same = (a: unknown, b: unknown) => String(idOf(a)) === String(idOf(b))

/**
 * Does a list row satisfy an access `where` (the shape Payload sends to the client as
 * `{ permission: true, where }`)? Supports and/or plus equals / not_equals / in / not_in on top-level
 * fields (relationships as id or populated doc) — what src/access/policies.ts produces. Anything else
 * → false, so the button falls back to "Buka"/"Lihat" (never claims an edit the server would refuse).
 */
export function whereMatches(where: unknown, row: Record<string, unknown>): boolean {
  if (!where || typeof where !== 'object') return false
  return Object.entries(where as Where).every(([key, cond]) => {
    if (key === 'and') return Array.isArray(cond) && cond.every((w) => whereMatches(w, row))
    if (key === 'or') return Array.isArray(cond) && cond.some((w) => whereMatches(w, row))
    if (!cond || typeof cond !== 'object' || !(key in row)) return false
    const v = row[key]
    return Object.entries(cond as Where).every(([op, x]) => {
      if (op === 'equals') return same(v, x)
      if (op === 'not_equals') return !same(v, x)
      if (op === 'in') return Array.isArray(x) && x.some((y) => same(v, y))
      if (op === 'not_in') return Array.isArray(x) && !x.some((y) => same(v, y))
      return false
    })
  })
}

/** Client-side collection permission (`true`, or `{ permission, where }`) applied to one row. */
export function canOnRow(perm: unknown, row: Record<string, unknown>): boolean {
  if (perm === true) return true
  if (!perm || typeof perm !== 'object' || (perm as { permission?: unknown }).permission !== true) return false
  const where = (perm as { where?: unknown }).where
  return where === undefined || whereMatches(where, row)
}

/** "Ubah" when the user may update the collection, "Buka" for workflow documents, otherwise "Lihat". */
export function rowActionOf(collectionSlug: string, canUpdate: boolean): RowAction {
  if (canUpdate) return { kind: 'edit', label: 'Ubah', icon: 'edit' }
  if (DOCUMENT_COLLECTIONS.has(collectionSlug)) return { kind: 'open', label: 'Buka', icon: 'document' }
  return { kind: 'view', label: 'Lihat', icon: 'eye' }
}
