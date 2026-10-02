import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { companiesWithRole, hasRole, mappedCompanies, relId, userId, type Role } from '@/access/roles'
import { companyOf, contextCompanyId } from '@/domain/companies'
import { writeAudit } from '@/audit/writer'
import { fail, today } from '@/domain/expense/common'
import { claimMedia } from '@/domain/expense/receipts'
import { allocateDocNo } from '@/domain/numbering-db'
import { parseBusinessDate } from '@/domain/numbering'
import { isBusinessDate } from '@/domain/expense/types'
import { getRequestTx } from '@/lib/tx'

import { isPeriod, periodEnd } from './periods'

export type CashEntryDoc = {
  id: number
  entryNo: string
  entryDate: string
  period?: string | null
  direction: 'in' | 'out'
  amount: number
  cashAccount: unknown
  category?: unknown
  cashInSource?: unknown
  project?: unknown
  costCenter?: unknown
  vehicle?: unknown
  description?: string | null
  proof?: unknown
  sourceType: 'transfer' | 'settlement_refund' | 'manual' | 'reversal' | 'opening'
  expenseRequest?: unknown
  transfer?: unknown
  status: 'posted' | 'void'
  reversalOf?: unknown
  reversedBy?: unknown
  voidReason?: string | null
}

export type PostInput = {
  direction: 'in' | 'out'
  entryDate: string
  cashAccountId: number
  amount: number
  categoryId?: number | null
  cashInSourceId?: number | null
  projectId?: number | null
  costCenterId?: number | null
  vehicleId?: number | null
  description?: string | null
  proofId?: number | null
  sourceType: CashEntryDoc['sourceType']
  expenseRequestId?: number | null
  transferId?: number | null
  reversalOfId?: number | null
}

/**
 * Lock date of ONE PT from the DB (same function the triggers use; ADR 0016 §4: closing PT A never
 * locks PT B). Without a company: the context PT (caller's only PT / company #1) — every domain caller
 * passes the document's PT; views with several PTs use `lockDates`.
 */
export async function currentLockDate(req: PayloadRequest, companyId?: number | null): Promise<string | null> {
  const tx = await getRequestTx(req)
  const cid = typeof companyId === 'number' ? companyId : await contextCompanyId(req)
  const r = (await tx.execute(sql`SELECT pk_cash_lock_date(${cid}::integer)::text AS d`)) as unknown as { rows: Array<{ d: string | null }> }
  return r.rows[0]?.d ?? null
}

/** Lock date per PT of `companyIds` (Kas / Tutup buku views show one per PT, ADR 0016 §4). */
export async function lockDates(req: PayloadRequest, companyIds: readonly number[]): Promise<Array<{ companyId: number; lockDate: string | null }>> {
  const out: Array<{ companyId: number; lockDate: string | null }> = []
  for (const c of [...new Set(companyIds)].sort((a, b) => a - b)) out.push({ companyId: c, lockDate: await currentLockDate(req, c) })
  return out
}

/** Kas roles (view) — the PTs where the caller may read the cash ledger (Finance / Direktur). */
export const KAS_LEDGER_ROLES: readonly Role[] = ['pk-finance', 'pk-owner']

/** Selected PTs where the caller holds one of `roles` (default: Kas view roles). */
export function kasCompanies(req: PayloadRequest, roles: readonly Role[] = KAS_LEDGER_ROLES): number[] {
  return companiesWithRole(req, roles)
}

/**
 * PT of a closing / reopen without an explicit `company`: the ONLY selected PT where the caller holds
 * `roles`; none → 403, several → 400 "PT wajib dipilih" (ADR 0016 §5: a mutation names its PT).
 */
function closingCompany(req: PayloadRequest, companyId: number | undefined, roles: readonly Role[]): number {
  if (typeof companyId === 'number') return companyId
  const pts = companiesWithRole(req, roles)
  if (pts.length === 1) return pts[0]!
  if (pts.length === 0) fail(403, 'Hanya Finance/Direktur yang dapat menutup buku.')
  fail(400, 'PT wajib dipilih.', [{ path: 'company', message: 'Pilih PT yang ditutup bukunya.' }])
}

/**
 * The cash account must exist, be active and — when the flow knows its PT (`companyId` = the
 * document's PT) — belong to that PT. QA-MC4-10 (scope rule 2026-10-02): a cash account of another PT
 * is answered like a missing one BEFORE any lock-date check (a B account used to answer with PT B's
 * closing date: "tutup buku s/d …").
 */
export async function assertAccount(req: PayloadRequest, id: number, companyId?: number) {
  const a = await req.payload.findByID({ collection: 'cash-accounts', id, depth: 0, overrideAccess: true /* SYSTEM-READ: account check, PT compared below */, req }).catch(() => null)
  if (!a || a.active === false || (companyId !== undefined && relId(a.company) !== companyId)) fail(400, 'Akun kas tidak ditemukan atau nonaktif.', [{ path: 'cashAccountId', message: 'Akun kas tidak valid.' }])
}

/**
 * Posts one ledger row (ADR 0005 §2–§3): KM/KK number by direction and date (ADR 0007), inside the
 * business transaction. The DB guard sets `period`/`posted_at` and rejects dates in a closed period.
 */
export async function postEntry(req: PayloadRequest, input: PostInput): Promise<CashEntryDoc> {
  if (!isBusinessDate(input.entryDate)) fail(400, 'Tanggal harus YYYY-MM-DD.')
  if (!(Number.isSafeInteger(input.amount) && input.amount > 0)) fail(400, 'Nominal harus bilangan bulat Rupiah > 0.')
  if (input.projectId && input.costCenterId) fail(400, 'Pilih project ATAU pusat biaya.')
  const companyId = await companyOf(req, 'cash-accounts', input.cashAccountId)
  // ADR 0016 §5 (MC2 fix): a manual posting needs Finance IN THE ACCOUNT's PT (the endpoint only
  // checks "Finance in any PT"); other source types are posted by flows already checked per PT.
  if (req.user && input.sourceType === 'manual' && !hasRole(req, 'pk-finance', companyId)) fail(400, 'Akun kas tidak ditemukan atau nonaktif.', [{ path: 'cashAccountId', message: 'Akun kas tidak valid.' }])
  // QA-MC4-10: account (and its PT) first — the lock date of a PT the caller is not mapped to is never answered
  const mapped = mappedCompanies(req)
  if (companyId === undefined || (mapped !== null && !mapped.includes(companyId))) fail(400, 'Akun kas tidak ditemukan atau nonaktif.', [{ path: 'cashAccountId', message: 'Akun kas tidak valid.' }])
  await assertAccount(req, input.cashAccountId)
  const lock = await currentLockDate(req, companyId)
  if (lock && input.entryDate <= lock) fail(409, `Periode ${input.entryDate.slice(0, 7)} sudah ditutup (tutup buku s/d ${lock}).`)
  const { docNo } = await allocateDocNo(req, input.direction === 'in' ? 'cash_in' : 'cash_out', { companyId: companyId!, date: parseBusinessDate(input.entryDate) })
  const doc = await req.payload.create({
    collection: 'cash-entries',
    data: {
      entryNo: docNo,
      entryDate: input.entryDate,
      direction: input.direction,
      amount: input.amount,
      cashAccount: input.cashAccountId,
      category: input.categoryId ?? null,
      cashInSource: input.cashInSourceId ?? null,
      project: input.projectId ?? null,
      costCenter: input.costCenterId ?? null,
      vehicle: input.vehicleId ?? null,
      description: input.description ?? null,
      proof: input.proofId ?? null,
      sourceType: input.sourceType,
      expenseRequest: input.expenseRequestId ?? null,
      transfer: input.transferId ?? null,
      reversalOf: input.reversalOfId ?? null,
      status: 'posted',
      postedBy: userId(req) ?? null,
    } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: ledger posting after guards
    req,
  })
  return doc as unknown as CashEntryDoc
}

export type ManualInput = {
  direction: 'in' | 'out'
  entryDate?: string
  cashAccountId: number
  amount: number
  description: string
  categoryId?: number | null
  cashInSourceId?: number | null
  projectId?: number | null
  costCenterId?: number | null
  vehicleId?: number | null
  proofId?: number | null
}

const MANUAL_REFS = [
  ['projectId', 'projects', 'Project tidak ditemukan.'],
  ['costCenterId', 'cost-centers', 'Pusat biaya tidak ditemukan.'],
  ['categoryId', 'expense-categories', 'Kategori tidak ditemukan.'],
  ['cashInSourceId', 'cash-in-sources', 'Sumber kas masuk tidak ditemukan.'],
  ['vehicleId', 'vehicles', 'Kendaraan tidak ditemukan.'],
] as const

/**
 * QA-MC4-14 (scope rule): references of a manual entry — a missing id (was a 500 from the foreign key)
 * and one of a PT the caller is not mapped to get the same 400. A reference of another MAPPED PT is
 * still refused by the company hook / DB trigger ("cross-company reference").
 */
async function assertManualRefs(req: PayloadRequest, input: Partial<Record<(typeof MANUAL_REFS)[number][0], number | null | undefined>>): Promise<void> {
  const mapped = mappedCompanies(req)
  for (const [key, collection, message] of MANUAL_REFS) {
    const id = input[key]
    if (typeof id !== 'number') continue
    const doc = (await req.payload.findByID({ collection, id, depth: 0, overrideAccess: true /* SYSTEM-READ: existence + PT of a reference */, req, disableErrors: true })) as { company?: unknown } | null
    const company = relId(doc?.company)
    if (!doc || (mapped !== null && company !== undefined && !mapped.includes(company))) fail(400, message, [{ path: key, message }])
  }
}

/** US-23: manual cash in/out (Finance): amount, description, account, category/source required. */
export async function createManualEntry(req: PayloadRequest, input: ManualInput): Promise<CashEntryDoc> {
  if (input.direction === 'out' && !input.categoryId) fail(400, 'Kategori wajib untuk kas keluar.', [{ path: 'categoryId', message: 'Wajib.' }])
  if (input.direction === 'in' && !input.cashInSourceId) fail(400, 'Sumber wajib untuk kas masuk.', [{ path: 'cashInSourceId', message: 'Wajib.' }])
  if (!input.description.trim()) fail(400, 'Keterangan wajib diisi.')
  await assertManualRefs(req, input)
  const entryDate = input.entryDate ?? (await today(req))
  if (entryDate > (await today(req))) fail(400, 'Tanggal tidak boleh di masa depan.')
  // E2 fix: the proof is set on INSERT. Attaching it with a follow-up update (previous code) hit
  // the audit reason rule for edits ("Alasan wajib diisi saat mengedit transaksi kas.") → every
  // manual entry with a proof failed with 400. The owner link is claimed right after the insert,
  // in the same transaction (uploader/ownership errors roll the posting back).
  const doc = await postEntry(req, {
    ...input,
    entryDate,
    description: input.description.trim(),
    proofId: input.proofId ?? null,
    sourceType: 'manual',
  })
  if (input.proofId) await claimMedia(req, 'media-attachments', input.proofId, doc.id, { ownerType: 'cash_entry' })
  return doc
}

export type ManualEdit = {
  description?: string
  categoryId?: number | null
  cashInSourceId?: number | null
  projectId?: number | null
  costCenterId?: number | null
  vehicleId?: number | null
}

/**
 * ADR 0005 §5: only MANUAL posted entries, only descriptive fields, only while the period is open,
 * reason required; amount/date/account/direction changes = void + new entry.
 */
export async function editManualEntry(req: PayloadRequest, id: number, patch: ManualEdit, reason: string): Promise<CashEntryDoc> {
  const e = await loadEntry(req, id)
  if (e.sourceType !== 'manual') fail(409, 'Hanya transaksi kas manual yang dapat diedit.')
  if (e.status !== 'posted') fail(409, 'Transaksi sudah di-void.')
  const lock = await currentLockDate(req, relId((e as { company?: unknown }).company))
  if (lock && e.entryDate <= lock) fail(409, 'Periode transaksi sudah ditutup.')
  const merged = {
    project: patch.projectId !== undefined ? patch.projectId : relId(e.project),
    costCenter: patch.costCenterId !== undefined ? patch.costCenterId : relId(e.costCenter),
  }
  if (merged.project && merged.costCenter) fail(400, 'Pilih project ATAU pusat biaya.')
  await assertManualRefs(req, patch)
  const data: Record<string, unknown> = {}
  if (patch.description !== undefined) data.description = patch.description.trim()
  if (patch.categoryId !== undefined) data.category = patch.categoryId
  if (patch.cashInSourceId !== undefined) data.cashInSource = patch.cashInSourceId
  if (patch.projectId !== undefined) data.project = patch.projectId
  if (patch.costCenterId !== undefined) data.costCenter = patch.costCenterId
  if (patch.vehicleId !== undefined) data.vehicle = patch.vehicleId
  req.context.auditReason = reason
  return (await req.payload.update({
    collection: 'cash-entries',
    id,
    data: data as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: descriptive edit after guards (DB re-checks)
    req,
  })) as unknown as CashEntryDoc
}

export async function loadEntry(req: PayloadRequest, id: number): Promise<CashEntryDoc> {
  if (!Number.isSafeInteger(id) || id <= 0) fail(404, 'Transaksi kas tidak ditemukan.')
  const tx = await getRequestTx(req)
  await tx.execute(sql`SELECT id FROM cash_entries WHERE id = ${id} FOR UPDATE`)
  const e = await req.payload.findByID({ collection: 'cash-entries', id, depth: 0, overrideAccess: true /* SYSTEM-READ: PT role checked below */, req }).catch(() => null)
  if (!e) fail(404, 'Transaksi kas tidak ditemukan.')
  // ADR 0016 §5 (MC2 fix): edit / void only by Finance OF THE ENTRY's PT (else 404, no existence leak)
  if (req.user && !hasRole(req, 'pk-finance', relId((e as { company?: unknown }).company))) fail(404, 'Transaksi kas tidak ditemukan.')
  return e as unknown as CashEntryDoc
}

/**
 * T8 void / reversal (ADR 0005 §4, US-24): never delete or change the posted row — insert a
 * reversal row (inverted direction, same amount/account, `reversalOf`) dated the original date
 * if its period is open, else today (Odoo-like), and mark the original `void` with reason.
 * Entries created by a transfer are voided only through the transfer (keeps T1/T3 consistent).
 */
export async function voidEntry(
  req: PayloadRequest,
  id: number,
  reason: string,
  opts: { viaTransfer?: boolean; viaSettlement?: boolean } = {},
): Promise<{ original: CashEntryDoc; reversal: CashEntryDoc }> {
  const e = await loadEntry(req, id)
  if (e.status === 'void') fail(409, 'Transaksi sudah di-void.')
  if (e.sourceType === 'reversal') fail(409, 'Jurnal balik tidak dapat di-void.')
  if (e.sourceType === 'transfer' && !opts.viaTransfer) fail(409, 'Kas keluar dari transfer di-void lewat pembatalan transfer.')
  // F2b: the LPJ refund belongs to a settled request ("Selesai"); voiding it alone would leave the
  // settlement inconsistent → only through the settlement reversal (E9, lpj.ts reverseSettlement).
  if (e.sourceType === 'settlement_refund' && !opts.viaSettlement) {
    fail(409, 'Kas masuk pengembalian LPJ di-void lewat "Batalkan penyelesaian" pada LPJ, bukan dari buku kas.')
  }
  const lock = await currentLockDate(req, relId((e as { company?: unknown }).company))
  const reversalDate = lock && e.entryDate <= lock ? await today(req) : e.entryDate
  const reversal = await postEntry(req, {
    direction: e.direction === 'in' ? 'out' : 'in',
    entryDate: reversalDate,
    cashAccountId: relId(e.cashAccount)!,
    amount: e.amount,
    categoryId: relId(e.category) ?? null,
    cashInSourceId: relId(e.cashInSource) ?? null,
    projectId: relId(e.project) ?? null,
    costCenterId: relId(e.costCenter) ?? null,
    vehicleId: relId(e.vehicle) ?? null,
    description: `Jurnal balik ${e.entryNo}: ${reason}`,
    sourceType: 'reversal',
    expenseRequestId: relId(e.expenseRequest) ?? null,
    transferId: relId(e.transfer) ?? null,
    reversalOfId: e.id,
  })
  req.context.auditReason = reason
  const original = (await req.payload.update({
    collection: 'cash-entries',
    id: e.id,
    data: { status: 'void', voidReason: reason, voidedBy: userId(req), voidedAt: new Date().toISOString(), reversedBy: reversal.id } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: void flag (DB: only posted → void + void columns)
    req,
  })) as unknown as CashEntryDoc
  return { original, reversal }
}

/**
 * Balance per account = opening balance + Σ in − Σ out over ALL rows (voids cancel via reversal rows),
 * for the cash accounts of `companyIds` — default: the selected PTs where the caller is Finance /
 * Direktur (ADR 0016 §5; combined balance = Σ per PT, each item carries `companyId`).
 */
export async function balances(req: PayloadRequest, asOf?: string, opts: { companyIds?: readonly number[] } = {}) {
  const tx = await getRequestTx(req)
  const until = asOf && isBusinessDate(asOf) ? asOf : '9999-12-31'
  const pts = (opts.companyIds ?? kasCompanies(req)).filter((c) => Number.isSafeInteger(c))
  if (pts.length === 0) return []
  const r = (await tx.execute(sql`
    SELECT a.id, a.company_id, a.name, coalesce(a.opening_balance, 0)::text AS opening,
           coalesce(sum(CASE WHEN e.direction = 'in' THEN e.amount ELSE 0 END), 0)::text AS total_in,
           coalesce(sum(CASE WHEN e.direction = 'out' THEN e.amount ELSE 0 END), 0)::text AS total_out
    FROM cash_accounts a
    LEFT JOIN cash_entries e ON e.cash_account_id = a.id AND e.entry_date <= ${until}
    WHERE a.company_id IN (${sql.join(
      pts.map((c) => sql`${c}`),
      sql`, `,
    )})
    GROUP BY a.id, a.name, a.opening_balance
    ORDER BY a.id`)) as unknown as { rows: Array<{ id: number; company_id: number; name: string; opening: string; total_in: string; total_out: string }> }
  return r.rows.map((x) => {
    const opening = Number(x.opening)
    const tin = Number(x.total_in)
    const tout = Number(x.total_out)
    return { cashAccountId: Number(x.id), companyId: Number(x.company_id), name: x.name, openingBalance: opening, totalIn: tin, totalOut: tout, balance: opening + tin - tout }
  })
}

/**
 * Close a month OF ONE PT (Finance/Direktur = pk-owner of that PT; ADR 0016 §4 — closing PT A
 * never locks PT B). `companyId` default = the caller's only PT (MC3: `company` parameter of
 * POST /period-closings). Only past months; audited `period_close`.
 */
export async function closePeriod(req: PayloadRequest, period: string, note?: string, companyId?: number) {
  if (!isPeriod(period)) fail(400, 'Periode harus YYYY-MM.')
  const company = req.user ? closingCompany(req, companyId, ['pk-finance', 'pk-owner']) : (companyId ?? (await contextCompanyId(req)))
  if (req.user && !hasRole(req, ['pk-finance', 'pk-owner'], company)) fail(403, 'Hanya Finance/Direktur PT ini yang dapat menutup buku.')
  if (period >= (await today(req, company)).slice(0, 7)) fail(409, 'Hanya bulan yang sudah lewat yang dapat ditutup.')
  const tx = await getRequestTx(req)
  await tx.execute(sql`LOCK TABLE period_closings IN SHARE ROW EXCLUSIVE MODE`)
  const existing = await req.payload.count({
    collection: 'period-closings',
    where: { and: [{ company: { equals: company } }, { period: { equals: period } }, { status: { equals: 'closed' } }] },
    overrideAccess: true, // SYSTEM-READ: duplicate close check
    req,
  })
  if (existing.totalDocs > 0) fail(409, `Periode ${period} sudah ditutup.`)
  const doc = await req.payload.create({
    collection: 'period-closings',
    data: { company, period, status: 'closed', note: note ?? null, closedBy: userId(req) } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: period close after role check
    req,
  })
  await writeAudit(req, [{ action: 'period_close', docType: 'period_closing', docId: String(doc.id), docNo: period, field: 'period', newValue: { period, lockDate: periodEnd(period) }, reason: note, companyId: company }])
  return doc
}

/** Re-open (Owner only = "Direktur" label, G1-1; reason required; ADR 0005 §6): only the LATEST closed period. */
export async function reopenPeriod(req: PayloadRequest, period: string, reason: string, companyId?: number) {
  const company = closingCompany(req, companyId, ['pk-owner'])
  if (!hasRole(req, 'pk-owner', company)) fail(403, 'Hanya Direktur yang dapat membuka kembali periode.')
  if (!isPeriod(period)) fail(400, 'Periode harus YYYY-MM.')
  const tx = await getRequestTx(req)
  await tx.execute(sql`LOCK TABLE period_closings IN SHARE ROW EXCLUSIVE MODE`)
  const res = await req.payload.find({
    collection: 'period-closings',
    where: { and: [{ company: { equals: company } }, { status: { equals: 'closed' } }] },
    sort: '-period',
    limit: 1,
    depth: 0,
    overrideAccess: true, // SYSTEM-READ: latest closed period
    req,
  })
  const latest = res.docs[0] as { id: number; period: string } | undefined
  if (!latest || latest.period !== period) fail(409, 'Hanya periode tertutup terakhir yang dapat dibuka kembali.')
  const doc = await req.payload.update({
    collection: 'period-closings',
    id: latest.id,
    data: { status: 'reopened', reopenedBy: userId(req), reopenedAt: new Date().toISOString(), reopenReason: reason } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: reopen after role check
    req,
  })
  await writeAudit(req, [{ action: 'period_reopen', docType: 'period_closing', docId: String(latest.id), docNo: period, field: 'status', oldValue: 'closed', newValue: 'reopened', reason, companyId: company }])
  return doc
}
