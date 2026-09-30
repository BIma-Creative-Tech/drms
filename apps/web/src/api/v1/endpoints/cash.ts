import type { PayloadRequest, Where } from 'payload'

import { relId } from '@/access/roles'
import { balances, closePeriod, createManualEntry, currentLockDate, editManualEntry, kasCompanies, lockDates, reopenPeriod, voidEntry, type CashEntryDoc } from '@/domain/cash/ledger'

import { companyQuery, singleCompanyQuery } from '../company-query'
import { HttpError, json, v1 } from '../http'
import { withNamedCompany } from '../named-company'
import { CashEntryCreate, CashEntryUpdate, CashListQuery, PeriodCloseBody, ReasonBody } from '../schemas-flow'

/** US-23 / US-24 / ADR 0005 — Finance writes; Finance/Direktur (pk-owner)/Admin read (requirements §4 "Kas & bank"). */
const WRITE_LIMIT: [number, number] = [30, 60_000]

export function cashDto(e: CashEntryDoc & { postedAt?: string | null }) {
  return {
    id: e.id,
    entryNo: e.entryNo,
    entryDate: e.entryDate,
    period: e.period ?? null,
    direction: e.direction,
    amount: e.amount,
    cashAccountId: relId(e.cashAccount)!,
    categoryId: relId(e.category) ?? null,
    cashInSourceId: relId(e.cashInSource) ?? null,
    projectId: relId(e.project) ?? null,
    costCenterId: relId(e.costCenter) ?? null,
    vehicleId: relId(e.vehicle) ?? null,
    description: e.description ?? null,
    sourceType: e.sourceType,
    expenseRequestId: relId(e.expenseRequest) ?? null,
    transferId: relId(e.transfer) ?? null,
    status: e.status,
    reversalOfId: relId(e.reversalOf) ?? null,
    reversedById: relId(e.reversedBy) ?? null,
    voidReason: e.voidReason ?? null,
    postedAt: e.postedAt ?? null,
    companyId: relId((e as { company?: unknown }).company) ?? null, // MC3
  }
}

function idParam(v: string | undefined): number {
  if (!v || !/^\d{1,10}$/.test(v)) throw new HttpError(404, 'Not Found')
  return Number(v)
}

async function reload(req: PayloadRequest, id: number) {
  const e = await req.payload.findByID({ collection: 'cash-entries', id, depth: 0, overrideAccess: true /* SYSTEM-READ: role checked by the endpoint */, req })
  return cashDto(e as unknown as CashEntryDoc)
}

export const listCashEndpoint = v1({
  path: '/cash-entries',
  method: 'get',
  roles: ['pk-finance', 'pk-owner', 'pk-admin'],
  handler: async ({ req }) => {
    const q = CashListQuery.safeParse(Object.fromEntries(req.searchParams.entries()))
    if (!q.success) throw new HttpError(400, 'Bad Request', { errors: q.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) })
    const and: Where[] = []
    if (q.data.period) and.push({ period: { equals: q.data.period } })
    if (q.data.cashAccountId) and.push({ cashAccount: { equals: q.data.cashAccountId } })
    if (q.data.projectId) and.push({ project: { equals: q.data.projectId } })
    if (q.data.costCenterId) and.push({ costCenter: { equals: q.data.costCenterId } })
    const companies = await companyQuery(req) // MC3: narrows only
    if (companies) and.push({ company: { in: companies } })
    if (q.data.cursor) {
      const n = Number(Buffer.from(q.data.cursor, 'base64url').toString('utf8'))
      if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, 'Bad Request', { detail: 'cursor tidak valid.' })
      and.push({ id: { less_than: n } })
    }
    const res = await req.payload.find({
      collection: 'cash-entries',
      where: and.length ? { and } : undefined,
      sort: '-id',
      limit: q.data.limit + 1,
      depth: 0,
      user: req.user,
      overrideAccess: false, // collection read access (Finance/Owner/Admin)
      req,
    })
    const docs = res.docs as unknown as CashEntryDoc[]
    const page = docs.slice(0, q.data.limit)
    const next = docs.length > q.data.limit ? Buffer.from(String(page[page.length - 1]!.id)).toString('base64url') : null
    return json({ items: page.map(cashDto), nextCursor: next })
  },
})

export const createCashEndpoint = v1({
  path: '/cash-entries',
  method: 'post',
  roles: ['pk-finance'],
  body: CashEntryCreate,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body }) => {
    const { company, ...input } = body
    // MC4: optional body `company` = the cash account's PT; Finance IN that PT
    const refs = [
      { collection: 'cash-accounts', id: input.cashAccountId, path: 'cashAccountId' },
      { collection: 'projects', id: input.projectId, path: 'projectId' },
      { collection: 'cost-centers', id: input.costCenterId, path: 'costCenterId' },
    ] as const
    return withNamedCompany(req, company, { roles: ['pk-finance'], refs: [...refs] }, async () => {
      const e = await createManualEntry(req, input)
      return json(await reload(req, e.id), 201)
    })
  },
})

export const updateCashEndpoint = v1({
  path: '/cash-entries/:id',
  method: 'patch',
  roles: ['pk-finance'],
  body: CashEntryUpdate,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true, // E2: the web form sends Idempotency-Key (retry = replay, never a second edit)
  handler: async ({ req, body, params }) => {
    const id = idParam(params.id)
    const { reason, ...patch } = body
    await editManualEntry(req, id, patch, reason)
    return json(await reload(req, id))
  },
})

export const voidCashEndpoint = v1({
  path: '/cash-entries/:id/void',
  method: 'post',
  roles: ['pk-finance'],
  body: ReasonBody,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => {
    const { original, reversal } = await voidEntry(req, idParam(params.id), body.reason)
    return json({ original: await reload(req, original.id), reversal: await reload(req, reversal.id) })
  },
})

export const balancesEndpoint = v1({
  path: '/cash-accounts/balances',
  method: 'get',
  roles: ['pk-finance', 'pk-owner'],
  transactional: true, // read inside a transaction (raw SQL uses the request transaction handle)
  handler: async ({ req }) => {
    const asOf = req.searchParams.get('asOf') ?? undefined
    // ADR 0016 §5: accounts of the selected PTs where the caller is Finance/Direktur; `company` narrows.
    // MC3 fix: `company` was passed through unchecked (any PT's balances) — now ⊆ selection ∩ Kas PTs.
    const companies = await companyQuery(req)
    const kas = kasCompanies(req)
    const companyIds = companies === undefined ? kas : companies.filter((c) => kas.includes(c))
    return json({ asOf: asOf ?? null, items: await balances(req, asOf, { companyIds }) })
  },
})

/** Optional `?company=<id>` (per-PT closing / balances, ADR 0016 §4); malformed → 400. */
function companyParam(req: PayloadRequest): number | undefined {
  const raw = req.searchParams.get('company')
  if (raw === null || raw === '') return undefined
  if (!/^[1-9]\d{0,8}$/.test(raw)) throw new HttpError(400, 'Bad Request', { detail: 'company tidak valid.' })
  return Number(raw)
}

function periodDto(p: Record<string, unknown>) {
  return {
    id: p.id as number,
    companyId: relId(p.company) ?? null,
    period: p.period as string,
    status: p.status as 'closed' | 'reopened',
    note: (p.note as string) ?? null,
    closedById: relId(p.closedBy) ?? null,
    closedAt: (p.closedAt as string) ?? null,
    reopenedById: relId(p.reopenedBy) ?? null,
    reopenedAt: (p.reopenedAt as string) ?? null,
    reopenReason: (p.reopenReason as string) ?? null,
  }
}

export const listPeriodsEndpoint = v1({
  path: '/period-closings',
  method: 'get',
  roles: ['pk-finance', 'pk-owner', 'pk-admin'],
  transactional: true,
  handler: async ({ req }) => {
    // MC3 fix: the lock date of `?company=` was read for ANY PT — now the PT must be in the selection
    const company = await singleCompanyQuery(req)
    const res = await req.payload.find({
      collection: 'period-closings',
      where: company === undefined ? undefined : { company: { equals: company } },
      sort: '-id',
      limit: 200,
      depth: 0,
      user: req.user,
      overrideAccess: false,
      req,
    })
    // closings are per PT: one lock date per readable PT (`lockDate` = the requested / only PT, else null)
    const readable = kasCompanies(req, ['pk-finance', 'pk-owner', 'pk-admin'])
    const pts = company !== undefined ? readable.filter((c) => c === company) : readable
    const locks = await lockDates(req, pts)
    return json({
      lockDate: company !== undefined || locks.length === 1 ? (locks[0]?.lockDate ?? null) : locks.length === 0 ? await currentLockDate(req) : null,
      lockDates: locks,
      items: res.docs.map((d) => periodDto(d as unknown as Record<string, unknown>)),
    })
  },
})

export const closePeriodEndpoint = v1({
  path: '/period-closings',
  method: 'post',
  roles: ['pk-finance', 'pk-owner'],
  body: PeriodCloseBody,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body }) => json(periodDto((await closePeriod(req, body.period, body.note, body.company)) as unknown as Record<string, unknown>), 201),
})

export const reopenPeriodEndpoint = v1({
  path: '/period-closings/:period/reopen',
  method: 'post',
  roles: ['pk-owner'],
  body: ReasonBody,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => json(periodDto((await reopenPeriod(req, params.period ?? '', body.reason, companyParam(req))) as unknown as Record<string, unknown>)),
})

export const CASH_ENDPOINTS = [
  listCashEndpoint,
  createCashEndpoint,
  updateCashEndpoint,
  voidCashEndpoint,
  balancesEndpoint,
  listPeriodsEndpoint,
  closePeriodEndpoint,
  reopenPeriodEndpoint,
]
