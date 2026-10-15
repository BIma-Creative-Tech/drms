import type { PayloadRequest, Where } from 'payload'

import { relId } from '@/access/roles'
import { effectiveRadiusM } from '@/domain/attendance/calendar'
import { companyById, displayNames } from '@/domain/companies'
import { today } from '@/domain/expense/common'
import { siteFlagsFor, type SiteFlags } from '@/domain/sites'
import { projectRapSummaries, type ProjectRapSummary } from '@/domain/rap/budget'
import { rapRequiredFor } from '@/domain/rap/rules'
import { rapRoles } from '@/domain/rap/service'
import { searchWhere } from '@/lib/text-search'
import { PROJECT_STATUSES } from '@/collections/Projects'

/**
 * DRMS 10/10 Phase C (APK Projects menu, point 6/7): project list + detail of /api/v1/projects — always within
 * the caller's project read access (Staff: assigned projects = the projects they can submit to, PM: their team's,
 * Direktur / Finance / Admin: every project of the selected PTs). RAP money (planned / realised) only for the price
 * roles of the project (Direktur, Admin, Finance, the project's PM; owner 2026-10-10: no prices for Staff).
 */
export type ProjectListQuery = { q?: string; status?: string; page: number; limit: number; companies?: number[]; site?: number }

type ProjectDoc = {
  id: number
  code?: string
  name?: string
  kind?: string | null
  company?: unknown
  pm?: unknown
  status?: string | null
  budget?: number | null
  progressPct?: number | null
  costCenter?: unknown
  site?: unknown
  client?: unknown
  address?: string | null
  startDate?: string | null
  targetDate?: string | null
}

const STATUS_LABEL = Object.fromEntries(PROJECT_STATUSES.map((s) => [s.value, s.label])) as Record<string, string>

export function rapSummaryDto(s: ProjectRapSummary | undefined, prices: boolean) {
  if (!s) return { items: 0, planned: null, realised: null, transferred: null, verified: null, remaining: null, percent: null, overBudgetItems: null }
  return prices
    ? { items: s.items, planned: s.planned, realised: s.realised, transferred: s.transferred, verified: s.verified, remaining: s.remaining, percent: s.percent, overBudgetItems: s.overBudgetItems }
    : { items: s.items, planned: null, realised: null, transferred: null, verified: null, remaining: null, percent: null, overBudgetItems: null }
}

type Ref = { id: number; code: string; name: string }

/** {id, code, name} of the referenced cost centers / sites of the visible projects (names only, no other data). */
async function refsOf(req: PayloadRequest, collection: 'cost-centers' | 'sites', ids: Array<number | undefined>): Promise<Map<number, Ref>> {
  const list = [...new Set(ids.filter((x): x is number => x !== undefined))]
  if (list.length === 0) return new Map()
  const res = await req.payload.find({ collection, where: { id: { in: list } }, depth: 0, pagination: false, select: { code: true, name: true }, overrideAccess: true /* SYSTEM-READ: names of the visible projects' cost centers / sites */, req })
  return new Map(res.docs.map((c) => [c.id as number, { id: c.id as number, code: String((c as { code?: string }).code ?? ''), name: String((c as { name?: string }).name ?? '') }]))
}

/** RAB of the projects regardless of the caller's field access (D4 rule input; the amount itself is not returned). */
async function budgetsOf(req: PayloadRequest, docs: ProjectDoc[]): Promise<Map<number, number | null>> {
  if (docs.length === 0) return new Map()
  const res = await req.payload.find({ collection: 'projects', where: { id: { in: docs.map((d) => d.id) } }, depth: 0, pagination: false, select: { budget: true }, overrideAccess: true /* SYSTEM-READ: RAB of the visible projects for the D4 RAP rule */, req })
  return new Map(res.docs.map((d) => [d.id as number, typeof (d as { budget?: unknown }).budget === 'number' ? ((d as { budget: number }).budget) : null]))
}

async function items(req: PayloadRequest, docs: ProjectDoc[]) {
  const pmIds = docs.map((d) => relId(d.pm)).filter((x): x is number => x !== undefined)
  const [names, ccs, sites, rap, budgets] = [
    await displayNames(req, pmIds),
    await refsOf(req, 'cost-centers', docs.map((d) => relId(d.costCenter))),
    await refsOf(req, 'sites', docs.map((d) => relId(d.site))),
    await projectRapSummaries(req, docs.map((d) => d.id)),
    await budgetsOf(req, docs),
  ]
  const out = []
  for (const d of docs) {
    const company = relId(d.company) ?? -1
    const prices = (await rapRoles(req, { id: d.id, company })).prices
    const pm = relId(d.pm)
    const s = rap.get(d.id)
    out.push({
      id: d.id,
      code: d.code ?? '',
      name: d.name ?? '',
      kind: d.kind ?? 'umum',
      companyId: company,
      pm: pm !== undefined ? { id: pm, name: names.get(pm) ?? `user#${pm}` } : null,
      status: d.status ?? null,
      statusLabel: d.status ? (STATUS_LABEL[d.status] ?? d.status) : null,
      // RAB of the project: null for callers without a money role in its PT (field access, access/money.ts: Staff, Operator)
      contractValue: typeof d.budget === 'number' ? d.budget : null,
      progressPct: typeof d.progressPct === 'number' ? d.progressPct : null,
      costCenter: ccs.get(relId(d.costCenter) ?? -1) ?? null,
      // ADR 0023: the branch office (kantor cabang) that handles the project
      site: sites.get(relId(d.site) ?? -1) ?? null,
      rapPlanned: prices ? (s?.planned ?? null) : null,
      rapRealised: prices ? (s?.realised ?? null) : null,
      rapPercent: prices ? (s?.percent ?? null) : null,
      rapOverBudgetItems: prices ? (s?.overBudgetItems ?? 0) : null,
      rapItems: s?.items ?? 0,
      // DRMS 10/10 D4 (owner 2026-10-11): a project with a RAB (or konstruksi) needs a RAP before requests can be sent
      rapRequired: rapRequiredFor({ kind: d.kind ?? 'umum', budget: budgets.get(d.id) ?? null }),
      rapMissing: rapRequiredFor({ kind: d.kind ?? 'umum', budget: budgets.get(d.id) ?? null }) && (s?.activeItems ?? 0) === 0,
    })
  }
  return out
}

/** GET /projects — paged, searchable (kode / nama), status filter (default: every status but Arsip). */
export async function listProjects(req: PayloadRequest, q: ProjectListQuery) {
  const and: Where[] = []
  const statuses = (q.status ?? '').split(',').filter(Boolean)
  and.push(statuses.length ? { status: { in: statuses } } : { status: { not_in: ['arsip', 'dibatalkan'] } })
  const text = searchWhere(['code', 'name'], q.q)
  if (text) and.push(text)
  if (q.companies?.length) and.push({ company: { in: q.companies } })
  if (q.site) and.push({ site: { equals: q.site } }) // ADR 0023: only narrows the read scope
  try {
    const res = await req.payload.find({ collection: 'projects', where: { and }, sort: 'code', page: q.page, limit: q.limit, depth: 0, user: req.user, overrideAccess: false /* caller's project read scope */, req })
    return { docs: await items(req, res.docs as unknown as ProjectDoc[]), totalDocs: res.totalDocs, page: res.page ?? q.page, totalPages: Math.max(1, res.totalPages), limit: res.limit }
  } catch (err) {
    if ((err as { status?: number }).status === 403) return { docs: [], totalDocs: 0, page: 1, totalPages: 1, limit: q.limit }
    throw err
  }
}

/** GET /projects/{id} — one visible project (else 404) incl. PM, default cost center and RAP summary. */
export async function projectDetail(req: PayloadRequest, id: number) {
  const d = (await req.payload.findByID({ collection: 'projects', id, depth: 0, user: req.user, overrideAccess: false /* caller's read scope */, req }).catch(() => null)) as ProjectDoc | null
  if (!d) return null
  const [item] = await items(req, [d])
  const prices = (await rapRoles(req, { id, company: relId(d.company) ?? -1 })).prices
  const client = relId(d.client)
  const clientDoc = client !== undefined ? ((await req.payload.findByID({ collection: 'clients', id: client, depth: 0, select: { name: true }, overrideAccess: true /* SYSTEM-READ: name of the visible project's client */, req, disableErrors: true })) as { name?: string } | null) : null
  return {
    ...item!,
    client: client !== undefined ? { id: client, name: clientDoc?.name ?? '' } : null,
    address: d.address ?? null,
    startDate: d.startDate ? d.startDate.slice(0, 10) : null,
    targetDate: d.targetDate ? d.targetDate.slice(0, 10) : null,
    rap: rapSummaryDto((await projectRapSummaries(req, [id])).get(id), prices),
  }
}

/** GET /cost-centers — the caller's readable cost centers (Finance: every one of the selected PTs; transfer picker). */
export async function listCostCenters(req: PayloadRequest, q: { q?: string; companies?: number[]; includeInactive?: boolean }) {
  const and: Where[] = []
  if (!q.includeInactive) and.push({ active: { not_equals: false } })
  const text = searchWhere(['code', 'name'], q.q)
  if (text) and.push(text)
  if (q.companies?.length) and.push({ company: { in: q.companies } })
  try {
    const res = await req.payload.find({ collection: 'cost-centers', where: and.length ? { and } : undefined, sort: 'code', limit: 500, depth: 0, user: req.user, overrideAccess: false /* caller's read scope */, req })
    return {
      docs: (res.docs as Array<{ id: number; code?: string; name?: string; type?: string; company?: unknown; active?: boolean | null }>).map((c) => ({
        id: c.id,
        code: c.code ?? '',
        name: c.name ?? '',
        type: c.type ?? null,
        companyId: relId(c.company) ?? null,
        active: c.active !== false,
      })),
      totalDocs: res.totalDocs,
    }
  } catch (err) {
    if ((err as { status?: number }).status === 403) return { docs: [], totalDocs: 0 }
    throw err
  }
}

/**
 * ADR 0023 §6: GET /sites — the sites (kantor cabang) of the selected PTs (every member of a PT reads them) with
 * the caller's flags: `home` (own home site), `assigned` (active site assignment today), `team` (may record PM
 * on-behalf there). Effective radius = own or the PT default (like projects in /masters).
 */
export async function listSites(req: PayloadRequest, q: { q?: string; companies?: number[]; includeInactive?: boolean }) {
  const and: Where[] = []
  if (!q.includeInactive) and.push({ active: { not_equals: false } })
  const text = searchWhere(['code', 'name'], q.q)
  if (text) and.push(text)
  if (q.companies?.length) and.push({ company: { in: q.companies } })
  type SiteDoc = { id: number; code?: string; name?: string; company?: unknown; address?: string | null; lat?: number | null; lng?: number | null; radiusM?: number | null; costCenter?: unknown; defaultWorkSchedule?: unknown; active?: boolean | null }
  let docs: SiteDoc[] = []
  try {
    const res = await req.payload.find({ collection: 'sites', where: and.length ? { and } : undefined, sort: 'code', limit: 500, depth: 0, user: req.user, overrideAccess: false /* caller's read scope */, req })
    docs = res.docs as unknown as SiteDoc[]
  } catch (err) {
    if ((err as { status?: number }).status === 403) return { docs: [], totalDocs: 0 }
    throw err
  }
  const ccs = await refsOf(req, 'cost-centers', docs.map((d) => relId(d.costCenter)))
  const wsIds = [...new Set(docs.map((d) => relId(d.defaultWorkSchedule)).filter((x): x is number => x !== undefined))]
  const ws = wsIds.length
    ? new Map(
        (await req.payload.find({ collection: 'work-schedules', where: { id: { in: wsIds } }, depth: 0, pagination: false, select: { name: true }, overrideAccess: true /* SYSTEM-READ: schedule names of the visible sites */, req })).docs.map((w) => [w.id as number, { id: w.id as number, name: String((w as { name?: string }).name ?? '') }]),
      )
    : new Map<number, { id: number; name: string }>()
  const flags = new Map<number, SiteFlags>()
  const out = []
  for (const d of docs) {
    const company = relId(d.company) ?? -1
    if (!flags.has(company)) flags.set(company, await siteFlagsFor(req, company, await today(req, company)))
    const f = flags.get(company)!
    const radius = typeof d.lat === 'number' && typeof d.lng === 'number' && typeof d.radiusM !== 'number' ? effectiveRadiusM(null, (await companyById(req, company)).defaultGeofenceRadiusM) : (d.radiusM ?? null)
    out.push({
      id: d.id,
      code: d.code ?? '',
      name: d.name ?? '',
      companyId: company,
      address: d.address ?? null,
      lat: typeof d.lat === 'number' ? d.lat : null,
      lng: typeof d.lng === 'number' ? d.lng : null,
      radiusM: radius,
      costCenter: ccs.get(relId(d.costCenter) ?? -1) ?? null,
      defaultWorkSchedule: ws.get(relId(d.defaultWorkSchedule) ?? -1) ?? null,
      active: d.active !== false,
      home: f.home === d.id,
      assigned: f.assigned.has(d.id),
      team: f.team.has(d.id),
    })
  }
  return { docs: out, totalDocs: out.length }
}
