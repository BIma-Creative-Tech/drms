import type { PayloadRequest, Where } from 'payload'

import { hasRole, hasRoleAny, userId } from '@/access/roles'
import { companyOf } from '@/domain/companies'
import { resolveScope } from '@/access/scope'

/**
 * Who may do what with progress reports (requirements v1.1 §4 "Laporan progress": Staff —,
 * PM C/R team, Finance R, Direktur (pk-owner) C/R all, Admin —; plan fase1-golive §E4 AC:
 * "PM hanya project timnya, Staff tidak bisa membuat").
 */

/** May the caller CREATE a report for `projectId`? Direktur: any project; PM: team projects. */
export async function canReportOn(req: PayloadRequest, projectId: number): Promise<boolean> {
  // ADR 0016 §5: Direktur / PM IN THE PROJECT's PT
  const company = await companyOf(req, 'projects', projectId)
  if (hasRole(req, 'pk-owner', company)) return true
  if (!hasRole(req, 'pk-pm', company)) return false
  return (await resolveScope(req, company ?? null)).teamProjects.includes(projectId)
}

/** Roles that may create reports at all (capability for the APK / web). */
export function mayCreateReports(req: PayloadRequest): boolean {
  return hasRoleAny(req, 'pk-owner', 'pk-pm')
}

const CTX_IDS = 'pkVisibleProgressReportIds'

/**
 * Ids of progress reports the caller may read, via the collection read access (overrideAccess:false),
 * cached per request. Used by the photo read access (media-progress-photos owned by a report).
 */
export async function visibleReportIds(req: PayloadRequest): Promise<number[]> {
  const uid = userId(req)
  if (uid === undefined) return []
  const cached = req.context?.[CTX_IDS] as { uid: number; ids: number[] } | undefined
  if (cached && cached.uid === uid) return cached.ids
  let ids: number[] = []
  try {
    const res = await req.payload.find({
      collection: 'progress-reports',
      depth: 0,
      pagination: false,
      select: { docNo: true },
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

/** Read rule for photos owned by a readable report. */
export async function reportPhotoWhere(req: PayloadRequest): Promise<Where | false> {
  const ids = await visibleReportIds(req)
  if (ids.length === 0) return false
  return { and: [{ ownerDocType: { equals: 'progress_report' } }, { ownerDocId: { in: ids.map(String) } }] }
}
