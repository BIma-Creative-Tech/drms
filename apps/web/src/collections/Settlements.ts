import type { CollectionConfig } from 'payload'

import { RIWAYAT_TAB } from '@/admin/config'

import { denyAll } from '@/access/roles'
import { reasonOnChange, withAudit } from '@/audit/hooks'
import { byVisibleRequest, denyDeleteLogged } from '@/domain/expense/access'
import { SETTLEMENT_STATUSES, SETTLEMENT_STATUS_LABELS } from '@/domain/expense/settlement-rules'
import { uuidField } from '@/fields/common'

import { ro } from './fields-f2'

/**
 * T5 LPJ & settlement (requirements v1.1 §7 T5, US-08/US-21/US-22; architecture §4.3 `settlements`,
 * §5.3). Uang Muka only, one row per request, created when the requester declares the receipts
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
    fields: [
      { name: 'docNo', type: 'text', label: 'Nomor LPJ', unique: true, index: true, admin: ro },
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
      { name: 'submittedBy', type: 'relationship', relationTo: 'users', label: 'Dikirim oleh', admin: ro },
      { name: 'verifiedAt', type: 'date', label: 'Diverifikasi (server)', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'verifiedBy', type: 'relationship', relationTo: 'users', label: 'Diverifikasi oleh', admin: ro },
      { name: 'settledAt', type: 'date', label: 'Diselesaikan (server)', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'settledBy', type: 'relationship', relationTo: 'users', label: 'Diselesaikan oleh', admin: ro },
      { name: 'refundCashEntry', type: 'relationship', relationTo: 'cash-entries', label: 'Kas masuk pengembalian', admin: ro },
      { name: 'shortfallTransfer', type: 'relationship', relationTo: 'transfers', label: 'Transfer kekurangan', admin: ro },
      // E9 — settlement reversal (Finance): the refund KM / shortfall transfer is voided (reversal rows
      // stay visible in the cash book), the LPJ returns to "Terverifikasi" and the links above are
      // cleared (the previous ids stay in the audit log). DB guard: only settled → verified, reason ≥ 3.
      { name: 'reversalCount', type: 'number', label: 'Jumlah pembatalan penyelesaian', defaultValue: 0, admin: ro },
      { name: 'lastReversedAt', type: 'date', label: 'Penyelesaian terakhir dibatalkan (server)', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'lastReversedBy', type: 'relationship', relationTo: 'users', label: 'Dibatalkan oleh', admin: ro },
      { name: 'lastReversalReason', type: 'textarea', label: 'Alasan pembatalan penyelesaian', maxLength: 1000, admin: ro },
      uuidField(),
    ],
  },
  {
    docType: 'settlement',
    docNo: (d) => (typeof d.docNo === 'string' ? d.docNo : undefined),
    exclude: ['submitCount', 'reversalCount'],
    reasonRules: [reasonOnChange(['financeNotes'], 'Catatan revisi wajib diisi (G7).')],
    actionFor: (c) => (c.field === 'status' ? 'status_change' : undefined),
  },
)
