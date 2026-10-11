import type { PayloadRequest } from 'payload'

import { companyContextOf, membershipsOf, userRoles, type Membership, type Role } from '@/access/roles'
import { appSettings, companyById, settings } from '@/domain/companies'
import { privacyStatusOf } from '@/legal/privacy-notice'
import { DEFAULT_TZ } from '@/lib/time'

import { json, v1 } from '../http'

type UserShape = {
  id: number
  email: string
  name?: string | null
  privacyAckVersion?: number | null
  privacyAckAt?: string | null
  _strategy?: 'oidcSession' | 'mobileBearer'
  _pkDevice?: { id: number; deviceId: string }
}

/**
 * APK UI hints from a role set (ADR 0013 E1 / E4) — the same rule for the legacy top-level object
 * (roles of the selected PTs) and for each PT in `companies[]` (roles IN that PT). Decisions
 * (approval inbox) = Direktur (pk-owner) or Finance; the PM monitors the team list; progress
 * reports are created by the PM (team projects) or the Direktur. ADR 0021: the PM approves its project's
 * requests first, so the approval inbox is offered to the PM too. The server guards stay authoritative.
 */
export function capabilitiesOf(roles: readonly Role[], opts: { fieldReportsEnabled?: boolean } = {}) {
  // FR1 (ADR 0020 §2): Staff (assigned projects), PM (team) and Direktur report in the field when the
  // PT's flag is on; WHICH report a project offers follows its kind (projects.kind, masters/units).
  const field = opts.fieldReportsEnabled === true && roles.some((r) => r === 'pk-staff' || r === 'pk-pm' || r === 'pk-owner')
  return {
    // ADR 0021: the PM project approves first ("Persetujuan PM") — the inbox lists only its own steps
    approvalInbox: roles.some((r) => r === 'pk-owner' || r === 'pk-finance' || r === 'pk-pm'),
    teamMonitor: roles.includes('pk-pm'),
    progressReportCreate: roles.some((r) => r === 'pk-pm' || r === 'pk-owner' || r === 'pk-admin'),
    serviceReportCreate: field,
    unitTimesheetCreate: field,
    aftersalesActivityCreate: field,
    // P3: Laporan harian on projects of kind konstruksi
    dailyReportCreate: field,
  }
}

/**
 * PT of the DEPRECATED single-PT fields of /me (`employee`, `settings`) — MC3-1 compatibility rule
 * for the released APK (mobile-v0.2.0): the first SELECTED membership (ascending PT id) that has an
 * employee, else the first selected membership, else null. With exactly one PT this is that PT
 * (identical to the pre-MC3 answer); with several PTs it is the lowest-id selected PT with an
 * employee (= DRMS for users of the DRMS migration) — the PT whose employee `req.user.employee`
 * already named. Never a PT outside the caller's memberships.
 */
export function legacyCompanyOf(selected: readonly Membership[]): number | null {
  const sorted = [...selected].sort((a, b) => a.company - b.company)
  return (sorted.find((m) => m.employee !== null) ?? sorted[0])?.company ?? null
}

type EmployeeRef = { id: number; code: string; name: string }

async function employeeRefs(req: PayloadRequest, ids: number[]): Promise<Map<number, EmployeeRef>> {
  const out = new Map<number, EmployeeRef>()
  if (ids.length === 0) return out
  const res = await req.payload.find({
    collection: 'employees',
    where: { id: { in: ids } },
    depth: 0,
    pagination: false,
    select: { code: true, name: true },
    overrideAccess: true, // SYSTEM-READ: the caller's OWN membership employees (ids from the auth context)
    req,
  })
  for (const e of res.docs as unknown as EmployeeRef[]) out.set(e.id, { id: e.id, code: e.code, name: e.name })
  return out
}

/**
 * GET /api/v1/me — profile + company context (ADR 0016 §8, MC3-1).
 * - `companies[]`: EVERY active membership (active PT) of the caller, ascending id, with the roles,
 *   employee, capabilities and APK-relevant settings OF THAT PT, and `selected` (= in the request's
 *   effective selection). `activeCompanyIds` = that selection (`X-Company-Ids` / cookie ∩
 *   memberships; default all). `appSettings` = app-wide values (one APK for all PTs).
 * - Deprecated (kept for mobile-v0.2.0): `roles` / `capabilities` = union over the SELECTED PTs
 *   (unchanged), `employee` / `settings` = the PT `legacyCompanyId` (see legacyCompanyOf).
 * - `privacy` (ADR 0018): current privacy-notice version + the caller's acknowledgement (version, time).
 */
export const meEndpoint = v1({
  path: '/me',
  method: 'get',
  handler: async ({ req }) => {
    const u = req.user as unknown as UserShape
    const ctx = companyContextOf(req.user)
    const all = [...(ctx?.memberships ?? [])].sort((a, b) => a.company - b.company)
    const selected = membershipsOf(req.user)
    const activeCompanyIds = selected.map((m) => m.company).sort((a, b) => a - b)
    const legacyCompanyId = legacyCompanyOf(selected)
    const employees = await employeeRefs(req, [...new Set(all.map((m) => m.employee).filter((e): e is number => typeof e === 'number'))])
    const app = await appSettings(req)
    const companies = []
    for (const m of all) {
      const c = await companyById(req, m.company)
      const roles = [...m.roles].sort() as Role[]
      companies.push({
        id: m.company,
        code: c.shortCode,
        name: c.name,
        timezone: c.timezone,
        selected: activeCompanyIds.includes(m.company),
        roles,
        employeeId: m.employee,
        employee: m.employee !== null ? (employees.get(m.employee) ?? null) : null,
        capabilities: capabilitiesOf(roles, { fieldReportsEnabled: c.fieldReportsEnabled === true }),
        settings: {
          defaultGeofenceRadiusM: c.defaultGeofenceRadiusM,
          receiptRoundingTolerance: c.receiptRoundingTolerance,
          receiptMaxAgeDays: c.receiptMaxAgeDays,
          budgetWarnPct: c.budgetWarnPct,
          syncExpenseDraftsEnabled: c.syncExpenseDraftsEnabled !== false,
          syncAttendanceEnabled: c.syncAttendanceEnabled === true,
          syncProgressReportsEnabled: c.syncProgressReportsEnabled !== false,
          fieldReportsEnabled: c.fieldReportsEnabled === true,
        },
      })
    }
    const legacyEmployeeId = selected.find((m) => m.company === legacyCompanyId)?.employee ?? null
    // Scope rule 2026-10-02 (QA-MC4-14): without any membership the deprecated `settings` carry NO PT
    // (was: company #1's name and policy values) — the Companies field defaults instead
    const s =
      legacyCompanyId !== null
        ? await settings(req, legacyCompanyId)
        : { ...app, name: '', shortCode: '', timezone: DEFAULT_TZ, defaultGeofenceRadiusM: 100, receiptRoundingTolerance: 1000, receiptMaxAgeDays: 30 }
    const roles = userRoles(req)
    const imageTargets = {
      receiptsMaxPx: app.imageTargets?.receiptsMaxPx ?? 1600,
      selfiesMaxPx: app.imageTargets?.selfiesMaxPx ?? 720,
      transferProofsMaxPx: app.imageTargets?.transferProofsMaxPx ?? 1600,
      progressPhotosMaxPx: app.imageTargets?.progressPhotosMaxPx ?? 1600,
      jpegQuality: app.imageTargets?.jpegQuality ?? 80,
    }
    return json({
      id: u.id,
      email: u.email,
      name: u.name ?? null,
      roles,
      capabilities: capabilitiesOf(roles, { fieldReportsEnabled: companies.some((c) => c.selected && c.settings.fieldReportsEnabled) }),
      employee: legacyEmployeeId !== null ? (employees.get(legacyEmployeeId) ?? null) : null,
      authMethod: u._strategy ?? 'oidcSession',
      device: u._pkDevice ?? null,
      settings: {
        companyName: s.name,
        shortCode: s.shortCode,
        timezone: s.timezone,
        minAppVersion: s.minAppVersion ?? null,
        offlineMaxAgeDays: s.offlineMaxAgeDays,
        defaultGeofenceRadiusM: s.defaultGeofenceRadiusM,
        receiptRoundingTolerance: s.receiptRoundingTolerance,
        receiptMaxAgeDays: s.receiptMaxAgeDays,
        imageTargets,
      },
      companies,
      activeCompanyIds,
      legacyCompanyId,
      appSettings: {
        minAppVersion: app.minAppVersion ?? null,
        latestAppVersion: app.latestAppVersion ?? null,
        offlineMaxAgeDays: app.offlineMaxAgeDays,
        imageTargets,
      },
      // ADR 0018 (Q-46): acknowledgement of the employee privacy notice. Additive — APK ≤ 0.3.2 ignores it.
      privacy: privacyStatusOf(u),
      serverTime: new Date().toISOString(),
    })
  },
})
