import type { CollectionConfig } from 'payload'

import { RIWAYAT_TAB } from '@/admin/config'

import { denyAll } from '@/access/roles'
import { byRole } from '@/access/policies'
import { reasonOnChange, withAudit } from '@/audit/hooks'
import { denyDeleteLogged } from '@/domain/expense/access'
import { uuidField } from '@/fields/common'

import { businessDateField, ro } from './fields-f2'
import { companyField, companyHook } from '@/fields/company'
import { USER_NAME_VIEW } from '@/fields/users'

/**
 * T6/T7 Kas masuk / keluar — own single-entry cash book (ADR 0005). CLASS B: flat, no DELETE,
 * posted rows never change amount/direction/account/date (DB trigger `pk_cash_entries_guard`);
 * void = reversal row (`reversalOf`) + original `status=void` with reason (T8, US-24). Period lock
 * (ADR 0005 §6): the DB rejects inserts/edits dated on or before the end of the last closed period
 * (`period_closings`). `period` and `posted_at` are set by the DB.
 * Read: Finance/Owner/Admin (requirements §4 "Kas & bank"; PM gets summaries via dashboards, F3).
 * Writes: domain service only (/api/v1/cash-entries, transfers).
 */
export const CashEntries: CollectionConfig = withAudit(
  {
    slug: 'cash-entries',
    labels: { singular: 'Transaksi kas', plural: 'Transaksi kas' },
    admin: { group: 'Keuangan', useAsTitle: 'entryNo', defaultColumns: ['entryNo', 'entryDate', 'direction', 'amount', 'cashAccount', 'sourceType', 'status'], components: { views: { edit: RIWAYAT_TAB } } },
    access: {
      read: byRole({ 'pk-finance': true, 'pk-owner': true, 'pk-admin': true }),
      create: denyAll,
      update: denyAll,
      delete: denyDeleteLogged('cash_entry'),
    },
    hooks: { beforeChange: [companyHook('cash-entries', { derive: [{ field: 'cashAccount', collection: 'cash-accounts' }], check: [{ field: 'category', collection: 'expense-categories' }, { field: 'cashInSource', collection: 'cash-in-sources' }, { field: 'project', collection: 'projects' }, { field: 'costCenter', collection: 'cost-centers' }, { field: 'vehicle', collection: 'vehicles' }, { field: 'expenseRequest', collection: 'expense-requests' }, { field: 'transfer', collection: 'transfers' }, { field: 'reversalOf', collection: 'cash-entries' }] })] },
    fields: [
      companyField({ derived: true }),
      { name: 'entryNo', type: 'text', label: 'Nomor', index: true, admin: ro },
      businessDateField('entryDate', 'Tanggal', { required: true, index: true, admin: ro }),
      { name: 'period', type: 'text', label: 'Periode (YYYY-MM)', index: true, admin: ro },
      { name: 'direction', type: 'select', label: 'Arah', required: true, options: [{ label: 'Masuk', value: 'in' }, { label: 'Keluar', value: 'out' }], admin: ro },
      { name: 'amount', type: 'number', label: 'Nominal (Rp)', required: true, admin: ro },
      { name: 'cashAccount', type: 'relationship', label: 'Akun kas', relationTo: 'cash-accounts', required: true, index: true, admin: ro },
      { name: 'category', type: 'relationship', relationTo: 'expense-categories', label: 'Kategori (keluar)', admin: ro },
      { name: 'cashInSource', type: 'relationship', relationTo: 'cash-in-sources', label: 'Sumber (masuk)', admin: ro },
      { name: 'project', type: 'relationship', relationTo: 'projects', admin: ro },
      { name: 'costCenter', type: 'relationship', relationTo: 'cost-centers', admin: ro },
      { name: 'vehicle', type: 'relationship', relationTo: 'vehicles', admin: ro },
      { name: 'description', type: 'textarea', label: 'Keterangan', maxLength: 1000, admin: ro },
      { name: 'proof', type: 'upload', relationTo: 'media-attachments', label: 'Bukti', admin: ro },
      {
        name: 'sourceType',
        type: 'select',
        label: 'Sumber',
        required: true,
        options: [
          { label: 'Transfer pengajuan', value: 'transfer' },
          { label: 'Pengembalian LPJ', value: 'settlement_refund' },
          { label: 'Manual', value: 'manual' },
          { label: 'Pembalikan', value: 'reversal' },
          { label: 'Saldo awal', value: 'opening' },
        ],
        admin: ro,
      },
      { name: 'expenseRequest', type: 'relationship', relationTo: 'expense-requests', index: true, admin: ro },
      { name: 'transfer', type: 'relationship', relationTo: 'transfers', admin: ro },
      { name: 'status', type: 'select', required: true, defaultValue: 'posted', index: true, options: [{ label: 'Posted', value: 'posted' }, { label: 'Void', value: 'void' }], admin: ro },
      { name: 'reversalOf', type: 'relationship', relationTo: 'cash-entries', label: 'Jurnal balik dari', admin: ro },
      { name: 'reversedBy', type: 'relationship', relationTo: 'cash-entries', label: 'Dibalik oleh', admin: ro },
      { name: 'voidReason', type: 'text', admin: ro },
      { name: 'voidedBy', type: 'relationship', relationTo: 'users', label: 'Dibatalkan oleh', admin: { ...ro, components: USER_NAME_VIEW } },
      { name: 'voidedAt', type: 'date', admin: ro },
      { name: 'postedBy', type: 'relationship', relationTo: 'users', label: 'Dicatat oleh', admin: { ...ro, components: USER_NAME_VIEW } },
      { name: 'postedAt', type: 'date', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      uuidField(),
    ],
  },
  {
    docType: 'cash_entry',
    docNo: (d) => (typeof d.entryNo === 'string' ? d.entryNo : undefined),
    exclude: ['period', 'postedAt'],
    reasonRules: [
      reasonOnChange(['voidReason'], 'Alasan wajib diisi saat void.'),
      reasonOnChange(['description', 'category', 'cashInSource', 'project', 'costCenter', 'vehicle', 'proof'], 'Alasan wajib diisi saat mengedit transaksi kas.'),
    ],
    actionFor: (c) => (c.field === 'status' && c.newValue === 'void' ? 'void' : undefined),
  },
)
