import type { CollectionConfig } from 'payload'

import { RIWAYAT_TAB } from '@/admin/config'

import { denyAll, hasRoleAny } from '@/access/roles'
import { reasonOnChange, withAudit } from '@/audit/hooks'
import { byVisibleRequest, denyDeleteLogged } from '@/domain/expense/access'
import { uuidField } from '@/fields/common'

import { businessDateField, ro } from './fields-f2'

/**
 * T3 Transfer / pencairan (requirements v1.1 §7 T3, US-20). Amount is COPIED server-side from the
 * request's approved amount (G3; DB trigger re-checks on insert), destination = request's bank
 * snapshot, proof + bank reference required, automatic KK cash-out (T7) in the same transaction.
 * CLASS B: flat, no DELETE; only the void columns may change (posted → void). Period lock (G5) on
 * `transfer_date` enforced by DB trigger.
 */
export const Transfers: CollectionConfig = withAudit(
  {
    slug: 'transfers',
    labels: { singular: 'Transfer', plural: 'Transfer' },
    admin: { group: 'Keuangan', useAsTitle: 'docNo', defaultColumns: ['docNo', 'request', 'kind', 'amount', 'transferDate', 'status'], components: { views: { edit: RIWAYAT_TAB } } },
    access: {
      // Finance/Owner/Admin all; requesters own; PM team (via the request scope).
      read: async (args) => (hasRoleAny(args.req, 'pk-finance', 'pk-owner', 'pk-admin') ? true : byVisibleRequest('request')(args)),
      create: denyAll,
      update: denyAll,
      delete: denyDeleteLogged('transfer'),
    },
    fields: [
      { name: 'docNo', type: 'text', label: 'Nomor', unique: true, index: true, admin: ro },
      { name: 'request', type: 'relationship', relationTo: 'expense-requests', required: true, index: true, admin: ro },
      { name: 'kind', type: 'select', required: true, options: ['advance', 'reimburse', 'lpj_shortfall'].map((v) => ({ label: v, value: v })), admin: ro },
      { name: 'cashAccount', type: 'relationship', relationTo: 'cash-accounts', label: 'Akun kas sumber', required: true, admin: ro },
      { name: 'amount', type: 'number', label: 'Nominal (Rp)', required: true, admin: ro },
      {
        name: 'destination',
        type: 'group',
        label: 'Rekening tujuan (snapshot)',
        admin: ro,
        fields: [
          { name: 'bankName', type: 'text', label: 'Bank' },
          { name: 'accountNo', type: 'text', label: 'Nomor rekening' },
          { name: 'accountHolder', type: 'text', label: 'Atas nama' },
        ],
      },
      { name: 'bankRef', type: 'text', label: 'Nomor referensi bank', required: true, maxLength: 64, admin: ro },
      { name: 'proof', type: 'upload', relationTo: 'media-transfer-proofs', label: 'Bukti transfer', required: true, admin: ro },
      businessDateField('transferDate', 'Tanggal transfer', { required: true, admin: ro }),
      { name: 'postedBy', type: 'relationship', relationTo: 'users', label: 'Dicatat oleh', admin: ro },
      { name: 'status', type: 'select', required: true, defaultValue: 'posted', index: true, options: [{ label: 'Posted', value: 'posted' }, { label: 'Void', value: 'void' }], admin: ro },
      { name: 'cashEntry', type: 'relationship', relationTo: 'cash-entries', label: 'Kas keluar', admin: ro },
      { name: 'voidReason', type: 'text', label: 'Alasan void', admin: ro },
      { name: 'voidedBy', type: 'relationship', relationTo: 'users', admin: ro },
      { name: 'voidedAt', type: 'date', admin: ro },
      uuidField(),
    ],
  },
  {
    docType: 'transfer',
    docNo: (d) => (typeof d.docNo === 'string' ? d.docNo : undefined),
    reasonRules: [reasonOnChange(['voidReason'], 'Alasan wajib diisi saat membatalkan transfer.')],
    actionFor: (c) => (c.field === 'status' && c.newValue === 'void' ? 'void' : undefined),
  },
)
