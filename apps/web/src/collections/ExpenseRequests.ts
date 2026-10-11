import { APIError, type CollectionAfterChangeHook, type Condition, type CollectionBeforeChangeHook, type CollectionConfig, type FilterOptionsProps, type PayloadRequest, type Where } from 'payload'

import { RIWAYAT_TAB } from '@/admin/config'

import { employeeIn, ownEmployees, relId, rolesIn, rolesOf, userId } from '@/access/roles'
import { fieldNever, rolesAllowed } from '@/access/policies'
import { normalizeValue, reasonOnChange, withAudit } from '@/audit/hooks'
import { writeAudit, type AuditRow } from '@/audit/writer'
import { denyDeleteLogged, requestReadAccess, requestUpdateAccess } from '@/domain/expense/access'
import { ids, type RequestDoc } from '@/domain/expense/common'
import { CONTENT_VALIDATED, fromDocLines, validateContent } from '@/domain/expense/drafts'
import { grandTotal, normalizeLines, validateLines, type LineInput } from '@/domain/expense/lines'
import { diffLines, type AuditLine } from '@/domain/expense/line-audit'
import { recomputeFlags } from '@/domain/expense/receipts'
import { isContentEditable, REQUEST_STATUSES, REQUEST_TYPE_LABELS, STATUS_LABELS, type RequestStatus, type RequestType } from '@/domain/expense/types'
import { changeReasonField, rupiahField, uuidField } from '@/fields/common'
import { requestMeta } from '@/lib/request-meta'
import { forceDeferredChecks } from '@/lib/system-tx'
import { notifyCreated, notifyTransition } from '@/domain/notifications'
import { companyField, companyHook, pickerSameCompany, sameCompanyOptions } from '@/fields/company'
import { validationError } from '@/lib/validation'

import { draftOnly, editableInput, isDraftForm, linesCondition, linesEditable, PLACEHOLDERS, submittedOnly, whenSet } from './expense-request-form'
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

/** Roles that may read `approval-rules` (collection read access) — the field is shown only to them. */
const canSeeApprovalRules: Condition = (_data, _sibling, { user }) => rolesOf(user).some((r) => r === 'pk-admin' || r === 'pk-owner' || r === 'pk-finance')
const ro = { readOnly: true }
const RUPIAH_FIELD = '@/admin/components/RupiahNumberField#RupiahNumberField'
/** Read-only money as "Rp 1.250.000" (RupiahNumberField read-only mode). */
const rupiahView = { components: { Field: RUPIAH_FIELD } }

/** Picker filter of `bankAccount` (S3e, US-44): active accounts of the requesters / the creator's employee. */
export const bankAccountOptions = ({ data, user }: Pick<FilterOptionsProps, 'data' | 'user'>): false | Where => {
  const reqs = ids(((data ?? {}) as { requesters?: unknown[] | null }).requesters ?? null)
  const company = relId((data as { company?: unknown } | undefined)?.company)
  const emp = company !== undefined ? employeeIn({ user } as never, company) : relId((user as { employee?: unknown } | null)?.employee)
  const owners = reqs.length > 0 ? reqs : emp !== undefined ? [emp] : []
  if (owners.length === 0) return false
  return { and: [{ employee: { in: owners } }, { active: { not_equals: false } }] }
}

/**
 * QA-15 (owner decision 2026-10-08): "Pemohon" (Diajukan Oleh) picker — a user whose only role in the document's
 * PT (unknown yet: in every selected PT) is Staff sees only their OWN employee; everyone else the
 * employees of the document's PT (pickerSameCompany). Server rule: drafts.ts validateContent.
 */
export const requesterOptions = ({ data, user }: Pick<FilterOptionsProps, 'data' | 'user'>): boolean | Where => {
  const company = relId((data as { company?: unknown } | undefined)?.company)
  const base = sameCompanyOptions({ data })
  const roles = company !== undefined ? rolesIn({ user } as never, company) : rolesOf(user)
  if (!(roles.includes('pk-staff') && roles.every((r) => r === 'pk-staff'))) return base
  const own = company !== undefined ? [employeeIn({ user } as never, company)].filter((e): e is number => e !== undefined) : ownEmployees({ user } as never)
  if (own.length === 0) return false
  const mine: Where = { id: { in: own } }
  return base === true ? mine : { and: [base, mine] }
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

  const project = relId(d.project !== undefined ? d.project : prev.project)
  const costCenter = relId(d.costCenter !== undefined ? d.costCenter : prev.costCenter)
  if (project !== undefined && costCenter !== undefined) {
    throw validationError(req, { collection: 'expense-requests' }, [{ path: 'project', message: 'Pilih project ATAU pusat biaya, tidak keduanya.' }])
  }

  // D3: on every content write the line totals are recomputed (qty × harga satuan); a client total is ignored.
  // Transitions do not send lines (the stored, possibly frozen rows are kept as they are).
  if (!transition && Array.isArray(d.lines)) d.lines = normalizeLines(d.lines as LineInput[], (prev.lines ?? []) as LineInput[])
  const lines = (d.lines ?? prev.lines ?? []) as LineInput[]
  const errors = validateLines(lines, { forSubmit: false })
  if (errors.length > 0) throw validationError(req, { collection: 'expense-requests' }, errors)
  d.grandTotal = grandTotal(lines) // server-computed; any client value is ignored (US-03)

  // S3e (US-44): the admin form leaves the account empty → default account of the first requester.
  // Only the admin form path (the /api/v1 + APK path sends its own choice and is validated as-is).
  if (!transition && req.user && context?.[CONTENT_VALIDATED] !== true && (operation === 'create' || isContentEditable((prev.status ?? 'draft') as RequestStatus))) {
    const current = d.bankAccount !== undefined ? d.bankAccount : prev.bankAccount
    if ((current === null || current === undefined || current === '') && prev.status !== 'receipt_revision') {
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
        },
        {
          forSubmit: false,
          creatorId: operation === 'create' ? (userId(req) ?? -1) : (relId(prev.createdBy) ?? -1),
          // QA-15: a Staff-only editor may not change the requesters of someone else's draft
          callerSetsRequesters: operation === 'create' || (d.requesters !== undefined && ids(d.requesters as unknown[] | null).join(',') !== ids(prev.requesters as unknown[] | null).join(',')),
        },
      )
    } catch (err) {
      const e = err as APIError & { data?: { errors?: Array<{ path: string; message: string }> } }
      const list = e instanceof APIError && e.status === 400 ? e.data?.errors : undefined
      if (!list?.length) throw err
      // API field names → form field paths so the admin form marks the right inputs.
      const path = (p: string) =>
        p.replace(/^projectId$/, 'project').replace(/^costCenterId$/, 'costCenter').replace(/^requesterIds$/, 'requesters').replace(/^bankAccountId$/, 'bankAccount').replace(/\.(uom|category|vehicle)Id$/, '.$1')
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
      // Lead review (d): "Simpan" only while the content is editable (new / Draft / Revisi Nota).
      components: { views: { edit: RIWAYAT_TAB }, edit: { SaveButton: '@/admin/components/RequestSaveButton#RequestSaveButton' } },
    },
    access: {
      read: requestReadAccess,
      // Q-09 default: Staff/PM for themselves, Admin and Finance also on behalf of requesters.
      create: rolesAllowed('pk-staff', 'pk-pm', 'pk-admin', 'pk-finance'),
      update: requestUpdateAccess,
      delete: denyDeleteLogged('expense_request'),
    },
    hooks: { beforeChange: [companyHook('expense-requests', { derive: [{ field: 'project', collection: 'projects' }, { field: 'costCenter', collection: 'cost-centers' }, { field: 'requesters', collection: 'employees' }], check: [{ field: 'bankAccount', collection: 'employee-bank-accounts' }, { field: 'urgencyLevel', collection: 'urgency-levels' }, { field: 'approvalRule', collection: 'approval-rules' }, { field: 'resubmitOf', collection: 'expense-requests' }, { field: 'lines', collection: 'expense-categories', sub: 'category' }, { field: 'lines', collection: 'vehicles', sub: 'vehicle' }] }), beforeChange], afterChange: [auditLines, notify] },
    // DRMS 10/10 8i (WA-03/WA-10): create / draft shows only the inputs, in the APK draft editor order
    // (Jenis, Judul, Project, Pusat biaya, Tanggal dibutuhkan, Urgensi, Pemohon, Rekening, Keterangan,
    // Lampiran, baris + total pratinjau); system / workflow fields appear after submit (expense-request-form.ts).
    fields: [
      companyField(),
      { name: 'docNo', type: 'text', label: 'Nomor', index: true, access: system, admin: { ...ro, position: 'sidebar', condition: whenSet('docNo') } },
      // F2c: status timeline + next actor for everyone, requester actions for creator/requesters.
      { name: 'workflowPanel', type: 'ui', label: 'Status & aksi', admin: { components: { Field: '@/admin/components/WorkflowPanel#WorkflowPanel' } } },
      // M16 / US-46: "Cetak PDF" (audited API download); UI only, no column.
      { name: 'pdfLinks', type: 'ui', label: 'PDF', admin: { position: 'sidebar', components: { Field: '@/admin/components/PdfLinks#PdfLinks' } } },
      {
        name: 'type',
        type: 'select',
        label: 'Jenis',
        required: true,
        options: [
          { label: REQUEST_TYPE_LABELS.advance, value: 'advance' },
          { label: REQUEST_TYPE_LABELS.reimburse, value: 'reimburse' },
        ],
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
      { name: 'project', type: 'relationship', relationTo: 'projects', label: 'Project', index: true, ...pickerSameCompany(), admin: { placeholder: PLACEHOLDERS.project, condition: editableInput('project') } },
      { name: 'costCenter', type: 'relationship', relationTo: 'cost-centers', label: 'Pusat biaya', index: true, ...pickerSameCompany(), admin: { placeholder: PLACEHOLDERS.costCenter, description: 'Isi project ATAU pusat biaya.', condition: editableInput('costCenter') } },
      businessDateField('neededDate', 'Tanggal dibutuhkan', { admin: { condition: editableInput() } }),
      // Owner decision 2026-10-09: replaces "Periode kegiatan" (periodFrom/periodTo, Q-04).
      { name: 'urgencyLevel', type: 'relationship', relationTo: 'urgency-levels', label: 'Tingkat urgensi', index: true, ...pickerSameCompany(), admin: { placeholder: PLACEHOLDERS.urgencyLevel, condition: editableInput('urgencyLevel') } },
      // QA-15: Staff-only users pick only themselves (requesterOptions); the server re-checks (validateContent).
      // WA-09: "Pemohon" as in the APK (the PDF signature box keeps "Diajukan Oleh").
      { name: 'requesters', type: 'relationship', relationTo: 'employees', hasMany: true, label: 'Pemohon', admin: { isSortable: true, placeholder: PLACEHOLDERS.requesters, condition: editableInput() }, ...pickerSameCompany(), filterOptions: requesterOptions },
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
        admin: { description: 'Hanya rekening milik pemohon. Kosongkan untuk memakai rekening default pemohon pertama.', placeholder: PLACEHOLDERS.bankAccount, condition: draftOnly },
      },
      // DRMS 10/10 8e (WA-04): chosen account (draft) / snapshot (after submit) — bank · holder · masked no. + eye toggle.
      { name: 'bankAccountPreview', type: 'ui', label: 'Rekening tujuan', admin: { condition: editableInput(), components: { Field: '@/admin/components/BankAccountPreview#BankAccountPreview' } } },
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
        label: 'Baris item',
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
              { name: 'vehicle', type: 'relationship', relationTo: 'vehicles', label: 'Kendaraan', admin: { placeholder: PLACEHOLDERS.vehicle } },
            ],
          },
          { name: 'notes', type: 'text', label: 'Keterangan', maxLength: 500 },
        ],
      },
      { name: 'linesTotalPreview', type: 'ui', label: 'Total (pratinjau)', admin: { condition: linesCondition, components: { Field: '@/admin/components/LinesTotalPreview#LinesTotalPreview' } } },
      businessDateField('requestDate', 'Tanggal pengajuan (server)', { access: system, admin: { ...ro, position: 'sidebar', condition: whenSet('requestDate') } }),
      { name: 'createdBy', type: 'relationship', relationTo: 'users', label: 'Dibuat oleh', index: true, access: system, admin: { ...ro, position: 'sidebar', condition: whenSet('createdBy'), components: USER_NAME_VIEW } },
      { ...rupiahField('grandTotal', 'Grand total (Rp)'), access: system, admin: { ...ro, ...rupiahView, position: 'sidebar', condition: whenSet('grandTotal') } },
      { ...rupiahField('approvedAmount', 'Nominal disetujui (Rp)'), access: system, admin: { ...ro, ...rupiahView, position: 'sidebar', condition: (d, s, c) => submittedOnly(d, s, c) && whenSet('approvedAmount')(d, s, c) } },
      { ...rupiahField('transferredTotal', 'Total ditransfer (Rp)'), access: system, admin: { ...ro, ...rupiahView, position: 'sidebar', condition: submittedOnly } },
      { ...rupiahField('verifiedReceiptsTotal', 'Total nota terverifikasi LPJ (Rp)'), access: system, admin: { ...ro, ...rupiahView, position: 'sidebar', condition: (d, s, c) => submittedOnly(d, s, c) && whenSet('verifiedReceiptsTotal')(d, s, c) } },
      // F2e UAT: office-only fields are not rendered for users who cannot read their target
      // (staff/PM → the relationship input fired POST /api/approval-rules → 403 on every view).
      { name: 'approvalRule', type: 'relationship', relationTo: 'approval-rules', label: 'Aturan approval', access: system, admin: { ...ro, position: 'sidebar', condition: (data, sibling, ctx) => submittedOnly(data, sibling, ctx) && canSeeApprovalRules(data, sibling, ctx) } },
      // DRMS 10/10 9c (WA-06): readable timeline in the workflow panel; raw JSON only for Admin, folded.
      { name: 'approvalSnapshot', type: 'json', label: 'Snapshot aturan approval', access: system, admin: { readOnly: true, components: { Field: '@/components/ReadOnlyJson#CollapsedReadOnlyJson' }, condition: (data, _s, { user }) => !isDraftForm(data) && rolesOf(user).includes('pk-admin') } },
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
      { name: 'submittedAt', type: 'date', label: 'Diajukan (server)', access: system, admin: { ...ro, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' }, condition: whenSet('submittedAt') } },
      // Item 11 (DRMS 10/10): final approval time (server) of the current cycle = start of the transfer SLA.
      { name: 'approvedAt', type: 'date', label: 'Disetujui (server)', index: true, access: system, admin: { ...ro, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' }, condition: whenSet('approvedAt') } },
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
      { ...changeReasonField(), admin: { ...changeReasonField().admin, condition: (data) => !!(data as { id?: unknown } | undefined)?.id && linesEditable(data as Parameters<typeof linesEditable>[0]) } },
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
