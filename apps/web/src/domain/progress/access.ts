import type { PayloadRequest, Where } from 'payload'

import { hasRole, hasRoleAny, userId } from '@/access/roles'
import { companyOf } from '@/domain/companies'
import { resolveScope } from '@/access/scope'

/**
 * Who may do what with progress reports (requirements v1.1 §4 "Laporan progress": Staff —,
 * PM C/R team, Finance R, Direktur (pk-owner) C/R all, Admin C/R all (owner decision 2026-10-09,
 * reverses QA-20(d)/2026-10-08 "Admin read-only"); plan fase1-golive §E4 AC: "PM hanya project
 * timnya, Staff tidak bisa membuat").
 */

/** May the caller CREATE a report for `projectId`? Direktur/Admin: any project; PM: team projects. */
export async function canReportOn(req: PayloadRequest, projectId: number): Promise<boolean> {
  // ADR 0016 §5: Direktur / Admin / PM IN THE PROJECT's PT
  const company = await companyOf(req, 'projects', projectId)
  if (hasRole(req, ['pk-owner', 'pk-admin'], company)) return true
  if (!hasRole(req, 'pk-pm', company)) return false
  return (await resolveScope(req, company ?? null)).teamProjects.includes(projectId)
}

/** Roles that may create reports at all (capability for the APK / web). */
export function mayCreateReports(req: PayloadRequest): boolean {
  return hasRoleAny(req, 'pk-owner', 'pk-admin', 'pk-pm')
}

const CTX_IDS = 'pkVisibleProgressReportIds'

/**
 * Ids of progress reports the caller may read, via the collection read access (overrideAccess:false),
 * cached per request. Used by the photo read access (media-progress-photos owned by a report).
 * `exceptCompanies`: see `visibleRequestIds` (QA-MC4-07).
 */
export async function visibleReportIds(req: PayloadRequest, opts: { exceptCompanies?: readonly number[] } = {}): Promise<number[]> {
  const uid = userId(req)
  if (uid === undefined) return []
  const except = [...new Set(opts.exceptCompanies ?? [])].sort((a, b) => a - b)
  const k = except.join(',')
  const cached = req.context?.[CTX_IDS] as { uid: number; byExcept: Record<string, number[]> } | undefined
  const hit = cached && cached.uid === uid ? cached.byExcept[k] : undefined
  if (hit) return hit
  let ids: number[] = []
  try {
    const res = await req.payload.find({
      collection: 'progress-reports',
      ...(except.length > 0 ? { where: { company: { not_in: except } } } : {}),
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
  req.context[CTX_IDS] = { uid, byExcept: { ...(cached && cached.uid === uid ? cached.byExcept : {}), [k]: ids } }
  return ids
}

/** Read rule for photos owned by a readable report (outside `exceptCompanies`, see above). */
export async function reportPhotoWhere(req: PayloadRequest, opts: { exceptCompanies?: readonly number[] } = {}): Promise<Where | false> {
  const ids = await visibleReportIds(req, opts)
  if (ids.length === 0) return false
  return { and: [{ ownerDocType: { equals: 'progress_report' } }, { ownerDocId: { in: ids.map(String) } }] }
}
