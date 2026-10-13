import type { PayloadRequest } from 'payload'

import { relId } from '@/access/roles'
import { writeAudit } from '@/audit/writer'
import { DUPLICATED_FROM_FIELD } from '@/domain/history-format'

import { ids, loadRaw, loadVisible, type RequestDoc } from './common'
import { createDraft, fromDocLines, type DraftInput, type LineInputApi } from './drafts'
import type { RequestType } from './types'

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
  if (input.bankAccountId) {
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
