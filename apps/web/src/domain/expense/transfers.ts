import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { relId, userId } from '@/access/roles'
import { writeAudit } from '@/audit/writer'
import { assertAccount, assertOnOrAfterOpening, currentLockDate, postEntry, voidEntry } from '@/domain/cash/ledger'
import { BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED, failCoded } from '@/domain/coded-error'
import { allocateDocNo } from '@/domain/numbering-db'
import { parseBusinessDate } from '@/domain/numbering'
import { DEFAULT_TZ, isoDateInTz, parseZonedDateTime } from '@/lib/time'
import { getRequestTx } from '@/lib/tx'

import { actorContext, fail, loadRaw, loadVisible, requireAction, settings, today, updateRequest } from './common'
import { claimMedia, recomputeFlags } from './receipts'
import { isBusinessDate, payeeOf } from './types'

export type TransferInput = {
  cashAccountId: number
  bankRef: string
  proofMediaId: number
  transferDate?: string
  /**
   * Item 11: date + time of the bank proof (ISO 8601 with offset, or "YYYY-MM-DDTHH:MM" = wall clock in
   * the PT zone). Required by the web form; old clients sending only `transferDate` still work (the
   * transfer then has no time: `transferAt` null, "jam tidak diketahui").
   */
  transferAt?: string
  /**
   * D2 (DRMS 10/10): cost center of the money, chosen by Finance (mandatory). Omitted → the project's default cost
   * center (projects.costCenter), else a legacy request's own cost center; none → 400.
   */
  costCenterId?: number | null
  /** Optional echo of the amount; must equal the approved amount (G3: Finance cannot change it). */
  amount?: number
  /** QA-04: confirm a transfer that makes the cash account balance negative (audited). */
  confirmOverdraft?: boolean
  /** QA-17: confirm a transfer to a bank account that is not verified (audited). */
  confirmUnverifiedAccount?: boolean
}

/** Verification state of the destination bank account of a request (QA-17; ADR 0025: a vendor account for a vendor payment). */
export type DestinationCheck = { bankAccountId: number | null; verificationStatus: 'verified' | 'unverified'; accountKind?: 'employee' | 'vendor' }

/**
 * QA-17 (owner decision 2026-10-08: warning + confirmation, audited): money to an employee bank account
 * that Finance has not verified needs `confirmUnverifiedAccount: true`, else 409
 * BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED with the destination (the transfer screen shows it). A
 * request without a linked account counts as unverified. Shared by the transfer (T3) and the LPJ
 * shortfall transfer (settle). Returns the state so the caller audits a confirmed transfer.
 */
export async function checkDestination(
  req: PayloadRequest,
  doc: { bankAccount?: unknown; payeeType?: unknown; vendorBankAccount?: unknown; bankSnapshot?: { bankName?: string | null; accountNo?: string | null; accountHolder?: string | null } | null },
  confirmed: boolean,
): Promise<DestinationCheck> {
  // ADR 0025: a vendor payment's destination is the vendor account (same confirmation rule as an employee account)
  const vendor = payeeOf(doc.payeeType) === 'vendor'
  const bankAccountId = relId(vendor ? doc.vendorBankAccount : doc.bankAccount) ?? null
  const acct = bankAccountId
    ? ((await req.payload.findByID({ collection: vendor ? 'vendor-bank-accounts' : 'employee-bank-accounts', id: bankAccountId, depth: 0, overrideAccess: true /* SYSTEM-READ: verification state of the request's destination */, req, disableErrors: true })) as {
        verificationStatus?: string | null
      } | null)
    : null
  const verificationStatus = acct?.verificationStatus === 'verified' ? 'verified' : 'unverified'
  if (verificationStatus !== 'verified' && !confirmed) {
    const snap = doc.bankSnapshot ?? {}
    failCoded(
      409,
      BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED,
      'Rekening tujuan belum diverifikasi Finance. Periksa nomor rekening dan nama pemilik, lalu konfirmasi untuk tetap mentransfer.',
      { bankAccountId, verificationStatus, accountKind: vendor ? 'vendor' : 'employee', bankName: snap.bankName ?? null, accountNo: snap.accountNo ?? null, accountHolder: snap.accountHolder ?? null },
    )
  }
  return { bankAccountId, verificationStatus, accountKind: vendor ? 'vendor' : 'employee' }
}

/** Audit row of a transfer confirmed to an unverified account (QA-17). */
export async function auditUnverifiedTransfer(req: PayloadRequest, t: { id: number; docNo: string }, d: DestinationCheck, info: { requestId: number; requestNo?: string | null; amount: number; kind: string; companyId?: number }) {
  await writeAudit(req, [
    {
      action: 'bank_unverified_confirmed',
      docType: 'transfer',
      docId: String(t.id),
      docNo: t.docNo,
      field: 'destination',
      newValue: { bankAccountId: d.bankAccountId, accountKind: d.accountKind ?? 'employee', verificationStatus: d.verificationStatus, requestId: info.requestId, requestNo: info.requestNo ?? null, amount: info.amount, kind: info.kind },
      reason: 'Transfer ke rekening belum diverifikasi dikonfirmasi pengguna (QA-17)',
      ...(info.companyId !== undefined ? { companyId: info.companyId } : {}),
    },
  ])
}

/** Clock skew allowed between the Finance PC and the server before a time counts as "future". */
const FUTURE_SKEW_MS = 2 * 60_000

/**
 * Item 11: `transferAt` → instant + its business date IN THE PT ZONE (null when not given). Not in the
 * future; when `transferDate` is sent too it must be the same date. The period lock (G5, DB trigger
 * on transfer_date) therefore applies to the date of the proof.
 */
export async function transferMoment(req: PayloadRequest, companyId: number | undefined, input: Pick<TransferInput, 'transferAt' | 'transferDate'>): Promise<{ instant: Date; date: string } | null> {
  if (input.transferAt === undefined || input.transferAt === null || input.transferAt === '') return null
  const tz = (await settings(req, companyId)).timezone || process.env.TZ || DEFAULT_TZ
  const instant = parseZonedDateTime(input.transferAt, tz)
  if (!instant) fail(400, 'Tanggal & jam transfer tidak valid (YYYY-MM-DDTHH:MM).')
  if (instant!.getTime() > Date.now() + FUTURE_SKEW_MS) fail(400, 'Tanggal & jam transfer tidak boleh di masa depan.')
  const date = isoDateInTz(instant!, tz)
  if (input.transferDate && input.transferDate !== date) fail(400, `Tanggal transfer (${input.transferDate}) berbeda dengan tanggal pada jam transfer (${date}).`)
  return { instant: instant!, date }
}

/**
 * D2: the transfer's cost center — Finance's choice, else the default of the request's project (or of its site, ADR
 * 0023), else (legacy) the request's own cost center. Must be an ACTIVE cost center of the request's PT.
 */
export async function transferCostCenter(req: PayloadRequest, doc: { project?: unknown; costCenter?: unknown }, companyId: number | undefined, chosen: number | null): Promise<number> {
  let id = chosen
  if (id === null) id = (await suggestedCostCenter(req, doc))?.id ?? null
  if (id === null) fail(400, 'Pusat biaya wajib dipilih (Finance menentukan pusat biaya saat transfer).', [{ path: 'costCenterId', message: 'Pusat biaya wajib dipilih.' }])
  const cc = (await req.payload.findByID({ collection: 'cost-centers', id: id!, depth: 0, overrideAccess: true /* SYSTEM-READ: PT + active checked below */, req, disableErrors: true })) as { company?: unknown; active?: boolean | null } | null
  if (!cc || cc.active === false || (companyId !== undefined && relId(cc.company) !== companyId)) {
    fail(400, 'Pusat biaya tidak ditemukan, nonaktif, atau bukan pusat biaya PT pengajuan ini.', [{ path: 'costCenterId', message: 'Pusat biaya tidak valid.' }])
  }
  return id!
}

/**
 * D2: cost center proposed to Finance — the project's default (projects.costCenter), else (ADR 0023 §1) the default
 * cost center of the project's site, else a legacy request's own.
 */
export async function suggestedCostCenter(req: PayloadRequest, doc: { project?: unknown; costCenter?: unknown }): Promise<{ id: number; code: string; name: string } | null> {
  const projectId = relId(doc.project)
  let id: number | undefined
  if (projectId !== undefined) {
    const p = (await req.payload.findByID({ collection: 'projects', id: projectId, depth: 0, select: { costCenter: true, site: true }, overrideAccess: true /* SYSTEM-READ: default cost center of the request's project */, req, disableErrors: true })) as {
      costCenter?: unknown
      site?: unknown
    } | null
    id = relId(p?.costCenter)
    const site = relId(p?.site)
    if (id === undefined && site !== undefined) {
      const st = (await req.payload.findByID({ collection: 'sites', id: site, depth: 0, select: { costCenter: true }, overrideAccess: true /* SYSTEM-READ: default cost center of the project's site */, req, disableErrors: true })) as { costCenter?: unknown } | null
      id = relId(st?.costCenter)
    }
  }
  id ??= relId(doc.costCenter)
  if (id === undefined) return null
  const cc = (await req.payload.findByID({ collection: 'cost-centers', id, depth: 0, select: { code: true, name: true, active: true }, overrideAccess: true /* SYSTEM-READ: name of the suggestion */, req, disableErrors: true })) as { code?: string; name?: string; active?: boolean | null } | null
  return cc && cc.active !== false ? { id, code: cc.code ?? '', name: cc.name ?? '' } : null
}

/** D2: cost center of the request's latest posted advance / reimburse transfer (null for legacy transfers). */
export async function requestTransferCostCenter(req: PayloadRequest, requestId: number): Promise<number | null> {
  const t = await req.payload.find({
    collection: 'transfers',
    where: { and: [{ request: { equals: requestId } }, { status: { equals: 'posted' } }, { kind: { in: ['advance', 'reimburse'] } }] },
    sort: '-id',
    limit: 1,
    depth: 0,
    select: { costCenter: true },
    overrideAccess: true, // SYSTEM-READ: cost center of the request's transfer
    req,
  })
  return relId((t.docs[0] as { costCenter?: unknown } | undefined)?.costCenter) ?? null
}

type TransferDoc = { id: number; docNo: string; request: unknown; amount: number; status: 'posted' | 'void'; cashEntry?: unknown; kind: string }

/**
 * POST /expense-requests/{id}/transfer (US-20, T3): Pengajuan Baru "Disetujui (Antri Transfer)" or
 * Reimburse "Nota Terverifikasi (Antri Transfer)". ADR 0025: a vendor payment → "Selesai" at once (no LPJ); the
 * destination snapshot is the vendor account taken at submit. Amount copied from `approvedAmount` (G3, also
 * DB-checked on insert), destination = the request's bank snapshot (read-only), source account +
 * bank reference + proof required. Auto-posts ONE KK cash-out linked to request and transfer
 * (category = the lines' single category, else empty: category breakdown comes from the lines,
 * US-25) — all in one transaction; the DB rejects a transfer date in a closed period (G5).
 */
export async function recordTransfer(req: PayloadRequest, id: number, input: TransferInput) {
  const visible = await loadVisible(req, id, { lock: true })
  requireAction(await actorContext(req, visible), 'transfer')
  const doc = await loadRaw(req, id)
  const approved = doc.approvedAmount ?? 0
  if (input.amount !== undefined && input.amount !== approved) {
    fail(409, 'Nominal transfer harus sama dengan nominal yang disetujui; Finance tidak dapat mengubah nominal.')
  }
  const companyId = relId((doc as { company?: unknown }).company)
  const todayDate = await today(req, companyId)
  const at = await transferMoment(req, companyId, input)
  const transferDate = at?.date ?? input.transferDate ?? todayDate
  if (!isBusinessDate(transferDate)) fail(400, 'Tanggal transfer harus YYYY-MM-DD.')
  if (transferDate > todayDate) fail(400, 'Tanggal transfer tidak boleh di masa depan.')
  if (!input.bankRef.trim()) fail(400, 'Nomor referensi bank wajib diisi.')
  if (!doc.bankSnapshot?.accountNo) fail(409, 'Rekening tujuan belum tersimpan pada pengajuan.')
  const account = await assertAccount(req, input.cashAccountId, companyId) // QA-MC4-10: account of the request's PT
  assertOnOrAfterOpening(account, transferDate, 'transferDate') // QA-05: 400 instead of the wrapped trigger error
  const lock = await currentLockDate(req, companyId)
  if (lock && transferDate <= lock) fail(409, `Periode ${transferDate.slice(0, 7)} sudah ditutup (tutup buku s/d ${lock}).`)
  const costCenterId = await transferCostCenter(req, doc, companyId, input.costCenterId ?? null) // D2
  const destination = await checkDestination(req, doc, input.confirmUnverifiedAccount === true) // QA-17

  const { docNo } = await allocateDocNo(req, 'transfer', { companyId: relId((doc as { company?: unknown }).company)!, date: parseBusinessDate(transferDate) })
  await claimMedia(req, 'media-transfer-proofs', input.proofMediaId, id)
  const transfer = (await req.payload.create({
    collection: 'transfers',
    data: {
      docNo,
      request: id,
      kind: doc.type,
      cashAccount: input.cashAccountId,
      amount: approved,
      costCenter: costCenterId,
      destination: { ...doc.bankSnapshot },
      bankRef: input.bankRef.trim(),
      proof: input.proofMediaId,
      transferDate,
      transferAt: at?.instant.toISOString() ?? null,
      postedBy: userId(req),
      status: 'posted',
    } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: transfer after guards (DB: amount = approved, period open)
    req,
  })) as unknown as TransferDoc
  const categories = [...new Set((doc.lines ?? []).map((l) => relId(l.category)).filter((x): x is number => x !== undefined))]
  const entry = await postEntry(req, {
    direction: 'out',
    entryDate: transferDate,
    cashAccountId: input.cashAccountId,
    amount: approved,
    categoryId: categories.length === 1 ? categories[0] : null,
    projectId: relId(doc.project) ?? null,
    costCenterId, // D2: the cost center Finance chose (legacy request: its own one)
    description: `Transfer ${docNo} — ${doc.docNo ?? ''} ${doc.title}`.slice(0, 1000),
    sourceType: 'transfer',
    expenseRequestId: id,
    transferId: transfer.id,
    confirmOverdraft: input.confirmOverdraft === true, // QA-04
  })
  if (destination.verificationStatus !== 'verified') {
    await auditUnverifiedTransfer(req, transfer, destination, { requestId: id, requestNo: doc.docNo, amount: approved, kind: doc.type, companyId: relId((doc as { company?: unknown }).company) })
  }
  const linked = await req.payload.update({
    collection: 'transfers',
    id: transfer.id,
    data: { cashEntry: entry.id } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: link the KK entry (DB: cash_entry_id set once)
    req,
  })
  // ADR 0025: a vendor payment is done with the transfer (the invoice is the proof — no receipts, LPJ or settlement)
  const vendor = payeeOf(doc.payeeType) === 'vendor'
  const updated = await updateRequest(
    req,
    id,
    { status: vendor ? 'completed' : 'transferred', transferredTotal: (doc.transferredTotal ?? 0) + approved },
    vendor ? 'pembayaran vendor selesai dengan transfer (invoice = bukti, tanpa LPJ)' : undefined,
  )
  if (doc.type === 'advance' && !vendor) await recomputeFlags(req, id) // receipt date rules use the transfer date
  return { transfer: linked, cashEntry: entry, request: updated }
}

/**
 * POST /expense-requests/{id}/transfers/{tid}/void (T8): reversal of the KK entry (original stays
 * visible), transfer `void` with reason, request back to its transfer queue status.
 */
export async function voidTransfer(req: PayloadRequest, id: number, transferId: number, reason: string) {
  const visible = await loadVisible(req, id, { lock: true })
  requireAction(await actorContext(req, visible), 'transfer_void')
  const doc = await loadRaw(req, id)
  const t = (await req.payload
    .findByID({ collection: 'transfers', id: transferId, depth: 0, overrideAccess: true /* SYSTEM-READ: belongs-to check below */, req })
    .catch(() => null)) as TransferDoc | null
  if (!t || relId(t.request) !== id) fail(404, 'Transfer tidak ditemukan.')
  if (t.status !== 'posted') fail(409, 'Transfer sudah dibatalkan.')
  const entryId = relId(t.cashEntry)
  const voided = entryId ? await voidEntry(req, entryId, reason, { viaTransfer: true }) : null
  req.context.auditReason = reason
  const transfer = await req.payload.update({
    collection: 'transfers',
    id: transferId,
    data: { status: 'void', voidReason: reason, voidedBy: userId(req), voidedAt: new Date().toISOString() } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: void after guards (DB: only posted → void)
    req,
  })
  const back = doc.type === 'advance' ? 'approved' : 'receipts_verified'
  const updated = await updateRequest(req, id, { status: back, transferredTotal: Math.max(0, (doc.transferredTotal ?? 0) - t.amount) }, reason)
  return { transfer, reversal: voided?.reversal ?? null, request: updated }
}

/**
 * ADR 0013 O-2 (S3e, S-29): requests among `requestIds` whose CURRENT approval cycle the caller
 * approved (Finance "Approval" decision). Approve and transfer by the same Finance user stay allowed
 * (small team, audited); the transfer screen shows "Anda juga yang menyetujui" as a warning.
 */
export async function approvedByCaller(req: PayloadRequest, requestIds: number[]): Promise<Set<number>> {
  const uid = userId(req)
  const list = requestIds.filter((x) => Number.isSafeInteger(x) && x > 0)
  if (uid === undefined || list.length === 0) return new Set()
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT DISTINCT a.request_id AS id FROM approvals a JOIN expense_requests er ON er.id = a.request_id
     WHERE a.request_id IN (${sql.join(
       list.map((i) => sql`${i}`),
       sql`, `,
     )}) AND a.actor_id = ${uid} AND a.decision = 'approved' AND a.cycle = er.approval_cycle`)) as unknown as { rows: Array<{ id: number }> }
  return new Set(r.rows.map((x) => Number(x.id)))
}
