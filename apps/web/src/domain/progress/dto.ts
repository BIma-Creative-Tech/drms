import type { PayloadRequest, Where } from 'payload'

import { hasRole, relId, userId } from '@/access/roles'

import { mayCreateReports } from './access'
import { reportRev, type ReportDoc } from './reports'

/**
 * API shape of progress reports (/api/v1/progress-reports, schemas-progress.ts). Names of project,
 * stage and reporter are resolved in one batch per page (SYSTEM-READ of records referenced by
 * reports the caller may read).
 */

type Named = { project: Map<number, { code: string; name: string }>; stage: Map<number, { name: string; weightPct: number }>; user: Map<number, string> }

async function names(req: PayloadRequest, docs: readonly ReportDoc[]): Promise<Named> {
  const ids = (key: 'project' | 'stage' | 'reporter') => [...new Set(docs.map((d) => relId(d[key])).filter((x): x is number => x !== undefined))]
  const out: Named = { project: new Map(), stage: new Map(), user: new Map() }
  const p = ids('project')
  if (p.length) {
    const r = await req.payload.find({ collection: 'projects', where: { id: { in: p } }, depth: 0, pagination: false, select: { code: true, name: true }, overrideAccess: true /* SYSTEM-READ: names */, req })
    for (const d of r.docs as Array<{ id: number; code: string; name: string }>) out.project.set(d.id, { code: d.code, name: d.name })
  }
  const s = ids('stage')
  if (s.length) {
    const r = await req.payload.find({ collection: 'project-stages', where: { id: { in: s } }, depth: 0, pagination: false, select: { name: true, weightPct: true }, overrideAccess: true /* SYSTEM-READ: names */, req })
    for (const d of r.docs as Array<{ id: number; name: string; weightPct?: number | null }>) out.stage.set(d.id, { name: d.name, weightPct: Number(d.weightPct ?? 0) })
  }
  const u = ids('reporter')
  if (u.length) {
    const r = await req.payload.find({ collection: 'users', where: { id: { in: u } }, depth: 1, pagination: false, select: { name: true, email: true, employee: true }, overrideAccess: true /* SYSTEM-READ: display names */, req })
    for (const d of r.docs as Array<{ id: number; name?: string | null; email: string; employee?: { name?: string } | number | null }>) {
      const emp = d.employee && typeof d.employee === 'object' ? d.employee.name : undefined
      out.user.set(d.id, emp || d.name || d.email)
    }
  }
  return out
}

type PhotoRow = { id: number; ownerDocId: string; width?: number | null; height?: number | null; filesize?: number | null }

async function photos(req: PayloadRequest, reportIds: readonly number[]): Promise<Map<number, PhotoRow[]>> {
  const map = new Map<number, PhotoRow[]>()
  if (reportIds.length === 0) return map
  const r = await req.payload.find({
    collection: 'media-progress-photos',
    where: { and: [{ ownerDocType: { equals: 'progress_report' } }, { ownerDocId: { in: reportIds.map(String) } }] },
    depth: 0,
    pagination: false,
    sort: 'id',
    select: { ownerDocId: true, width: true, height: true, filesize: true },
    overrideAccess: true, // SYSTEM-READ: photos of reports the caller may read (same rule as the photo read access)
    req,
  })
  for (const d of r.docs as unknown as PhotoRow[]) {
    const k = Number(d.ownerDocId)
    map.set(k, [...(map.get(k) ?? []), d])
  }
  return map
}

export function isEditable(req: PayloadRequest, d: ReportDoc, now = Date.now()): boolean {
  return relId(d.reporter) === userId(req) && !!d.editableUntil && new Date(d.editableUntil).getTime() > now
}

export async function reportDtos(req: PayloadRequest, docs: readonly ReportDoc[]) {
  const [n, ph] = [await names(req, docs), await photos(req, docs.map((d) => d.id))]
  return docs.map((d) => {
    const projectId = relId(d.project)!
    const stageId = relId(d.stage)!
    const reporterId = relId(d.reporter)!
    return {
      id: d.id,
      uuid: d.uuid ?? null,
      docNo: d.docNo ?? null,
      project: { id: projectId, code: n.project.get(projectId)?.code ?? null, name: n.project.get(projectId)?.name ?? null },
      stage: { id: stageId, name: n.stage.get(stageId)?.name ?? null, weightPct: n.stage.get(stageId)?.weightPct ?? null },
      reportDate: d.reportDate,
      pctBefore: Number(d.pctBefore),
      pctAfter: Number(d.pctAfter),
      projectPctBefore: d.projectPctBefore === null || d.projectPctBefore === undefined ? null : Number(d.projectPctBefore),
      projectPctAfter: d.projectPctAfter === null || d.projectPctAfter === undefined ? null : Number(d.projectPctAfter),
      work: d.work,
      issues: d.issues ?? null,
      reporter: { id: reporterId, name: n.user.get(reporterId) ?? null },
      photos: (ph.get(d.id) ?? []).map((p) => ({
        id: p.id,
        width: p.width ?? null,
        height: p.height ?? null,
        filesize: p.filesize ?? null,
        url: `/api/v1/media/progress-photos/${p.id}/file`,
        thumbUrl: `/api/v1/media/progress-photos/${p.id}/file?variant=thumb`,
      })),
      offline: d.offline === true,
      timeTrust: d.timeTrust ?? 'server',
      source: d.source ?? null,
      flags: Array.isArray(d.flags) ? d.flags : [],
      receivedAt: d.receivedAt ?? null,
      editableUntil: d.editableUntil ?? null,
      editable: isEditable(req, d),
      rev: reportRev(d),
      clientUuid: d.clientUuid ?? null,
      createdAt: d.createdAt ?? null,
    }
  })
}

export type ReportDto = Awaited<ReturnType<typeof reportDtos>>[number]

export async function reportDto(req: PayloadRequest, d: ReportDoc): Promise<ReportDto> {
  return (await reportDtos(req, [d]))[0]!
}

export type ReportListFilter = { projectId?: number; stageId?: number; from?: string; to?: string; mine?: boolean; limit: number; after?: number }

/** US-31: newest first, filter by project (and stage / date range), caller's read scope, cursor on id. */
export async function listReports(req: PayloadRequest, f: ReportListFilter): Promise<{ items: ReportDto[]; nextCursor: number | null }> {
  // Roles without read access get an empty page (no query: a denied find kills an outer transaction).
  if (!hasRole(req, 'pk-owner', 'pk-finance', 'pk-pm')) return { items: [], nextCursor: null }
  const and: Where[] = []
  if (f.projectId !== undefined) and.push({ project: { equals: f.projectId } })
  if (f.stageId !== undefined) and.push({ stage: { equals: f.stageId } })
  if (f.from) and.push({ reportDate: { greater_than_equal: f.from } })
  if (f.to) and.push({ reportDate: { less_than_equal: f.to } })
  if (f.mine) and.push({ reporter: { equals: userId(req) ?? -1 } })
  if (f.after !== undefined) and.push({ id: { less_than: f.after } })
  let docs: ReportDoc[] = []
  try {
    const res = await req.payload.find({
      collection: 'progress-reports',
      where: and.length ? { and } : undefined,
      sort: '-id',
      limit: f.limit + 1,
      depth: 0,
      user: req.user,
      overrideAccess: false, // caller's read scope (PM team, Direktur/Finance all)
      req,
    })
    docs = res.docs as unknown as ReportDoc[]
  } catch (err) {
    if ((err as { status?: number }).status === 403) return { items: [], nextCursor: null }
    throw err
  }
  const page = docs.slice(0, f.limit)
  return { items: await reportDtos(req, page), nextCursor: docs.length > f.limit ? page[page.length - 1]!.id : null }
}

export { mayCreateReports }
