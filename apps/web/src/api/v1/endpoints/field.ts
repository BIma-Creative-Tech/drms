import type { Endpoint, PayloadRequest } from 'payload'

import { activityDto, correctActivity, createActivity, editActivity, listActivities, openPos } from '@/domain/field/aftersales'
import { loadVisible } from '@/domain/field/common'
import { correctServiceReport, createServiceReport, editServiceReport, listServiceReports, serviceDto, type ServiceDoc } from '@/domain/field/service'
import { correctTimesheet, createTimesheet, editTimesheet, listTimesheets, timesheetDto, type TimesheetDoc } from '@/domain/field/timesheet'
import { listUnits, projectContractUnits } from '@/domain/field/units'
import type { ActivityDoc } from '@/domain/field/aftersales'
import { localDate } from '@/domain/progress/rules'
import { DEFAULT_TZ } from '@/lib/time'

import { companyQuery } from '../company-query'
import { HttpError, json, v1 } from '../http'
import { withNamedCompany } from '../named-company'
import {
  AftersalesActivityCorrection,
  AftersalesActivityCreate,
  AftersalesActivityListQuery,
  AftersalesActivityUpdate,
  OpenPosQuery,
  ServiceReportCorrection,
  ServiceReportCreate,
  ServiceReportListQuery,
  ServiceReportUpdate,
  UnitListQuery,
  UnitTimesheetCorrection,
  UnitTimesheetCreate,
  UnitTimesheetListQuery,
  UnitTimesheetUpdate,
} from '../schemas-field'

/**
 * FR1 field reports (ADR 0020, requirements v1.3 US-60…US-68). Mutations: 30/min per user, one
 * transaction, `Idempotency-Key` (required from the APK), plus `clientUuid` replay. Every create
 * answers 403 FEATURE_DISABLED while companies.fieldReportsEnabled is off for the project's PT,
 * 409 WRONG_PROJECT_KIND when the project kind does not offer the report. Reads follow the
 * collection access (Staff: assigned projects + own; PM: team + own; office: all of the PT).
 */
const WRITE_LIMIT: [number, number] = [30, 60_000]
const FIELD_ROLES = ['pk-staff', 'pk-pm', 'pk-owner'] as const

function idParam(params: Record<string, string>, name = 'id'): number {
  const v = params[name] ?? ''
  if (!/^\d{1,10}$/.test(v)) throw new HttpError(404, 'Not Found')
  return Number(v)
}

function query<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } } }, sp: URLSearchParams): T {
  const q = schema.safeParse(Object.fromEntries(sp.entries()))
  if (!q.success) throw new HttpError(400, 'Bad Request', { errors: q.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) })
  return q.data
}

function decodeCursor(c: string | undefined): number | undefined {
  if (!c) return undefined
  const n = Number(Buffer.from(c, 'base64url').toString('utf8'))
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, 'Bad Request', { detail: 'cursor tidak valid.' })
  return n
}
const encodeCursor = (id: number | null) => (id === null ? null : Buffer.from(String(id)).toString('base64url'))
const page = <T,>(p: { items: T[]; nextCursor: number | null }) => ({ items: p.items, nextCursor: encodeCursor(p.nextCursor) })

const named = (req: PayloadRequest, company: number | undefined, projectId: number) => <T,>(fn: () => Promise<T>) =>
  withNamedCompany(req, company, { roles: [...FIELD_ROLES], refs: [{ collection: 'projects', id: projectId, path: 'projectId' }] }, fn)

// ---------------------------------------------------------------- service reports

export const listServiceReportsEndpoint = v1({
  path: '/service-reports',
  method: 'get',
  handler: async ({ req }) => {
    const q = query(ServiceReportListQuery, req.searchParams)
    const p = await listServiceReports(req, { projectId: q.project, unitId: q.unit, status: q.status, reporterId: q.reporter, from: q.from, to: q.to, mine: q.mine !== undefined, limit: q.limit, after: decodeCursor(q.cursor), companyIds: await companyQuery(req) })
    return json(page(p))
  },
})

export const getServiceReportEndpoint = v1({
  path: '/service-reports/:id',
  method: 'get',
  handler: async ({ req, params }) => json(await serviceDto(req, await loadVisible<ServiceDoc>(req, 'service_report', idParam(params)))),
})

export const createServiceReportEndpoint = v1({
  path: '/service-reports',
  method: 'post',
  body: ServiceReportCreate,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body }) =>
    named(req, body.company, body.projectId)(async () => {
      const { company: _c, photoIds, clientUuid, ...rest } = body
      const { doc, created } = await createServiceReport(req, { ...rest, photoIds: photoIds ?? [], clientUuid: clientUuid ?? null })
      return json(await serviceDto(req, doc), created ? 201 : 200)
    }),
})

export const updateServiceReportEndpoint = v1({
  path: '/service-reports/:id',
  method: 'patch',
  body: ServiceReportUpdate,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => json(await serviceDto(req, await editServiceReport(req, idParam(params), body))),
})

export const correctServiceReportEndpoint = v1({
  path: '/service-reports/:id/corrections',
  method: 'post',
  roles: ['pk-pm', 'pk-owner'],
  body: ServiceReportCorrection,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => json(await serviceDto(req, await correctServiceReport(req, idParam(params), body))),
})

// ---------------------------------------------------------------- unit timesheets

export const listTimesheetsEndpoint = v1({
  path: '/unit-timesheets',
  method: 'get',
  handler: async ({ req }) => {
    const q = query(UnitTimesheetListQuery, req.searchParams)
    const p = await listTimesheets(req, { projectId: q.project, unitId: q.unit, reporterId: q.reporter, from: q.from, to: q.to, mine: q.mine !== undefined, limit: q.limit, after: decodeCursor(q.cursor), companyIds: await companyQuery(req) })
    return json(page(p))
  },
})

export const getTimesheetEndpoint = v1({
  path: '/unit-timesheets/:id',
  method: 'get',
  handler: async ({ req, params }) => json(await timesheetDto(req, await loadVisible<TimesheetDoc>(req, 'unit_timesheet', idParam(params)))),
})

export const createTimesheetEndpoint = v1({
  path: '/unit-timesheets',
  method: 'post',
  body: UnitTimesheetCreate,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body }) =>
    named(req, body.company, body.projectId)(async () => {
      const { company: _c, clientUuid, ...rest } = body
      const { doc, created } = await createTimesheet(req, { ...rest, clientUuid: clientUuid ?? null })
      return json(await timesheetDto(req, doc), created ? 201 : 200)
    }),
})

export const updateTimesheetEndpoint = v1({
  path: '/unit-timesheets/:id',
  method: 'patch',
  body: UnitTimesheetUpdate,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => json(await timesheetDto(req, await editTimesheet(req, idParam(params), body))),
})

export const correctTimesheetEndpoint = v1({
  path: '/unit-timesheets/:id/corrections',
  method: 'post',
  roles: ['pk-pm', 'pk-owner'],
  body: UnitTimesheetCorrection,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => json(await timesheetDto(req, await correctTimesheet(req, idParam(params), body))),
})

// ---------------------------------------------------------------- aftersales activities

export const listActivitiesEndpoint = v1({
  path: '/aftersales-activities',
  method: 'get',
  handler: async ({ req }) => {
    const q = query(AftersalesActivityListQuery, req.searchParams)
    const p = await listActivities(req, {
      projectId: q.project,
      clientId: q.client,
      kind: q.kind,
      poStatus: q.poStatus,
      reporterId: q.reporter,
      from: q.from,
      to: q.to,
      mine: q.mine !== undefined,
      limit: q.limit,
      after: decodeCursor(q.cursor),
      companyIds: await companyQuery(req),
    })
    return json(page(p))
  },
})

export const getActivityEndpoint = v1({
  path: '/aftersales-activities/:id',
  method: 'get',
  handler: async ({ req, params }) => json(await activityDto(req, await loadVisible<ActivityDoc>(req, 'aftersales_activity', idParam(params)))),
})

export const createActivityEndpoint = v1({
  path: '/aftersales-activities',
  method: 'post',
  body: AftersalesActivityCreate,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body }) =>
    named(req, body.company, body.projectId)(async () => {
      const { company: _c, photoIds, clientUuid, ...rest } = body
      const { doc, created } = await createActivity(req, { ...rest, photoIds: photoIds ?? [], clientUuid: clientUuid ?? null })
      return json(await activityDto(req, doc), created ? 201 : 200)
    }),
})

export const updateActivityEndpoint = v1({
  path: '/aftersales-activities/:id',
  method: 'patch',
  body: AftersalesActivityUpdate,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => json(await activityDto(req, await editActivity(req, idParam(params), body))),
})

export const correctActivityEndpoint = v1({
  path: '/aftersales-activities/:id/corrections',
  method: 'post',
  roles: ['pk-pm', 'pk-owner'],
  body: AftersalesActivityCorrection,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => json(await activityDto(req, await correctActivity(req, idParam(params), body))),
})

/** GET /aftersales/open-pos — incoming POs still to deliver (oldest first) in the caller's scope; ?client= narrows. */
export const openPosEndpoint = v1({
  path: '/aftersales/open-pos',
  method: 'get',
  rateLimit: [60, 60_000],
  handler: async ({ req }) => {
    const q = query(OpenPosQuery, req.searchParams)
    const asOf = localDate(new Date(), process.env.TZ || DEFAULT_TZ)
    return json(await openPos(req, { clientId: q.client, projectId: q.project, companyIds: await companyQuery(req), asOf }))
  },
})

// ---------------------------------------------------------------- units + contract units

/** GET /units — "Unit & Kendaraan" of the caller's PTs (no contract rates); ?project= / ?updatedSince= for the APK cache. */
export const listUnitsEndpoint = v1({
  path: '/units',
  method: 'get',
  rateLimit: [60, 60_000],
  handler: async ({ req }) => {
    const q = query(UnitListQuery, req.searchParams)
    return json(await listUnits(req, { projectId: q.project, updatedSince: q.updatedSince, companyIds: await companyQuery(req) }))
  },
})

/** GET /projects/{id}/contract-units — rates only for Direktur/Finance/Admin of the PT. */
export const projectContractUnitsEndpoint = v1({
  path: '/projects/:id/contract-units',
  method: 'get',
  handler: async ({ req, params }) => json(await projectContractUnits(req, idParam(params))),
})

export const FIELD_ENDPOINTS: Endpoint[] = [
  listServiceReportsEndpoint,
  getServiceReportEndpoint,
  createServiceReportEndpoint,
  updateServiceReportEndpoint,
  correctServiceReportEndpoint,
  listTimesheetsEndpoint,
  getTimesheetEndpoint,
  createTimesheetEndpoint,
  updateTimesheetEndpoint,
  correctTimesheetEndpoint,
  listActivitiesEndpoint,
  getActivityEndpoint,
  createActivityEndpoint,
  updateActivityEndpoint,
  correctActivityEndpoint,
  openPosEndpoint,
  listUnitsEndpoint,
  projectContractUnitsEndpoint,
]

