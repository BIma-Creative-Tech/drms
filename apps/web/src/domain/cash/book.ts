import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest, Where } from 'payload'
import { z } from 'zod'

import { companiesWithRole, relId, rolesOf, type Role } from '@/access/roles'
import { parseRupiah } from '@/lib/rupiah-input'
import { getRequestTx } from '@/lib/tx'

import type { CashEntryDoc } from './ledger'
import { counterpartsOf, type EntryCounterpart } from '@/domain/intercompany/service'
import { isPeriod, periodEnd } from './periods'

/**
 * E2 (fase1-golive §E2): read side of the web "Kas" views — buku kas with filters, saldo per
 * akun, period summaries for "Tutup buku". Writes stay in ledger.ts behind /api/v1 (the views
 * post to the domain endpoints; the collections keep create/update: denyAll).
 * Reads use the CALLER's collection access (overrideAccess:false); raw SQL (sums) runs inside the
 * request transaction with parameters only.
 * MC2 (ADR 0016 §4/§5): sums are limited to the selected PTs where the caller is Finance/Direktur
 * (`companyIds` narrows further — the Kas PT filter / "Tutup buku" per PT); every row carries its PT.
 */

// ---------------------------------------------------------------- pure rules (unit-tested)

/**
 * Who may use the Kas views (fase1-golive §E2; G1-1: "Direktur" = role pk-owner). Finance writes,
 * Direktur reads, closes and alone re-opens (ADR 0005 §6); PM/Staff/Admin: no menu, no page
 * (the /api/v1 endpoints answer them 403 on their own).
 */
export const KAS_VIEW_ROLES: Role[] = ['pk-finance', 'pk-owner']
export const KAS_WRITE_ROLES: Role[] = ['pk-finance']

/** UI hint over the selected PTs (any PT). Per-PT answer: `kasAccessIn`. */
export function kasAccess(user: unknown): { view: boolean; write: boolean; close: boolean; reopen: boolean } {
  const r = rolesOf(user)
  const view = r.some((x) => KAS_VIEW_ROLES.includes(x))
  return { view, write: r.some((x) => KAS_WRITE_ROLES.includes(x)), close: view, reopen: r.includes('pk-owner') }
}

/** Kas rights per selected PT (ADR 0016 §5): which PTs the caller may view / write / close / reopen. */
export function kasAccessIn(req: Pick<PayloadRequest, 'user'>): { view: number[]; write: number[]; close: number[]; reopen: number[] } {
  const view = companiesWithRole(req, KAS_VIEW_ROLES)
  return { view, write: companiesWithRole(req, KAS_WRITE_ROLES), close: view, reopen: companiesWithRole(req, ['pk-owner']) }
}

const pts = (req: PayloadRequest, companyIds?: readonly number[]) => {
  const allowed = companiesWithRole(req, KAS_VIEW_ROLES)
  return companyIds ? allowed.filter((c) => companyIds.includes(c)) : allowed
}
const ptSql = (ids: number[]) =>
  ids.length
    ? sql`company_id IN (${sql.join(
        ids.map((c) => sql`${c}`),
        sql`, `,
      )})`
    : sql`FALSE`

const optId = z.preprocess((v) => (v === '' || v === undefined ? undefined : v), z.coerce.number().int().positive().max(2_147_483_647).optional())
/** DRMS 13/10 Umum #4: multi-select ids `1,3` — invalid entries dropped, none left → no filter. */
const optIds = z.preprocess((v) => {
  if (typeof v !== 'string') return undefined
  const ids = [...new Set(v.split(',').map((x) => x.trim()).filter((x) => /^[1-9][0-9]{0,9}$/.test(x) && Number(x) <= 2_147_483_647).map(Number))].slice(0, 50)
  return ids.length ? ids : undefined
}, z.array(z.number().int().positive()).optional())
/** Multi-select of fixed values (`masuk,keluar`); unknown values dropped. */
const optEnums = <T extends string>(values: readonly [T, ...T[]]) =>
  z.preprocess((v) => {
    if (typeof v !== 'string') return undefined
    const out = [...new Set(v.split(',').map((x) => x.trim()))].filter((x): x is T => (values as readonly string[]).includes(x))
    return out.length ? out : undefined
  }, z.array(z.enum(values)).optional())
const optPeriod = z.preprocess((v) => (v === '' || v === undefined ? undefined : v), z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional())

/** Query string of /admin/kas (server-side Zod; invalid values are dropped, never passed on). */
export const BookQuery = z.object({
  // DRMS 13/10 Umum #4: akun / project / pusat / arah / status are multi-select (`?akun=1,3`)
  akun: optIds,
  periode: optPeriod,
  project: optIds,
  pusat: optIds,
  arah: optEnums(['masuk', 'keluar']),
  /** MC2: PT filter of the Kas list (a PT without Kas access simply yields no rows). */
  pt: optId,
  /** ADR 0023 (Q-S7): rows of the cash accounts flagged with this site (petty cash of a branch). */
  site: optId,
  status: optEnums(['posted', 'void']),
  /** ADR 0028: "Sumber" — source types (e.g. `intercompany` = Antar PT). */
  sumber: optEnums(['transfer', 'settlement_refund', 'manual', 'reversal', 'opening', 'intercompany', 'project_loan']),
  /** DRMS 10/10 D8: free text over number + description, page size 20 / 50 / 100 (default 50). */
  q: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined), z.string().max(100).optional()).catch(undefined),
  per: z.coerce.number().int().refine((n) => n === 20 || n === 50 || n === 100).optional().catch(undefined),
  hal: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
})
export type BookQuery = z.infer<typeof BookQuery>

export function parseBookQuery(sp: Record<string, string | string[] | undefined> | undefined): BookQuery {
  const flat: Record<string, string> = {}
  for (const [k, v] of Object.entries(sp ?? {})) {
    // a repeated param (plain GET form multi-select) = one comma-joined value
    const s = Array.isArray(v) ? v.join(',') : v
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
  if (q.akun?.length) and.push({ cashAccount: { in: q.akun } })
  if (q.periode) and.push({ period: { equals: q.periode } })
  if (q.project?.length) and.push({ project: { in: q.project } })
  if (q.pusat?.length) and.push({ costCenter: { in: q.pusat } })
  if (q.arah?.length === 1) and.push({ direction: { equals: q.arah[0] === 'masuk' ? 'in' : 'out' } }) // both = no filter
  if (q.status?.length) and.push({ status: { in: q.status } })
  if (q.sumber?.length) and.push({ sourceType: { in: q.sumber } })
  if (q.pt) and.push({ company: { equals: q.pt } })
  if (q.site) and.push({ 'cashAccount.site': { equals: q.site } })
  if (q.q) for (const t of q.q.split(/\s+/).filter(Boolean).slice(0, 5)) and.push({ or: [{ entryNo: { like: t } }, { description: { like: t } }] })
  return and.length ? { and } : undefined
}

/** Same rules as ledger.ts editManualEntry (UI hint only; the server re-checks). */
export function canEdit(e: Pick<CashEntryDoc, 'sourceType' | 'status' | 'entryDate'>, lockDate: string | null): boolean {
  return e.sourceType === 'manual' && e.status === 'posted' && !(lockDate && e.entryDate <= lockDate)
}

/** Same rules as ledger.ts voidEntry for a direct void (transfer postings go through the transfer; ADR 0028: so does the intercompany KM). */
export function canVoid(e: Pick<CashEntryDoc, 'sourceType' | 'status'>): boolean {
  return e.status === 'posted' && (e.sourceType === 'manual' || e.sourceType === 'opening')
}

/** Why a row has no Void button (shown as a hint). */
export function voidHint(e: Pick<CashEntryDoc, 'sourceType' | 'status'>, ic?: { sourceDocType?: string } | null): string | null {
  if (e.status === 'void') return null
  if (e.sourceType === 'transfer') return 'Batalkan lewat transfer pengajuan'
  if (e.sourceType === 'reversal') return 'Jurnal balik tidak dapat di-void'
  if (e.sourceType === 'settlement_refund') return 'Bagian dari LPJ'
  // ADR 0029: a leg of an inter-PT loan — voided through the loan (PJA) by Finance of the paying PT
  if (e.sourceType === 'intercompany' && ic?.sourceDocType === 'intercompany_loan') return 'Di-void lewat pinjaman antar-PT (PJA) oleh Finance PT pembayar'
  // ADR 0028: the receiving PT's automatic KM — voided only by the paying PT's transfer void
  if (e.sourceType === 'intercompany') return 'Di-void lewat pembatalan transfer di PT pengirim'
  // ADR 0031: a leg of an inter-project loan — voided with the transfer (automatic loan) or the repayment void
  if (e.sourceType === 'project_loan') return 'Di-void lewat pinjaman antar project (transfer / pengembalian)'
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
 * the last `max` months). QA-30: never before `booksStart` (earliest opening-balance date of the PT's
 * cash accounts, ledger.ts booksStartDate) — the server refuses those months too.
 */
export function closablePeriods(today: string, lockDate: string | null, max = 12, booksStart: string | null = null): string[] {
  const last = shift(monthOf(today), -1)
  let first = lockDate ? shift(monthOf(lockDate), 1) : shift(last, -(max - 1))
  if (booksStart && monthOf(booksStart) > first) first = monthOf(booksStart)
  const out: string[] = []
  for (let p = first; p <= last && out.length < max; p = shift(p, 1)) out.push(p)
  return out
}

/** Last `n` periods ending with the current month, newest first; QA-30: none before `booksStart`. */
export function recentPeriods(today: string, n = 12, booksStart: string | null = null): string[] {
  const all = Array.from({ length: n }, (_, i) => shift(monthOf(today), -i))
  return booksStart ? all.filter((p) => p >= monthOf(booksStart) || p === monthOf(today)) : all
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

/**
 * Rupiah text field ("Rp 1.250.000" → 1250000); null when empty/invalid. QA-03/QA-12: no longer strips
 * every non-digit ("1.000,50" was 100050, "-5000" was 5000) — same rules as lib/rupiah-input.
 */
export function parseRupiahInput(v: string): number | null {
  const r = parseRupiah(v)
  return r.error ? null : r.value
}

// ---------------------------------------------------------------- DB reads

/** `siteId` (accounts only, ADR 0023 Q-S7): the account's site flag. */
/** ADR 0028 `intercompanyReceiving` (accounts only): the PT's designated "Rekening penerimaan antar-PT". */
export type Option = { id: number; label: string; active: boolean; companyId: number | null; openingDate?: string | null; siteId?: number | null; intercompanyReceiving?: boolean }
export type Lookups = {
  accounts: Option[]
  /** ADR 0023: sites of the readable PTs (Kas "Site" filter). */
  sites: Option[]
  projects: Option[]
  costCenters: Option[]
  categories: Array<Option & { requiresVehicle: boolean }>
  sources: Option[]
  vehicles: Option[]
}

async function all(req: PayloadRequest, collection: 'cash-accounts' | 'projects' | 'cost-centers' | 'expense-categories' | 'cash-in-sources' | 'vehicles' | 'sites', sort: string) {
  const r = await req.payload.find({ collection, depth: 0, pagination: false, sort, user: req.user, overrideAccess: false, req })
  return r.docs as unknown as Array<Record<string, unknown>>
}

const codeName = (d: Record<string, unknown>) => [d.code, d.name].filter(Boolean).join(' ')
const cid = (d: Record<string, unknown>) => relId(d.company) ?? null

/** Masters for filters, labels and the forms (Finance/Owner may read all of them). */
export async function cashLookups(req: PayloadRequest): Promise<Lookups> {
  const [accounts, sites, projects, costCenters, categories, sources, vehicles] = await Promise.all([
    all(req, 'cash-accounts', 'name'),
    all(req, 'sites', 'code'),
    all(req, 'projects', 'code'),
    all(req, 'cost-centers', 'code'),
    all(req, 'expense-categories', 'name'),
    all(req, 'cash-in-sources', 'name'),
    all(req, 'vehicles', 'plateNo'),
  ])
  return {
    // QA-05: the form's date `min` follows the picked account's opening-balance (go-live) date
    accounts: accounts.map((d) => ({ id: d.id as number, companyId: cid(d), label: String(d.name ?? ''), active: d.active !== false, openingDate: (d.openingBalanceDate as string | null | undefined) ?? null, siteId: relId(d.site) ?? null, intercompanyReceiving: d.intercompanyReceiving === true })),
    sites: sites.map((d) => ({ id: d.id as number, companyId: cid(d), label: codeName(d), active: d.active !== false })),
    projects: projects.map((d) => ({ id: d.id as number, companyId: cid(d), label: codeName(d), active: d.status !== 'selesai' && d.status !== 'arsip' && d.status !== 'dibatalkan' })),
    costCenters: costCenters.map((d) => ({ id: d.id as number, companyId: cid(d), label: codeName(d), active: d.active !== false })),
    categories: categories.map((d) => ({ id: d.id as number, companyId: cid(d), label: codeName(d), active: d.active !== false, requiresVehicle: d.requiresVehicle === true })),
    sources: sources.map((d) => ({ id: d.id as number, companyId: cid(d), label: codeName(d), active: d.active !== false })),
    vehicles: vehicles.map((d) => ({ id: d.id as number, companyId: cid(d), label: [d.plateDisplay ?? d.plateNo ?? d.unitCode, d.type].filter(Boolean).join(' · '), active: d.active !== false })),
  }
}

export type BookRow = {
  id: number
  companyId: number | null
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
  /** ADR 0028: the other leg of an intercompany payment ("Lawan PT"); reversal rows carry their original's. */
  intercompany: EntryCounterpart | null
}

const PAGE_SIZE = 50

/** One page of the ledger, newest business date first; linked reversal numbers and request numbers resolved. */
export async function cashBookPage(req: PayloadRequest, q: BookQuery, limit = q.per ?? PAGE_SIZE) {
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
  const ic = await counterpartsOf(req, docs.flatMap((d) => [d.id, relId(d.reversalOf)]).filter((x): x is number => x !== undefined))
  const docNoOf = new Map((requests?.docs ?? []).map((d) => [d.id as number, ((d as { docNo?: string | null }).docNo ?? null) as string | null]))
  const link = (v: unknown) => {
    const id = relId(v)
    return id === undefined ? null : { id, entryNo: noOf.get(id) ?? `#${id}` }
  }
  const rows: BookRow[] = docs.map((d) => {
    const rid = relId(d.expenseRequest)
    return {
      id: d.id,
      companyId: relId((d as { company?: unknown }).company) ?? null,
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
      intercompany: ic.get(d.id) ?? ic.get(relId(d.reversalOf) ?? -1) ?? null,
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

/** Σ in / Σ out per cash account in one period (all rows: void + reversal cancel out, ADR 0005), Kas PTs only. */
export async function accountFlows(req: PayloadRequest, period: string, companyIds?: readonly number[]): Promise<Map<number, { n: number; tin: number; tout: number }>> {
  if (!isPeriod(period)) return new Map()
  const rows = await sums(
    req,
    sql`SELECT cash_account_id AS k, count(*)::int AS n,
               coalesce(sum(CASE WHEN direction = 'in' THEN amount ELSE 0 END), 0)::text AS tin,
               coalesce(sum(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0)::text AS tout
        FROM cash_entries WHERE period = ${period} AND ${ptSql(pts(req, companyIds))} GROUP BY cash_account_id`,
  )
  return new Map(rows.map((r) => [Number(r.key), { n: r.n, tin: r.tin, tout: r.tout }]))
}

export type PeriodSummary = {
  /** All rows of the month (posted, void, reversal). */
  n: number
  /** QA-30 (K-02b rule): Σ in / Σ out WITHOUT void pairs (`status='posted' AND source_type<>'reversal'`). */
  tin: number
  tout: number
  /** Voided originals in the month. */
  voids: number
  /** Rows of void pairs (voided originals + reversal rows) dated in the month and their net (in − out). */
  nKoreksi: number
  koreksi: number
}

/**
 * Per period (Tutup buku overview) of the Kas PTs — pass ONE `companyId` for the per-PT closing
 * screen (closing is always one PT, ADR 0016 §4). QA-30: Masuk/Keluar are net of void pairs (K-02b),
 * the void pairs are reported separately (`koreksi`, `nKoreksi`) — book net = tin − tout + koreksi.
 */
export async function periodSummaries(req: PayloadRequest, periods: string[], companyIds?: readonly number[]): Promise<Map<string, PeriodSummary>> {
  const valid = periods.filter(isPeriod)
  if (valid.length === 0) return new Map()
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT period AS k, count(*)::int AS n,
           coalesce(sum(amount) FILTER (WHERE direction = 'in' AND status = 'posted' AND source_type <> 'reversal'), 0)::text AS tin,
           coalesce(sum(amount) FILTER (WHERE direction = 'out' AND status = 'posted' AND source_type <> 'reversal'), 0)::text AS tout,
           count(*) FILTER (WHERE status = 'void')::int AS voids,
           count(*) FILTER (WHERE status = 'void' OR source_type = 'reversal')::int AS nk,
           coalesce(sum(CASE WHEN direction = 'in' THEN amount ELSE -amount END) FILTER (WHERE status = 'void' OR source_type = 'reversal'), 0)::text AS koreksi
    FROM cash_entries WHERE ${ptSql(pts(req, companyIds))} AND period IN (${sql.join(
      valid.map((p) => sql`${p}`),
      sql`, `,
    )}) GROUP BY period`)) as unknown as { rows: Array<{ k: string; n: number; tin: string; tout: string; voids: number; nk: number; koreksi: string }> }
  return new Map(r.rows.map((x) => [x.k, { n: Number(x.n), tin: Number(x.tin), tout: Number(x.tout), voids: Number(x.voids), nKoreksi: Number(x.nk), koreksi: Number(x.koreksi) }]))
}

// ---------------------------------------------------------------- transfer void (T8) list

export type VoidableTransfer = {
  transferId: number
  /** PT of the request (MC2). */
  companyId: number | null
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
    select: { docNo: true, title: true, type: true, company: true },
    user: req.user,
    overrideAccess: false,
    req,
  })
  const byId = new Map((reqs.docs as unknown as Array<{ id: number; docNo?: string | null; title?: string; type: 'advance' | 'reimburse'; company?: unknown }>).map((d) => [d.id, d]))
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
        companyId: relId(r.company) ?? null,
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
