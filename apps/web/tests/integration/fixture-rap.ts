/**
 * DRMS 10/10 D4 (owner 2026-10-11 "RAP wajib untuk semua proyek yang punya RAB"): fixture RAP items of the test
 * projects (filled by flow-world sysCreate) and the request-body helper that charges lines to them. No imports, so
 * both flow-world and helpers (http) can use it.
 */

/** Fixture RAP item per project (sysCreate of a project with a RAB). */
export const fixtureRap = new Map<number, number>()
export const fixtureRapItem = (project: unknown): number | undefined => (typeof project === 'number' ? fixtureRap.get(project) : undefined)

/**
 * D4: lines of a request body without `rapItemId` get the fixture RAP item of the body's project — /api/v1
 * (`projectId`, `lines[].rapItemId`), the collection REST (`project`, `lines[].rapItem`) and sync batch items (`payload.project_id`, `lines[].rap_item_id`). A line that
 * names an item (also null) keeps it; projects without a fixture item are left alone.
 */
export function withFixtureRap<T>(body: T): T {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body
  const b = body as Record<string, unknown>
  const fill = (lines: unknown, project: unknown, key: string) => {
    const item = fixtureRapItem(project)
    if (item === undefined || !Array.isArray(lines)) return lines
    return lines.map((l) => (l && typeof l === 'object' && !(key in (l as object)) ? { ...(l as object), [key]: item } : l))
  }
  let out: Record<string, unknown> = b
  if (Array.isArray(b.lines) && b.projectId !== undefined) out = { ...out, lines: fill(b.lines, b.projectId, 'rapItemId') }
  // Payload REST of the collection (admin form): `project`, `lines[].rapItem`
  else if (Array.isArray(b.lines) && b.project !== undefined) out = { ...out, lines: fill(b.lines, b.project, 'rapItem') }
  if (Array.isArray(b.items)) {
    out = {
      ...out,
      items: b.items.map((it) => {
        const i = it as { payload?: Record<string, unknown> } | null
        const pl = i?.payload
        return pl && Array.isArray(pl.lines) && pl.project_id !== undefined ? { ...i, payload: { ...pl, lines: fill(pl.lines, pl.project_id, 'rap_item_id') } } : it
      }),
    }
  }
  return out as T
}
