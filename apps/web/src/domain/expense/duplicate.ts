import type { PayloadRequest } from 'payload'

import { relId } from '@/access/roles'
import { writeAudit } from '@/audit/writer'
import { DUPLICATED_FROM_FIELD } from '@/domain/history-format'

import { ids, loadRaw, loadVisible, type RequestDoc } from './common'
import { createDraft, fromDocLines, type DraftInput, type LineInputApi } from './drafts'
import { isDirectPayment, payeeOf, type RequestType } from './types'
import { designatedAccount } from '@/domain/intercompany/service'

/**
 * DRMS 13/10 Persetujuan #12: "Duplikat" on the request page = a clean NEW Draft with the same PT, project, title,
 * urgency, notes, requesters, bank account and lines — never Payload's built-in duplicate, which copies every column
 * (status, number, approval snapshot / rule / cycle, approved / transferred / verified totals, timestamps, submit
 * times, reject / cancel reasons, `resubmitOf`, the unique `clientUuid`, attachments) and would leave the server to
 * strip them field by field (`disableDuplicate` on the collection closes that route).
 * Not copied: number, status / workflow fields (the create hook sets Draft, cycle 0, createdBy = caller), approvals,
 * transfers and LPJ (other collections, keyed to the source), receipts and their media, flags, attachments
 * (evidence of the source request), "Nominal sesuai nota" per line (belongs to a receipt), the needed date (the
 * new need gets its own) and a legacy cost center (D2: the requester picks a project). The copy is validated like
 * any new draft (createDraft → validateContent) and audited on the new draft (`create`, field `duplicated_from`).
 * ADR 0027: a vendor payment keeps its vendor and vendor account; the invoice (number, dates, file) is NOT copied — one
 * invoice is paid once (the duplicate-invoice rule would refuse it anyway); the new draft needs its own invoice.
 * ADR 0028: a PT grup payment keeps its receiving PT (not its document — same rule as the vendor invoice).
 */
export function duplicateDraftInput(src: RequestDoc): DraftInput & { type: RequestType; title: string } {
  return {
    type: src.type,
    title: src.title,
    projectId: relId(src.project) ?? null,
    urgencyLevelId: relId(src.urgencyLevel) ?? null,
    notes: src.notes ?? null,
    requesterIds: ids(src.requesters),
    bankAccountId: relId(src.bankAccount) ?? null,
    lines: fromDocLines(src).map(({ id: _id, receiptAmount: _receipt, ...l }): LineInputApi => ({ ...l, receiptAmount: null })),
    ...(payeeOf(src.payeeType) === 'vendor'
      ? {
          payeeType: 'vendor' as const,
          vendorId: relId(src.vendor) ?? null,
          vendorBankAccountId: relId(src.vendorBankAccount) ?? null,
          // ADR 0027: a vendor payment on a cost center (no project) keeps it
          ...(!relId(src.project) && relId(src.costCenter) ? { costCenterId: relId(src.costCenter)! } : {}),
        }
      : payeeOf(src.payeeType) === 'pt_grup'
        ? {
            payeeType: 'pt_grup' as const,
            payeeCompanyId: relId(src.payeeCompany) ?? null,
            ...(!relId(src.project) && relId(src.costCenter) ? { costCenterId: relId(src.costCenter)! } : {}),
          }
        : {}),
  }
}

/**
 * Creates the duplicate as the caller (collection create access + the draft rules of POST /expense-requests). The
 * caller must be able to READ the source (404 otherwise); the PT check (a create role in the source's PT) is the
 * endpoint's withNamedCompany. A bank account that is no longer usable (inactive, not of a requester) is dropped
 * instead of failing the copy — the requester picks one before submit.
 */
export async function duplicateAsDraft(req: PayloadRequest, id: number): Promise<RequestDoc> {
  await loadVisible(req, id)
  const src = await loadRaw(req, id)
  const input = duplicateDraftInput(src)
  if (input.vendorBankAccountId) {
    // ADR 0027: an account that is no longer usable (inactive) is dropped — the filer picks one before submit
    const acc = await req.payload.findByID({ collection: 'vendor-bank-accounts', id: input.vendorBankAccountId, depth: 0, overrideAccess: true /* SYSTEM-READ: is the copied vendor account still usable */, req }).catch(() => null)
    if (!acc || acc.active === false || relId(acc.vendor) !== input.vendorId) input.vendorBankAccountId = null
  }
  if (input.vendorId) {
    const v = await req.payload.findByID({ collection: 'vendors', id: input.vendorId, depth: 0, overrideAccess: true /* SYSTEM-READ: is the copied vendor still active */, req }).catch(() => null)
    if (!v || v.active === false) input.vendorId = input.vendorBankAccountId = null
  }
  if (input.payeeCompanyId) {
    // ADR 0028: a receiving PT that is no longer usable (inactive, no designated account) is dropped — picked again before submit
    const c = await req.payload.findByID({ collection: 'companies', id: input.payeeCompanyId, depth: 0, select: { active: true }, overrideAccess: true /* SYSTEM-READ: is the copied receiving PT still usable */, req, disableErrors: true })
    if (!c || (c as { active?: boolean | null }).active === false || !(await designatedAccount(req, input.payeeCompanyId))) input.payeeCompanyId = null
  }
  if (input.bankAccountId && !isDirectPayment(input.payeeType)) {
    const acc = await req.payload
      .findByID({ collection: 'employee-bank-accounts', id: input.bankAccountId, depth: 0, overrideAccess: true /* SYSTEM-READ: is the copied account still usable (G9) */, req })
      .catch(() => null)
    if (!acc || acc.active === false || !(input.requesterIds ?? []).includes(relId(acc.employee) ?? -1)) input.bankAccountId = null
  }
  const { doc } = await createDraft(req, input)
  await writeAudit(req, [
    {
      action: 'create',
      docType: 'expense_request',
      docId: String(doc.id),
      field: DUPLICATED_FROM_FIELD,
      newValue: { id: src.id, docNo: src.docNo ?? null },
      companyId: relId((src as { company?: unknown }).company) ?? null,
    },
  ])
  return doc
}
