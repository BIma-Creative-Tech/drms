import type { Where } from 'payload'

/**
 * DRMS 10/10 D8: Payload `where` for a free-text search — every whitespace-separated token (max 5)
 * must occur (`like` = case-insensitive contains) in one of `fields`. null when there is nothing to
 * search. Used by the admin list toolbars and the `q` param of the /api/v1 list endpoints.
 */
export function searchWhere(fields: readonly string[], q: string | null | undefined): Where | null {
  const tokens = (q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 5)
  if (!tokens.length || !fields.length) return null
  return { and: tokens.map((t) => ({ or: fields.map((f) => ({ [f]: { like: t } })) })) }
}
