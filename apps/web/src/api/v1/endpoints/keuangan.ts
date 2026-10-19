import type { PayloadRequest } from 'payload'

import { hasRole, memberCompanies, relId } from '@/access/roles'
import { matchesQuery, paginate } from '@/admin/list-query'
import {
  accountFlows,
  canEdit,
  canVoid,
  cashBookPage,
  cashLookups,
  closablePeriods,
  kasAccessIn,
  minPostingDate,
  parseBookQuery,
  periodState,
  periodSummaries,
  recentPeriods,
  voidableTransfers,
  voidHint,
  type Option,
} from '@/domain/cash/book'
import { balances, booksStartDate, currentLockDate, lockDates } from '@/domain/cash/ledger'
import { displayName, settings, today as businessToday } from '@/domain/expense/common'
import { REQUEST_TYPES } from '@/domain/expense/types'
import { formatServerTime } from '@/pdf/format'

import { HttpError, json, v1 } from '../http'

/**
 * User 2026-10-19 (APK ↔ web parity, phase 3): the web Keuangan pages as JSON for the APK — same helpers and the
 * same PT rules as admin/views/Kas.tsx (KasBook, TutupBuku) and admin/views/TransferQueue.tsx. Read-only; the
 * actions keep using POST /cash-entries…, /period-closings… and /expense-requests/{id}/transfers/{tid}/void.
 */
const READ_LIMIT: [number, number] = [60, 60_000]

type SP = Record<string, string | string[] | undefined>
const params = (req: PayloadRequest): SP => {
  const out: SP = {}
  for (const [k, v] of req.searchParams.entries()) {
    const prev = out[k]
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v]
  }
  return out
}

/** Options of the shown PTs (shared masters, companyId null, kept). */
const inPts = <T extends Option>(list: T[], pts: readonly number[]) => list.filter((o) => o.companyId === null || pts.includes(o.companyId))
const opt = (o: Option) => ({ id: o.id, label: o.label, active: o.active, companyId: o.companyId })

/** GET /api/v1/kas/book — the web "Buku kas" (/admin/kas) with its query string (BookQuery). */
export const kasBookEndpoint = v1({
  path: '/kas/book',
  method: 'get',
  roles: ['pk-finance', 'pk-owner'],
  rateLimit: READ_LIMIT,
  transactional: true, // raw SQL helpers (flows, counterparts) use the request transaction
  handler: async ({ req }) => {
    const acc = kasAccessIn(req)
    if (acc.view.length === 0) throw new HttpError(403, 'Forbidden')
    const q = parseBookQuery(params(req))
    if (q.pt !== undefined && !acc.view.includes(q.pt)) delete q.pt // never widens (web: same)
    const shown = q.pt !== undefined ? [q.pt] : acc.view
    const writeIn = (c: number | null) => c !== null && acc.write.includes(c)
    const locks = await lockDates(req, shown)
    const lockOf = (c: number | null) => locks.find((l) => l.companyId === c)?.lockDate ?? null
    const todays = new Map<number, string>()
    for (const c of shown) todays.set(c, await businessToday(req, c))
    const today = todays.get(shown[0]!)!
    const lk = await cashLookups(req)
    const page = await cashBookPage(req, q)
    const bal = await balances(req, undefined, { companyIds: shown })
    const flowPeriod = q.periode ?? today.slice(0, 7)
    const flows = await accountFlows(req, flowPeriod, shown)
    const accounts = q.pt !== undefined ? lk.accounts.filter((a) => a.companyId === q.pt) : lk.accounts
    // ADR 0023 (Q-S7): with a site filter the totals / tiles cover the accounts flagged with that site
    const siteAccounts = q.site ? new Set(lk.accounts.filter((a) => a.siteId === q.site).map((a) => a.id)) : null
    const inSite = (a: { cashAccountId: number }) => !siteAccounts || siteAccounts.has(a.cashAccountId)
    const activeIds = new Set(accounts.filter((a) => a.active).map((a) => a.id))
    const tiles = bal.filter((a) => (activeIds.has(a.cashAccountId) || a.balance !== 0) && inSite(a))
    return json({
      today,
      canWrite: acc.write.some((c) => shown.includes(c)),
      pts: shown.map((c) => {
        const lockDate = lockOf(c)
        const ic = lk.accounts.find((x) => x.companyId === c && x.active && x.intercompanyReceiving)
        return { companyId: c, lockDate, today: todays.get(c)!, minDate: minPostingDate(lockDate), write: acc.write.includes(c), reopen: acc.reopen.includes(c), intercompanyReceiving: ic ? ic.label : null }
      }),
      lookups: {
        accounts: inPts(lk.accounts, shown).map((a) => ({ ...opt(a), openingDate: a.openingDate ?? null, siteId: a.siteId ?? null, intercompanyReceiving: a.intercompanyReceiving === true })),
        sites: inPts(lk.sites, shown).map(opt),
        projects: inPts(lk.projects, shown).map(opt),
        costCenters: inPts(lk.costCenters, shown).map(opt),
        categories: inPts(lk.categories, shown).map((c) => ({ ...opt(c), requiresVehicle: c.requiresVehicle })),
        sources: inPts(lk.sources, shown).map(opt),
        vehicles: inPts(lk.vehicles, shown).map(opt),
      },
      total: bal.filter(inSite).reduce((s, a) => s + a.balance, 0),
      byPt: shown.map((c) => ({ companyId: c, total: bal.filter((a) => a.companyId === c && inSite(a)).reduce((s, a) => s + a.balance, 0) })),
      flowPeriod,
      accounts: tiles.map((a) => {
        const f = flows.get(a.cashAccountId) ?? { n: 0, tin: 0, tout: 0 }
        return { cashAccountId: a.cashAccountId, companyId: a.companyId, name: a.name, balance: a.balance, flowIn: f.tin, flowOut: f.tout, n: f.n }
      }),
      page: {
        rows: page.rows.map((r) => ({
          ...r,
          canEdit: writeIn(r.companyId) && canEdit(r, lockOf(r.companyId)),
          canVoid: writeIn(r.companyId) && canVoid(r),
          voidHint: writeIn(r.companyId) ? voidHint(r, r.intercompany) : null,
        })),
        totalDocs: page.totalDocs,
        page: page.page,
        totalPages: page.totalPages,
      },
    })
  },
})

/** GET /api/v1/kas/periods?company= — the web "Tutup buku" (/admin/tutup-buku) of ONE PT (closing is per PT). */
export const kasPeriodsEndpoint = v1({
  path: '/kas/periods',
  method: 'get',
  roles: ['pk-finance', 'pk-owner'],
  rateLimit: READ_LIMIT,
  transactional: true,
  handler: async ({ req }) => {
    const acc = kasAccessIn(req)
    if (acc.close.length === 0) throw new HttpError(403, 'Forbidden')
    const raw = req.searchParams.get('company')
    if (raw !== null && raw !== '' && !/^[1-9]\d{0,8}$/.test(raw)) throw new HttpError(400, 'Bad Request', { detail: 'company tidak valid.' })
    const asked = raw ? Number(raw) : undefined
    if (asked !== undefined && !acc.close.includes(asked)) {
      throw new HttpError(403, 'Forbidden', { code: 'COMPANY_NOT_ALLOWED', detail: 'PT yang diminta bukan PT Kas Anda (atau tidak termasuk PT yang dipilih).' })
    }
    const company = asked ?? (acc.close.length === 1 ? acc.close[0] : undefined)
    const pts = await lockDates(req, acc.close)
    if (company === undefined) {
      return json({ company: null, pts, today: null, lockDate: null, booksStart: null, latestClosed: null, canReopen: false, closable: [], rows: [], history: [] })
    }
    const todayDate = await businessToday(req, company)
    const lockDate = await currentLockDate(req, company)
    const tz = (await settings(req, company)).timezone || process.env.TZ || 'Asia/Makassar'
    const booksStart = await booksStartDate(req, company)
    const periods = recentPeriods(todayDate, 13, booksStart)
    const sums = await periodSummaries(req, periods, [company])
    const res = await req.payload.find({ collection: 'period-closings', where: { company: { equals: company } }, sort: '-id', limit: 100, depth: 0, user: req.user, overrideAccess: false, req })
    const docs = res.docs as unknown as Array<Record<string, unknown>>
    const names = new Map<number, string>()
    for (const u of new Set(docs.flatMap((x) => [relId(x.closedBy), relId(x.reopenedBy)]).filter((x): x is number => x !== undefined))) names.set(u, await displayName(req, u))
    const nm = (v: unknown) => (relId(v) !== undefined ? (names.get(relId(v)!) ?? null) : null)
    const history = docs.map((x) => ({
      id: x.id as number,
      period: x.period as string,
      status: x.status as 'closed' | 'reopened',
      note: (x.note as string) ?? null,
      closedBy: nm(x.closedBy),
      closedAt: formatServerTime(x.closedAt as string, tz) || null,
      reopenedBy: nm(x.reopenedBy),
      reopenedAt: formatServerTime(x.reopenedAt as string, tz) || null,
      reopenReason: (x.reopenReason as string) ?? null,
    }))
    const closable = closablePeriods(todayDate, lockDate, 12, booksStart)
    const closedSet = new Set(history.filter((c) => c.status === 'closed').map((c) => c.period))
    const latestClosed = history.filter((c) => c.status === 'closed').map((c) => c.period).sort().at(-1) ?? null
    const canReopen = acc.reopen.includes(company)
    return json({
      company,
      pts,
      today: todayDate,
      lockDate,
      booksStart,
      latestClosed,
      canReopen,
      closable,
      rows: periods.map((p) => {
        const state = periodState(p, todayDate, lockDate)
        const s = sums.get(p) ?? { n: 0, tin: 0, tout: 0, voids: 0, nKoreksi: 0, koreksi: 0 }
        return { period: p, state, explicit: closedSet.has(p), ...s, canClose: closable.includes(p), canReopen: canReopen && state === 'closed' && p === latestClosed }
      }),
      history,
    })
  },
})

const PER = [20, 50, 100]

/** GET /api/v1/transfers/voidable — web Antrian Transfer › "Transfer tercatat — dapat dibatalkan" (T8). */
export const voidableTransfersEndpoint = v1({
  path: '/transfers/voidable',
  method: 'get',
  roles: ['pk-finance', 'pk-owner'],
  rateLimit: READ_LIMIT,
  transactional: true,
  handler: async ({ req }) => {
    const sp = req.searchParams
    // web: `pt` ⊆ the selection (foreign ids ignored), `jenis` ⊆ request types
    const selected = memberCompanies(req)
    const ptIds = (sp.get('pt') ?? '').split(',').map((x) => x.trim()).filter((x) => /^[1-9]\d{0,8}$/.test(x)).map(Number).filter((c) => selected.includes(c))
    const jenis = (sp.get('jenis') ?? '').split(',').map((x) => x.trim()).filter((x): x is (typeof REQUEST_TYPES)[number] => (REQUEST_TYPES as readonly string[]).includes(x))
    const q = (sp.get('q') ?? '').trim().slice(0, 100)
    const page = /^\d{1,5}$/.test(sp.get('page') ?? '') ? Math.max(1, Number(sp.get('page'))) : 1
    const per = PER.includes(Number(sp.get('per'))) ? Number(sp.get('per')) : 20
    const all = (await voidableTransfers(req)).filter(
      (t) => (!ptIds.length || (t.companyId !== null && ptIds.includes(t.companyId))) && (!jenis.length || jenis.includes(t.requestType)) && matchesQuery([t.transferNo, t.requestNo, t.requestTitle], q),
    )
    const p = paginate(all, page, per)
    return json({ items: p.items.map((t) => ({ ...t, canVoid: hasRole(req, 'pk-finance', t.companyId) })), total: p.total, page: p.page, totalPages: p.totalPages })
  },
})

export const KEUANGAN_ENDPOINTS = [kasBookEndpoint, kasPeriodsEndpoint, voidableTransfersEndpoint]
