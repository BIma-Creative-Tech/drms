import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { hasRole, relId, userId } from '@/access/roles'
import { writeAudit } from '@/audit/writer'
import { dmy, currentLockDate, postEntry, voidEntry, type CashEntryDoc } from '@/domain/cash/ledger'
import { failCoded } from '@/domain/coded-error'
import { companyRefs, membersWithRole, type CompanyRef } from '@/domain/companies'
import { fail } from '@/domain/expense/common'
import { normalizeInvoiceNo, INACTIVE_FOR_DUPLICATES, STATUS_LABELS, type RequestStatus } from '@/domain/expense/types'
import { notificationTemplate, pushEnabled } from '@/domain/notifications'
import { formatRupiah } from '@/lib/money'
import { getRequestTx } from '@/lib/tx'

import { legOf } from './loan-rules'

/**
 * ADR 0028 (DRMS 13/10 Phase B) "Transfer antar-PT": an expense request of PT A with payee type `pt_grup` pays PT B of
 * the group. When Finance of A records the transfer (KK in A), this module posts the Kas Masuk in B on B's designated
 * receiving account (`cash_accounts.intercompany_receiving`) — a SYSTEM write inside A's authorised transfer (Finance A
 * holds no role in B; `postEntry(…, { systemCompany: true })`) — and pairs both rows in `intercompany_links` (the only
 * two-PT table, ADR 0016 amendment; DB guards 20261014_100200). Voiding A's transfer reverses the KM the same way.
 * B's Finance cannot void the KM alone. Users of A see of B only the PT name / short code, the designated account
 * (masked in the directory) and counterpart document numbers.
 */

/** System cash-in source of the automatic KM (seeded per PT next to "Pengembalian LPJ"; migration 20261014_100300). */
export const INTERCOMPANY_CASH_IN_SOURCE = { code: 'ANTAR-PT', name: 'Antar PT' } as const

/** Stable problem codes (OpenAPI lists them). */
export const INTERCOMPANY_PERIOD_CLOSED = 'INTERCOMPANY_PERIOD_CLOSED'
export const INTERCOMPANY_ACCOUNT_CHANGED = 'INTERCOMPANY_ACCOUNT_CHANGED'
export const INTERCOMPANY_NO_ACCOUNT = 'INTERCOMPANY_NO_ACCOUNT'

/** Audit doc type of a link row (two rows per event: one per PT). */
export const INTERCOMPANY_LINK_DOC_TYPE = 'intercompany_link'

export type ReceivingAccount = {
  id: number
  companyId: number
  name: string
  bankName: string | null
  accountNo: string
  accountHolder: string
  openingBalanceDate: string | null
}

export type PayeeDirectoryItem = {
  companyId: number
  shortCode: string
  name: string
  bankName: string | null
  accountNoMasked: string
  accountHolder: string
}

/** '1234567890' → '••••7890' (same mask as the request detail). */
export function maskAccount(no: string | null | undefined): string {
  return no ? `••••${no.slice(-4)}` : ''
}

type AccountDoc = { id: number; company?: unknown; name?: string | null; accountNo?: string | null; accountHolder?: string | null; openingBalanceDate?: string | null; bank?: unknown }

const toAccount = (a: AccountDoc): ReceivingAccount => ({
  id: a.id,
  companyId: relId(a.company) ?? -1,
  name: a.name ?? '',
  bankName: a.bank && typeof a.bank === 'object' ? ((a.bank as { name?: string | null }).name ?? null) : null,
  accountNo: a.accountNo ?? '',
  accountHolder: a.accountHolder ?? '',
  openingBalanceDate: a.openingBalanceDate ?? null,
})

/** Designated (active) receiving accounts of `companyIds` (SYSTEM-READ: accounts of other PTs — only these fields leave). */
async function designatedAccounts(req: PayloadRequest, companyIds: readonly number[] | null): Promise<ReceivingAccount[]> {
  const res = await req.payload.find({
    collection: 'cash-accounts',
    where: { and: [{ intercompanyReceiving: { equals: true } }, { active: { not_equals: false } }, ...(companyIds ? [{ company: { in: [...companyIds] } }] : [])] },
    sort: 'id',
    depth: 1,
    pagination: false,
    select: { company: true, name: true, accountNo: true, accountHolder: true, openingBalanceDate: true, bank: true },
    overrideAccess: true, // SYSTEM-READ: designated intercompany receiving account (ADR 0028 §2)
    req,
  })
  return (res.docs as unknown as AccountDoc[]).map(toAccount)
}

/** The designated (active) intercompany receiving account of PT `companyId`, or null (SYSTEM-READ: account of another PT). */
export async function designatedAccount(req: PayloadRequest, companyId: number): Promise<ReceivingAccount | null> {
  return (await designatedAccounts(req, [companyId]))[0] ?? null
}

/**
 * Payee directory of PT `sourceCompanyId` (ADR 0028 §2): every OTHER active PT of the group with a designated receiving
 * account — PT name / short code, bank, MASKED number, holder. Nothing else of the other PTs (balances, other accounts).
 */
export async function payeeDirectory(req: PayloadRequest, sourceCompanyId: number): Promise<PayeeDirectoryItem[]> {
  const accounts = new Map<number, ReceivingAccount>()
  for (const a of await designatedAccounts(req, null)) if (!accounts.has(a.companyId)) accounts.set(a.companyId, a)
  accounts.delete(sourceCompanyId)
  if (accounts.size === 0) return []
  const res = await req.payload.find({
    collection: 'companies',
    where: { and: [{ id: { in: [...accounts.keys()] } }, { active: { not_equals: false } }] },
    depth: 0,
    pagination: false,
    select: { shortCode: true, name: true },
    overrideAccess: true, // SYSTEM-READ: app-wide group master (name / short code of the payee PTs)
    req,
  })
  return (res.docs as unknown as Array<{ id: number; shortCode?: string | null; name?: string | null }>)
    .map((c) => {
      const a = accounts.get(c.id)!
      return { companyId: c.id, shortCode: c.shortCode ?? '', name: c.name ?? '', bankName: a.bankName, accountNoMasked: maskAccount(a.accountNo), accountHolder: a.accountHolder }
    })
    .sort((x, y) => x.shortCode.localeCompare(y.shortCode) || x.companyId - y.companyId)
}

/** Short code / name of a PT (app-wide group master; SYSTEM-READ). */
export async function companyRef(req: PayloadRequest, companyId: number): Promise<CompanyRef | null> {
  return (await companyRefs(req, [companyId]))[0] ?? null
}

/**
 * Draft / submit rules of the receiving PT (validateContent): required to send; an ACTIVE PT ≠ the request's own PT with
 * a designated receiving account. `noAccount` = the PT exists but designated none (400 INTERCOMPANY_NO_ACCOUNT).
 */
export async function payeeCompanyErrors(
  req: PayloadRequest,
  payeeCompanyId: number | null | undefined,
  opts: { forSubmit: boolean; ownCompany: number | undefined },
): Promise<{ errors: Array<{ path: string; message: string }>; noAccount: boolean }> {
  const errors: Array<{ path: string; message: string }> = []
  if (!payeeCompanyId) {
    if (opts.forSubmit) errors.push({ path: 'payeeCompanyId', message: 'PT penerima wajib dipilih.' })
    return { errors, noAccount: false }
  }
  if (opts.ownCompany !== undefined && payeeCompanyId === opts.ownCompany) {
    errors.push({ path: 'payeeCompanyId', message: 'PT penerima harus PT lain di grup, bukan PT pengajuan ini.' })
    return { errors, noAccount: false }
  }
  const c = (await req.payload.findByID({ collection: 'companies', id: payeeCompanyId, depth: 0, select: { shortCode: true, active: true }, overrideAccess: true /* SYSTEM-READ: group master (payee PT) */, req, disableErrors: true })) as {
    shortCode?: string | null
    active?: boolean | null
  } | null
  if (!c || c.active === false) {
    errors.push({ path: 'payeeCompanyId', message: 'PT penerima tidak ditemukan atau nonaktif.' })
    return { errors, noAccount: false }
  }
  if (!(await designatedAccount(req, payeeCompanyId))) {
    errors.push({ path: 'payeeCompanyId', message: `PT ${c.shortCode || 'penerima'} belum menetapkan rekening penerimaan antar-PT.` })
    return { errors, noAccount: true }
  }
  return { errors, noAccount: false }
}

/** Message of a duplicate document of the receiving PT (owner 2026-10-14: unique per receiving PT among live requests). */
export function duplicateDocumentMessage(invoiceNo: string, other: { id: number; docNo: string | null; status: RequestStatus }): string {
  return `Dokumen ${invoiceNo.trim()} dari PT penerima ini sudah dipakai di pengajuan ${other.docNo ?? `#${other.id} (draft)`} — status ${STATUS_LABELS[other.status]}. Satu tagihan / memo hanya boleh dibayar sekali; batalkan pengajuan lama atau periksa nomornya.`
}

/**
 * ADR 0028 duplicate rule: same receiving PT + same normalized document number on a `pt_grup` request that is not
 * cancelled / rejected (Draft included; D2410: not a soft-deleted draft) → 409 with a field error on `invoiceNo`. DB:
 * expense_requests_ic_invoice_uq (migration 20261024_510000 ignores deleted rows).
 */
export async function assertDocumentUnused(req: PayloadRequest, payeeCompanyId: number, invoiceNo: string, requestId?: number): Promise<void> {
  const key = normalizeInvoiceNo(invoiceNo)
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT id, doc_no, status::text AS status FROM expense_requests
     WHERE payee_type = 'pt_grup' AND payee_company_id = ${payeeCompanyId} AND id <> ${requestId ?? -1} AND is_deleted IS NOT TRUE
       AND status::text NOT IN (${sql.join(
         INACTIVE_FOR_DUPLICATES.map((s) => sql`${s}`),
         sql`, `,
       )})
       AND pk_invoice_key(invoice_no) = ${key}
     ORDER BY id LIMIT 1`)) as unknown as { rows: Array<{ id: number; doc_no: string | null; status: RequestStatus }> }
  const other = r.rows[0]
  if (!other) return
  const message = duplicateDocumentMessage(invoiceNo, { id: Number(other.id), docNo: other.doc_no, status: other.status })
  fail(409, message, [{ path: 'invoiceNo', message }])
}

/** Receiving side resolved and checked BEFORE anything of the transfer is written (§6 step 2). */
export type PreparedReceipt = { target: CompanyRef; account: ReceivingAccount; source: CompanyRef }

/**
 * §6 step 2 — checks of the receiving PT B for a transfer dated `transferDate`: B active; its designated account active
 * and still the snapshot's account number (else 409 INTERCOMPANY_ACCOUNT_CHANGED); the date after B's lock date (else
 * 409 INTERCOMPANY_PERIOD_CLOSED) and not before the account's opening-balance date (400). The DB triggers stay the
 * authority (a race with B's closing still ends in 409 from pk_cash_entries_guard).
 */
export async function prepareReceipt(
  req: PayloadRequest,
  doc: { payeeCompany?: unknown; company?: unknown; bankSnapshot?: { accountNo?: string | null } | null },
  transferDate: string,
): Promise<PreparedReceipt> {
  const targetId = relId(doc.payeeCompany)
  const sourceId = relId(doc.company)
  if (targetId === undefined || sourceId === undefined) fail(409, 'PT penerima belum tersimpan pada pengajuan.')
  return prepareReceiver(req, { targetId: targetId!, sourceId: sourceId!, date: transferDate, expectedAccountNo: doc.bankSnapshot?.accountNo ?? '' })
}

/**
 * ADR 0029 §3.5 step 4 — the generic receiving-side checks of an intercompany movement (PT grup payment: `prepareReceipt`;
 * inter-PT loan disbursement / repayment): the receiving PT active, its designated account active (and, for a payment,
 * still the snapshot's number), the date after its lock date (409 INTERCOMPANY_PERIOD_CLOSED, same text) and not before
 * the account's opening-balance date. Everything BEFORE anything of the movement is written.
 */
export async function prepareReceiver(
  req: PayloadRequest,
  input: { targetId: number; sourceId: number; date: string; expectedAccountNo?: string; noun?: string; status?: number },
): Promise<PreparedReceipt> {
  const { targetId, sourceId, date: transferDate } = input
  const noun = input.noun ?? 'Transfer antar-PT'
  const [target, source] = [await companyRef(req, targetId), await companyRef(req, sourceId)]
  const t = (await req.payload.findByID({ collection: 'companies', id: targetId, depth: 0, select: { active: true }, overrideAccess: true /* SYSTEM-READ: receiving PT active */, req, disableErrors: true })) as { active?: boolean | null } | null
  if (!target || !source || !t || t.active === false) fail(409, 'PT penerima tidak ditemukan atau nonaktif.')
  const code = target!.shortCode
  const account = await designatedAccount(req, targetId)
  if (!account) failCoded(input.status ?? 409, INTERCOMPANY_NO_ACCOUNT, `PT ${code} belum menetapkan rekening penerimaan antar-PT.`, { payeeCompanyId: targetId })
  if (input.expectedAccountNo !== undefined && account!.accountNo !== input.expectedAccountNo) {
    failCoded(409, INTERCOMPANY_ACCOUNT_CHANGED, `Rekening penerimaan PT ${code} berubah sejak pengajuan. Tarik dan ajukan ulang pengajuan ini.`, { payeeCompanyId: targetId })
  }
  const lock = await currentLockDate(req, targetId)
  if (lock && transferDate <= lock) {
    failCoded(
      409,
      INTERCOMPANY_PERIOD_CLOSED,
      `Periode ${transferDate.slice(0, 7)} PT ${code} sudah ditutup (tutup buku s/d ${lock}). ${noun} tidak dapat dicatat pada tanggal ini — minta Direktur PT ${code} membuka kembali periode itu, atau catat transfer dengan tanggal di periode terbuka.`,
      { payeeCompanyId: targetId, lockDate: lock },
    )
  }
  if (account!.openingBalanceDate && transferDate < account!.openingBalanceDate) {
    const message = `Tanggal transfer sebelum tanggal saldo awal rekening penerimaan PT ${code} (${dmy(account!.openingBalanceDate)}).`
    fail(400, message, [{ path: 'transferDate', message }])
  }
  return { target: target!, account: account!, source: source! }
}

/** The receiving PT's system cash-in source "Antar PT" (created when missing — e.g. a PT older than the data migration). */
export async function cashInSource(req: PayloadRequest, companyId: number): Promise<number> {
  const found = await req.payload.find({
    collection: 'cash-in-sources',
    where: { and: [{ company: { equals: companyId } }, { code: { equals: INTERCOMPANY_CASH_IN_SOURCE.code } }] },
    sort: 'id',
    limit: 1,
    depth: 0,
    overrideAccess: true, // SYSTEM-READ: system master of the receiving PT
    req,
  })
  const id = found.docs[0]?.id as number | undefined
  if (id !== undefined) return id
  const created = await req.payload.create({
    collection: 'cash-in-sources',
    data: { company: companyId, code: INTERCOMPANY_CASH_IN_SOURCE.code, name: INTERCOMPANY_CASH_IN_SOURCE.name, active: true } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: system master of a PT (ADR 0028), audited by the collection
    req,
  })
  return created.id as number
}

/** Runs `fn` with the audit source `system` and `reason` (rows of the receiving PT), restoring the request's own after. */
export async function asSystem<T>(req: PayloadRequest, reason: string, fn: () => Promise<T>): Promise<T> {
  const before = { source: req.context.auditSource, reason: req.context.auditReason }
  req.context.auditSource = 'system'
  req.context.auditReason = reason
  try {
    return await fn()
  } finally {
    req.context.auditSource = before.source
    req.context.auditReason = before.reason
  }
}

type LinkRow = {
  id: number
  source_company_id: number
  target_company_id: number
  source_doc_type: string
  source_doc_id: number
  source_transfer_id: number | null
  source_cash_entry_id: number
  target_cash_account_id: number
  target_cash_entry_id: number
  amount: string | number
  status: 'posted' | 'void'
}

/**
 * §6 — after the transfer row and A's KK exist (same transaction): posts the KM in B (date = transfer date, amount,
 * B's designated account, system source "Antar PT", no project / cost center, description without any number of A),
 * inserts the link and audits it in both PTs; B's Finance and Direktur are notified. Any failure rolls everything back.
 */
export async function postReceipt(
  req: PayloadRequest,
  input: { prepared: PreparedReceipt; request: { id: number; docNo?: string | null; title: string }; transfer: { id: number; docNo: string }; kk: CashEntryDoc; transferDate: string; amount: number },
): Promise<{ km: CashEntryDoc; linkId: number }> {
  const { prepared, request, transfer, kk } = input
  const B = prepared.target.id
  const reason = `Kas masuk otomatis antar-PT dari PT ${prepared.source.shortCode} (ADR 0028)`
  const km = await asSystem(req, reason, async () =>
    postEntry(
      req,
      {
        direction: 'in',
        entryDate: input.transferDate,
        cashAccountId: prepared.account.id,
        amount: input.amount,
        cashInSourceId: await cashInSource(req, B),
        description: `Antar-PT dari ${prepared.source.shortCode}: ${request.title}`.slice(0, 1000),
        sourceType: 'intercompany',
      },
      { systemCompany: true },
    ),
  )
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    INSERT INTO intercompany_links (source_company_id, target_company_id, source_doc_type, source_doc_id, source_transfer_id, source_cash_entry_id,
                                    target_cash_account_id, target_cash_entry_id, amount, status, created_by_id)
    VALUES (${prepared.source.id}, ${B}, 'expense_request', ${request.id}, ${transfer.id}, ${kk.id}, ${prepared.account.id}, ${km.id}, ${input.amount}, 'posted', ${userId(req) ?? null})
    RETURNING id`)) as unknown as { rows: Array<{ id: number }> }
  const linkId = Number(r.rows[0]!.id)
  const value = { sourceDoc: { type: 'expense_request', id: request.id, docNo: request.docNo ?? null }, transferId: transfer.id, transferNo: transfer.docNo, kkId: kk.id, kkNo: kk.entryNo, kmId: km.id, kmNo: km.entryNo, sourceCompanyId: prepared.source.id, targetCompanyId: B, amount: input.amount }
  await asSystem(req, reason, () =>
    writeAudit(req, [
      { action: 'create', docType: INTERCOMPANY_LINK_DOC_TYPE, docId: String(linkId), docNo: km.entryNo, field: 'intercompanyLink', newValue: value, reason, companyId: prepared.source.id },
      { action: 'create', docType: INTERCOMPANY_LINK_DOC_TYPE, docId: String(linkId), docNo: km.entryNo, field: 'intercompanyLink', newValue: value, reason, companyId: B },
    ]),
  )
  await notifyReceivingPt(req, 'cash.intercompany_received', { companyId: B, km, sourceCode: prepared.source.shortCode, account: prepared.account.name, amount: input.amount })
  return { km, linkId }
}

/**
 * §7 — the void of A's transfer (Finance A, same transaction, after A's KK is voided): posts B's reversal of the KM
 * (dated per the ledger rule: the KM date while B's period is open, else today — a closed period in B never blocks the
 * void), sets the link `void`, audits in both PTs and notifies B. No link (not an intercompany transfer) → null.
 */
export async function voidReceipt(req: PayloadRequest, transferId: number, reason: string): Promise<{ reversal: CashEntryDoc; linkId: number } | null> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`SELECT * FROM intercompany_links WHERE source_transfer_id = ${transferId} FOR UPDATE`)) as unknown as { rows: LinkRow[] }
  const link = r.rows[0]
  if (!link) return null
  if (link.status !== 'posted') fail(409, 'Kas masuk antar-PT sudah dibatalkan.')
  const refs = await companyRefs(req, [Number(link.source_company_id), Number(link.target_company_id)])
  const sourceCode = refs.find((c) => c.id === Number(link.source_company_id))?.shortCode ?? ''
  const why = `Transfer antar-PT dibatalkan di PT ${sourceCode}: ${reason}`.slice(0, 1000)
  const { original, reversal } = await asSystem(req, why, () => voidEntry(req, Number(link.target_cash_entry_id), why, { viaIntercompany: true }))
  await tx.execute(sql`UPDATE intercompany_links SET status = 'void', void_reason = ${why}, voided_by_id = ${userId(req) ?? null}, voided_at = now() WHERE id = ${link.id}`)
  const value = { transferId, kmId: original.id, kmNo: original.entryNo, reversalId: reversal.id, reversalNo: reversal.entryNo, amount: Number(link.amount) }
  await asSystem(req, why, () =>
    writeAudit(req, [
      { action: 'void', docType: INTERCOMPANY_LINK_DOC_TYPE, docId: String(link.id), docNo: original.entryNo, field: 'status', oldValue: 'posted', newValue: value, reason: why, companyId: Number(link.source_company_id) },
      { action: 'void', docType: INTERCOMPANY_LINK_DOC_TYPE, docId: String(link.id), docNo: original.entryNo, field: 'status', oldValue: 'posted', newValue: value, reason: why, companyId: Number(link.target_company_id) },
    ]),
  )
  await notifyReceivingPt(req, 'cash.intercompany_reversed', { companyId: Number(link.target_company_id), km: original, reversal, sourceCode, account: null, amount: Number(link.amount) })
  return { reversal, linkId: Number(link.id) }
}

/** §9: default texts of the receiving PT's events (editable as `notification-templates` rows of the same event). */
export const INTERCOMPANY_NOTIFY_DEFAULTS = {
  'cash.intercompany_received': { title: 'Kas masuk antar-PT: {entryNo}', body: 'Dari PT {source} {amount} ke {account}.' },
  'cash.intercompany_reversed': { title: 'Kas masuk antar-PT dibatalkan: {entryNo}', body: 'PT {source} membatalkan transfer {amount}; jurnal balik {reversalNo} tercatat otomatis.' },
} as const

async function notifyReceivingPt(
  req: PayloadRequest,
  event: keyof typeof INTERCOMPANY_NOTIFY_DEFAULTS,
  v: { companyId: number; km: CashEntryDoc; reversal?: CashEntryDoc; sourceCode: string; account: string | null; amount: number },
): Promise<void> {
  const to = new Set<number>([...(await membersWithRole(req, 'pk-finance', v.companyId)), ...(await membersWithRole(req, 'pk-owner', v.companyId))])
  const actor = userId(req)
  if (actor !== undefined) to.delete(actor)
  if (to.size === 0) return
  const t = await notificationTemplate(req, event, INTERCOMPANY_NOTIFY_DEFAULTS[event])
  const vars: Record<string, string> = { entryNo: v.km.entryNo, source: v.sourceCode, amount: formatRupiah(v.amount), account: v.account ?? '', reversalNo: v.reversal?.entryNo ?? '' }
  const render = (s: string) => s.replace(/\{(entryNo|source|amount|account|reversalNo)\}/g, (_, k: string) => vars[k] ?? '')
  for (const uid of [...to].sort((a, b) => a - b)) {
    await req.payload.create({
      collection: 'notifications',
      data: {
        user: uid,
        event,
        title: render(t.title).slice(0, 160),
        body: render(t.body).slice(0, 1000),
        docType: 'cash_entry',
        docId: String(v.km.id),
        docNo: v.km.entryNo,
        company: v.companyId,
        pushStatus: pushEnabled() ? 'pending' : 'skipped',
      } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: in-app notification of the receiving PT (same transaction as the posting)
      req,
    })
  }
}

/** The link state of request `requestId` (latest link; null before any intercompany transfer) — request detail / PDF. */
export async function intercompanyOfRequest(req: PayloadRequest, requestId: number): Promise<{ status: 'posted' | 'void'; targetEntryNo: string; targetEntryId: number; targetCompany: CompanyRef | null; transferId: number | null } | null> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT l.status, l.target_company_id, l.target_cash_entry_id, l.source_transfer_id, e.entry_no
      FROM intercompany_links l JOIN cash_entries e ON e.id = l.target_cash_entry_id
     WHERE l.source_doc_type = 'expense_request' AND l.source_doc_id = ${requestId}
     ORDER BY (l.status = 'posted') DESC, l.id DESC LIMIT 1`)) as unknown as { rows: Array<{ status: 'posted' | 'void'; target_company_id: number; target_cash_entry_id: number; source_transfer_id: number | null; entry_no: string }> }
  const x = r.rows[0]
  if (!x) return null
  return { status: x.status, targetEntryNo: x.entry_no, targetEntryId: Number(x.target_cash_entry_id), targetCompany: await companyRef(req, Number(x.target_company_id)), transferId: x.source_transfer_id === null ? null : Number(x.source_transfer_id) }
}

/** Counterpart of a cash entry of an intercompany pair (Buku Kas row, API cash entry) — numbers and PT only. */
export type EntryCounterpart = {
  /** `in` = this entry is the KM of the receiving PT; `out` = the KK of the paying PT. */
  direction: 'in' | 'out'
  /** ADR 0029: the document behind the pair — a PT grup payment (expense request) or an inter-PT loan (PJA). */
  sourceDocType: 'expense_request' | 'intercompany_loan'
  /** ADR 0029: the loan movement's leg ("Pinjaman antar-PT diberikan" …); null for a PT grup payment. */
  loanLeg: 'given' | 'received' | 'repaid_in' | 'repaid_out' | null
  status: 'posted' | 'void'
  counterpartCompany: CompanyRef | null
  /** The paying PT's request and transfer numbers (ADR 0029: the loan's PJA number and id). */
  sourceDocNo: string | null
  sourceDocId: number
  transferDocNo: string | null
  counterpartEntryNo: string
  counterpartEntryId: number
  /** The caller may open the counterpart entry (Kas roles in the other PT); else the numbers are plain text. */
  canOpenCounterpart: boolean
  /** The caller may open the paying PT's request (office roles there). */
  canOpenSourceDoc: boolean
}

/**
 * Counterparts of `entryIds` (KK of A or KM of B; reversal rows resolve through their original). The caller already
 * reads the entries themselves; what comes back of the OTHER PT is its short code / name and document numbers only.
 */
export async function counterpartsOf(req: PayloadRequest, entryIds: readonly number[]): Promise<Map<number, EntryCounterpart>> {
  const ids = [...new Set(entryIds.filter((x) => Number.isSafeInteger(x) && x > 0))]
  const out = new Map<number, EntryCounterpart>()
  if (ids.length === 0) return out
  const tx = await getRequestTx(req)
  const list = sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `,
  )
  const r = (await tx.execute(sql`
    SELECT l.id, l.status, l.source_company_id, l.target_company_id, l.source_doc_type, l.source_doc_id, l.source_cash_entry_id, l.target_cash_entry_id,
           kk.entry_no AS kk_no, km.entry_no AS km_no, er.doc_no AS request_no, t.doc_no AS transfer_no, ln.id AS loan_id, ln.doc_no AS loan_no
      FROM intercompany_links l
      JOIN cash_entries kk ON kk.id = l.source_cash_entry_id
      JOIN cash_entries km ON km.id = l.target_cash_entry_id
      LEFT JOIN expense_requests er ON l.source_doc_type = 'expense_request' AND er.id = l.source_doc_id
      LEFT JOIN transfers t ON t.id = l.source_transfer_id
      LEFT JOIN intercompany_loan_transfers mv ON l.source_doc_type IN ('intercompany_loan_disbursement', 'intercompany_loan_repayment') AND mv.id = l.source_doc_id
      LEFT JOIN intercompany_loans ln ON ln.id = mv.loan_id
     WHERE l.source_cash_entry_id IN (${list}) OR l.target_cash_entry_id IN (${list})`)) as unknown as {
    rows: Array<{ id: number; status: 'posted' | 'void'; source_company_id: number; target_company_id: number; source_doc_type: string; source_doc_id: number; source_cash_entry_id: number; target_cash_entry_id: number; kk_no: string; km_no: string; request_no: string | null; transfer_no: string | null; loan_id: number | null; loan_no: string | null }>
  }
  if (r.rows.length === 0) return out
  const refs = new Map((await companyRefs(req, r.rows.flatMap((x) => [Number(x.source_company_id), Number(x.target_company_id)]))).map((c) => [c.id, c]))
  for (const x of r.rows) {
    const A = Number(x.source_company_id)
    const B = Number(x.target_company_id)
    const office = (c: number) => hasRole(req, ['pk-finance', 'pk-owner', 'pk-admin'], c)
    // ADR 0029: a loan movement — the document is the PJA (it belongs to both PTs: opened by an office role of either)
    const loan = x.loan_id !== null && x.loan_id !== undefined
    const docType = x.source_doc_type as 'expense_request' | 'intercompany_loan_disbursement' | 'intercompany_loan_repayment'
    const base = loan
      ? { status: x.status, sourceDocType: 'intercompany_loan' as const, sourceDocNo: x.loan_no, sourceDocId: Number(x.loan_id), transferDocNo: null, canOpenSourceDoc: office(A) || office(B) }
      : { status: x.status, sourceDocType: 'expense_request' as const, sourceDocNo: x.request_no, sourceDocId: Number(x.source_doc_id), transferDocNo: x.transfer_no, canOpenSourceDoc: office(A) }
    const leg = (side: 'source' | 'target') => (loan ? legOf(docType as 'intercompany_loan_disbursement' | 'intercompany_loan_repayment', side) : null)
    out.set(Number(x.source_cash_entry_id), { ...base, loanLeg: leg('source'), direction: 'out', counterpartCompany: refs.get(B) ?? null, counterpartEntryNo: x.km_no, counterpartEntryId: Number(x.target_cash_entry_id), canOpenCounterpart: office(B) })
    out.set(Number(x.target_cash_entry_id), { ...base, loanLeg: leg('target'), direction: 'in', counterpartCompany: refs.get(A) ?? null, counterpartEntryNo: x.kk_no, counterpartEntryId: Number(x.source_cash_entry_id), canOpenCounterpart: office(A) })
  }
  return out
}
