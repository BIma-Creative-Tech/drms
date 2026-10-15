import type { Where } from 'payload'

import { IS_DELETED } from './registry'

/**
 * D1610 (ADR 0030): the `where` rules of the central "hide soft-deleted rows" hook (collection.ts). Pure (unit-tested).
 */

/** Rows that are not soft-deleted. `not_equals` matches NULL too (@payloadcms/drizzle: `IS NULL OR <> true`). */
export const NOT_DELETED: Where = { [IS_DELETED]: { not_equals: true } }

/** Only soft-deleted rows. */
export const ONLY_DELETED: Where = { [IS_DELETED]: { equals: true } }

/** Every row, deleted or not — an explicit `isDeleted` condition, so the hook keeps both (Admin "Tampilkan yang dihapus"). */
export const WITH_DELETED: Where = { or: [{ [IS_DELETED]: { equals: true } }, { [IS_DELETED]: { not_equals: true } }] }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Does the where name `field` anywhere (top level, inside and / or, any depth)? */
export function mentionsField(where: unknown, field: string): boolean {
  if (Array.isArray(where)) return where.some((w) => mentionsField(w, field))
  if (!isObj(where)) return false
  return Object.entries(where).some(([k, v]) => k === field || ((k === 'and' || k === 'or') && mentionsField(v, field)))
}

const idCondition = (v: unknown): boolean => isObj(v) && ('equals' in v || 'in' in v) && Object.keys(v).every((op) => op === 'equals' || op === 'in')

/**
 * A lookup of explicit ids: `{ id: { equals | in } }` at the top level or as one conjunct of a top-level `and`
 * (Payload's relationship population / dataloader `where: { id: { in } }`, the admin's relationship labels and
 * selected-value lookups, relationship validation). Such reads keep returning a soft-deleted row: an old document
 * that points at a deleted vendor still shows the vendor's name. Lists, pickers and searches never match this.
 */
export function isIdLookup(where: unknown): boolean {
  if (!isObj(where)) return false
  if (idCondition(where.id)) return true
  return Array.isArray(where.and) && where.and.some((w) => isObj(w) && idCondition(w.id))
}

/** `where` AND not deleted (an empty / missing where → just the condition). */
export function andNotDeleted(where: Where | undefined | null): Where {
  if (!where || Object.keys(where).length === 0) return NOT_DELETED
  return { and: [where, NOT_DELETED] }
}

/**
 * The where a read runs with. `mayIncludeDeleted`: the caller may see deleted rows (an Admin, a system read, or
 * a server-side read that opted in) — then an explicit `isDeleted` condition is kept as it is. Anything else
 * gets `isDeleted != true` AND-ed (a non-Admin `where[isDeleted][equals]=true` therefore finds nothing).
 * `null` = leave the where unchanged.
 */
export function readWhere(where: Where | undefined | null, opts: { byId: boolean; mayIncludeDeleted: boolean }): Where | null {
  if (opts.byId || isIdLookup(where)) return null
  if (opts.mayIncludeDeleted && mentionsField(where, IS_DELETED)) return null
  return andNotDeleted(where)
}
