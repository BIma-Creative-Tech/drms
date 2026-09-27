import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest, Where } from 'payload'
import { z } from 'zod'

import { relId, rolesOf, type Role } from '@/access/roles'
import { getRequestTx } from '@/lib/tx'

import type { CashEntryDoc } from './ledger'
import { isPeriod, periodEnd } from './periods'

/**
 * E2 (fase1-golive §E2): read side of the web "Kas" views — buku kas with filters, saldo per
 * akun, period summaries for "Tutup buku". Writes stay in ledger.ts behind /api/v1 (the views
 * post to the domain endpoints; the collections keep create/update: denyAll).
 * Reads use the CALLER's collection access (overrideAccess:false); raw SQL (sums) runs inside the
 * request transaction with parameters only.
 */

// ---------------------------------------------------------------- pure rules (unit-tested)

/**
 * Who may use the Kas views (fase1-golive §E2; G1-1: "Direktur" = role pk-owner). Finance writes,
 * Direktur reads, closes and alone re-opens (ADR 0005 §6); PM/Staff/Admin: no menu, no page
 * (the /api/v1 endpoints answer them 403 on their own).
 */
export const KAS_VIEW_ROLES: Role[] = ['pk-finance', 'pk-owner']
export const KAS_WRITE_ROLES: Role[] = ['pk-finance']

export function kasAccess(user: unknown): { view: boolean; write: boolean; close: boolean; reopen: boolean } {
  const r = rolesOf(user)
  const view = r.some((x) => KAS_VIEW_ROLES.includes(x))
  return { view, write: r.some((x) => KAS_WRITE_ROLES.includes(x)), close: view, reopen: r.includes('pk-owner') }
}

const optId = z.preprocess((v) => (v === '' || v === undefined ? undefined : v), z.coerce.number().int().positive().max(2_147_483_647).optional())
const optPeriod = z.preprocess((v) => (v === '' || v === undefined ? undefined : v), z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional())

/** Query string of /admin/kas (server-side Zod; invalid values are dropped, never passed on). */
export const BookQuery = z.object({
  akun: optId,
  periode: optPeriod,
  project: optId,
  pusat: optId,
  arah: z.enum(['masuk', 'keluar']).optional().catch(undefined),
  status: z.enum(['posted', 'void']).optional().catch(undefined),
  hal: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
})
export type BookQuery = z.infer<typeof BookQuery>

export function parseBookQuery(sp: Record<string, string | string[] | undefined> | undefined): BookQuery {
  const flat: Record<string, string> = {}
  for (const [k, v] of Object.entries(sp ?? {})) {
    const s = Array.isArray(v) ? v[0] : v
    if (typeof s === 'string') flat[k] = s
  }
  const out: Record<string, unknown> = {}
  // field by field: one bad value drops only that filter
  for (const [k, schema] of Object.entries(BookQuery.shape)) {
    const r = (schema as z.ZodType).safeParse(flat[k])
    if (r.success && r.data !== undefined) out[k] = r.data
  }
  return { hal: 1, ...out } as BookQuery
}

export function bookWhere(q: BookQuery): Where | undefined {
  const and: Where[] = []
  if (q.akun) and.push({ cashAccount: { equals: q.akun } })
  if (q.periode) and.push({ period: { equals: q.periode } })
  if (q.project) and.push({ project: { equals: q.project } })
  if (q.pusat) and.push({ costCenter: { equals: q.pusat } })
  if (q.arah) and.push({ direction: { equals: q.arah === 'masuk' ? 'in' : 'out' } })
  if (q.status) and.push({ status: { equals: q.status } })
  return and.length ? { and } : undefined
}

/** Same rules as ledger.ts editManualEntry (UI hint only; the server re-checks). */
export function canEdit(e: Pick<CashEntryDoc, 'sourceType' | 'status' | 'entryDate'>, lockDate: string | null): boolean {
  return e.sourceType === 'manual' && e.status === 'posted' && !(lockDate && e.entryDate <= lockDate)
}

/** Same rules as ledger.ts voidEntry for a direct void (transfer postings go through the transfer). */
export function canVoid(e: Pick<CashEntryDoc, 'sourceType' | 'status'>): boolean {
  return e.status === 'posted' && (e.sourceType === 'manual' || e.sourceType === 'opening')
}

/** Why a row has no Void button (shown as a hint). */
export function voidHint(e: Pick<CashEntryDoc, 'sourceType' | 'status'>): string | null {
  if (e.status === 'void') return null
  if (e.sourceType === 'transfer') return 'Batalkan lewat transfer pengajuan'
  if (e.sourceType === 'reversal') return 'Jurnal balik tidak dapat di-void'
  if (e.sourceType === 'settlement_refund') return 'Bagian dari LPJ'
  return null
}

/** 'YYYY-MM' of a business date. */
const monthOf = (d: string) => d.slice(0, 7)

function shift(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number) as [number, number]
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

/**
 * Months that can be closed now (ledger.ts closePeriod: past months only; the lock date moves
 * forward): after the lock month up to last month, oldest first, at most `max` (no lock yet →
 * the last `max` months).
 */
export function closablePeriods(today: string, lockDate: string | null, max = 12): string[] {
  const last = shift(monthOf(today), -1)
  const first = lockDate ? shift(monthOf(lockDate), 1) : shift(last, -(max - 1))
  const out: string[] = []
  for (let p = first; p <= last && out.length < max; p = shift(p, 1)) out.push(p)
  return out
}

/** Last `n` periods ending with the current month, newest first. */
export function recentPeriods(today: string, n = 12): string[] {
  return Array.from({ length: n }, (_, i) => shift(monthOf(today), -i))
}

export type PeriodState = 'closed' | 'open' | 'current'
export function periodState(period: string, today: string, lockDate: string | null): PeriodState {
  if (lockDate && periodEnd(period) <= lockDate) return 'closed'
  return period === monthOf(today) ? 'current' : 'open'
}

/** Earliest date a new posting may carry (day after the lock date). */
export function minPostingDate(lockDate: string | null): string | null {
  if (!lockDate) return null
  const d = new Date(`${lockDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Digits of a Rupiah text field ("Rp 1.250.000" → 1250000); null when empty/invalid. */
export function parseRupiahInput(v: string): number | null {
  const digits = v.replace(/[^\d]/g, '')
  if (!digits || digits.length > 13) return null
  const n = Number(digits)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

// ---------------------------------------------------------------- DB reads

export type Option = { id: number; label: string; active: boolean }
export type Lookups = {
  accounts: Option[]
  projects: Option[]
  costCenters: Option[]
  categories: Array<Option & { requiresVehicle: boolean }>
  sources: Option[]
  vehicles: Option[]
}

async function all(req: PayloadRequest, collection: 'cash-accounts' | 'projects' | 'cost-centers' | 'expense-categories' | 'cash-in-sources' | 'vehicles', sort: string) {
  const r = await req.payload.find({ collection, depth: 0, pagination: false, sort, user: req.user, overrideAccess: false, req })
  return r.docs as unknown as Array<Record<string, unknown>>
}

const codeName = (d: Record<string, unknown>) => [d.code, d.name].filter(Boolean).join(' ')

/** Masters for filters, labels and the forms (Finance/Owner may read all of them). */
export async function cashLookups(req: PayloadRequest): Promise<Lookups> {
  const [accounts, projects, costCenters, categories, sources, vehicles] = await Promise.all([
    all(req, 'cash-accounts', 'name'),
    all(req, 'projects', 'code'),
    all(req, 'cost-centers', 'code'),
    all(req, 'expense-categories', 'name'),
    all(req, 'cash-in-sources', 'name'),
    all(req, 'vehicles', 'plateNo'),
  ])
  return {
    accounts: accounts.map((d) => ({ id: d.id as number, label: String(d.name ?? ''), active: d.active !== false })),
    projects: projects.map((d) => ({ id: d.id as number, label: codeName(d), active: d.status !== 'selesai' && d.status !== 'arsip' })),
    costCenters: costCenters.map((d) => ({ id: d.id as number, label: codeName(d), active: d.active !== false })),
    categories: categories.map((d) => ({ id: d.id as number, label: codeName(d), active: d.active !== false, requiresVehicle: d.requiresVehicle === true })),
    sources: sources.map((d) => ({ id: d.id as number, label: codeName(d), active: d.active !== false })),
    vehicles: vehicles.map((d) => ({ id: d.id as number, label: [d.plateDisplay ?? d.plateNo, d.type].filter(Boolean).join(' · '), active: d.active !== false })),
  }
}

export type BookRow = {
  id: number
  entryNo: string
  entryDate: string
  period: string | null
  direction: 'in' | 'out'
  amount: number
  status: 'posted' | 'void'
  sourceType: CashEntryDoc['sourceType']
  description: string | null
  cashAccountId: number
  projectId: number | null
  costCenterId: number | null
  categoryId: number | null
  cashInSourceId: number | null
  vehicleId: number | null
  proofId: number | null
  voidReason: string | null
  reversalOf: { id: number; entryNo: string } | null
  reversedBy: { id: number; entryNo: string } | null
  request: { id: number; docNo: string | null } | null
}

const PAGE_SIZE = 50

/** One page of the ledger, newest business date first; linked reversal numbers and request numbers resolved. */
export async function cashBookPage(req: PayloadRequest, q: BookQuery, limit = PAGE_SIZE) {
  const res = await req.payload.find({
    collection: 'cash-entries',
    where: bookWhere(q),
    sort: ['-entryDate', '-id'],
    limit,
    page: q.hal,
    depth: 0,
    user: req.user,
    overrideAccess: false, // collection read access (Finance/Owner/Admin)
    req,
  })
  const docs = res.docs as unknown as Array<CashEntryDoc & { proof?: unknown }>
  const linkIds = [...new Set(docs.flatMap((d) => [relId(d.reversalOf), relId(d.reversedBy)]).filter((x): x is number => x !== undefined))]
  const reqIds = [...new Set(docs.map((d) => relId(d.expenseRequest)).filter((x): x is number => x !== undefined))]
  const [links, requests] = await Promise.all([
    linkIds.length
      ? req.payload.find({ collection: 'cash-entries', where: { id: { in: linkIds } }, depth: 0, pagination: false, select: { entryNo: true }, user: req.user, overrideAccess: false, req })
      : null,
    reqIds.length
      ? req.payload.find({ collection: 'expense-requests', where: { id: { in: reqIds } }, depth: 0, pagination: false, select: { docNo: true }, user: req.user, overrideAccess: false, req })
      : null,
  ])
  const noOf = new Map((links?.docs ?? []).map((d) => [d.id as number, String((d as { entryNo?: string }).entryNo ?? '')]))
  const docNoOf = new Map((requests?.docs ?? []).map((d) => [d.id as number, ((d as { docNo?: string | null }).docNo ?? null) as string | null]))
  const link = (v: unknown) => {
    const id = relId(v)
    return id === undefined ? null : { id, entryNo: noOf.get(id) ?? `#${id}` }
  }
  const rows: BookRow[] = docs.map((d) => {
    const rid = relId(d.expenseRequest)
    return {
      id: d.id,
      entryNo: d.entryNo,
      entryDate: d.entryDate,
      period: d.period ?? null,
      direction: d.direction,
      amount: d.amount,
      status: d.status,
      sourceType: d.sourceType,
      description: d.description ?? null,
      cashAccountId: relId(d.cashAccount)!,
      projectId: relId(d.project) ?? null,
      costCenterId: relId(d.costCenter) ?? null,
      categoryId: relId(d.category) ?? null,
      cashInSourceId: relId(d.cashInSource) ?? null,
      vehicleId: relId(d.vehicle) ?? null,
      proofId: relId(d.proof) ?? null,
      voidReason: d.voidReason ?? null,
      reversalOf: link(d.reversalOf),
      reversedBy: link(d.reversedBy),
      request: rid === undefined ? null : { id: rid, docNo: docNoOf.get(rid) ?? null },
    }
  })
  return { rows, totalDocs: res.totalDocs, page: res.page ?? 1, totalPages: res.totalPages }
}

type SumRow = { key: string; n: number; tin: number; tout: number }

async function sums(req: PayloadRequest, query: ReturnType<typeof sql>): Promise<SumRow[]> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(query)) as unknown as { rows: Array<{ k: string | number; n: number; tin: string; tout: string }> }
  return r.rows.map((x) => ({ key: String(x.k), n: Number(x.n), tin: Number(x.tin), tout: Number(x.tout) }))
}

/** Σ in / Σ out per cash account in one period (all rows: void + reversal cancel out, ADR 0005). */
export async function accountFlows(req: PayloadRequest, period: string): Promise<Map<number, { n: number; tin: number; tout: number }>> {
  if (!isPeriod(period)) return new Map()
  const rows = await sums(
    req,
    sql`SELECT cash_account_id AS k, count(*)::int AS n,
               coalesce(sum(CASE WHEN direction = 'in' THEN amount ELSE 0 END), 0)::text AS tin,
               coalesce(sum(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0)::text AS tout
        FROM cash_entries WHERE period = ${period} GROUP BY cash_account_id`,
  )
  return new Map(rows.map((r) => [Number(r.key), { n: r.n, tin: r.tin, tout: r.tout }]))
}

/** Per period: number of rows, Σ in, Σ out, voided rows (Tutup buku overview). */
export async function periodSummaries(req: PayloadRequest, periods: string[]): Promise<Map<string, { n: number; tin: number; tout: number; voids: number }>> {
  const valid = periods.filter(isPeriod)
  if (valid.length === 0) return new Map()
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT period AS k, count(*)::int AS n,
           coalesce(sum(CASE WHEN direction = 'in' THEN amount ELSE 0 END), 0)::text AS tin,
           coalesce(sum(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0)::text AS tout,
           count(*) FILTER (WHERE status = 'void')::int AS voids
    FROM cash_entries WHERE period IN (${sql.join(
      valid.map((p) => sql`${p}`),
      sql`, `,
    )}) GROUP BY period`)) as unknown as { rows: Array<{ k: string; n: number; tin: string; tout: string; voids: number }> }
  return new Map(r.rows.map((x) => [x.k, { n: Number(x.n), tin: Number(x.tin), tout: Number(x.tout), voids: Number(x.voids) }]))
}

// ---------------------------------------------------------------- transfer void (T8) list

export type VoidableTransfer = {
  transferId: number
  transferNo: string
  transferDate: string
  amount: number
  cashAccountId: number | null
  cashEntryId: number | null
  requestId: number
  requestNo: string | null
  requestTitle: string
  requestType: 'advance' | 'reimburse'
}

/**
 * Posted transfers whose request is still "Sudah Ditransfer" — the only state the T8 void accepts
 * (state.ts: transferred → approved / receipts_verified). Caller's read access on both collections.
 */
export async function voidableTransfers(req: PayloadRequest, limit = 50): Promise<VoidableTransfer[]> {
  const reqs = await req.payload.find({
    collection: 'expense-requests',
    where: { status: { equals: 'transferred' } },
    depth: 0,
    limit: 200,
    select: { docNo: true, title: true, type: true },
    user: req.user,
    overrideAccess: false,
    req,
  })
  const byId = new Map((reqs.docs as unknown as Array<{ id: number; docNo?: string | null; title?: string; type: 'advance' | 'reimburse' }>).map((d) => [d.id, d]))
  if (byId.size === 0) return []
  const ts = await req.payload.find({
    collection: 'transfers',
    where: { and: [{ request: { in: [...byId.keys()] } }, { status: { equals: 'posted' } }, { kind: { in: ['advance', 'reimburse'] } }] },
    sort: ['-transferDate', '-id'],
    depth: 0,
    limit,
    user: req.user,
    overrideAccess: false,
    req,
  })
  return (ts.docs as unknown as Array<Record<string, unknown>>).flatMap((t) => {
    const r = byId.get(relId(t.request) ?? -1)
    if (!r) return []
    return [
      {
        transferId: t.id as number,
        transferNo: String(t.docNo ?? ''),
        transferDate: String(t.transferDate ?? ''),
        amount: Number(t.amount ?? 0),
        cashAccountId: relId(t.cashAccount) ?? null,
        cashEntryId: relId(t.cashEntry) ?? null,
        requestId: r.id,
        requestNo: r.docNo ?? null,
        requestTitle: r.title ?? '',
        requestType: r.type,
      },
    ]
  })
}
