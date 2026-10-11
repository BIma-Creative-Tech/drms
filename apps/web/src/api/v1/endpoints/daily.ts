import type { Endpoint, PayloadRequest } from 'payload'

import { loadVisible } from '@/domain/field/common'
import { correctDailyReport, createDailyReport, dailyDto, editDailyReport, listDailyReports, weeklyRecap, type DailyDoc } from '@/domain/daily/service'
import {
  activeUomCodes,
  applyRapTemplate,
  commitRapImport,
  createRapItem,
  loadRap,
  previewRapImport,
  saveRapAsTemplate,
  updateRapItem,
} from '@/domain/rap/service'
import { buildRapWorkbook } from '@/domain/rap/workbook'

import { companyQuery } from '../company-query'
import { HttpError, json, v1 } from '../http'
import { withNamedCompany } from '../named-company'
import {
  DailyReportCorrection,
  DailyReportCreate,
  DailyReportListQuery,
  DailyReportUpdate,
  RapApplyTemplate,
  RapImportCommit,
  RapItemCreate,
  RapItemUpdate,
  RapSaveTemplate,
} from '../schemas-daily'

/**
 * P3 Konstruksi: RAP + Laporan Harian (owner decisions 2026-10-10). Mutations: one transaction,
 * `Idempotency-Key` (required from the APK) and, for daily reports, `clientUuid` replay. RAP edits:
 * Direktur/Admin of the PT or the PM of the project team; once a daily report realised anything the
 * RAP is locked (Direktur/Admin with a reason). Reads follow the project visibility; prices only for
 * Direktur, Admin, Finance and the project PM.
 */
const WRITE_LIMIT: [number, number] = [30, 60_000]
// owner decision 2026-10-10: Finance / Admin only read field reports
const FIELD_ROLES = ['pk-staff', 'pk-pm', 'pk-owner'] as const
const RAP_FILE_MAX = 2 * 1024 * 1024
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function idParam(params: Record<string, string>, name = 'id'): number {
  const v = params[name] ?? ''
  if (!/^\d{1,10}$/.test(v)) throw new HttpError(404, 'Not Found')
  return Number(v)
}

function decodeCursor(c: string | undefined): number | undefined {
  if (!c) return undefined
  const n = Number(Buffer.from(c, 'base64url').toString('utf8'))
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, 'Bad Request', { detail: 'cursor tidak valid.' })
  return n
}
const encodeCursor = (id: number | null) => (id === null ? null : Buffer.from(String(id)).toString('base64url'))

function xlsxResponse(bytes: Uint8Array, filename: string): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': XLSX,
      'Content-Disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]+/g, '-')}"`,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/** multipart "file" (.xlsx ≤ 2 MB) of an import request. */
function rapFile(req: PayloadRequest): Uint8Array {
  const file = req.file
  if (!file?.data?.length) throw new HttpError(400, 'Bad Request', { detail: 'Field "file" wajib (multipart/form-data, .xlsx).' })
  if (file.data.length > RAP_FILE_MAX) throw new HttpError(413, 'Content Too Large', { detail: 'File RAP maksimal 2 MB.' })
  return new Uint8Array(file.data)
}

// ---------------------------------------------------------------- RAP

export const getRapEndpoint = v1({
  path: '/projects/:id/rap',
  method: 'get',
  transactional: true, // raw SQL reads use the request transaction handle
  handler: async ({ req, params }) => json(await loadRap(req, idParam(params))),
})

/** GET /rap/template.xlsx — empty template (kode, uraian, tahapan, jenis, satuan, volume, harga_satuan, bobot). */
export const rapTemplateEndpoint = v1({
  path: '/rap/template.xlsx',
  method: 'get',
  rateLimit: [10, 60_000],
  handler: async ({ req }) => xlsxResponse(buildRapWorkbook(await activeUomCodes(req)), 'template-rap.xlsx'),
})

/** GET /projects/{id}/rap.xlsx — the project's RAP in the import format (prices only for the price roles). */
export const rapExportEndpoint = v1({
  path: '/projects/:id/rap.xlsx',
  method: 'get',
  transactional: true, // raw SQL reads use the request transaction handle
  rateLimit: [10, 60_000],
  handler: async ({ req, params }) => {
    const id = idParam(params)
    const rap = await loadRap(req, id)
    const rows = rap.items
      .filter((i) => i.active)
      .map((i) => ({ code: i.code, description: i.description, stageName: i.stage.name, kind: i.kind, uomCode: i.uom.code, volume: i.volume, unitPrice: i.unitPrice ?? null, weightPct: i.weightPct }))
    return xlsxResponse(buildRapWorkbook(await activeUomCodes(req), rows), `rap-project-${id}.xlsx`)
  },
})

export const createRapItemEndpoint = v1({
  path: '/projects/:id/rap/items',
  method: 'post',
  body: RapItemCreate,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => {
    const { reason, ...input } = body
    return json(await createRapItem(req, idParam(params), input, reason), 201)
  },
})

export const updateRapItemEndpoint = v1({
  path: '/rap-items/:id',
  method: 'patch',
  body: RapItemUpdate,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => {
    const { reason, ...input } = body
    return json(await updateRapItem(req, idParam(params), input, reason))
  },
})

export const rapImportPreviewEndpoint = v1({
  path: '/projects/:id/rap/import/preview',
  method: 'post',
  multipart: true,
  transactional: true,
  rateLimit: [10, 60_000],
  handler: async ({ req, params }) => json(await previewRapImport(req, idParam(params), rapFile(req))),
})

export const rapImportCommitEndpoint = v1({
  path: '/projects/:id/rap/import/commit',
  method: 'post',
  multipart: true,
  rateLimit: [10, 60_000],
  transactional: true,
  handler: async ({ req, params }) => {
    const bytes = rapFile(req)
    const parsed = RapImportCommit.safeParse(req.data ?? {})
    if (!parsed.success) throw new HttpError(400, 'Bad Request', { errors: parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) })
    return json(await commitRapImport(req, idParam(params), bytes, { fileHash: parsed.data.fileHash, reason: parsed.data.reason ?? null }))
  },
})

export const rapApplyTemplateEndpoint = v1({
  path: '/projects/:id/rap/apply-template',
  method: 'post',
  body: RapApplyTemplate,
  rateLimit: [10, 60_000],
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => json(await applyRapTemplate(req, idParam(params), body.templateId)),
})

export const rapSaveTemplateEndpoint = v1({
  path: '/projects/:id/rap/save-template',
  method: 'post',
  body: RapSaveTemplate,
  rateLimit: [10, 60_000],
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => json(await saveRapAsTemplate(req, idParam(params), body.name), 201),
})

// ---------------------------------------------------------------- daily reports

export const listDailyReportsEndpoint = v1({
  path: '/daily-reports',
  method: 'get',
  transactional: true, // raw SQL reads use the request transaction handle
  handler: async ({ req }) => {
    const q = DailyReportListQuery.safeParse(Object.fromEntries(req.searchParams.entries()))
    if (!q.success) throw new HttpError(400, 'Bad Request', { errors: q.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) })
    const d = q.data
    const p = await listDailyReports(req, { projectId: d.project, reporterId: d.reporter, from: d.from, to: d.to, mine: d.mine !== undefined, limit: d.limit, after: decodeCursor(d.cursor), companyIds: await companyQuery(req), q: d.q })
    return json({ items: p.items, nextCursor: encodeCursor(p.nextCursor) })
  },
})

export const getDailyReportEndpoint = v1({
  path: '/daily-reports/:id',
  method: 'get',
  transactional: true, // raw SQL reads use the request transaction handle
  handler: async ({ req, params }) => json(await dailyDto(req, await loadVisible<DailyDoc>(req, 'daily_report', idParam(params)), { history: true })),
})

export const createDailyReportEndpoint = v1({
  path: '/daily-reports',
  method: 'post',
  body: DailyReportCreate,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body }) =>
    withNamedCompany(req, body.company, { roles: [...FIELD_ROLES], refs: [{ collection: 'projects', id: body.projectId, path: 'projectId' }] }, async () => {
      const { company: _c, photoIds, clientUuid, ...rest } = body
      const { doc, created } = await createDailyReport(req, { ...rest, photoIds: photoIds ?? [], clientUuid: clientUuid ?? null })
      return json(await dailyDto(req, doc), created ? 201 : 200)
    }),
})

export const updateDailyReportEndpoint = v1({
  path: '/daily-reports/:id',
  method: 'patch',
  body: DailyReportUpdate,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => json(await dailyDto(req, await editDailyReport(req, idParam(params), body))),
})

export const correctDailyReportEndpoint = v1({
  path: '/daily-reports/:id/corrections',
  method: 'post',
  roles: ['pk-pm', 'pk-owner'],
  body: DailyReportCorrection,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => json(await dailyDto(req, await correctDailyReport(req, idParam(params), body))),
})

/** GET /projects/{id}/daily-recap — "Minggu ke-N" recap (quantities only). */
export const dailyRecapEndpoint = v1({
  path: '/projects/:id/daily-recap',
  method: 'get',
  transactional: true, // raw SQL reads use the request transaction handle
  handler: async ({ req, params }) => json(await weeklyRecap(req, idParam(params))),
})

export const DAILY_ENDPOINTS: Endpoint[] = [
  getRapEndpoint,
  rapTemplateEndpoint,
  rapExportEndpoint,
  createRapItemEndpoint,
  updateRapItemEndpoint,
  rapImportPreviewEndpoint,
  rapImportCommitEndpoint,
  rapApplyTemplateEndpoint,
  rapSaveTemplateEndpoint,
  listDailyReportsEndpoint,
  getDailyReportEndpoint,
  createDailyReportEndpoint,
  updateDailyReportEndpoint,
  correctDailyReportEndpoint,
  dailyRecapEndpoint,
]
