import { hasRoleAny, type Role } from '@/access/roles'
import { matchesQuery, paginate, parseListQuery } from '@/admin/list-query'
import { buildTimesheetMatrix } from '@/domain/field/views'
import { contractsOf, enabledCompanies, fieldProjects, mayCreateIn, timesheetsOf, todayOf, unitsOf } from '@/domain/field/web'

import { HttpError, json, v1 } from '../http'

/**
 * User 2026-10-19 (APK ↔ web parity, phase 5b): the web "Unit & kontrak" page (admin/views/FieldUnits.tsx
 * FieldContracts) as JSON — same gate (field readers, PTs of the selection with field reports on), same helpers
 * (projects of kind kontrak_unit, contract units, this month's timesheets → buildTimesheetMatrix). Money never: the
 * rates / minimum hours stay out (contractsOf `terms` is not passed on).
 */
// Same role lists as admin/views/field-ui.tsx (that module is a React view; not imported by the API)
const FIELD_READERS: readonly Role[] = ['pk-owner', 'pk-finance', 'pk-pm', 'pk-admin', 'pk-staff']
const FIELD_CREATORS: readonly Role[] = ['pk-owner', 'pk-pm', 'pk-staff']
const FEATURE_OFF = 'Laporan lapangan (servis, timesheet, aftersales) belum diaktifkan untuk PT yang dipilih. Admin grup dapat menyalakannya di Pengaturan › Perusahaan.'

export const fieldContractsEndpoint = v1({
  path: '/field/contracts',
  method: 'get',
  rateLimit: [60, 60_000],
  transactional: true,
  handler: async ({ req }) => {
    if (!hasRoleAny(req, ...FIELD_READERS)) throw new HttpError(403, 'Forbidden')
    const companies = await enabledCompanies(req)
    if (companies.length === 0) throw new HttpError(403, 'Forbidden', { code: 'FIELD_REPORTS_OFF', detail: FEATURE_OFF })
    const projects = await fieldProjects(req, ['kontrak_unit'], companies)
    const today = await todayOf(req, companies[0])
    const month = today.slice(0, 7)
    const contracts = await contractsOf(req, projects.map((p) => p.id))
    const ts = await timesheetsOf(req, { projectIds: projects.map((p) => p.id), from: `${month}-01`, to: today })
    const units = await unitsOf(req, companies, { activeOnly: true })
    const lq = parseListQuery(Object.fromEntries(req.searchParams.entries()), [], { pageKey: 'page' }) // q, page, per (20|50|100)
    const creator = hasRoleAny(req, ...FIELD_CREATORS)
    const all = projects
      .filter((p) => matchesQuery([p.code, p.name], lq.q))
      .map((p) => {
        const cs = contracts.filter((c) => c.projectId === p.id)
        const m = buildTimesheetMatrix({ month, today, contracts: cs, timesheets: ts.filter((t) => t.projectId === p.id) })
        const isActiveToday = (c: (typeof cs)[number]) => c.active && c.startDate <= today && (c.endDate === null || c.endDate >= today)
        const filled = new Set(ts.filter((t) => t.projectId === p.id && t.reportDate === today).map((t) => t.unitId))
        const activeToday = cs.filter(isActiveToday)
        return {
          projectId: p.id,
          code: p.code,
          name: p.name,
          companyId: p.companyId,
          status: p.status,
          unitsActiveToday: activeToday.length,
          filledToday: activeToday.filter((c) => filled.has(c.unitId)).length,
          canCreateTimesheet: creator && mayCreateIn(req, p.companyId) && activeToday.length > 0,
          contracts: cs.map((c) => ({
            id: c.id,
            unitId: c.unitId,
            unitLabel: c.label,
            unitType: c.unitType,
            startDate: c.startDate,
            endDate: c.endDate,
            active: c.active,
            activeToday: isActiveToday(c),
            filledToday: isActiveToday(c) && filled.has(c.unitId),
          })),
          // the web row: "Belum diisi (bln ini)", "Jam kerja (bln ini)", "Selisih HM" (+ standby / breakdown / filled)
          monthTotals: m.totals,
        }
      })
    const page = paginate(all, lq.page, lq.per)
    return json({
      today,
      month,
      canCreateTimesheet: creator,
      items: page.items,
      total: page.total,
      page: page.page,
      totalPages: page.totalPages,
      // "Unit alat berat": status from the last service report, HM from timesheets / services
      units: units
        .filter((u) => u.kind === 'alat_berat')
        .map((u) => ({ id: u.id, companyId: u.companyId, label: u.label, type: u.type, brandModel: u.brandModel, owner: u.owner, clientName: u.client?.name ?? null, status: u.status, lastHourMeter: u.lastHourMeter })),
    })
  },
})
