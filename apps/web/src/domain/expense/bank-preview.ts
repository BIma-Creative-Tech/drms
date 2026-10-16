import type { PayloadRequest } from 'payload'

import { employeeIn, hasRole, relId, userId } from '@/access/roles'
import { designatedAccount } from '@/domain/intercompany/service'

import { fail, ids, loadVisible } from './common'
import { maskAccountNo } from './dto'
import { payeeOf } from './types'
import { mayFileIntercompany } from './drafts'

/**
 * DRMS 10/10 8e (WA-04): the destination account shown under the "Rekening tujuan" picker (draft) and
 * as the frozen snapshot (after submit) — bank · holder · MASKED number, plus the full number on an
 * explicit "reveal" only for the people the request DTO already shows it to (dto.ts `fullBank`):
 * the request's creator / requesters and Finance / Direktur / Admin of the document's PT.
 *
 * - `requestId` given: the request must be visible to the caller (loadVisible → 404). Draft → the
 *   live account (`accountId` = the picker value, default the saved one); it must belong to the
 *   request's PT and be the saved account, an account of one of its requesters, or an account the
 *   caller may read anyway (collection access) — anything else 404 (no probing of other accounts).
 *   After submit → the snapshot taken at submit (`accountId` ignored).
 * - no request (new, unsaved form): only an account the caller may read through the collection
 *   access (own employee's account, or Finance/Direktur/Admin of its PT) — it is readable in full
 *   anyway, so `canReveal` = true.
 */
export type BankPreview = {
  source: 'account' | 'snapshot'
  bankName: string | null
  accountHolder: string | null
  accountNoMasked: string | null
  canReveal: boolean
  /** Only with `reveal` and `canReveal`. */
  accountNo?: string
}

type AccountDoc = { id: number; company?: unknown; employee?: unknown; vendor?: unknown; accountNo?: string | null; accountHolder?: string | null; bank?: unknown }

async function bankName(req: PayloadRequest, bank: unknown): Promise<string | null> {
  if (bank && typeof bank === 'object') return String((bank as { name?: string }).name ?? '') || null
  const id = relId(bank)
  if (id === undefined) return null
  const b = await req.payload.findByID({ collection: 'banks', id, depth: 0, overrideAccess: true /* SYSTEM-READ: shared bank master name */, req }).catch(() => null)
  return (b as { name?: string } | null)?.name ?? null
}

async function readableAccount(req: PayloadRequest, id: number, vendor = false): Promise<AccountDoc | null> {
  try {
    return (await req.payload.findByID({ collection: vendor ? 'vendor-bank-accounts' : 'employee-bank-accounts', id, depth: 0, user: req.user, overrideAccess: false, req })) as unknown as AccountDoc
  } catch {
    return null
  }
}

function out(source: BankPreview['source'], acc: { bankName: string | null; accountNo: string | null | undefined; accountHolder: string | null | undefined }, full: boolean, reveal: boolean): BankPreview {
  const no = acc.accountNo ?? null
  return {
    source,
    bankName: acc.bankName,
    accountHolder: acc.accountHolder ?? null,
    accountNoMasked: maskAccountNo(no, false),
    canReveal: full && !!no,
    ...(reveal && full && no ? { accountNo: no } : {}),
  }
}

/**
 * ADR 0028: preview of a receiving PT's designated intercompany account BEFORE submit — always MASKED (the full number
 * is only in the submit snapshot, shown like a vendor account to the filer / office roles of the request's PT).
 */
async function intercompanyPreview(req: PayloadRequest, payeeCompanyId: number): Promise<BankPreview> {
  const acc = await designatedAccount(req, payeeCompanyId)
  if (!acc) fail(404, 'PT penerima belum menetapkan rekening penerimaan antar-PT.')
  return out('account', { bankName: acc!.bankName, accountNo: acc!.accountNo, accountHolder: acc!.accountHolder }, false, false)
}

export async function bankPreview(req: PayloadRequest, input: { requestId?: number; accountId?: number; vendorAccountId?: number; payeeCompanyId?: number; reveal: boolean }): Promise<BankPreview> {
  const { requestId, accountId, reveal } = input
  // ADR 0028: a new PT grup form — only a filer role (Finance / PM / Direktur) sees the payee directory's accounts
  if (input.payeeCompanyId !== undefined && requestId === undefined) {
    if (!mayFileIntercompany(req)) fail(404, 'Rekening tidak ditemukan.')
    return intercompanyPreview(req, input.payeeCompanyId)
  }
  // ADR 0027: a vendor account (vendor payment) — readable through the collection access (Admin / Finance / Direktur / PM / Staff of its PT)
  if (input.vendorAccountId !== undefined) return vendorPreview(req, { requestId, accountId: input.vendorAccountId, reveal })
  if (requestId === undefined) {
    if (accountId === undefined) fail(400, 'Pilih rekening.')
    const acc = await readableAccount(req, accountId)
    if (!acc) fail(404, 'Rekening tidak ditemukan.')
    return out('account', { bankName: await bankName(req, acc.bank), accountNo: acc.accountNo, accountHolder: acc.accountHolder }, true, reveal)
  }
  const doc = await loadVisible(req, requestId)
  const company = relId((doc as { company?: unknown }).company)
  const emp = employeeIn(req, company)
  const own = relId(doc.createdBy) === userId(req) || (emp !== undefined && ids(doc.requesters).includes(emp))
  const full = own || hasRole(req, ['pk-finance', 'pk-owner', 'pk-admin'], company)
  if (doc.status !== 'draft') {
    const s = doc.bankSnapshot
    if (!s?.accountNo) fail(404, 'Rekening tujuan belum tercatat.')
    return out('snapshot', { bankName: s.bankName ?? null, accountNo: s.accountNo, accountHolder: s.accountHolder }, full, reveal)
  }
  // ADR 0028: a PT grup Draft — the (picked, else saved) receiving PT's designated account, masked
  if (payeeOf(doc.payeeType) === 'pt_grup') {
    const pc = input.payeeCompanyId ?? relId(doc.payeeCompany)
    if (pc === undefined) fail(404, 'Belum ada PT penerima.')
    return intercompanyPreview(req, pc!)
  }
  // ADR 0027: a vendor-payment Draft shows its saved vendor account
  if (payeeOf(doc.payeeType) === 'vendor') {
    const saved = relId(doc.vendorBankAccount)
    if (saved === undefined) fail(404, 'Belum ada rekening vendor.')
    return vendorPreview(req, { requestId, accountId: saved, reveal })
  }
  const saved = relId(doc.bankAccount)
  const id = accountId ?? saved
  if (id === undefined) fail(404, 'Belum ada rekening tujuan.')
  const acc = (await req.payload.findByID({ collection: 'employee-bank-accounts', id, depth: 0, overrideAccess: true /* SYSTEM-READ: checked below (same PT + saved / requester's / readable) */, req }).catch(() => null)) as AccountDoc | null
  if (!acc || relId(acc.company) !== company) fail(404, 'Rekening tidak ditemukan.')
  const allowed = id === saved || ids(doc.requesters).includes(relId(acc.employee) ?? -1) || (await readableAccount(req, id)) !== null
  if (!allowed) fail(404, 'Rekening tidak ditemukan.')
  return out('account', { bankName: await bankName(req, acc.bank), accountNo: acc.accountNo, accountHolder: acc.accountHolder }, full, reveal)
}

/**
 * ADR 0027: preview of a vendor account. With a request (visible to the caller): a Draft's account must be of the
 * request's PT and of its chosen vendor — or the saved one; after submit the snapshot. Without a request (new form):
 * an account the caller may read (collection access). The full number for the request's own people / office roles,
 * and for readers of the account (vendor accounts are business data, readable in full by their collection readers).
 */
async function vendorPreview(req: PayloadRequest, input: { requestId?: number; accountId: number; reveal: boolean }): Promise<BankPreview> {
  const { requestId, accountId, reveal } = input
  const readable = await readableAccount(req, accountId, true)
  if (requestId === undefined) {
    if (!readable) fail(404, 'Rekening tidak ditemukan.')
    return out('account', { bankName: await bankName(req, readable.bank), accountNo: readable.accountNo, accountHolder: readable.accountHolder }, true, reveal)
  }
  const doc = await loadVisible(req, requestId)
  const company = relId((doc as { company?: unknown }).company)
  const emp = employeeIn(req, company)
  const own = relId(doc.createdBy) === userId(req) || (emp !== undefined && ids(doc.requesters).includes(emp))
  const full = own || hasRole(req, ['pk-finance', 'pk-owner', 'pk-admin'], company) || readable !== null
  if (doc.status !== 'draft') {
    const s = doc.bankSnapshot
    if (!s?.accountNo) fail(404, 'Rekening tujuan belum tercatat.')
    return out('snapshot', { bankName: s.bankName ?? null, accountNo: s.accountNo, accountHolder: s.accountHolder }, full, reveal)
  }
  const acc = (await req.payload.findByID({ collection: 'vendor-bank-accounts', id: accountId, depth: 0, overrideAccess: true /* SYSTEM-READ: checked below (same PT + saved / of the chosen vendor / readable) */, req }).catch(() => null)) as AccountDoc | null
  if (!acc || relId(acc.company) !== company) fail(404, 'Rekening tidak ditemukan.')
  const allowed = accountId === relId(doc.vendorBankAccount) || (relId(doc.vendor) !== undefined && relId(acc.vendor) === relId(doc.vendor)) || readable !== null
  if (!allowed) fail(404, 'Rekening tidak ditemukan.')
  return out('account', { bankName: await bankName(req, acc.bank), accountNo: acc.accountNo, accountHolder: acc.accountHolder }, full, reveal)
}
