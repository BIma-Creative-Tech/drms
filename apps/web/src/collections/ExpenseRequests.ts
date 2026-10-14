import { APIError, type CollectionAfterChangeHook, type CollectionBeforeChangeHook, type CollectionConfig, type FilterOptionsProps, type PayloadRequest, type Where } from 'payload'

import { RIWAYAT_TAB } from '@/admin/config'

import { employeeIn, ownEmployees, relId, rolesIn, rolesOf, userId, type Role } from '@/access/roles'
import { fieldNever, rolesAllowed } from '@/access/policies'
import { normalizeValue, reasonOnChange, withAudit } from '@/audit/hooks'
import { writeAudit, type AuditRow } from '@/audit/writer'
import { denyDeleteLogged, requestReadAccess, requestUpdateAccess } from '@/domain/expense/access'
import { ids, type RequestDoc } from '@/domain/expense/common'
import { CONTENT_VALIDATED, fromDocLines, validateContent } from '@/domain/expense/drafts'
import { grandTotal, normalizeLines, unlockLine, validateLines, type LineInput } from '@/domain/expense/lines'
import { diffLines, type AuditLine } from '@/domain/expense/line-audit'
import { recomputeFlags } from '@/domain/expense/receipts'
import { INTERCOMPANY_PAYMENT_LABEL, isContentEditable, isDirectPayment, PAYEE_TYPE_LABELS, payeeOf, REQUEST_STATUSES, REQUEST_TYPE_LABELS, STATUS_LABELS, VENDOR_PAYMENT_LABEL, type RequestStatus, type RequestType } from '@/domain/expense/types'
import { INTERCOMPANY_PAYMENT_ROLES, VENDOR_PAYMENT_ROLES } from '@/domain/expense/drafts'
import { changeReasonField, rupiahField, uuidField } from '@/fields/common'
import { requestMeta } from '@/lib/request-meta'
import { forceDeferredChecks } from '@/lib/system-tx'
import { notifyCreated, notifyTransition } from '@/domain/notifications'
import { companyField, companyHook, formCompany, isListFilter, pickerSameCompany } from '@/fields/company'
import { hasRole, hasRoleAny } from '@/access/roles'
import { select as selectValidation } from 'payload/shared'
import { validationError } from '@/lib/validation'

import { directPayee, draftOnly, editableInput, employeePayee, intercompanyPayee, linesCondition, linesEditable, notOnRequestPage, PLACEHOLDERS, revisionOnly, shownInHeader, vendorPayee, whenSet } from './expense-request-form'
import { businessDateField } from './fields-f2'
import { USER_NAME_VIEW } from '@/fields/users'

/**
 * T1 Pengajuan biaya (requirements v1.1 §7 T1; architecture §4.3, §5.1/§5.2).
 *
 * IMMUTABILITY DESIGN (F1 finding: Payload deletes and re-inserts every array / hasMany row on
 * EVERY parent update):
 * - `lines` (array → `expense_requests_lines`) and `requesters` (hasMany → `expense_requests_rels`)
 *   are ordinary Payload children while the request is content-editable (Draft, Revisi Nota).
 * - On every transition out of an editable status the DB trigger `pk_expense_requests_guard`
 *   stores `content_hash` = md5 over lines + requesters (SQL `pk_expense_content_hash`) and, while
 *   locked, rejects any change of the header columns (whitelist: status + workflow counters).
 * - DEFERRED constraint triggers on the parent and both child tables re-check at COMMIT that a
 *   locked request's children still hash to `content_hash` and that `grand_total = Σ lines.total`
 *   → Payload's delete+re-insert of identical rows passes, any real change fails the commit
 *   (even as raw SQL with the app role).
 * - The domain service also writes a Class A snapshot (`expense-line-snapshots`) at submit and at
 *   approval (audit/PDF trail).
 * Status changes only through the domain service (`context.pkTransition`), guard G6.
 */

const system = { create: fieldNever, update: fieldNever }

const ro = { readOnly: true }
const RUPIAH_FIELD = '@/admin/components/RupiahNumberField#RupiahNumberField'
/** DRMS 13/10 Pengajuan #3/#5: a picker that stays disabled ("Pilih PT terlebih dahulu") until the form has a PT. */
const COMPANY_SCOPED_FIELD = '@/admin/components/companies/CompanyScopedField#CompanyScopedField'
/** Read-only money as "Rp 1.250.000" (RupiahNumberField read-only mode). */
const rupiahView = { components: { Field: RUPIAH_FIELD } }

/**
 * Q-09 / ADR 0024: roles that may create a request (collection create access). DRMS 13/10 Pengajuan #1–#3/#5: also the
 * PT picker scope (PT switcher selection ∩ these roles; one PT → prefilled read-only) and the PT the dependent pickers
 * (project, urgency, Pemohon, rekening) wait for.
 */
export const REQUEST_CREATE_ROLES: readonly Role[] = ['pk-staff', 'pk-pm', 'pk-admin', 'pk-finance', 'pk-owner']

/**
 * Picker filter of `bankAccount` (S3e, US-44): active accounts of the requesters / the creator's employee.
 * DRMS 13/10 #3: nothing until the form's PT is known (the list filter, data `{}`, keeps the old rule).
 */
export const bankAccountOptions = ({ data, user }: Pick<FilterOptionsProps, 'data' | 'user'>): false | Where => {
  const reqs = ids(((data ?? {}) as { requesters?: unknown[] | null }).requesters ?? null)
  const company = formCompany(data, user, REQUEST_CREATE_ROLES)
  if (company === undefined && !isListFilter(data)) return false
  const emp = company !== undefined ? employeeIn({ user } as never, company) : relId((user as { employee?: unknown } | null)?.employee)
  const owners = reqs.length > 0 ? reqs : emp !== undefined ? [emp] : []
  if (owners.length === 0) return false
  return { and: [{ employee: { in: owners } }, { active: { not_equals: false } }] }
}

/**
 * QA-15 (owner decision 2026-10-08): "Pemohon" (Diajukan Oleh) picker — a user whose only role in the document's
 * PT (list filter: in every selected PT) is Staff sees only their OWN employee; everyone else the
 * employees of the document's PT (pickerSameCompany). Server rule: drafts.ts validateContent.
 */
export const requesterOptions = ({ data, user }: Pick<FilterOptionsProps, 'data' | 'user'>): boolean | Where => {
  const list = isListFilter(data)
  const company = list ? undefined : formCompany(data, user, REQUEST_CREATE_ROLES)
  // DRMS 13/10 Pengajuan #5: locked until the PT is chosen (prefilled for a single PT), then that PT's employees
  if (!list && company === undefined) return false
  const base: true | Where = company === undefined ? true : { company: { equals: company } }
  const roles = company !== undefined ? rolesIn({ user } as never, company) : rolesOf(user)
  if (!(roles.includes('pk-staff') && roles.every((r) => r === 'pk-staff'))) return base
  const own = company !== undefined ? [employeeIn({ user } as never, company)].filter((e): e is number => e !== undefined) : ownEmployees({ user } as never)
  if (own.length === 0) return false
  const mine: Where = { id: { in: own } }
  return base === true ? mine : { and: [base, mine] }
}

/**
 * ADR 0027 (client 2026-10-14): the requester's cost center is writable only on a vendor payment (a vendor payment
 * without a project names its cost center); employee requests keep D2 (no cost center, Finance sets it at the transfer).
 * ADR 0028: the same for a payment to a PT of the group (project OR cost center, ADR 0027 decision 2).
 */
export const vendorCostCenterAccess = ({ data, siblingData, doc }: { data?: unknown; siblingData?: unknown; doc?: unknown }): boolean => {
  const payee = (data as { payeeType?: unknown } | undefined)?.payeeType ?? (siblingData as { payeeType?: unknown } | undefined)?.payeeType ?? (doc as { payeeType?: unknown } | undefined)?.payeeType
  return isDirectPayment(payee)
}

/**
 * ADR 0027: "Jenis penerima" options of the form — `vendor` only for Finance / PM of the form's PT (D3; the server
 * re-checks: drafts.ts vendorErrors). A stored value stays selectable (a locked request is never re-validated here).
 */
export const payeeTypeOptions = ({ options, data, req }: { options: Array<string | { label: unknown; value: string }>; data?: unknown; req: PayloadRequest }) => {
  const stored = (data as { payeeType?: unknown } | undefined)?.payeeType
  const company = formCompany(data, req.user, REQUEST_CREATE_ROLES)
  const may = (roles: readonly Role[]) => (company !== undefined ? hasRole(req, roles, company) : hasRoleAny(req, ...roles))
  // ADR 0028 (owner 2026-10-14): "PT grup" for Finance, PM and Direktur of the form's PT (server: drafts.ts payeeFilerErrors)
  const hidden = new Set<string>([...(may(VENDOR_PAYMENT_ROLES) || stored === 'vendor' ? [] : ['vendor']), ...(may(INTERCOMPANY_PAYMENT_ROLES) || stored === 'pt_grup' ? [] : ['pt_grup'])])
  return hidden.size === 0 ? options : options.filter((o) => !hidden.has(typeof o === 'string' ? o : o.value))
}

/** ADR 0027: vendor picker — ACTIVE vendors of the form's PT (locked until the PT is known; list filter: every readable vendor). */
export const vendorOptions = ({ data, user }: Pick<FilterOptionsProps, 'data' | 'user'>): boolean | Where => {
  if (isListFilter(data)) return true
  const company = formCompany(data, user, REQUEST_CREATE_ROLES)
  return company === undefined ? false : { and: [{ company: { equals: company } }, { active: { not_equals: false } }] }
}

/** ADR 0027: vendor account picker — active accounts OF THE CHOSEN vendor (nothing before a vendor is chosen). */
export const vendorAccountOptions = ({ data }: Pick<FilterOptionsProps, 'data'>): boolean | Where => {
  if (isListFilter(data)) return true
  const v = relId((data as { vendor?: unknown } | undefined)?.vendor)
  return v === undefined ? false : { and: [{ vendor: { equals: v } }, { active: { not_equals: false } }] }
}

/**
 * S3e (US-44): default account of the first requester — its "Rekening default", else its oldest active
 * account; none → null (the requester then picks one, submit requires it).
 */
export async function defaultBankAccount(req: PayloadRequest, requesterIds: number[]): Promise<number | null> {
  const first = requesterIds[0]
  if (first === undefined) return null
  const res = await req.payload.find({
    collection: 'employee-bank-accounts',
    where: { and: [{ employee: { equals: first } }, { active: { not_equals: false } }] },
    sort: 'id',
    depth: 0,
    limit: 50,
    overrideAccess: true, // SYSTEM-READ: default account of a requester (G9 checked by validateContent)
    req,
  })
  const docs = res.docs as unknown as Array<{ id: number; isDefault?: boolean | null }>
  return (docs.find((a) => a.isDefault) ?? docs[0])?.id ?? null
}

type Doc = Record<string, unknown> & { id?: number; status?: RequestStatus; lines?: LineInput[] }

const beforeChange: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req, context }) => {
  const d = data as Doc
  const prev = (originalDoc ?? {}) as Doc
  const transition = context?.pkTransition === true

  if (operation === 'create') {
    if (!transition) {
      d.status = 'draft'
      const uid = userId(req)
      if (uid === undefined) throw new APIError('Unauthorized', 401)
      d.createdBy = uid // "Dibuat Oleh" is always the logged-in user (US-41)
      d.source = requestMeta(req).source
      d.approvalCycle = 0
      d.transferredTotal = 0
      d.syncRev = 1
    }
    const reqs = Array.isArray(d.requesters) ? d.requesters : []
    // default: the creator's own employee IN THE REQUEST's PT (company set by companyHook, ADR 0016)
    const emp = employeeIn(req, relId(d.company))
    if (reqs.length === 0 && emp !== undefined) d.requesters = [emp]
  }

  if (operation === 'update') {
    const nextStatus = (d.status ?? prev.status) as RequestStatus
    if (nextStatus !== prev.status && !transition) throw new APIError('Status hanya berubah lewat aksi (submit/approve/…).', 403, null, true)
    if (!transition && prev.status && !isContentEditable(prev.status)) {
      throw new APIError(`Pengajuan berstatus "${STATUS_LABELS[prev.status]}" tidak dapat diubah.`, 409, null, true)
    }
    // F4 (ADR 0010 sync contract): `syncRev` counts content edits of an editable request; the APK
    // sends it back as `base_rev` and a stale offline edit becomes a `conflict` (server wins).
    // Transitions never bump it (a locked row may not change outside the guard whitelist).
    if (!transition && prev.status && isContentEditable(prev.status)) {
      d.syncRev = (typeof prev.syncRev === 'number' ? prev.syncRev : 1) + 1
    }
    if (!transition && prev.status === 'receipt_revision') {
      // "Revisi Nota": only line amounts/descriptions and notes may change (type, scope,
      // requesters and bank account were approved and stay).
      const changed = Object.keys(d).filter(
        (k) => !['lines', 'notes', 'changeReason', 'syncRev'].includes(k) && JSON.stringify(normalizeValue(d[k])) !== JSON.stringify(normalizeValue(prev[k])),
      )
      if (changed.length > 0) throw new APIError(`Saat Revisi Nota hanya baris item yang dapat diubah (${changed.join(', ')}).`, 409, null, true)
    }
  }

  // ADR 0027: payee type coercion on every content write of a Draft — vendor = Pengajuan Baru without an employee account;
  // karyawan = no vendor / invoice data (a switch back never leaves stale vendor columns, DB CHECK expense_requests_payee).
  // ADR 0028: PT grup = Pengajuan Baru without employee / vendor account, receiving PT + its document (invoice fields).
  const payee = payeeOf(d.payeeType !== undefined ? d.payeeType : prev.payeeType)
  if (!transition && (operation === 'create' || prev.status === 'draft')) {
    d.payeeType = payee
    if (payee !== 'karyawan') {
      d.type = 'advance'
      d.bankAccount = null
      if (payee === 'vendor') d.payeeCompany = null
      else for (const k of ['vendor', 'vendorBankAccount']) d[k] = null
    } else {
      for (const k of ['vendor', 'vendorBankAccount', 'payeeCompany', 'invoiceNo', 'invoiceDate', 'invoiceDueDate', 'invoiceFile']) d[k] = null
      // a vendor / PT grup draft switched back to an employee payment drops its cost center (D2: employee requests have none)
      if (isDirectPayment(prev.payeeType)) d.costCenter = null
    }
  }

  const project = relId(d.project !== undefined ? d.project : prev.project)
  let costCenter = relId(d.costCenter !== undefined ? d.costCenter : prev.costCenter)
  // D2: a legacy cost-center DRAFT that gets a project becomes a project request (its old cost center is dropped;
  // the field itself is never writable by users — `access` above). Locked / Revisi Nota rows never change scope.
  if (!transition && project !== undefined && costCenter !== undefined && (operation === 'create' || prev.status === 'draft')) {
    d.costCenter = null
    costCenter = undefined
  }
  if (project !== undefined && costCenter !== undefined) {
    throw validationError(req, { collection: 'expense-requests' }, [{ path: 'project', message: 'Pilih project ATAU pusat biaya, tidak keduanya.' }])
  }

  // D3: on every content write the line totals are recomputed (qty × harga satuan); a client total is ignored.
  // Transitions do not send lines (the stored, possibly frozen rows are kept as they are).
  if (!transition && Array.isArray(d.lines)) d.lines = normalizeLines(d.lines as LineInput[], (prev.lines ?? []) as LineInput[])
  // D3 unlock (locked → Draft / Revisi Nota): lines whose unit price does not reproduce their total (saved before
  // D3) get total ÷ qty when exact, else no unit price — the DB rule then holds and the requester can keep editing;
  // such a line must be completed before the next submit (lines.ts lineNeedsCompletion).
  if (transition && operation === 'update' && prev.status && !isContentEditable(prev.status) && isContentEditable((d.status ?? prev.status) as RequestStatus)) {
    const prevLines = (Array.isArray(d.lines) ? d.lines : (prev.lines ?? [])) as LineInput[]
    const unlocked = prevLines.map((l) => unlockLine(l))
    if (unlocked.some((l, i) => l !== prevLines[i])) d.lines = unlocked
  }
  const lines = (d.lines ?? prev.lines ?? []) as LineInput[]
  const errors = validateLines(lines, { forSubmit: false })
  if (errors.length > 0) throw validationError(req, { collection: 'expense-requests' }, errors)
  d.grandTotal = grandTotal(lines) // server-computed; any client value is ignored (US-03)

  // S3e (US-44): the admin form leaves the account empty → default account of the first requester.
  // Only the admin form path (the /api/v1 + APK path sends its own choice and is validated as-is).
  if (!transition && req.user && context?.[CONTENT_VALIDATED] !== true && (operation === 'create' || isContentEditable((prev.status ?? 'draft') as RequestStatus))) {
    const current = d.bankAccount !== undefined ? d.bankAccount : prev.bankAccount
    if ((current === null || current === undefined || current === '') && prev.status !== 'receipt_revision' && payee === 'karyawan') {
      const def = await defaultBankAccount(req, ids((d.requesters !== undefined ? d.requesters : prev.requesters) as unknown[] | null))
      if (def !== null) d.bankAccount = def
    }
  }

  // F2c: the admin create/edit form (generic REST) gets the SAME draft rules as POST/PATCH
  // /api/v1/expense-requests (G9 bank account of a requester, G10 scope, Q-09 on-behalf only by
  // Admin/Finance, active masters). The domain service validates itself and flags the context.
  if (!transition && req.user && context?.[CONTENT_VALIDATED] !== true) {
    const pick = <T,>(k: string): T => (d[k] !== undefined ? d[k] : prev[k]) as T
    try {
      await validateContent(
        req,
        {
          type: pick<RequestType>('type'),
          title: pick<string | null>('title'),
          projectId: project ?? null,
          costCenterId: costCenter ?? null,
          requesterIds: ids(pick<unknown[] | null>('requesters')),
          bankAccountId: relId(pick('bankAccount')) ?? null,
          lines: fromDocLines({ lines } as unknown as RequestDoc),
          neededDate: pick<string | null>('neededDate'),
          urgencyLevelId: relId(pick('urgencyLevel')) ?? null,
          // ADR 0027
          payeeType: payee,
          vendorId: relId(pick('vendor')) ?? null,
          vendorBankAccountId: relId(pick('vendorBankAccount')) ?? null,
          // ADR 0028
          payeeCompanyId: relId(pick('payeeCompany')) ?? null,
          invoiceNo: pick<string | null>('invoiceNo'),
          invoiceDate: pick<string | null>('invoiceDate'),
          invoiceDueDate: pick<string | null>('invoiceDueDate'),
          invoiceFileId: relId(pick('invoiceFile')) ?? null,
        },
        {
          forSubmit: false,
          requestId: operation === 'update' ? prev.id : undefined,
          creatorId: operation === 'create' ? (userId(req) ?? -1) : (relId(prev.createdBy) ?? -1),
          // QA-15: a Staff-only editor may not change the requesters of someone else's draft
          callerSetsRequesters: operation === 'create' || (d.requesters !== undefined && ids(d.requesters as unknown[] | null).join(',') !== ids(prev.requesters as unknown[] | null).join(',')),
        },
      )
    } catch (err) {
      const e = err as APIError & { data?: { errors?: Array<{ path: string; message: string }> } }
      // 400 field errors, and ADR 0027's 409 duplicate invoice (field `invoiceNo`) → marked on the form inputs
      const list = e instanceof APIError && (e.status === 400 || e.status === 409) ? e.data?.errors : undefined
      if (!list?.length) throw err
      // API field names → form field paths so the admin form marks the right inputs.
      const path = (p: string) =>
        p
          .replace(/^projectId$/, 'project')
          .replace(/^costCenterId$/, 'costCenter')
          .replace(/^requesterIds$/, 'requesters')
          .replace(/^bankAccountId$/, 'bankAccount')
          .replace(/^vendorId$/, 'vendor')
          .replace(/^vendorBankAccountId$/, 'vendorBankAccount')
          .replace(/^payeeCompanyId$/, 'payeeCompany')
          .replace(/^invoiceFileId$/, 'invoiceFile')
          .replace(/\.(uom|category|vehicle|rapItem)Id$/, '.$1')
      throw validationError(
        req,
        { collection: 'expense-requests' },
        list.map((x) => ({ path: path(x.path), message: x.message })),
      )
    }
  }
  return data
}

/** §8 T1 "baris item ditambah/diubah/dihapus", "pemohon diubah" — one audit row per change with line_no. */
const auditLines: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req, context }) => {
  if (context?.audit === false) return doc
  const rows: AuditRow[] = diffLines(
    operation === 'create' ? [] : ((previousDoc?.lines ?? []) as AuditLine[]),
    (doc.lines ?? []) as AuditLine[],
  ).map((c) => ({
    action: c.kind === 'added' ? 'create' : 'update',
    docType: 'expense_request',
    docId: String(doc.id),
    docNo: doc.docNo ?? undefined,
    field: c.field,
    lineNo: c.lineNo,
    oldValue: c.oldValue,
    newValue: c.newValue,
    reason: typeof req.context?.auditReason === 'string' ? req.context.auditReason : undefined,
  }))
  await writeAudit(req, rows)
  // D3: a content edit of the lines (Draft / Revisi Nota) refreshes the flags at once — "Selisih nota"
  // (receipt_amount_mismatch) follows the requester's "Nominal sesuai nota" without waiting for submit.
  if (operation === 'update' && context?.pkTransition !== true && rows.length > 0) await recomputeFlags(req, doc.id as number)
  // Run the deferred freeze checks NOW (Payload's commit swallows COMMIT errors, see
  // lib/system-tx.ts) so a violation fails this operation with a real error.
  await forceDeferredChecks(req)
  return doc
}

/** In-app notifications on every status transition (US-05, ADR 0011 §5) — same transaction. */
const notify: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req, context }) => {
  // S3e (US-41): a new draft that lists other requesters informs them ("dibuat atas nama Anda").
  if (operation === 'create') {
    if (context?.pkTransition !== true) await notifyCreated(req, doc as never)
    return doc
  }
  if (operation !== 'update' || context?.pkTransition !== true || !previousDoc) return doc
  await notifyTransition(req, { status: previousDoc.status as RequestStatus, currentLevel: previousDoc.currentLevel as number | null }, doc as never)
  return doc
}

export const ExpenseRequests: CollectionConfig = withAudit(
  {
    slug: 'expense-requests',
    labels: { singular: 'Pengajuan biaya', plural: 'Pengajuan biaya' },
    admin: {
      useAsTitle: 'title',
      group: 'Keuangan',
      defaultColumns: ['docNo', 'type', 'title', 'urgencyLevel', 'status', 'grandTotal', 'createdBy', 'updatedAt'],
      listSearchableFields: ['docNo', 'title'],
      // Lead review (d): "Simpan" only while the content is editable (new / Draft / Revisi Nota); DRMS 13/10 Persetujuan #5/#7/#12:
      // the action bar (decisions, Cetak, Duplikat, Edit/Batal) in the document controls row before "Simpan".
      components: {
        views: { edit: RIWAYAT_TAB },
        edit: { SaveButton: '@/admin/components/RequestSaveButton#RequestSaveButton', beforeDocumentControls: ['@/admin/components/request/RequestActionBar#RequestActionBar'] },
      },
    },
    // DRMS 13/10 Persetujuan #12: Payload's duplicate copies every column (status, number, snapshot, totals, unique clientUuid,
    // attachments …) — off (menu item + REST route); "Duplikat" = POST /api/v1/expense-requests/:id/duplicate (domain/expense/duplicate.ts).
    disableDuplicate: true,
    access: {
      read: requestReadAccess,
      // Q-09 default: Staff/PM for themselves, Admin and Finance also on behalf of requesters. ADR 0024 (owner
      // 2026-10-11): the Direktur files his OWN requests (only for himself — drafts.ts on-behalf rule).
      create: rolesAllowed(...REQUEST_CREATE_ROLES),
      update: requestUpdateAccess,
      delete: denyDeleteLogged('expense_request'),
    },
    hooks: { beforeChange: [companyHook('expense-requests', { derive: [{ field: 'project', collection: 'projects' }, { field: 'costCenter', collection: 'cost-centers' }, { field: 'requesters', collection: 'employees' }], check: [{ field: 'bankAccount', collection: 'employee-bank-accounts' }, { field: 'vendor', collection: 'vendors' }, { field: 'vendorBankAccount', collection: 'vendor-bank-accounts' }, { field: 'urgencyLevel', collection: 'urgency-levels' }, { field: 'approvalRule', collection: 'approval-rules' }, { field: 'resubmitOf', collection: 'expense-requests' }, { field: 'lines', collection: 'expense-categories', sub: 'category' }, { field: 'lines', collection: 'vehicles', sub: 'vehicle' }, { field: 'lines', collection: 'rap-items', sub: 'rapItem' }] }), beforeChange], afterChange: [auditLines, notify] },
    // DRMS 10/10 8i (WA-03/WA-10): create / draft shows only the inputs, in the APK draft editor order
    // (Jenis, Judul, Project, Pusat biaya, Tanggal dibutuhkan, Urgensi, Pemohon, Rekening, Keterangan,
    // Lampiran, baris + total pratinjau); system / workflow fields appear after submit (expense-request-form.ts).
    fields: [
      // DRMS 13/10 Pengajuan #1/#2: PT picker = PT switcher selection ∩ create roles; one PT → prefilled, read-only
      companyField({ createRoles: REQUEST_CREATE_ROLES }),
      // Phase C polish: shown in the workflow panel header (shownInHeader), not repeated in the sidebar
      { name: 'docNo', type: 'text', label: 'Nomor', index: true, access: system, admin: { ...ro, position: 'sidebar', condition: shownInHeader } },
      // F2c: status timeline + next actor for everyone, requester actions for creator/requesters.
      { name: 'workflowPanel', type: 'ui', label: 'Status & aksi', admin: { components: { Field: '@/admin/components/WorkflowPanel#WorkflowPanel' } } },
      // DRMS 13/10 Persetujuan #3/#5: right column = the request stepper (replaces "Cetak PDF" — now "Cetak" in the action bar —,
      // "Total ditransfer" — now in the summary — and "Aturan approval" — named in the stepper for Finance / Admin).
      { name: 'requestStepper', type: 'ui', label: 'Alur pengajuan', admin: { position: 'sidebar', components: { Field: '@/admin/components/request/StepperField#StepperField' } } },
      {
        // ADR 0027 (DRMS 13/10 Wave 4) "Jenis penerima": karyawan (default, as before) or vendor = "Pembayaran vendor"
        // (Finance / PM only, vendor + rekening vendor + invoice, no LPJ). Required → no admin.condition (schema drift);
        // the wrapper renders it only while the content is editable.
        name: 'payeeType',
        type: 'select',
        label: 'Jenis penerima',
        required: true,
        defaultValue: 'karyawan',
        index: true,
        options: [
          { label: PAYEE_TYPE_LABELS.karyawan, value: 'karyawan' },
          { label: `${PAYEE_TYPE_LABELS.vendor} (${VENDOR_PAYMENT_LABEL.toLowerCase()})`, value: 'vendor' },
          // ADR 0028: payment to another PT of the group (Finance / PM / Direktur of this PT) — Kas Masuk in that PT at the transfer
          { label: `${PAYEE_TYPE_LABELS.pt_grup} (${INTERCOMPANY_PAYMENT_LABEL.toLowerCase()})`, value: 'pt_grup' },
        ],
        filterOptions: payeeTypeOptions as never,
        admin: {
          placeholder: PLACEHOLDERS.payeeType,
          description: 'Vendor: Finance / PM membayar invoice vendor ke rekening vendor (tanpa LPJ). PT grup: Finance / PM / Direktur membayar PT lain di grup ke rekening penerimaan antar-PT-nya; kas masuk di PT itu tercatat otomatis saat ditransfer.',
          components: { Field: '@/admin/components/EditableOnlyFields#PayeeTypeField' },
        },
      },
      {
        name: 'type',
        type: 'select',
        label: 'Jenis',
        required: true,
        options: [
          { label: REQUEST_TYPE_LABELS.advance, value: 'advance' },
          { label: REQUEST_TYPE_LABELS.reimburse, value: 'reimburse' },
        ],
        // ADR 0027 / 0028: a vendor / PT grup payment is always "Pengajuan Baru" — set by the hook, so the (hidden) input may stay empty
        validate: (value: unknown, options: { siblingData?: unknown }) => (isDirectPayment((options.siblingData as { payeeType?: unknown } | undefined)?.payeeType) ? true : selectValidation(value as never, options as never)),
        // B-2 item 3: required → no admin.condition (schema drift); the wrapper renders nothing on a locked request
        admin: { placeholder: PLACEHOLDERS.type, components: { Field: '@/admin/components/EditableOnlyFields#RequestTypeField' } },
      },
      {
        name: 'status',
        type: 'select',
        label: 'Status',
        required: true,
        defaultValue: 'draft',
        index: true,
        options: REQUEST_STATUSES.map((s) => ({ label: STATUS_LABELS[s], value: s })),
        access: system,
        // No admin.condition here: on a required field it makes the Postgres adapter treat the column as
        // nullable (schema drift). RequestStatusField renders nothing on a Draft form and the ADR 0021 label otherwise.
        admin: { ...ro, position: 'sidebar', components: { Field: '@/admin/components/RequestStatusField#RequestStatusField', Cell: '@/admin/components/RequestStatusCell#RequestStatusCell' } },
      },
      { name: 'title', type: 'text', label: 'Judul', required: true, maxLength: 200, admin: { components: { Field: '@/admin/components/EditableOnlyFields#RequestTitleField' } } },
      // D2: the project is mandatory to send the request (validateContent forSubmit); its RAP items feed the line picker (D4)
      { name: 'project', type: 'relationship', relationTo: 'projects', label: 'Project', index: true, ...pickerSameCompany({ createRoles: REQUEST_CREATE_ROLES }), admin: { placeholder: PLACEHOLDERS.project, description: 'Wajib diisi sebelum dikirim. Item RAP baris diambil dari project ini.', condition: editableInput('project'), components: { Field: COMPANY_SCOPED_FIELD } } },
      // D2 (DRMS 10/10, owner 2026-10-11): no non-project requests — the requester never sets a cost center (create /
      // update access false → a value sent by an old client is ignored); Finance sets it on the transfer
      // (transfers.costCenter). Legacy requests keep theirs (shown read-only, never on a new form).
      // ADR 0027 (client 2026-10-14): a VENDOR payment may name a cost center instead of a project (e.g. office bills) —
      // writable only for the vendor payee (field access), the DB rule expense_requests_project_rules agrees.
      {
        name: 'costCenter',
        type: 'relationship',
        relationTo: 'cost-centers',
        label: 'Pusat biaya',
        index: true,
        access: { create: vendorCostCenterAccess, update: vendorCostCenterAccess },
        ...pickerSameCompany({ createRoles: REQUEST_CREATE_ROLES }),
        admin: {
          placeholder: PLACEHOLDERS.costCenter,
          description: 'Pembayaran vendor / antar-PT tanpa project: pilih pusat biaya (mis. tagihan kantor). Pengajuan lama tanpa project menampilkan pusat biayanya di sini.',
          condition: (d, s, c) =>
            (directPayee(editableInput())(d, s, c) && !whenSet('project')(d, s, c)) || (linesEditable(d as Parameters<typeof linesEditable>[0]) && whenSet('costCenter')(d, s, c)),
          components: { Field: COMPANY_SCOPED_FIELD },
        },
      },
      businessDateField('neededDate', 'Tanggal dibutuhkan', { admin: { condition: editableInput() } }),
      // Owner decision 2026-10-09: replaces "Periode kegiatan" (periodFrom/periodTo, Q-04).
      // DRMS 13/10 Pengajuan #3: every PT has its own Low/Medium/High — locked until the PT is known, then that PT's levels.
      { name: 'urgencyLevel', type: 'relationship', relationTo: 'urgency-levels', label: 'Tingkat urgensi', index: true, ...pickerSameCompany({ createRoles: REQUEST_CREATE_ROLES }), admin: { placeholder: PLACEHOLDERS.urgencyLevel, condition: editableInput('urgencyLevel'), components: { Field: COMPANY_SCOPED_FIELD } } },
      // QA-15: Staff-only users pick only themselves (requesterOptions); the server re-checks (validateContent).
      // WA-09: "Pemohon" as in the APK (the PDF signature box keeps "Diajukan Oleh").
      // ADR 0027: a vendor payment's Pemohon is its filer (server default) — no picker
      { name: 'requesters', type: 'relationship', relationTo: 'employees', hasMany: true, label: 'Pemohon', admin: { isSortable: true, placeholder: PLACEHOLDERS.requesters, condition: employeePayee(editableInput()), components: { Field: COMPANY_SCOPED_FIELD } }, ...pickerSameCompany(), filterOptions: requesterOptions },
      {
        name: 'bankAccount',
        type: 'relationship',
        relationTo: 'employee-bank-accounts',
        label: 'Rekening tujuan',
        // S3e (US-44, Q-11, S-03): the picker lists only ACTIVE accounts of the requesters ("Pemohon";
        // none chosen yet = the creator's own employee), like the APK. Empty on save = default
        // account of the first requester (beforeChange). G9 is still enforced by validateContent, so
        // the relationship's own filterOptions check is switched off (it would re-read the account with
        // the caller's access — a Staff cannot read a co-requester's account).
        filterOptions: bankAccountOptions,
        validate: () => true as const,
        // DRMS 10/10 8e: the picker only while Draft; afterwards the preview below shows the submit snapshot.
        admin: { description: 'Hanya rekening milik pemohon. Kosongkan untuk memakai rekening default pemohon pertama.', placeholder: PLACEHOLDERS.bankAccount, condition: employeePayee(draftOnly), components: { Field: COMPANY_SCOPED_FIELD } },
      },
      // ADR 0027 "Pembayaran vendor": vendor + its account (Draft only, then the snapshot) + invoice (the proof)
      { name: 'vendor', type: 'relationship', relationTo: 'vendors', label: 'Vendor', index: true, ...pickerSameCompany(), filterOptions: vendorOptions, admin: { placeholder: PLACEHOLDERS.vendor, condition: vendorPayee(editableInput('vendor')), components: { Field: COMPANY_SCOPED_FIELD } } },
      {
        name: 'vendorBankAccount',
        type: 'relationship',
        relationTo: 'vendor-bank-accounts',
        label: 'Rekening vendor',
        filterOptions: vendorAccountOptions,
        // checked by validateContent (account OF the chosen vendor, active, same PT) — no re-read with the caller's access
        validate: () => true as const,
        admin: { description: 'Rekening tujuan transfer = rekening vendor yang dipilih (dicatat saat diajukan).', placeholder: PLACEHOLDERS.vendorBankAccount, condition: vendorPayee(draftOnly), components: { Field: COMPANY_SCOPED_FIELD } },
      },
      {
        // ADR 0028 "PT penerima": another ACTIVE PT of the group with a designated receiving account (payee directory
        // GET /api/v1/intercompany/payees — a filer of PT A cannot read PT B's companies row or cash accounts, so the
        // picker is a custom select over that directory). `companies` is the app-wide group master (not a per-PT
        // reference: no companyHook check); validated by validateContent (active, ≠ own PT, designated account).
        name: 'payeeCompany',
        type: 'relationship',
        relationTo: 'companies',
        label: 'PT penerima',
        index: true,
        validate: () => true as const,
        admin: {
          placeholder: PLACEHOLDERS.payeeCompany,
          description: 'PT lain di grup yang menerima pembayaran — ditransfer ke rekening penerimaan antar-PT yang ditetapkan PT itu.',
          condition: intercompanyPayee(draftOnly),
          components: { Field: '@/admin/components/IntercompanyPayeeField#IntercompanyPayeeField' },
        },
      },
      // DRMS 10/10 8e (WA-04): chosen account (draft) / snapshot (after submit) — bank · holder · masked no. + eye toggle.
      { name: 'bankAccountPreview', type: 'ui', label: 'Rekening tujuan', admin: { condition: editableInput(), components: { Field: '@/admin/components/BankAccountPreview#BankAccountPreview' } } },
      // ADR 0028 (owner 2026-10-14): a payment to a PT of the group needs the receiving PT's document (invoice / memo) the
      // same way — number, date and file required to send, number unique per receiving PT
      { name: 'invoiceNo', type: 'text', label: 'Nomor invoice / dokumen', maxLength: 64, index: true, admin: { placeholder: 'mis. INV/2026/0012', condition: directPayee(editableInput('invoiceNo')) } },
      businessDateField('invoiceDate', 'Tanggal invoice / dokumen', { admin: { condition: directPayee(editableInput('invoiceDate')) } }),
      businessDateField('invoiceDueDate', 'Jatuh tempo', { admin: { condition: directPayee(editableInput('invoiceDueDate')) } }),
      { name: 'invoiceFile', type: 'upload', relationTo: 'media-attachments', label: 'File invoice / dokumen (foto / PDF)', admin: { description: 'Wajib sebelum dikirim. Invoice vendor / tagihan atau memo PT penerima = bukti pembayaran (tanpa LPJ).', condition: directPayee(editableInput('invoiceFile')) } },
      {
        name: 'bankSnapshot',
        type: 'group',
        label: 'Rekening tujuan (snapshot saat diajukan)',
        access: system,
        // shown through bankAccountPreview (masked + eye toggle), never as raw fields
        admin: { ...ro, hidden: true },
        fields: [
          { name: 'bankName', type: 'text', label: 'Bank' },
          { name: 'accountNo', type: 'text', label: 'Nomor rekening' },
          { name: 'accountHolder', type: 'text', label: 'Atas nama' },
        ],
      },
      { name: 'notes', type: 'textarea', label: 'Keterangan', maxLength: 2000, admin: { condition: editableInput() } },
      { name: 'attachments', type: 'upload', relationTo: 'media-attachments', hasMany: true, label: 'Lampiran', admin: { condition: editableInput() } },
      {
        name: 'lines',
        type: 'array',
        label: 'Rincian item',
        labels: { singular: 'Baris', plural: 'Baris' },
        // DRMS 10/10 8f–8h (D3): a lines TABLE with "Tambah baris" / edit in a dialog (LinesTableField) instead of
        // Payload's row cards; total = qty × harga satuan, computed (dialog preview + server hook, never typed).
        // DRMS 10/10 9a (WA-05): editable only in Draft / Revisi Nota; otherwise the "Rincian pengajuan" table.
        admin: { condition: linesCondition, components: { Field: '@/admin/components/lines/LinesTableField#LinesTableField' } },
        fields: [
          { name: 'description', type: 'text', label: 'Uraian', maxLength: 500 },
          {
            type: 'row',
            fields: [
              // qty keeps decimals (e.g. 1,5 m³); empty = 1 (D3)
              { name: 'qty', type: 'number', label: 'Qty', min: 0 },
              { name: 'uom', type: 'relationship', relationTo: 'uoms', label: 'Satuan', admin: { placeholder: PLACEHOLDERS.uom } },
              { name: 'unitPrice', type: 'number', label: 'Harga satuan', min: 0, admin: { components: { Field: RUPIAH_FIELD } } },
              // D3: server-computed (beforeChange → normalizeLines); a client value is ignored
              { name: 'total', type: 'number', label: 'Total', min: 0, admin: { readOnly: true, components: { Field: RUPIAH_FIELD } } },
              { name: 'receiptAmount', type: 'number', label: 'Nominal sesuai nota', min: 0, admin: { components: { Field: RUPIAH_FIELD } } },
            ],
          },
          {
            type: 'row',
            fields: [
              { name: 'category', type: 'relationship', relationTo: 'expense-categories', label: 'Kategori', admin: { placeholder: PLACEHOLDERS.category } },
              // D4 (DRMS 10/10): the RAP item of the request's project this line is charged to (required to send when the
              // project has a RAP; realisation per item = Σ approved line totals, domain/rap/budget.ts)
              { name: 'rapItem', type: 'relationship', relationTo: 'rap-items', label: 'Item RAP', index: true, admin: { placeholder: PLACEHOLDERS.rapItem } },
              { name: 'vehicle', type: 'relationship', relationTo: 'vehicles', label: 'Kendaraan', admin: { placeholder: PLACEHOLDERS.vehicle } },
            ],
          },
          { name: 'notes', type: 'text', label: 'Keterangan', maxLength: 500 },
        ],
      },
      // DRMS 13/10 Persetujuan #10: no separate "Total (pratinjau)" box — the grand total is the footer row of the lines table
      // Phase C polish: Grand total is the "Rincian item" footer; Tanggal / Dibuat oleh in the read-only "Rincian pengajuan".
      // DRMS 13/10 Persetujuan #5: the summary is shown on every status (read mode), so none of these server fields is on
      // the form any more — the money totals are summary rows, the approval rule is named in the stepper (Finance / Admin;
      // F2e UAT: a relationship input for users without approval-rules read access fired a 403 on every view).
      businessDateField('requestDate', 'Tanggal pengajuan (server)', { access: system, admin: { ...ro, position: 'sidebar', condition: notOnRequestPage } }),
      { name: 'createdBy', type: 'relationship', relationTo: 'users', label: 'Dibuat oleh', index: true, access: system, admin: { ...ro, position: 'sidebar', condition: notOnRequestPage, components: USER_NAME_VIEW } },
      { ...rupiahField('grandTotal', 'Grand total (Rp)'), access: system, admin: { ...ro, ...rupiahView, position: 'sidebar', condition: shownInHeader } },
      { ...rupiahField('approvedAmount', 'Nominal disetujui (Rp)'), access: system, admin: { ...ro, ...rupiahView, position: 'sidebar', condition: notOnRequestPage } },
      { ...rupiahField('transferredTotal', 'Total ditransfer (Rp)'), access: system, admin: { ...ro, ...rupiahView, position: 'sidebar', condition: notOnRequestPage } },
      { ...rupiahField('verifiedReceiptsTotal', 'Total nota terverifikasi LPJ (Rp)'), access: system, admin: { ...ro, ...rupiahView, position: 'sidebar', condition: notOnRequestPage } },
      { name: 'approvalRule', type: 'relationship', relationTo: 'approval-rules', label: 'Aturan approval', access: system, admin: { ...ro, position: 'sidebar', condition: notOnRequestPage } },
      // DRMS 10/10 9c (WA-06): readable timeline instead of the raw JSON. DRMS 13/10 Persetujuan #6: not on the page at all
      // (also not for Admin) — the stepper shows the positions, "Log perubahan" / "Riwayat" the changes.
      // (the read-only JSON component stays declared: config guard — no json field may fall back to the Monaco editor)
      { name: 'approvalSnapshot', type: 'json', label: 'Snapshot aturan approval', access: system, admin: { readOnly: true, hidden: true, components: { Field: '@/components/ReadOnlyJson#ReadOnlyJson' } } },
      {
        // ADR 0021 (owner 2026-10-10): narrow G1 exception, set by the service at submit only (DB trigger
        // expense_requests_g1_exception: value 'direktur_via_pm' | 'direktur_via_pm_self' or null, changes only at the freeze point).
        // DRMS 10/10 9c: shown as readable text in the approval timeline ("Pengajuan Direktur — diajukan oleh PM …").
        name: 'g1Exception',
        type: 'text',
        label: 'Pengecualian G1',
        access: system,
        admin: { ...ro, hidden: true },
      },
      { name: 'approvalCycle', type: 'number', label: 'Siklus approval', defaultValue: 0, access: system, admin: { ...ro, hidden: true } },
      // Lead review (a): the approval timeline in the workflow panel shows the running level — no sidebar number.
      { name: 'currentLevel', type: 'number', label: 'Level approval berjalan', access: system, admin: { ...ro, hidden: true } },
      // Phase C polish: the approval timeline shows when it was sent / approved (shownInHeader)
      { name: 'submittedAt', type: 'date', label: 'Diajukan (server)', access: system, admin: { ...ro, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' }, condition: shownInHeader } },
      // Item 11 (DRMS 10/10): final approval time (server) of the current cycle = start of the transfer SLA.
      { name: 'approvedAt', type: 'date', label: 'Disetujui (server)', index: true, access: system, admin: { ...ro, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' }, condition: shownInHeader } },
      { name: 'contentHash', type: 'text', label: 'Hash isi terkunci', access: system, admin: { ...ro, hidden: true } },
      {
        name: 'resubmitOf',
        type: 'relationship',
        relationTo: 'expense-requests',
        label: 'Pengajuan ulang dari',
        access: system,
        // F2e: number + title of the previous request (not only its title), read-only link.
        admin: { ...ro, condition: whenSet('resubmitOf'), components: { Field: '@/admin/components/ResubmitOfField#ResubmitOfField' } },
      },
      { name: 'cancelReason', type: 'text', label: 'Alasan batal', access: system, admin: { ...ro, condition: whenSet('cancelReason') } },
      { name: 'rejectReason', type: 'text', label: 'Alasan ditolak', access: system, admin: { ...ro, condition: whenSet('rejectReason') } },
      {
        name: 'syncRev',
        type: 'number',
        label: 'Revisi isi (sinkronisasi APK)',
        defaultValue: 1,
        access: system,
        admin: { ...ro, hidden: true },
      },
      { name: 'clientUuid', type: 'text', label: 'Client UUID (APK offline)', unique: true, index: true, access: { update: fieldNever }, admin: { ...ro, hidden: true } },
      {
        name: 'source',
        type: 'select',
        label: 'Sumber',
        options: ['web', 'apk', 'system', 'job'].map((s) => ({ label: s, value: s })),
        access: system,
        // system field (web / apk / job) — audit + reports only, never on the form (Lead review a)
        admin: { ...ro, hidden: true },
      },
      uuidField(),
      // Lead review (d): "Alasan perubahan" (audit reason of a save) only where "Simpan" exists (new / Draft / Revisi Nota).
      // Phase C polish: only in "Revisi Nota" (a Draft save needs no audit reason)
      { ...changeReasonField(), admin: { ...changeReasonField().admin, condition: (data, s, c) => !!(data as { id?: unknown } | undefined)?.id && revisionOnly(data, s, c) } },
    ],
  },
  {
    docType: 'expense_request',
    // lines: per-line rows (auditLines); docNo: `number_issued` row written by allocateDocNo().
    exclude: ['lines', 'docNo', 'contentHash', 'approvalSnapshot', 'g1Exception', 'currentLevel', 'approvalCycle', 'submittedAt', 'syncRev'],
    docNo: (doc) => (typeof doc.docNo === 'string' ? doc.docNo : undefined),
    reasonRules: [reasonOnChange(['cancelReason'], 'Alasan wajib diisi saat membatalkan.')],
    actionFor: (c) => (c.field === 'status' ? 'status_change' : undefined),
  },
)
