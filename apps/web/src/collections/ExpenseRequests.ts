import { APIError, ValidationError, type CollectionAfterChangeHook, type Condition, type CollectionBeforeChangeHook, type CollectionConfig, type Field, type FilterOptionsProps, type PayloadRequest, type Where } from 'payload'

import { RIWAYAT_TAB } from '@/admin/config'

import { relId, rolesOf, userId } from '@/access/roles'
import { fieldNever, rolesAllowed } from '@/access/policies'
import { normalizeValue, reasonOnChange, withAudit } from '@/audit/hooks'
import { writeAudit, type AuditRow } from '@/audit/writer'
import { denyDeleteLogged, requestReadAccess, requestUpdateAccess } from '@/domain/expense/access'
import { ids, type RequestDoc } from '@/domain/expense/common'
import { CONTENT_VALIDATED, fromDocLines, validateContent } from '@/domain/expense/drafts'
import { grandTotal, validateLines, type LineInput } from '@/domain/expense/lines'
import { diffLines, type AuditLine } from '@/domain/expense/line-audit'
import { isBusinessDate, isContentEditable, REQUEST_STATUSES, STATUS_LABELS, type RequestStatus, type RequestType } from '@/domain/expense/types'
import { rupiahField, uuidField } from '@/fields/common'
import { requestMeta } from '@/lib/request-meta'
import { forceDeferredChecks } from '@/lib/system-tx'
import { notifyCreated, notifyTransition } from '@/domain/notifications'

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
const jsonView = { readOnly: true, components: { Field: '@/components/ReadOnlyJson#ReadOnlyJson' } }

const businessDate = (name: string, label: string, extra: Partial<Field> = {}): Field =>
  ({
    name,
    type: 'text',
    label,
    maxLength: 10,
    admin: { description: 'Format YYYY-MM-DD (zona waktu perusahaan).' },
    validate: (v: unknown) => (v === null || v === undefined || v === '' || isBusinessDate(v) ? true : 'Tanggal harus YYYY-MM-DD.'),
    ...extra,
  }) as Field

/** Picker filter of `bankAccount` (S3e, US-44): active accounts of the requesters / the creator's employee. */
export const bankAccountOptions = ({ data, user }: Pick<FilterOptionsProps, 'data' | 'user'>): false | Where => {
  const reqs = ids(((data ?? {}) as { requesters?: unknown[] | null }).requesters ?? null)
  const emp = relId((user as { employee?: unknown } | null)?.employee)
  const owners = reqs.length > 0 ? reqs : emp !== undefined ? [emp] : []
  if (owners.length === 0) return false
  return { and: [{ employee: { in: owners } }, { active: { not_equals: false } }] }
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
    const emp = relId((req.user as { employee?: unknown } | null)?.employee)
    if (reqs.length === 0 && emp !== undefined) d.requesters = [emp] // default: the creator's own employee
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
    throw new ValidationError({ collection: 'expense-requests', errors: [{ path: 'project', message: 'Pilih project ATAU pusat biaya, tidak keduanya (US-53).' }], req })
  }

  const lines = (d.lines ?? prev.lines ?? []) as LineInput[]
  const errors = validateLines(lines, { forSubmit: false })
  if (errors.length > 0) throw new ValidationError({ collection: 'expense-requests', errors, req })
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
          periodFrom: pick<string | null>('periodFrom'),
          periodTo: pick<string | null>('periodTo'),
        },
        { forSubmit: false, creatorId: operation === 'create' ? (userId(req) ?? -1) : (relId(prev.createdBy) ?? -1) },
      )
    } catch (err) {
      const e = err as APIError & { data?: { errors?: Array<{ path: string; message: string }> } }
      const list = e instanceof APIError && e.status === 400 ? e.data?.errors : undefined
      if (!list?.length) throw err
      // API field names → form field paths so the admin form marks the right inputs.
      const path = (p: string) =>
        p.replace(/^projectId$/, 'project').replace(/^costCenterId$/, 'costCenter').replace(/^requesterIds$/, 'requesters').replace(/^bankAccountId$/, 'bankAccount').replace(/\.(uom|category|vehicle)Id$/, '.$1')
      throw new ValidationError({ collection: 'expense-requests', errors: list.map((x) => ({ path: path(x.path), message: x.message })), req })
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
      defaultColumns: ['docNo', 'type', 'title', 'status', 'grandTotal', 'createdBy', 'updatedAt'],
      listSearchableFields: ['docNo', 'title'],
      components: { views: { edit: RIWAYAT_TAB } },
    },
    access: {
      read: requestReadAccess,
      // Q-09 default: Staff/PM for themselves, Admin and Finance also on behalf of requesters.
      create: rolesAllowed('pk-staff', 'pk-pm', 'pk-admin', 'pk-finance'),
      update: requestUpdateAccess,
      delete: denyDeleteLogged('expense_request'),
    },
    hooks: { beforeChange: [beforeChange], afterChange: [auditLines, notify] },
    fields: [
      { name: 'docNo', type: 'text', label: 'Nomor', unique: true, index: true, access: system, admin: { ...ro, position: 'sidebar' } },
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
          { label: 'Uang Muka', value: 'advance' },
          { label: 'Reimburse', value: 'reimburse' },
        ],
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
        admin: { ...ro, position: 'sidebar' },
      },
      { name: 'title', type: 'text', label: 'Judul / subjek', required: true, maxLength: 200 },
      { name: 'project', type: 'relationship', relationTo: 'projects', label: 'Project', index: true },
      { name: 'costCenter', type: 'relationship', relationTo: 'cost-centers', label: 'Pusat biaya', index: true },
      businessDate('requestDate', 'Tanggal pengajuan (server)', { access: system, admin: { ...ro, position: 'sidebar' } }),
      businessDate('neededDate', 'Tanggal dibutuhkan'),
      businessDate('periodFrom', 'Periode kegiatan dari (opsional, Q-04)'),
      businessDate('periodTo', 'Periode kegiatan sampai'),
      { name: 'notes', type: 'textarea', label: 'Keterangan', maxLength: 2000 },
      { name: 'requesters', type: 'relationship', relationTo: 'employees', hasMany: true, label: 'Diajukan Oleh', admin: { isSortable: true } },
      { name: 'createdBy', type: 'relationship', relationTo: 'users', label: 'Dibuat Oleh', index: true, access: system, admin: { ...ro, position: 'sidebar' } },
      {
        name: 'bankAccount',
        type: 'relationship',
        relationTo: 'employee-bank-accounts',
        label: 'Rekening tujuan',
        // S3e (US-44, Q-11, S-03): the picker lists only ACTIVE accounts of the requesters ("Diajukan
        // Oleh"; none chosen yet = the creator's own employee), like the APK. Empty on save = default
        // account of the first requester (beforeChange). G9 is still enforced by validateContent, so
        // the relationship's own filterOptions check is switched off (it would re-read the account with
        // the caller's access — a Staff cannot read a co-requester's account).
        filterOptions: bankAccountOptions,
        validate: () => true as const,
        admin: { description: 'Hanya rekening milik pemohon. Kosongkan untuk memakai rekening default pemohon pertama.' },
      },
      {
        name: 'bankSnapshot',
        type: 'group',
        label: 'Rekening tujuan (snapshot saat diajukan)',
        access: system,
        admin: ro,
        fields: [
          { name: 'bankName', type: 'text', label: 'Bank' },
          { name: 'accountNo', type: 'text', label: 'Nomor rekening' },
          { name: 'accountHolder', type: 'text', label: 'Atas nama' },
        ],
      },
      {
        name: 'lines',
        type: 'array',
        label: 'Baris item',
        labels: { singular: 'Baris', plural: 'Baris' },
        // F2d UAT: Payload 3.90.1 client race — a row added while the form-state server action of
        // the previous edit is still pending stays a skeleton.
        admin: { description: 'Tunggu sebentar setelah mengisi field sebelum menekan Tambah Baris.' },
        fields: [
          { name: 'description', type: 'text', label: 'Uraian', maxLength: 500 },
          {
            type: 'row',
            fields: [
              { name: 'qty', type: 'number', label: 'Jumlah', min: 0 },
              { name: 'uom', type: 'relationship', relationTo: 'uoms', label: 'Satuan' },
              { name: 'unitPrice', type: 'number', label: 'Harga satuan (informatif)', min: 0 },
              { name: 'total', type: 'number', label: 'Total (Rp)', min: 0 },
            ],
          },
          {
            type: 'row',
            fields: [
              { name: 'category', type: 'relationship', relationTo: 'expense-categories', label: 'Kategori' },
              { name: 'vehicle', type: 'relationship', relationTo: 'vehicles', label: 'Kendaraan' },
            ],
          },
          { name: 'notes', type: 'text', label: 'Keterangan', maxLength: 500 },
        ],
      },
      { ...rupiahField('grandTotal', 'Grand total (Rp)'), access: system, admin: { ...ro, position: 'sidebar' } },
      { ...rupiahField('approvedAmount', 'Nominal disetujui (Rp)'), access: system, admin: { ...ro, position: 'sidebar' } },
      { ...rupiahField('transferredTotal', 'Total ditransfer (Rp)'), access: system, admin: { ...ro, position: 'sidebar' } },
      { ...rupiahField('verifiedReceiptsTotal', 'Total nota terverifikasi LPJ (Rp)'), access: system, admin: { ...ro, position: 'sidebar' } },
      { name: 'attachments', type: 'upload', relationTo: 'media-attachments', hasMany: true, label: 'Lampiran umum' },
      // F2e UAT: office-only fields are not rendered for users who cannot read their target
      // (staff/PM → the relationship input fired POST /api/approval-rules → 403 on every view).
      { name: 'approvalRule', type: 'relationship', relationTo: 'approval-rules', label: 'Aturan approval', access: system, admin: { ...ro, condition: canSeeApprovalRules } },
      { name: 'approvalSnapshot', type: 'json', label: 'Snapshot aturan approval', access: system, admin: { ...jsonView, condition: canSeeApprovalRules } },
      { name: 'approvalCycle', type: 'number', label: 'Siklus approval', defaultValue: 0, access: system, admin: { ...ro, hidden: true } },
      { name: 'currentLevel', type: 'number', label: 'Level approval berjalan', access: system, admin: ro },
      { name: 'submittedAt', type: 'date', label: 'Diajukan (server)', access: system, admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'contentHash', type: 'text', label: 'Hash isi terkunci', access: system, admin: { ...ro, hidden: true } },
      {
        name: 'resubmitOf',
        type: 'relationship',
        relationTo: 'expense-requests',
        label: 'Pengajuan ulang dari',
        access: system,
        // F2e: number + title of the previous request (not only its title), read-only link.
        admin: { ...ro, components: { Field: '@/admin/components/ResubmitOfField#ResubmitOfField' } },
      },
      { name: 'cancelReason', type: 'text', label: 'Alasan batal', access: system, admin: ro },
      { name: 'rejectReason', type: 'text', label: 'Alasan ditolak', access: system, admin: ro },
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
        admin: { ...ro, position: 'sidebar' },
      },
      uuidField(),
    ],
  },
  {
    docType: 'expense_request',
    // lines: per-line rows (auditLines); docNo: `number_issued` row written by allocateDocNo().
    exclude: ['lines', 'docNo', 'contentHash', 'approvalSnapshot', 'currentLevel', 'approvalCycle', 'submittedAt', 'syncRev'],
    docNo: (doc) => (typeof doc.docNo === 'string' ? doc.docNo : undefined),
    reasonRules: [reasonOnChange(['cancelReason'], 'Alasan wajib diisi saat membatalkan.')],
    actionFor: (c) => (c.field === 'status' ? 'status_change' : undefined),
  },
)
