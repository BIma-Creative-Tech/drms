import type { PayloadRequest } from 'payload'

import { hasRole, userId } from '@/access/roles'
import { resolveScope } from '@/access/scope'

/**
 * Who may do what with budget addenda (requirements v1.1 §4 "Addendum RAB": Staff —, PM C team,
 * Finance R, Direktur A (ADR 0013: + Finance approval), Admin —).
 */

/** PM of the project's team (pk-pm + team scope) — the only creator/submitter (US-18). */
export async function isTeamPm(req: PayloadRequest, projectId: number): Promise<boolean> {
  if (!hasRole(req, 'pk-pm')) return false
  return (await resolveScope(req)).teamProjects.includes(projectId)
}

/** Roles that can read addenda at all (Admin/Staff get an empty list, never a 403 inside a transaction). */
export function mayReadAddenda(req: PayloadRequest): boolean {
  return hasRole(req, 'pk-owner', 'pk-finance', 'pk-pm')
}

const CTX_IDS = 'pkVisibleAddendumIds'

/** Ids of addenda the caller may read (collection read access), cached per request (approvals read access). */
export async function visibleAddendumIds(req: PayloadRequest): Promise<number[]> {
  const uid = userId(req)
  if (uid === undefined || !mayReadAddenda(req)) return []
  const cached = req.context?.[CTX_IDS] as { uid: number; ids: number[] } | undefined
  if (cached && cached.uid === uid) return cached.ids
  let ids: number[] = []
  try {
    const res = await req.payload.find({
      collection: 'budget-addenda',
      depth: 0,
      pagination: false,
      select: { status: true },
      user: req.user,
      overrideAccess: false, // the caller's own read scope decides
      req,
    })
    ids = res.docs.map((d) => d.id as number)
  } catch (err) {
    if ((err as { status?: number }).status !== 403) throw err
  }
  req.context[CTX_IDS] = { uid, ids }
  return ids
}
