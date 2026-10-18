import { createHash } from 'node:crypto'

import type { CollectionSlug, PayloadRequest, Where } from 'payload'

import { memberCompanies, relId } from '@/access/roles'
import { withEffectiveRadius } from '@/domain/attendance/calendar'
import { companyById } from '@/domain/companies'
import { today } from '@/domain/expense/common'
import { siteFlagsFor, type SiteFlags } from '@/domain/sites'
import { mayFileIntercompany } from '@/domain/expense/drafts'
import { direkturEmployees } from '@/domain/expense/on-behalf'
import { payeeDirectory } from '@/domain/intercompany/service'
import { INCLUDE_DELETED, softDeleteEntry } from '@/domain/soft-delete/registry'
import { ONLY_DELETED } from '@/domain/soft-delete/where'

import { companyQuery } from '../company-query'
import { MASTER_TYPES, MastersQuery, SHARED_MASTER_TYPES, type MasterType } from '../schemas'
import { HttpError, problem, v1 } from '../http'

const LIMIT = 500

/** type → collection + whitelisted fields (never internal/sensitive columns like odoo refs). ADR 0028: `intercompany-payees` is computed. */
const MAP: Record<Exclude<MasterType, 'intercompany-payees'>, { collection: CollectionSlug; fields: string[] }> = {
  projects: { collection: 'projects', fields: ['code', 'name', 'kind', 'client', 'site', 'address', 'lat', 'lng', 'radiusM', 'pm', 'status', 'startDate', 'targetDate', 'progressPct'] },
  'project-stages': { collection: 'project-stages', fields: ['project', 'name', 'weightPct', 'sequence', 'progressPct', 'active'] },
  'cost-centers': { collection: 'cost-centers', fields: ['code', 'name', 'type', 'manager', 'lat', 'lng', 'radiusM', 'active'] },
  'expense-categories': { collection: 'expense-categories', fields: ['code', 'name', 'defaultUom', 'allowedUoms', 'requiresVehicle', 'active'] },
  uoms: { collection: 'uoms', fields: ['code', 'name', 'category', 'active'] },
  vehicles: { collection: 'vehicles', fields: ['kind', 'displayName', 'unitCode', 'plateNo', 'plateDisplay', 'type', 'brandModel', 'owner', 'status', 'costCenter', 'project', 'active'] },
  employees: { collection: 'employees', fields: ['code', 'name', 'nickname', 'position', 'homeSite', 'active'] },
  banks: { collection: 'banks', fields: ['code', 'name', 'active'] },
  'bank-accounts': { collection: 'employee-bank-accounts', fields: ['employee', 'bank', 'accountNo', 'accountHolder', 'isDefault', 'verificationStatus', 'active'] },
  'work-schedules': { collection: 'work-schedules', fields: ['name', 'startTime', 'endTime', 'lateToleranceMin', 'workDays', 'active'] },
  holidays: { collection: 'holidays', fields: ['date', 'name'] },
  'team-assignments': { collection: 'team-assignments', fields: ['employee', 'project', 'costCenter', 'site', 'roleInProject', 'startDate', 'endDate'] },
  // MC3-1: receipt vendor picker (vendor_id) and Kas "sumber kas masuk" — per PT, read access of the collection
  vendors: { collection: 'vendors', fields: ['name', 'contact', 'active'] },
  // ADR 0027: vendor payment — the chosen vendor's accounts (collection access: Admin / Finance / Direktur / PM / Staff,
  // Staff since the owner request 2026-10-16 — Staff file vendor payments too)
  'vendor-bank-accounts': { collection: 'vendor-bank-accounts', fields: ['vendor', 'bank', 'accountNo', 'accountHolder', 'isDefault', 'verificationStatus', 'active'] },
  'cash-in-sources': { collection: 'cash-in-sources', fields: ['code', 'name', 'active'] },
  'urgency-levels': { collection: 'urgency-levels', fields: ['code', 'name', 'rank', 'active'] },
  // FR1: customers (collection access: office roles + PM; Staff only when assigned to an aftersales project of the PT)
  clients: { collection: 'clients', fields: ['name', 'contact', 'phone', 'active'] },
  // ADR 0023: kantor cabang (every member of the PT reads them) + per-caller flags home / assigned / team (siteFlagsFor)
  sites: { collection: 'sites', fields: ['code', 'name', 'isHeadOffice', 'address', 'lat', 'lng', 'radiusM', 'costCenter', 'defaultWorkSchedule', 'active'] },
}

const SHARED: ReadonlySet<MasterType> = new Set(SHARED_MASTER_TYPES)

type Item = Record<string, unknown>

function pick(doc: Record<string, unknown>, fields: string[], shared: boolean): Item {
  const out: Item = { id: doc.id, uuid: doc.uuid ?? undefined, updatedAt: doc.updatedAt, company: shared ? null : (relId(doc.company) ?? null), shared }
  for (const f of fields) {
    const v = doc[f]
    out[f] = v === undefined ? null : v
  }
  return out
}

/**
 * ADR 0028: per requested paying PT where the caller is Finance / PM / Direktur, the payee directory (other active PTs
 * with a designated receiving account; masked numbers). Not delta-synced (`since` ignored: a small, computed list).
 */
async function intercompanyPayees(req: PayloadRequest, companies: number[]) {
  const items: Item[] = []
  for (const company of companies) {
    if (!mayFileIntercompany(req, company)) continue
    for (const p of await payeeDirectory(req, company)) {
      items.push({ id: p.companyId, company, shared: false, payeeCompanyId: p.companyId, shortCode: p.shortCode, name: p.name, bankName: p.bankName, accountNoMasked: p.accountNoMasked, accountHolder: p.accountHolder, active: true })
    }
  }
  return { items, hasMore: false }
}

async function loadType(req: PayloadRequest, type: MasterType, companies: number[], since?: string) {
  if (type === 'intercompany-payees') return intercompanyPayees(req, companies)
  const { collection, fields } = MAP[type]
  const shared = SHARED.has(type)
  const and: Where[] = []
  if (since) and.push({ updatedAt: { greater_than: since } })
  // per-PT masters: the PTs of this request (selection, narrowed by ?company=) — the collection
  // access applies on top (scope own/team/assigned/all per role IN each PT, ADR 0016 §5)
  if (!shared) and.push({ company: { in: companies.length ? companies : [-1] } })
  try {
    const res = await req.payload.find({
      collection,
      where: { and },
      sort: 'updatedAt',
      limit: LIMIT,
      depth: 0,
      overrideAccess: false, // access control of the collection applies (scope own/team/assigned/all)
      req,
    })
    let items = res.docs.map((d) => pick(d as unknown as Record<string, unknown>, fields, shared))
    // D1610 (ADR 0030): soft-deleted rows are not in the list (central read rule). A delta read (`since`) gets them as
    // tombstones (`deleted: true`, `active: false`) so a delta cache can drop them; the full read simply omits them.
    if (since && softDeleteEntry(collection)) items = [...items, ...(await tombstones(req, collection, and, fields, shared))]
    // a cancelled project ("Batalkan proyek") is closed: inactive for the APK pickers (attendance, progress, reports)
    if (type === 'projects') items = items.map((i) => (i.status === 'dibatalkan' ? { ...i, active: false } : i))
    // assignments to a soft-deleted project are left out (the project itself is not in `projects`)
    if (type === 'team-assignments') items = await withoutDeletedProjects(req, items)
    if (type === 'sites') {
      // ADR 0023 §6: the caller's own check-in sites (home site / active site assignment) and on-behalf sites (team)
      const flags = new Map<number, SiteFlags>()
      for (const i of items) {
        const c = i.company as number
        if (!flags.has(c)) flags.set(c, await siteFlagsFor(req, c, await today(req, c)))
        const f = flags.get(c)!
        i.home = f.home === i.id
        i.assigned = f.assigned.has(i.id as number)
        i.team = f.team.has(i.id as number)
      }
    }
    if (type === 'employees' && items.length > 0) {
      // ADR 0024: `direktur` = the employee's account holds Direktur in the employee's PT — the APK does not
      // offer such an employee as requester to anyone else (a Direktur files his own request; server: 403 / 409).
      // ADR 0026: also an Owner (pk-principal) — the Owner's own request is the no-approval one (filed by himself).
      const dir = await direkturEmployees(req, items.map((i) => i.id as number))
      items = items.map((i) => ({ ...i, direktur: dir.has(i.id as number) }))
    }
    if (type === 'projects' || type === 'cost-centers' || type === 'sites') {
      // default geofence radius of EACH item's PT (ADR 0016 §1: per-PT setting)
      const out: Item[] = []
      for (const i of items) out.push(typeof i.company === 'number' ? withEffectiveRadius(i, (await companyById(req, i.company)).defaultGeofenceRadiusM) : i)
      items = out
    }
    return { items, hasMore: res.hasNextPage }
  } catch (err) {
    // Access `false` (nothing in scope, e.g. staff without assignments) → Forbidden → empty list.
    if ((err as { status?: number }).status === 403) return { items: [], hasMore: false }
    throw err
  }
}

/** D1610: rows soft-deleted since the delta point, within the caller's read access (`isDeleted` kept: INCLUDE_DELETED). */
async function tombstones(req: PayloadRequest, collection: CollectionSlug, and: Where[], fields: string[], shared: boolean): Promise<Item[]> {
  const before = req.context[INCLUDE_DELETED]
  req.context[INCLUDE_DELETED] = true
  try {
    const res = await req.payload.find({ collection, where: { and: [...and, ONLY_DELETED] }, sort: 'updatedAt', limit: LIMIT, depth: 0, overrideAccess: false /* caller's read scope */, req })
    return res.docs.map((d) => ({ ...pick(d as unknown as Record<string, unknown>, fields, shared), active: false, deleted: true }))
  } finally {
    if (before === undefined) delete req.context[INCLUDE_DELETED]
    else req.context[INCLUDE_DELETED] = before
  }
}

/** D1610: team assignments whose project is soft-deleted are dropped from the masters answer. */
async function withoutDeletedProjects(req: PayloadRequest, items: Item[]): Promise<Item[]> {
  const ids = [...new Set(items.map((i) => relId(i.project)).filter((x): x is number => x !== undefined))]
  if (ids.length === 0) return items
  const res = await req.payload.find({ collection: 'projects', where: { and: [{ id: { in: ids } }, ONLY_DELETED] }, depth: 0, pagination: false, select: { id: true } as never, overrideAccess: true /* SYSTEM-READ: which assigned projects are soft-deleted (ids only) */, req })
  const gone = new Set((res.docs as unknown as Array<{ id: number }>).map((d) => d.id))
  return gone.size === 0 ? items : items.filter((i) => !gone.has(relId(i.project) ?? -1))
}

const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')

/** "W/\"a\", \"b\"" → ['a', 'b'] (weak/strong compare, RFC 9110 §13.1.2); `*` matches anything. */
function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false
  const strip = (t: string) => t.trim().replace(/^W\//, '')
  const want = strip(etag)
  return header.split(',').some((t) => t.trim() === '*' || strip(t) === want)
}

/**
 * GET /api/v1/masters?types=a,b&since=ISO&company=1,3 — master data for the APK (architecture
 * §6.3, MC3-1 per PT), filtered by each collection's read access for the caller.
 * - Per-PT masters come from the request's PTs (`X-Company-Ids` ∩ memberships, narrowed by
 *   `?company=`); every item carries `company` (id) and `shared: false`. Shared masters (banks,
 *   UoM, holidays — ADR 0016 D2) carry `company: null, shared: true`.
 * - Projects / cost centers without an own radius get the default radius of THEIR PT.
 * - `companies[]`: per requested PT its `version` (hash of that PT's items in this answer) and the
 *   default radius; `sharedVersion` for the shared types — the APK caches per PT and refetches a PT
 *   only when its version changed. The whole answer has an `ETag`; `If-None-Match` → 304.
 * Deactivated rows are included (`active`) so the APK can hide them; delta via `since` (ordered by
 * updatedAt, ≤ 500 per type). D1610 (ADR 0030): soft-deleted rows never appear in a full read; a delta read lists
 * the rows deleted since then as tombstones (`deleted: true, active: false`); a cancelled project has `active: false`.
 */
export const mastersEndpoint = v1({
  path: '/masters',
  method: 'get',
  handler: async ({ req }) => {
    const parsed = MastersQuery.safeParse({
      types: req.searchParams.get('types') ?? undefined,
      since: req.searchParams.get('since') ?? undefined,
      company: req.searchParams.get('company') ?? undefined,
    })
    if (!parsed.success) return problem(400, 'Bad Request', { errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) })
    const requested = parsed.data.types ? parsed.data.types.split(',') : [...MASTER_TYPES]
    const unknown = requested.filter((t) => !(MASTER_TYPES as readonly string[]).includes(t))
    if (unknown.length) throw new HttpError(400, 'Bad Request', { detail: `Unknown types: ${unknown.join(', ')}` })
    const companies = (await companyQuery(req)) ?? [...memberCompanies(req)].sort((a, b) => a - b)
    const types: Record<string, { items: Item[]; hasMore: boolean }> = {}
    for (const t of new Set(requested) as Set<MasterType>) types[t] = await loadType(req, t, companies, parsed.data.since)
    const perCompany = []
    for (const id of companies) {
      const c = await companyById(req, id)
      const mine = Object.fromEntries(Object.entries(types).filter(([t]) => !SHARED.has(t as MasterType)).map(([t, v]) => [t, v.items.filter((i) => i.company === id)]))
      perCompany.push({ id, code: c.shortCode, defaultGeofenceRadiusM: c.defaultGeofenceRadiusM, version: digest({ id, radius: c.defaultGeofenceRadiusM, mine }).slice(0, 20) })
    }
    const sharedVersion = digest(Object.entries(types).filter(([t]) => SHARED.has(t as MasterType))).slice(0, 20)
    const body = { serverTime: new Date().toISOString(), companies: perCompany, sharedVersion, types }
    const etag = `W/"m1-${digest({ companies: perCompany, sharedVersion, types: Object.keys(types).sort(), since: parsed.data.since ?? null }).slice(0, 32)}"`
    const headers = { 'Cache-Control': 'private, no-store', ETag: etag, Vary: 'Authorization, Cookie, X-Company-Ids' }
    if (etagMatches(req.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers })
    return Response.json(body, { status: 200, headers })
  },
})
