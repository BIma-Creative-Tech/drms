import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { byVisibleRequest, denyDeleteLogged } from '@/domain/expense/access'
import { flagVisibleWhere } from '@/domain/expense/flag-visibility'
import { FLAG_KINDS, FLAG_LABELS } from '@/domain/expense/types'

import { ro } from './fields-f2'
import { companyField, companyHook } from '@/fields/company'
import { USER_NAME_VIEW } from '@/fields/users'

const jsonView = { readOnly: true, components: { Field: '@/components/ReadOnlyJson#ReadOnlyJson' } }

/**
 * Validation flags per line/receipt (US-47…US-50, architecture §5.6) — shown to approvers and
 * Finance, never blocking. Recomputed by the service: new → `open` (audit flag_raised), condition
 * gone → `resolved`, Finance marks warnings `reviewed` (audit flag_reviewed, optional note).
 * `info` flags need no action. CLASS B: flat, no DELETE, identity columns immutable (trigger).
 * QA-MC4-06 (owner decision 2026-10-02, ADR 0016 "Scope rule"): a duplicate flag whose related request
 * is in ANOTHER PT carries `relatedCompany` and is readable only by users mapped to that PT
 * (`domain/expense/flag-visibility.ts`).
 */
export const ReceiptFlags: CollectionConfig = {
  slug: 'receipt-flags',
  labels: { singular: 'Flag validasi nota', plural: 'Flag validasi nota' },
  admin: { group: 'Keuangan', defaultColumns: ['request', 'lineNo', 'kind', 'level', 'status', 'message'] },
  access: {
    read: async (args) => {
      const base = await byVisibleRequest('request')(args)
      const v = flagVisibleWhere(args.req)
      if (base === false || !v) return base
      return base === true ? v : { and: [base, v] }
    },
    create: denyAll,
    update: denyAll,
    delete: denyDeleteLogged('receipt_flag'),
  },
  hooks: { beforeChange: [companyHook('receipt-flags', { derive: [{ field: 'request', collection: 'expense-requests' }] })] },
  fields: [
    companyField({ derived: true }),
    { name: 'request', type: 'relationship', relationTo: 'expense-requests', required: true, index: true, admin: ro },
    { name: 'key', type: 'text', required: true, index: true, admin: ro },
    { name: 'kind', type: 'select', required: true, options: FLAG_KINDS.map((k) => ({ label: FLAG_LABELS[k], value: k })), admin: ro },
    { name: 'level', type: 'select', required: true, options: [{ label: 'Info', value: 'info' }, { label: 'Peringatan', value: 'warning' }], admin: ro },
    { name: 'lineId', type: 'text', admin: ro },
    { name: 'lineNo', type: 'number', admin: ro },
    { name: 'receipt', type: 'relationship', relationTo: 'receipts', admin: ro },
    { name: 'relatedRequest', type: 'relationship', relationTo: 'expense-requests', label: 'Pengajuan terkait (nota ganda)', admin: ro },
    // QA-MC4-06: PT of `relatedRequest` when it is NOT this request's PT (cross-PT duplicate); empty otherwise
    { name: 'relatedCompany', type: 'relationship', relationTo: 'companies', label: 'PT pengajuan terkait (lintas PT)', index: true, admin: ro },
    { name: 'message', type: 'text', required: true, admin: ro },
    { name: 'detail', type: 'json', admin: jsonView },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'open',
      index: true,
      options: [
        { label: 'Terbuka', value: 'open' },
        { label: 'Sudah diperiksa', value: 'reviewed' },
        { label: 'Tidak berlaku lagi', value: 'resolved' },
      ],
      admin: ro,
    },
    { name: 'reviewedBy', type: 'relationship', relationTo: 'users', label: 'Ditinjau oleh', admin: { ...ro, components: USER_NAME_VIEW } },
    { name: 'reviewedAt', type: 'date', admin: ro },
    { name: 'reviewNote', type: 'text', maxLength: 500, admin: ro },
    { name: 'resolvedAt', type: 'date', admin: ro },
  ],
}
