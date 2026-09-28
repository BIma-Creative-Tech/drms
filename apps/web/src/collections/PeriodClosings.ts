import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { byRole } from '@/access/policies'
import { denyDeleteLogged } from '@/domain/expense/access'

import { ro } from './fields-f2'
import { companyField, companyHook } from '@/fields/company'

/**
 * Tutup buku bulanan (ADR 0005 §6, requirements §9 "Keuangan"). One row per close; re-open (Owner,
 * reason) flips it to `reopened`; a later close inserts a new row. Lock date = last day of the
 * latest period whose row is `closed` — enforced by DB triggers on cash_entries and transfers.
 * CLASS B: no DELETE; only the reopen columns may change (closed → reopened).
 */
export const PeriodClosings: CollectionConfig = {
  slug: 'period-closings',
  labels: { singular: 'Tutup buku', plural: 'Tutup buku' },
  admin: { group: 'Keuangan', useAsTitle: 'period', defaultColumns: ['period', 'status', 'closedBy', 'closedAt', 'reopenedAt'] },
  access: {
    read: byRole({ 'pk-finance': true, 'pk-owner': true, 'pk-admin': true }),
    create: denyAll,
    update: denyAll,
    delete: denyDeleteLogged('period_closing'),
  },
  hooks: { beforeChange: [companyHook('period-closings')] },
  fields: [
    companyField(),
    { name: 'period', type: 'text', label: 'Periode (YYYY-MM)', required: true, index: true, admin: ro },
    { name: 'status', type: 'select', required: true, defaultValue: 'closed', options: [{ label: 'Ditutup', value: 'closed' }, { label: 'Dibuka kembali', value: 'reopened' }], admin: ro },
    { name: 'note', type: 'text', maxLength: 500, admin: ro },
    { name: 'closedBy', type: 'relationship', relationTo: 'users', admin: ro },
    { name: 'closedAt', type: 'date', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
    { name: 'reopenedBy', type: 'relationship', relationTo: 'users', admin: ro },
    { name: 'reopenedAt', type: 'date', admin: ro },
    { name: 'reopenReason', type: 'text', maxLength: 500, admin: ro },
  ],
}
