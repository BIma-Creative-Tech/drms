import type { CollectionSlug, PayloadRequest, Where } from 'payload'

import { companiesWithRole, hasRole, relId, rolesIn, userId } from '@/access/roles'
import { resolveScope } from '@/access/scope'
import { companyById, companyOf } from '@/domain/companies'

import { FIELD_REPORT_TYPES, RATE_FIELD_ROLES, type FieldReportType } from './rules'

/**
 * FR1 access rules of the field reports (ADR 0020 §2, requirements v1.3 §4):
 * - CREATE (`canFieldReportOn`): Direktur — every project of the PT; PM — team projects; Staff —
 *   projects they are ASSIGNED to (active team-assignments). Finance/Admin do not report.
 *   This deliberately differs from `canReportOn` of the MANUAL progress reports (domain/progress),
 *   which stays PM/Direktur only (E4 negative tests).
 * - CORRECT (`canCorrectFieldOn`): PM of the project team or Direktur, any time, with a reason.
 * - READ (collection access): Admin/Direktur/Finance all of the PT, PM team projects + own, Staff
 *   assigned projects + own.
 * - Contract rates, billing estimates and aftersales values: Direktur, Finance, Admin
 *   (`RATE_FIELD_ROLES`); an aftersales value also by the reporter who entered it.
 */

export const FIELD_COLLECTIONS: Readonly<Record<FieldReportType, CollectionSlug>> = {
  service_report: 'service-reports',
  unit_timesheet: 'unit-timesheets',
  aftersales_activity: 'aftersales-activities',
}

/** May the caller CREATE field reports for `projectId` (its PT's roles + scope)? Kind/flag checked by the caller. */
export async function canFieldReportOn(req: PayloadRequest, projectId: number): Promise<boolean> {
  const company = await companyOf(req, 'projects', projectId)
  if (company === undefined) return false
  if (hasRole(req, 'pk-owner', company)) return true
  const scope = hasRole(req, ['pk-pm', 'pk-staff'], company) ? await resolveScope(req, company) : null
  if (!scope) return false
  if (hasRole(req, 'pk-pm', company) && scope.teamProjects.includes(projectId)) return true
  return hasRole(req, 'pk-staff', company) && scope.assignedProjects.includes(projectId)
}

/** PM of the project team or Direktur of its PT: corrections after the 24 h window (reason required). */
export async function canCorrectFieldOn(req: PayloadRequest, projectId: number): Promise<boolean> {
  const company = await companyOf(req, 'projects', projectId)
  if (company === undefined) return false
  if (hasRole(req, 'pk-owner', company)) return true
  if (!hasRole(req, 'pk-pm', company)) return false
  return (await resolveScope(req, company)).teamProjects.includes(projectId)
}

/** Contract rates / billing estimates / aftersales values readable in PT `companyId`. */
export function mayReadRates(req: PayloadRequest, companyId: number | null | undefined): boolean {
  return rolesIn(req, companyId).some((r) => RATE_FIELD_ROLES.includes(r))
}

/** Aftersales value of one activity: rate roles of its PT or the reporter who entered it. */
export function mayReadValue(req: PayloadRequest, doc: { company?: unknown; reporter?: unknown }): boolean {
  return mayReadRates(req, relId(doc.company)) || (relId(doc.reporter) !== undefined && relId(doc.reporter) === userId(req))
}

/** Is the field-report feature switched on for PT `companyId` (companies.fieldReportsEnabled, default OFF)? */
export async function fieldReportsEnabled(req: PayloadRequest, companyId: number): Promise<boolean> {
  return (await companyById(req, companyId)).fieldReportsEnabled === true
}

/**
 * Staff may upload field photos (media-progress-photos) only where field reports are on: in a PT
 * where they hold pk-staff and the flag is set (E4: Staff uploads stay 403 everywhere else).
 */
export async function staffMayUploadFieldPhotos(req: PayloadRequest): Promise<boolean> {
  for (const c of companiesWithRole(req, ['pk-staff'], { all: true })) if (await fieldReportsEnabled(req, c)) return true
  return false
}

const CTX_IDS = 'pkVisibleFieldIds'

/** Ids of `type` documents the caller may read (collection access, overrideAccess:false), cached per request. */
export async function visibleFieldIds(req: PayloadRequest, type: FieldReportType, opts: { exceptCompanies?: readonly number[] } = {}): Promise<number[]> {
  const uid = userId(req)
  if (uid === undefined) return []
  const except = [...new Set(opts.exceptCompanies ?? [])].sort((a, b) => a - b)
  const key = `${uid}:${type}:${except.join(',')}`
  req.context ??= {}
  const cache = (req.context[CTX_IDS] ??= {}) as Record<string, number[]>
  if (cache[key]) return cache[key]
  let ids: number[] = []
  try {
    const res = await req.payload.find({
      collection: FIELD_COLLECTIONS[type],
      ...(except.length > 0 ? { where: { company: { not_in: except } } } : {}),
      depth: 0,
      pagination: false,
      select: { project: true } as never,
      user: req.user,
      overrideAccess: false, // the caller's own read scope decides
      req,
    })
    ids = (res.docs as unknown as Array<{ id: number }>).map((d) => d.id)
  } catch (err) {
    if ((err as { status?: number }).status !== 403) throw err
  }
  cache[key] = ids
  return ids
}

/** Read rule for photos owned by readable field reports (list path; QA-MC4-07 `exceptCompanies`). */
export async function fieldPhotoWhere(req: PayloadRequest, opts: { exceptCompanies?: readonly number[] } = {}): Promise<Where | false> {
  const or: Where[] = []
  for (const t of FIELD_REPORT_TYPES) {
    const ids = await visibleFieldIds(req, t, opts)
    if (ids.length > 0) or.push({ and: [{ ownerDocType: { equals: t } }, { ownerDocId: { in: ids.map(String) } }] })
  }
  return or.length === 0 ? false : or.length === 1 ? or[0]! : { or }
}

export const isFieldOwnerType = (t: unknown): t is FieldReportType => typeof t === 'string' && (FIELD_REPORT_TYPES as readonly string[]).includes(t)
