import { APIError, type CollectionBeforeOperationHook, type CollectionSlug, type FlattenedField, type PayloadRequest } from 'payload'

import { relId } from './roles'

/** Fields never compared (system columns, the virtual reason, the immutable PT). */
const SKIP = new Set(['id', 'createdAt', 'updatedAt', 'changeReason', 'company', 'uuid'])

function norm(field: FlattenedField, v: unknown): unknown {
  if (v === undefined || v === '' || v === null) return null
  if (field.type === 'relationship' || field.type === 'upload') return Array.isArray(v) ? v.map((x) => relId(x) ?? x) : (relId(v) ?? v)
  if (field.type === 'date') {
    const t = new Date(String(v)).getTime()
    return Number.isNaN(t) ? v : t
  }
  if (field.type === 'number') return typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : v
  return v
}

const labelOf = (f: FlattenedField): string => (typeof (f as { label?: unknown }).label === 'string' ? ((f as { label: string }).label as string) : f.name)

/** Names of top-level data fields whose value in `data` differs from `current`. */
export function changedFields(fields: readonly FlattenedField[], data: Record<string, unknown>, current: Record<string, unknown>): FlattenedField[] {
  return fields.filter((f) => {
    if (SKIP.has(f.name) || !(f.name in data) || ('virtual' in f && f.virtual)) return false
    return JSON.stringify(norm(f, data[f.name])) !== JSON.stringify(norm(f, current[f.name]))
  })
}

/**
 * QA-20(b): a caller who may READ a document but not change it gets a 403 that NAMES the fields
 * instead of Payload's silent drop of field-level-denied values (200, nothing saved) or a bare 403.
 * beforeOperation (update by id): runs before collection access, sees the raw body. Callers who cannot
 * read the document get the normal answer (404 / 403, no existence leak); an unchanged body passes on
 * to the normal access check. `mayEdit` = the roles allowed to change the document in its PT.
 */
export function readOnlyFieldsGuard(collection: CollectionSlug, mayEdit: (req: PayloadRequest, company: number | undefined) => boolean, who: string): CollectionBeforeOperationHook {
  return async ({ args, operation, overrideAccess, req }) => {
    if (operation !== 'update' || overrideAccess || !req.user) return args
    const a = args as { id?: number | string; data?: Record<string, unknown> }
    if (a.id === undefined || !a.data || typeof a.data !== 'object') return args
    const current = (await req.payload.findByID({ collection, id: a.id, depth: 0, overrideAccess: true /* SYSTEM-READ: diff of the request body, visibility checked below */, req, disableErrors: true })) as Record<string, unknown> | null
    if (!current) return args
    if (mayEdit(req, relId(current.company))) return args
    const visible = await req.payload.find({ collection, where: { id: { equals: current.id as number } }, limit: 1, depth: 0, pagination: false, overrideAccess: false, user: req.user, req })
    if (visible.docs.length === 0) return args
    const changed = changedFields(req.payload.collections[collection].config.flattenedFields, a.data, current)
    if (changed.length === 0) return args
    const message = `Hanya ${who} yang dapat mengubah isian ini.`
    throw new APIError(`Anda tidak berhak mengubah: ${changed.map(labelOf).join(', ')}. ${message}`, 403, { errors: changed.map((f) => ({ path: f.name, message })) }, true)
  }
}
