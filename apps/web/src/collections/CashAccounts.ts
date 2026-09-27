import { APIError, type CollectionBeforeChangeHook, type CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { byRole, rolesAllowed } from '@/access/policies'
import { reasonOnChange, reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, rupiahField, uuidField } from '@/fields/common'

import { businessDateField } from './fields-f2'

/**
 * S3b / E11 (ADR 0005 "As implemented (S3b)"): the opening balance is final once a period on or after
 * its date is closed — `openingBalance` and `openingBalanceDate` are then locked (correction = manual
 * cash entry). Accounts without `openingBalanceDate` keep the F2 rule (change with reason). Mirrors
 * the DB trigger pk_cash_accounts_opening_lock (migration s3b_data_import) with a readable message.
 */
const openingBalanceLock: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  if (operation !== 'update' || !originalDoc?.openingBalanceDate) return data
  const changed = (['openingBalance', 'openingBalanceDate'] as const).some((f) => f in data && (data[f] ?? null) !== (originalDoc[f] ?? null))
  if (!changed) return data
  const month = String(originalDoc.openingBalanceDate).slice(0, 7)
  const closed = await req.payload.find({
    collection: 'period-closings',
    where: { and: [{ status: { equals: 'closed' } }, { period: { greater_than_equal: month } }] },
    limit: 1,
    depth: 0,
    pagination: false,
    overrideAccess: true, // SYSTEM-READ: lock check
    req,
  })
  const period = (closed.docs[0] as { period?: string } | undefined)?.period
  if (period) {
    throw new APIError(
      `Saldo awal terkunci: periode ${period} sudah ditutup. Koreksi saldo lewat kas masuk/keluar manual (dengan alasan).`,
      409,
      { errors: [{ path: 'openingBalance', message: 'Saldo awal terkunci setelah tutup buku.' }] },
      true,
    )
  }
  return data
}

/** Akun kas/bank perusahaan. Finance C/R/U, Owner R/U, Admin C/R/U (requirements §4 "Master data"). */
export const CashAccounts: CollectionConfig = withAudit(
  {
    slug: 'cash-accounts',
    labels: { singular: 'Akun kas/bank', plural: 'Akun kas/bank' },
    admin: { useAsTitle: 'name', group: 'Keuangan', defaultColumns: ['name', 'kind', 'accountNo', 'active'] },
    hooks: { beforeChange: [openingBalanceLock] },
    access: {
      read: byRole({ 'pk-admin': true, 'pk-finance': true, 'pk-owner': true }),
      create: rolesAllowed('pk-admin', 'pk-finance'),
      update: byRole({ 'pk-admin': true, 'pk-finance': true, 'pk-owner': true }),
      delete: denyAll,
    },
    fields: [
      { name: 'name', type: 'text', label: 'Nama akun', required: true, unique: true, maxLength: 128 },
      {
        name: 'kind',
        type: 'select',
        label: 'Jenis',
        required: true,
        defaultValue: 'bank',
        options: [
          { label: 'Kas', value: 'cash' },
          { label: 'Bank', value: 'bank' },
        ],
      },
      { name: 'bank', type: 'relationship', relationTo: 'banks', label: 'Bank' },
      { name: 'accountNo', type: 'text', label: 'Nomor rekening', maxLength: 34 },
      { name: 'accountHolder', type: 'text', label: 'Atas nama', maxLength: 128 },
      rupiahField('openingBalance', 'Saldo awal (Rp)'),
      businessDateField('openingBalanceDate', 'Tanggal saldo awal (YYYY-MM-DD)', {
        admin: {
          description:
            'Tanggal go-live akun ini. Transaksi kas sebelum tanggal ini ditolak; saldo awal terkunci setelah periode sejak tanggal ini ditutup. Kosong = tanpa kunci.',
        },
      }),
      { name: 'odooJournalCode', type: 'text', label: 'Kode jurnal Odoo', maxLength: 16 },
      activeField(),
      uuidField(),
    ],
  },
  {
    docType: 'cash_account',
    reasonRules: [reasonOnDeactivate, reasonOnChange(['openingBalance', 'openingBalanceDate'], 'Alasan wajib diisi saat mengubah saldo awal.')],
  },
)
