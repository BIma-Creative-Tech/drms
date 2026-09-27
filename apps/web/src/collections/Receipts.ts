import type { CollectionConfig } from 'payload'

import { RIWAYAT_TAB } from '@/admin/config'

import { denyAll, isStaffOnly } from '@/access/roles'
import { reasonOnChange, withAudit } from '@/audit/hooks'
import { byVisibleRequest, denyDeleteLogged } from '@/domain/expense/access'
import { uuidField } from '@/fields/common'

import { businessDateField, ro } from './fields-f2'

/**
 * T4 Nota (requirements v1.1 §7 T4, US-07/US-38/US-39): many per request, each linked to ONE line
 * (array row id + line number). CLASS B (ADR 0006 §2): flat, no DELETE; DB trigger allows content
 * changes only while the request's receipts are editable (Reimburse: Draft/Revisi Nota; Uang Muka:
 * after transfer), otherwise only the verification columns. "Hapus" = status `removed` with reason.
 * Image = `media-receipts` (resized to 2000 px, original discarded, sha256 of the original kept).
 */
export const Receipts: CollectionConfig = withAudit(
  {
    slug: 'receipts',
    labels: { singular: 'Nota', plural: 'Nota' },
    admin: { group: 'Keuangan', useAsTitle: 'receiptNo', defaultColumns: ['request', 'lineNo', 'receiptNo', 'vendorName', 'receiptDate', 'amount', 'status'], components: { views: { edit: RIWAYAT_TAB } } },
    access: { read: byVisibleRequest('request'), create: denyAll, update: denyAll, delete: denyDeleteLogged('receipt') },
    fields: [
      { name: 'request', type: 'relationship', relationTo: 'expense-requests', required: true, index: true, admin: ro },
      { name: 'lineId', type: 'text', label: 'ID baris', required: true, index: true, admin: ro },
      { name: 'lineNo', type: 'number', label: 'Baris ke-', admin: ro },
      { name: 'receiptNo', type: 'text', label: 'Nomor nota', maxLength: 64 },
      { name: 'receiptNoNorm', type: 'text', index: true, admin: { ...ro, hidden: true } },
      // F2e UAT: not rendered for staff (no read access to vendors → the input's query was a 403).
      { name: 'vendor', type: 'relationship', relationTo: 'vendors', label: 'Vendor (master)', admin: { condition: (_d, _s, { user }) => !isStaffOnly(user) } },
      { name: 'vendorName', type: 'text', label: 'Vendor / toko', required: true, maxLength: 160 },
      { name: 'vendorNorm', type: 'text', index: true, admin: { ...ro, hidden: true } },
      businessDateField('receiptDate', 'Tanggal nota', { required: true }),
      { name: 'receiptTime', type: 'text', label: 'Jam nota', maxLength: 8, validate: (v: unknown) => (v === null || v === undefined || v === '' || (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v)) ? true : 'Format HH:MM') },
      { name: 'amount', type: 'number', label: 'Total tercetak (Rp)', required: true, min: 1 },
      { name: 'taxAmount', type: 'number', label: 'Pajak (informatif, Q-26)', min: 0 },
      { name: 'image', type: 'upload', relationTo: 'media-receipts', label: 'Foto nota', required: true },
      { name: 'imageSha256', type: 'text', index: true, admin: { ...ro, hidden: true } },
      {
        name: 'status',
        type: 'select',
        label: 'Status',
        required: true,
        defaultValue: 'pending',
        index: true,
        options: [
          { label: 'Menunggu verifikasi', value: 'pending' },
          { label: 'Valid', value: 'valid' },
          { label: 'Ditolak', value: 'rejected' },
          { label: 'Dihapus', value: 'removed' },
        ],
        admin: ro,
      },
      { name: 'rejectReason', type: 'text', label: 'Alasan ditolak', admin: ro },
      { name: 'removeReason', type: 'text', label: 'Alasan dihapus', admin: ro },
      { name: 'verifiedBy', type: 'relationship', relationTo: 'users', label: 'Diverifikasi oleh', admin: ro },
      { name: 'verifiedAt', type: 'date', label: 'Diverifikasi', admin: ro },
      { name: 'entrySource', type: 'select', label: 'Sumber isian', defaultValue: 'manual', options: [{ label: 'Manual', value: 'manual' }, { label: 'OCR', value: 'ocr' }], admin: ro },
      { name: 'createdBy', type: 'relationship', relationTo: 'users', label: 'Diunggah oleh', admin: ro },
      // F4: APK offline id of a receipt synced with a draft (POST /api/v1/sync/batch, ADR 0010).
      { name: 'clientUuid', type: 'text', label: 'Client UUID (APK offline)', unique: true, index: true, admin: { ...ro, hidden: true } },
      uuidField(),
    ],
  },
  {
    docType: 'receipt',
    exclude: ['receiptNoNorm', 'vendorNorm', 'imageSha256', 'clientUuid'],
    reasonRules: [
      reasonOnChange(['rejectReason'], 'Alasan wajib diisi saat menolak nota.'),
      reasonOnChange(['removeReason'], 'Alasan wajib diisi saat menghapus nota.'),
    ],
    actionFor: (c) =>
      c.field === 'status' ? (c.newValue === 'valid' ? 'verify' : c.newValue === 'rejected' ? 'reject' : 'status_change') : undefined,
  },
)
