import type { OpenAPIRegistry, RouteConfig } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

import * as F from './schemas-field'

type Helpers = {
  security: Array<Record<string, string[]>>
  deviceHeader: z.ZodObject
  idem: z.ZodObject
  res: (code: number, description: string, schema: z.ZodType, errors: number[]) => RouteConfig['responses']
}

/** FR1 "Laporan lapangan per jenis project" paths (ADR 0020, requirements v1.3). Pure (bundled by scripts/gen-openapi.mjs). */
export function registerFieldPaths(registry: OpenAPIRegistry, h: Helpers): void {
  const idParam = z.object({ id: z.string().regex(/^\d+$/) })
  const write = [400, 401, 403, 404, 409, 422, 426, 429]
  const json = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } })
  const created = (description: string, schema: z.ZodType) => ({ ...h.res(201, description, schema, write), 200: { description: `${description} (replayed clientUuid)`, content: { 'application/json': { schema } } } })

  const trio = (o: {
    path: string
    tag: string
    listQuery: z.ZodType
    list: z.ZodType
    item: z.ZodType
    create: z.ZodType
    update: z.ZodType
    correction: z.ZodType
    createSummary: string
  }) => {
    registry.registerPath({
      method: 'get',
      path: o.path,
      summary: `${o.tag}: list, newest first, in the caller's read scope (Staff: assigned projects + own; PM: team + own; Direktur/Finance/Admin: all of the PT)`,
      security: h.security,
      request: { headers: h.deviceHeader, query: o.listQuery as z.ZodObject },
      responses: h.res(200, 'Page', o.list, [400, 401, 403, 426]),
    })
    registry.registerPath({
      method: 'get',
      path: `${o.path}/{id}`,
      summary: `${o.tag}: detail (404 outside the read scope)`,
      security: h.security,
      request: { headers: h.deviceHeader, params: idParam },
      responses: h.res(200, o.tag, o.item, [401, 404, 426]),
    })
    registry.registerPath({
      method: 'post',
      path: o.path,
      summary: o.createSummary,
      security: h.security,
      request: { headers: h.idem, body: json(o.create) },
      responses: created(o.tag, o.item),
    })
    registry.registerPath({
      method: 'patch',
      path: `${o.path}/{id}`,
      summary: `${o.tag}: edit by the reporter within 24 h (409 NOT_EDITABLE after the window; corrections: POST …/corrections)`,
      security: h.security,
      request: { headers: h.idem, params: idParam, body: json(o.update) },
      responses: h.res(200, o.tag, o.item, write),
    })
    registry.registerPath({
      method: 'post',
      path: `${o.path}/{id}/corrections`,
      summary: `${o.tag}: correction by the PM of the project team or the Direktur, any time, reason required (audited, flag CORRECTED)`,
      security: h.security,
      request: { headers: h.idem, params: idParam, body: json(o.correction) },
      responses: h.res(200, o.tag, o.item, write),
    })
  }

  trio({
    path: '/service-reports',
    tag: 'Service report',
    listQuery: F.ServiceReportListQuery,
    list: F.ServiceReportList,
    item: F.ServiceReport,
    create: F.ServiceReportCreate,
    update: F.ServiceReportUpdate,
    correction: F.ServiceReportCorrection,
    createSummary:
      'FR1 Laporan servis unit (SV/YYMM/####): Staff assigned / PM team / Direktur; project kind kontrak_unit or aftersales (409 WRONG_PROJECT_KIND); PT flag off → 403 FEATURE_DISABLED; HM below the unit\'s latest reading → 409 HM_DECREASED; unitStatusAfter updates the unit (menunggu_part notifies the PM)',
  })
  trio({
    path: '/unit-timesheets',
    tag: 'Unit timesheet',
    listQuery: F.UnitTimesheetListQuery,
    list: F.UnitTimesheetList,
    item: F.UnitTimesheet,
    create: F.UnitTimesheetCreate,
    update: F.UnitTimesheetUpdate,
    correction: F.UnitTimesheetCorrection,
    createSummary:
      'FR1 Timesheet harian unit: one per unit and date (409 DUPLICATE_DATE), unit in an active contract unit of the kontrak_unit project on that date (409 NOT_IN_CONTRACT), HM photo required; HM start ≠ previous HM end → flag HM_GAP; updates the unit\'s last HM',
  })
  trio({
    path: '/aftersales-activities',
    tag: 'Aftersales activity',
    listQuery: F.AftersalesActivityListQuery,
    list: F.AftersalesActivityList,
    item: F.AftersalesActivity,
    create: F.AftersalesActivityCreate,
    update: F.AftersalesActivityUpdate,
    correction: F.AftersalesActivityCorrection,
    createSummary:
      'FR1 Log aktivitas aftersales (project kind aftersales): penawaran / po_masuk / pengiriman (refers to an open PO of the same customer, moves its status; 409 PO_CLOSED) / penagihan / kunjungan / lainnya. Value (Rp) readable only by Direktur/Finance/Admin and the reporter',
  })
  registry.registerPath({
    method: 'get',
    path: '/aftersales/open-pos',
    summary: 'FR1: incoming POs still to deliver (belum_kirim / sebagian), oldest first, in the caller\'s scope; ?client= / ?project= narrow',
    security: h.security,
    request: { headers: h.deviceHeader, query: F.OpenPosQuery },
    responses: h.res(200, 'Open POs', F.OpenPoList, [400, 401, 403, 426, 429]),
  })
  registry.registerPath({
    method: 'get',
    path: '/units',
    summary: 'FR1 "Unit & Kendaraan" of the caller\'s PTs (never with contract rates); ?project= (kontrak_unit: units in an active contract today; aftersales: active units of the PT), ?updatedSince= delta',
    security: h.security,
    request: { headers: h.deviceHeader, query: F.UnitListQuery },
    responses: h.res(200, 'Units', F.UnitList, [400, 401, 403, 404, 426, 429]),
  })
  registry.registerPath({
    method: 'get',
    path: '/projects/{id}/contract-units',
    summary: 'FR1 contract units of a project the caller may read; rate / minimum hours null unless Direktur, Finance or Admin of the PT',
    security: h.security,
    request: { headers: h.deviceHeader, params: idParam },
    responses: h.res(200, 'Contract units', F.ContractUnitList, [401, 404, 426]),
  })
}
