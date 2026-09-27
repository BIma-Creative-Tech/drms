import { APIError, type CollectionBeforeOperationHook, type CollectionConfig, type GlobalConfig } from 'payload'

/**
 * E9 B-1 (ASVS G-21): Payload's generic REST create/update sets `req.data` only for a JSON body or
 * a multipart body with `_payload`. A form-urlencoded/text body (or multipart without `_payload`)
 * leaves `data` undefined, and a JSON array/primitive is not a document either — the collection
 * hooks then read `data.project` etc. and throw a TypeError → 500. This guard runs as the FIRST
 * `beforeOperation` hook of every collection and global (before any field hook, access check or
 * DB work) and turns such bodies into a 400 with a clear message.
 *
 * Upload collections may legitimately receive `data` undefined (multipart with only `file`); the
 * media factory then starts from `{}`.
 */
export const BODY_ERROR_MESSAGE =
  'Isi permintaan tidak valid: kirim objek JSON (Content-Type: application/json) atau multipart/form-data dengan field _payload berisi objek JSON.'

const WRITE_OPS = new Set(['create', 'update', 'updateByID'])

/** Pure check (unit-tested): throws a public 400 unless `data` is a plain object (or allowed undefined). */
export function assertDocumentBody(data: unknown, opts: { allowUndefined?: boolean } = {}): void {
  if (data === undefined && opts.allowUndefined) return
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) return
  throw new APIError(BODY_ERROR_MESSAGE, 400, null, true)
}

function collectionGuard(isUpload: boolean): CollectionBeforeOperationHook {
  return ({ args, operation }) => {
    if (!WRITE_OPS.has(operation)) return args
    assertDocumentBody((args as { data?: unknown }).data, { allowUndefined: isUpload })
    return args
  }
}

export function withBodyGuard(collections: CollectionConfig[]): CollectionConfig[] {
  return collections.map((c) => ({
    ...c,
    hooks: { ...c.hooks, beforeOperation: [collectionGuard(Boolean(c.upload)), ...(c.hooks?.beforeOperation ?? [])] },
  }))
}

type GlobalBeforeOperationHook = NonNullable<NonNullable<GlobalConfig['hooks']>['beforeOperation']>[number]

const globalGuard: GlobalBeforeOperationHook = ({ args, operation }) => {
  if (operation === 'update') assertDocumentBody((args as { data?: unknown }).data)
  return args
}

export function withGlobalBodyGuard(globals: GlobalConfig[]): GlobalConfig[] {
  return globals.map((g) => ({ ...g, hooks: { ...g.hooks, beforeOperation: [globalGuard, ...(g.hooks?.beforeOperation ?? [])] } }))
}
