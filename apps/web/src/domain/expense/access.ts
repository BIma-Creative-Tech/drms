import type { Access, PayloadRequest, Where } from 'payload'

import { companiesWithRole, relId, userId } from '@/access/roles'
import { anyOf, byRole, type Rule } from '@/access/policies'
import { inIds } from '@/access/scope'
import { writeAuditDetached } from '@/audit/writer'

/**
 * Read scopes for T1 and its satellites (requirements v1.1 §4 "Pengajuan dana", architecture §7.2):
 * - own  = the caller's employee is one of "Diajukan Oleh", or the caller is "Dibuat Oleh";
 * - team = PM: requests of team projects / team cost centers;
 * - Q-23 default: employees ASSIGNED to a cost center also see its requests;
 * - Finance / Owner / Admin: all.
 */
const ownRequest: Rule = async ({ req, scope }) => {
  const s = await scope()
  const or: Where[] = []
  const uid = userId(req)
  if (uid !== undefined) or.push({ createdBy: { equals: uid } })
  if (s.employeeId !== null) or.push({ requesters: { in: [s.employeeId] } })
  return or.length === 0 ? false : or.length === 1 ? (or[0] as Where) : { or }
}

const teamRequests: Rule = async ({ scope }) => {
  const s = await scope()
  const or = [inIds('project', s.teamProjects), inIds('costCenter', s.teamCostCenters)].filter((w): w is Where => w !== false)
  return or.length === 0 ? false : or.length === 1 ? (or[0] as Where) : { or }
}

/** Q-23 (usulan default): assigned staff see the requests of their cost centers. */
const assignedCostCenterRequests: Rule = async ({ scope }) => inIds('costCenter', (await scope()).assignedCostCenters)

export const requestReadAccess: Access = byRole({
  'pk-admin': true,
  'pk-owner': true,
  'pk-finance': true,
  'pk-pm': anyOf(ownRequest, teamRequests),
  'pk-staff': anyOf(ownRequest, assignedCostCenterRequests),
})

/**
 * Content-editable requests (Draft; Reimburse "Revisi Nota" — lines only, enforced by the hook) are
 * editable by their creator/requesters only (G8, US-04).
 */
export const requestUpdateAccess: Access = async (args) => {
  const own = await byRole({ 'pk-staff': ownRequest, 'pk-pm': ownRequest, 'pk-admin': ownRequest, 'pk-finance': ownRequest })(args)
  if (own === false) return false
  const draft: Where = { status: { in: ['draft', 'receipt_revision'] } }
  return own === true ? draft : { and: [draft, own] }
}

const CTX_IDS = 'pkVisibleRequestIds'

/**
 * Ids of requests the caller may read, via the collection's own read access (overrideAccess:false),
 * cached per request. Used by satellites (approvals, receipts, flags, transfers, snapshots, media).
 */
export async function visibleRequestIds(req: PayloadRequest): Promise<number[]> {
  const cached = req.context?.[CTX_IDS] as { uid: number; ids: number[] } | undefined
  const uid = userId(req)
  if (uid === undefined) return []
  if (cached && cached.uid === uid) return cached.ids
  let ids: number[] = []
  try {
    const res = await req.payload.find({
      collection: 'expense-requests',
      depth: 0,
      pagination: false,
      select: { status: true },
      user: req.user,
      overrideAccess: false, // the caller's own read scope
      req,
    })
    ids = res.docs.map((d) => d.id as number)
  } catch (err) {
    if ((err as { status?: number }).status !== 403) throw err
  }
  req.context[CTX_IDS] = { uid, ids }
  return ids
}

/**
 * Satellite read access (ADR 0016 §5): office roles see every row OF THE PTs where they hold the
 * role (satellites carry `company`, derived from the request); everyone else only rows of visible
 * requests.
 */
export function byVisibleRequest(field = 'request'): Access {
  return async ({ req }) => {
    if (!req.user) return false
    const office = companiesWithRole(req, ['pk-finance', 'pk-owner', 'pk-admin'])
    const own = inIds(field, await visibleRequestIds(req))
    const all: Where | false = office.length > 0 ? { company: { in: office } } : false
    const or = [all, own].filter((w): w is Where => w !== false)
    return or.length === 0 ? false : or.length === 1 ? (or[0] as Where) : { or }
  }
}

/**
 * G4 + architecture §7.4: delete is never allowed; a real HTTP DELETE attempt is recorded as
 * `delete_attempt` in its OWN transaction (the failing operation rolls back). Only HTTP DELETE
 * requests are logged — the admin UI evaluates delete permission on every document view (GET).
 */
export function denyDeleteLogged(docType: string): Access {
  return async ({ req, id }) => {
    if (req.method?.toUpperCase() === 'DELETE' && req.user) {
      await writeAuditDetached(req, [{ action: 'delete_attempt', docType, docId: id === undefined ? undefined : String(id), reason: 'hard delete ditolak (G4)' }])
    }
    return false
  }
}

/** Relationship value → id or null (helper for hooks). */
export const idOrNull = (v: unknown): number | null => relId(v) ?? null
