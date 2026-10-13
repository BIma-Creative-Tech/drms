import type { OpenAPIRegistry, RouteConfig } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

import * as D from './schemas-daily'

type Helpers = {
  security: Array<Record<string, string[]>>
  deviceHeader: z.ZodObject
  idem: z.ZodObject
  res: (code: number, description: string, schema: z.ZodType, errors: number[]) => RouteConfig['responses']
}

/** P3 "Konstruksi: RAP + Laporan Harian" paths. Pure (bundled by scripts/gen-openapi.mjs). */
export function registerDailyPaths(registry: OpenAPIRegistry, h: Helpers): void {
  const idParam = z.object({ id: z.string().regex(/^\d+$/) })
  const write = [400, 401, 403, 404, 409, 422, 426, 429]
  const json = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } })
  const xlsx = { 200: { description: 'Excel (.xlsx)', content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: z.string().meta({ format: 'binary' }) } } } }
  const multipart = (schema?: z.ZodType) => ({
    content: { 'multipart/form-data': { schema: z.object({ file: z.string().meta({ format: 'binary', description: '.xlsx ≤ 2 MB (413 above)' }), ...(schema ? { _payload: z.string().meta({ description: `JSON: ${schema.description ?? 'see schema'}` }) } : {}) }) } },
  })

  // ---- RAP
  registry.registerPath({
    method: 'get',
    path: '/projects/{id}/rap',
    summary: 'P3 RAP of a project (every kind since DRMS 10/10 D4; konstruksi: stage-driven progress): items (realised / received / used / stock / %), stage summary (progressMode rap|manual, basis value|equal), lock state, rapRequired; prices and totals only for Direktur/Admin/Finance and the project PM',
    security: h.security,
    request: { headers: h.deviceHeader, params: idParam },
    responses: h.res(200, 'RAP', D.Rap, [401, 404, 426]),
  })
  registry.registerPath({
    method: 'get',
    path: '/rap/template.xlsx',
    summary: 'P3 empty RAP Excel template (sheet RAP: kode, uraian, tahapan, jenis, satuan, volume, harga_satuan, bobot + Petunjuk)',
    security: h.security,
    responses: { ...xlsx, 401: { description: 'Unauthorized' }, 429: { description: 'Too Many Requests' } },
  })
  registry.registerPath({
    method: 'get',
    path: '/projects/{id}/rap.xlsx',
    summary: 'P3 the project\'s active RAP items in the import format (harga_satuan empty without the price roles)',
    security: h.security,
    request: { params: idParam },
    responses: { ...xlsx, 401: { description: 'Unauthorized' }, 404: { description: 'Not Found' }, 429: { description: 'Too Many Requests' } },
  })
  registry.registerPath({
    method: 'post',
    path: '/projects/{id}/rap/items',
    summary: 'P3 add a RAP item (any project kind; stageId required for konstruksi): Direktur/Admin or the project PM; locked RAP (realisation exists) → Direktur/Admin with reason (409 RAP_LOCKED); 409 DUPLICATE_CODE',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: json(D.RapItemCreate) },
    responses: h.res(201, 'RAP item', D.RapItem, write),
  })
  registry.registerPath({
    method: 'patch',
    path: '/rap-items/{id}',
    summary: 'P3 edit / deactivate a RAP item (same roles and lock as create; kind never changes). A used item ("Sudah terpakai") stays editable, but any change needs `reason` (400 field reason), audited',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: json(D.RapItemUpdate) },
    responses: h.res(200, 'RAP item', D.RapItem, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/projects/{id}/rap/import/preview',
    summary: 'P3 RAP Excel import — preview (no write): new / changed / unchanged per kode, items to deactivate, new stages, issues; returns fileHash for the commit',
    security: h.security,
    request: { params: idParam, body: multipart() },
    responses: h.res(200, 'Preview', D.RapPreview, [400, 401, 404, 409, 413, 429]),
  })
  registry.registerPath({
    method: 'post',
    path: '/projects/{id}/rap/import/commit',
    summary: 'P3 RAP Excel import — commit the previewed file (409 FILE_CHANGED); idempotent by kode; items missing from the file are deactivated; konstruksi: new stages only for Direktur/Admin; other kinds: tahapan optional, existing stages only',
    security: h.security,
    request: { params: idParam, body: multipart(D.RapImportCommit) },
    responses: h.res(200, 'RAP', D.Rap, [400, 401, 403, 404, 409, 413, 429]),
  })
  registry.registerPath({
    method: 'post',
    path: '/projects/{id}/rap/apply-template',
    summary: 'P3 fill an EMPTY RAP from a RAP template of the same PT and project kind (template without kind = any kind; 400 templateId otherwise; 409 STATE_CONFLICT when items exist)',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: json(D.RapApplyTemplate) },
    responses: h.res(200, 'RAP', D.Rap, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/projects/{id}/rap/save-template',
    summary: 'P3 save the project\'s active RAP items as a template of the PT (Direktur/Admin or project PM)',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: json(D.RapSaveTemplate) },
    responses: h.res(201, 'Template', D.RapTemplateSaved, write),
  })

  // ---- daily reports
  registry.registerPath({
    method: 'get',
    path: '/daily-reports',
    summary: 'P3 Laporan harian: list, newest first, in the caller\'s read scope (Staff: assigned projects + own; PM: team + own; Direktur/Finance/Admin: all of the PT)',
    security: h.security,
    request: { headers: h.deviceHeader, query: D.DailyReportListQuery },
    responses: h.res(200, 'Page', D.DailyReportList, [400, 401, 403, 426]),
  })
  registry.registerPath({
    method: 'get',
    path: '/daily-reports/{id}',
    summary: 'P3 Laporan harian: detail incl. the append-only ledger (404 outside the read scope)',
    security: h.security,
    request: { headers: h.deviceHeader, params: idParam },
    responses: h.res(200, 'Daily report', D.DailyReport, [401, 404, 426]),
  })
  registry.registerPath({
    method: 'post',
    path: '/daily-reports',
    summary:
      'P3 Laporan harian (LH/YYMM/####), project kind konstruksi: weather, manpower / equipment, volume pekerjaan and material per RAP item, issues, photos ≤ 10. One per project, reporter and date (409 DAILY_EXISTS). Above the RAP volume: allowed with notes (400 OVER_RAP_NOTE_REQUIRED), flag MELEBIHI_RAP, PM notified; same item booked by another reporter that day → flag POSSIBLE_DUPLICATE. Stage % of RAP-driven stages and the project % are recomputed',
    security: h.security,
    request: { headers: h.idem, body: json(D.DailyReportCreate) },
    responses: { ...h.res(201, 'Daily report', D.DailyReport, write), 200: { description: 'Daily report (replayed clientUuid)', content: { 'application/json': { schema: D.DailyReport } } } },
  })
  registry.registerPath({
    method: 'patch',
    path: '/daily-reports/{id}',
    summary: 'P3 Laporan harian: edit by the reporter within 24 h (409 NOT_EDITABLE after); differences are booked to the ledger (origin edit)',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: json(D.DailyReportUpdate) },
    responses: h.res(200, 'Daily report', D.DailyReport, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/daily-reports/{id}/corrections',
    summary: 'P3 Laporan harian: correction by the PM of the project team or the Direktur, any time, reason required (ledger origin correction, flag CORRECTED)',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: json(D.DailyReportCorrection) },
    responses: h.res(200, 'Daily report', D.DailyReport, write),
  })
  registry.registerPath({
    method: 'get',
    path: '/projects/{id}/daily-recap',
    summary: 'P3 weekly recap "Minggu ke-N" (Mon–Sun from the project start): reports, worker-days, rain / stop hours per week; volume per work item per week and cumulative %',
    security: h.security,
    request: { headers: h.deviceHeader, params: idParam },
    responses: h.res(200, 'Recap', D.DailyRecap, [401, 404, 426]),
  })
}
