import { APIError, type CollectionBeforeChangeHook, type CollectionBeforeOperationHook, type CollectionConfig, type Field, type PayloadRequest, type Where } from 'payload'

import { hasRoleAny, isGroupAdmin } from '@/access/roles'
import { USER_NAME_VIEW } from '@/fields/users'

import { DELETE_REASON, DELETED_AT, DELETED_BY, INCLUDE_DELETED, IS_DELETED, softDeleteEntry } from './registry'
import { NOT_DELETED, readWhere } from './where'

/**
 * D1610 (ADR 0030): the soft-delete columns and the central "hide deleted rows" rule of every collection in the
 * registry, applied once in payload.config.ts (`withSoftDelete`). No React import — collection configs also load in
 * the worker.
 *
 * - Fields `isDeleted` (flag, true = dihapus), `deletedAt`, `deletedBy`, `deleteReason`: read-only for everyone
 *   (field access create/update false); written ONLY by domain/soft-delete/service.ts (one SQL UPDATE + audit row in
 *   the request transaction). Shown in the form sidebar of a deleted row only.
 * - beforeOperation (find / count / findDistinct): `isDeleted != true` is AND-ed to every list read — admin lists,
 *   relationship pickers, REST `/api/<slug>`, the /api/v1 lists and the APK masters, dashboards that read through
 *   Payload — EXCEPT a lookup of explicit ids (findByID, `where: { id: { in } }`: relationship labels of old
 *   documents, population, the detail page) and an explicit `isDeleted` condition of an Admin / a system read
 *   (the list filter "Tampilkan yang dihapus").
 * - beforeChange: a deleted row cannot be edited (409) until an Admin restores it.
 * - join fields pointing at a soft-delete collection get `isDeleted != true` (the vendor's "Rekening" tab).
 */

/** May the caller see soft-deleted rows when asking for them (Admin of a selected PT, group admin)? */
export function mayShowDeleted(req: Pick<PayloadRequest, 'user'>): boolean {
  return isGroupAdmin(req) || hasRoleAny(req, 'pk-admin')
}

const deletedOnly = (data: unknown) => (data as { isDeleted?: unknown } | undefined)?.isDeleted === true
const never = () => false
const ro = { readOnly: true, position: 'sidebar' as const, disableListColumn: true, condition: deletedOnly }

export function softDeleteFields(): Field[] {
  return [
    {
      name: IS_DELETED,
      type: 'checkbox',
      label: 'Dihapus',
      defaultValue: false,
      index: true,
      access: { create: never, update: never },
      admin: { ...ro, description: 'Data ini dihapus (soft delete): tidak tampil di daftar dan pemilih. Admin dapat memulihkannya.' },
    },
    { name: DELETED_AT, type: 'date', label: 'Dihapus pada', access: { create: never, update: never }, admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
    { name: DELETED_BY, type: 'relationship', relationTo: 'users', label: 'Dihapus oleh', access: { create: never, update: never }, admin: { ...ro, components: USER_NAME_VIEW } },
    { name: DELETE_REASON, type: 'text', label: 'Alasan hapus', maxLength: 1000, access: { create: never, update: never }, admin: ro },
  ]
}

/** The central read rule (see the module comment). */
export const hideDeleted: CollectionBeforeOperationHook = ({ args, operation, overrideAccess, req }) => {
  if (operation !== 'read' && operation !== 'count' && operation !== 'readDistinct') return args
  const a = args as { id?: unknown; where?: Where }
  const next = readWhere(a.where, {
    byId: operation === 'read' && a.id !== undefined && a.id !== null,
    mayIncludeDeleted: overrideAccess === true || req.context?.[INCLUDE_DELETED] === true || mayShowDeleted(req),
  })
  return next === null ? args : ({ ...args, where: next } as typeof args)
}

/** A deleted row is frozen until it is restored (the restore itself is an SQL update, not a Payload one). */
export const deletedRowGuard: CollectionBeforeChangeHook = ({ data, operation, originalDoc }) => {
  if (operation === 'update' && deletedOnly(originalDoc)) {
    throw new APIError('Data ini sudah dihapus. Admin perlu memulihkannya ("Pulihkan") sebelum data dapat diubah.', 409, null, true)
  }
  return data
}

function withJoinFilter(fields: Field[]): Field[] {
  return fields.map((f) => {
    if (f.type === 'join') {
      const targets = Array.isArray(f.collection) ? f.collection : [f.collection]
      if (!targets.some((t) => softDeleteEntry(t))) return f
      return { ...f, where: f.where ? { and: [f.where, NOT_DELETED] } : NOT_DELETED }
    }
    if (f.type === 'row' || f.type === 'collapsible') return { ...f, fields: withJoinFilter(f.fields) }
    if (f.type === 'tabs') return { ...f, tabs: f.tabs.map((t) => ({ ...t, fields: withJoinFilter(t.fields) })) }
    return f
  })
}

/** Adds the fields + hooks to the registry's collections and the join filter to every collection. Idempotent. */
export function withSoftDelete(collections: CollectionConfig[]): CollectionConfig[] {
  return collections.map((c) => {
    const joined = { ...c, fields: withJoinFilter(c.fields) }
    if (!softDeleteEntry(c.slug) || c.fields.some((f) => 'name' in f && f.name === IS_DELETED)) return joined
    return {
      ...joined,
      fields: [...joined.fields, ...softDeleteFields()],
      hooks: {
        ...c.hooks,
        beforeOperation: [...(c.hooks?.beforeOperation ?? []), hideDeleted],
        beforeChange: [deletedRowGuard, ...(c.hooks?.beforeChange ?? [])],
      },
    }
  })
}
