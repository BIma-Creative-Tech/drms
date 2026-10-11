import type { CollectionConfig } from 'payload'

import { RIWAYAT_TAB } from '@/admin/config'

import { denyAll } from '@/access/roles'
import { reasonOnChange, withAudit } from '@/audit/hooks'
import { byVisibleRequest, denyDeleteLogged } from '@/domain/expense/access'
import { SETTLEMENT_STATUSES, SETTLEMENT_STATUS_LABELS, SHORTFALL_APPROVAL_LABELS, SHORTFALL_APPROVAL_STATUSES } from '@/domain/expense/settlement-rules'
import { uuidField } from '@/fields/common'

import { ro } from './fields-f2'
import { companyField, companyHook } from '@/fields/company'
import { USER_NAME_VIEW } from '@/fields/users'

/**
 * T5 LPJ & settlement (requirements v1.1 §7 T5, US-08/US-21/US-22; architecture §4.3 `settlements`,
 * §5.3). Pengajuan Baru only, one row per request, created when the requester declares the receipts
 * complete ("Nota Lengkap"). LPJ number (`LPJ/YYMM/####`, ADR 0007) at the first submit.
 * difference = transferredTotal − verifiedReceiptsTotal: > 0 → staff returns the rest (KM
 * "Pengembalian LPJ", ADR 0005 §3), < 0 → shortfall transfer (T3 `lpj_shortfall` + KK), 0 → none.
 * CLASS B (ADR 0006 §2): flat, no DELETE; DB trigger `pk_settlements_guard` enforces the status
 * graph, freezes identity columns and every settled row, and cross-checks the posted refund /
 * shortfall amounts. Writes: domain service only (/api/v1/expense-requests/{id}/lpj/*, /settle).
 */
export const Settlements: CollectionConfig = withAudit(
  {
    slug: 'settlements',
    labels: { singular: 'LPJ', plural: 'LPJ' },
    admin: {
      group: 'Keuangan',
      useAsTitle: 'docNo',
      defaultColumns: ['docNo', 'request', 'status', 'transferredTotal', 'receiptsTotal', 'difference', 'settlementType'],
      components: { views: { edit: RIWAYAT_TAB } },
    },
    access: {
      read: byVisibleRequest('request'),
      create: denyAll,
      update: denyAll,
      delete: denyDeleteLogged('settlement'),
    },
    hooks: { beforeChange: [companyHook('settlements', { derive: [{ field: 'request', collection: 'expense-requests' }], check: [{ field: 'refundCashEntry', collection: 'cash-entries' }, { field: 'shortfallTransfer', collection: 'transfers' }] })] },
    fields: [
      companyField({ derived: true }),
      { name: 'docNo', type: 'text', label: 'Nomor LPJ', index: true, admin: ro },
      { name: 'request', type: 'relationship', relationTo: 'expense-requests', label: 'Pengajuan', required: true, unique: true, index: true, admin: ro },
      {
        name: 'status',
        type: 'select',
        label: 'Status',
        required: true,
        defaultValue: 'draft',
        index: true,
        options: SETTLEMENT_STATUSES.map((s) => ({ label: SETTLEMENT_STATUS_LABELS[s], value: s })),
        admin: ro,
      },
      { name: 'usageNotes', type: 'textarea', label: 'Uraian penggunaan dana', maxLength: 2000, admin: ro },
      // Point 13 (DRMS 10/10): LPJ photos (site / goods), same pipeline + privacy as receipts (media-receipts:
      // re-encoded ≤ 1600 px, EXIF stripped, owner-linked → readable like the request). Requester adds/removes
      // them while the LPJ is Draft / Revisi (service lpj.ts setLpjPhotos); frozen afterwards
      // (DB: settlements_photos_frozen compares the set with `photos_hash` taken at submit).
      {
        name: 'photos',
        type: 'upload',
        relationTo: 'media-receipts',
        hasMany: true,
        maxRows: 10,
        label: 'Foto LPJ',
        admin: { ...ro, components: { Field: '@/admin/components/LpjPhotosField#LpjPhotosField' } },
      },
      { name: 'photosHash', type: 'text', label: 'Hash foto LPJ terkunci', admin: { ...ro, hidden: true } },
      { name: 'transferredTotal', type: 'number', label: 'Total ditransfer (Rp)', admin: ro },
      { name: 'receiptsTotal', type: 'number', label: 'Total nota diajukan (Rp)', admin: ro },
      { name: 'verifiedReceiptsTotal', type: 'number', label: 'Total nota terverifikasi (Rp)', admin: ro },
      { name: 'difference', type: 'number', label: 'Selisih (ditransfer − nota) (Rp)', admin: ro },
      {
        name: 'settlementType',
        type: 'select',
        label: 'Penyelesaian',
        options: [
          { label: 'Pas (tanpa selisih)', value: 'none' },
          { label: 'Pengembalian ke kas (KM)', value: 'refund' },
          { label: 'Kekurangan dibayar (transfer)', value: 'shortfall' },
        ],
        admin: ro,
      },
      { name: 'financeNotes', type: 'textarea', label: 'Catatan revisi Finance', maxLength: 1000, admin: ro },
      { name: 'submitCount', type: 'number', label: 'Jumlah pengiriman', defaultValue: 0, admin: ro },
      { name: 'submittedAt', type: 'date', label: 'Dikirim (server)', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'submittedBy', type: 'relationship', relationTo: 'users', label: 'Dikirim oleh', admin: { ...ro, components: USER_NAME_VIEW } },
      { name: 'verifiedAt', type: 'date', label: 'Diverifikasi (server)', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'verifiedBy', type: 'relationship', relationTo: 'users', label: 'Diverifikasi oleh', admin: { ...ro, components: USER_NAME_VIEW } },
      { name: 'settledAt', type: 'date', label: 'Diselesaikan (server)', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'settledBy', type: 'relationship', relationTo: 'users', label: 'Diselesaikan oleh', admin: { ...ro, components: USER_NAME_VIEW } },
      { name: 'refundCashEntry', type: 'relationship', relationTo: 'cash-entries', label: 'Kas masuk pengembalian', admin: ro },
      { name: 'shortfallTransfer', type: 'relationship', relationTo: 'transfers', label: 'Transfer kekurangan', admin: ro },
      // E9 — settlement reversal (Finance): the refund KM / shortfall transfer is voided (reversal rows
      // stay visible in the cash book), the LPJ returns to "Terverifikasi" and the links above are
      // cleared (the previous ids stay in the audit log). DB guard: only settled → verified, reason ≥ 3.
      { name: 'reversalCount', type: 'number', label: 'Jumlah pembatalan penyelesaian', defaultValue: 0, admin: ro },
      { name: 'lastReversedAt', type: 'date', label: 'Penyelesaian terakhir dibatalkan (server)', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'lastReversedBy', type: 'relationship', relationTo: 'users', label: 'Dibatalkan oleh', admin: { ...ro, components: USER_NAME_VIEW } },
      { name: 'lastReversalReason', type: 'textarea', label: 'Alasan pembatalan penyelesaian', maxLength: 1000, admin: ro },
      // QA-06 / ADR 0019 — shortfall above approved + tolerance: re-approval of the new total through the
      // ADR 0013 engine (Direktur "Diketahui" → Finance), decision rows in `approvals` (docType
      // expense_shortfall, `settlement`). DB guard: these columns change only while the LPJ is verified.
      {
        name: 'shortfallApprovalStatus',
        type: 'select',
        label: 'Persetujuan kekurangan',
        options: SHORTFALL_APPROVAL_STATUSES.map((v) => ({ label: SHORTFALL_APPROVAL_LABELS[v], value: v })),
        admin: ro,
      },
      { name: 'shortfallApprovalCycle', type: 'number', label: 'Siklus persetujuan kekurangan', defaultValue: 0, admin: ro },
      { name: 'shortfallApprovalLevel', type: 'number', label: 'Level persetujuan kekurangan', admin: ro },
      { name: 'shortfallApprovalAmount', type: 'number', label: 'Total transfer yang dimintakan persetujuan (Rp)', admin: ro },
      { name: 'shortfallApprovalSnapshot', type: 'json', label: 'Aturan approval kekurangan (snapshot)', admin: { readOnly: true, components: { Field: '@/components/ReadOnlyJson#ReadOnlyJson' } } },
      { name: 'shortfallApprovalNote', type: 'textarea', label: 'Alasan pengajuan kekurangan (Finance)', maxLength: 1000, admin: ro },
      { name: 'shortfallRejectReason', type: 'textarea', label: 'Alasan penolakan kekurangan', maxLength: 1000, admin: ro },
      uuidField(),
    ],
  },
  {
    docType: 'settlement',
    docNo: (d) => (typeof d.docNo === 'string' ? d.docNo : undefined),
    exclude: ['submitCount', 'reversalCount', 'shortfallApprovalSnapshot', 'photosHash'],
    reasonRules: [reasonOnChange(['financeNotes'], 'Catatan revisi wajib diisi (G7).')],
    actionFor: (c) => (c.field === 'status' ? 'status_change' : undefined),
  },
)
