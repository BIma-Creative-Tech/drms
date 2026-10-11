import type { PayloadRequest } from 'payload'

import { employeeIn, hasRole, relId, userId } from '@/access/roles'

import { fail, ids, loadVisible } from './common'
import { maskAccountNo } from './dto'

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

type AccountDoc = { id: number; company?: unknown; employee?: unknown; accountNo?: string | null; accountHolder?: string | null; bank?: unknown }

async function bankName(req: PayloadRequest, bank: unknown): Promise<string | null> {
  if (bank && typeof bank === 'object') return String((bank as { name?: string }).name ?? '') || null
  const id = relId(bank)
  if (id === undefined) return null
  const b = await req.payload.findByID({ collection: 'banks', id, depth: 0, overrideAccess: true /* SYSTEM-READ: shared bank master name */, req }).catch(() => null)
  return (b as { name?: string } | null)?.name ?? null
}

async function readableAccount(req: PayloadRequest, id: number): Promise<AccountDoc | null> {
  try {
    return (await req.payload.findByID({ collection: 'employee-bank-accounts', id, depth: 0, user: req.user, overrideAccess: false, req })) as unknown as AccountDoc
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

export async function bankPreview(req: PayloadRequest, input: { requestId?: number; accountId?: number; reveal: boolean }): Promise<BankPreview> {
  const { requestId, accountId, reveal } = input
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
  const saved = relId(doc.bankAccount)
  const id = accountId ?? saved
  if (id === undefined) fail(404, 'Belum ada rekening tujuan.')
  const acc = (await req.payload.findByID({ collection: 'employee-bank-accounts', id, depth: 0, overrideAccess: true /* SYSTEM-READ: checked below (same PT + saved / requester's / readable) */, req }).catch(() => null)) as AccountDoc | null
  if (!acc || relId(acc.company) !== company) fail(404, 'Rekening tidak ditemukan.')
  const allowed = id === saved || ids(doc.requesters).includes(relId(acc.employee) ?? -1) || (await readableAccount(req, id)) !== null
  if (!allowed) fail(404, 'Rekening tidak ditemukan.')
  return out('account', { bankName: await bankName(req, acc.bank), accountNo: acc.accountNo, accountHolder: acc.accountHolder }, full, reveal)
}
