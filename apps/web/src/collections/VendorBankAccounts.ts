import type { CollectionConfig } from 'payload'
import { creatableRelationship } from '@/admin/relationship-create'

import { denyAll } from '@/access/roles'
import { byRole, fieldRoles, rolesAllowed } from '@/access/policies'
import { reasonOnChange, reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, uuidField } from '@/fields/common'
import { companyField, companyHook, pickerSameCompany } from '@/fields/company'

/** ADR 0027: account number as stored (spaces, dots and dashes removed) — same rule as the employee accounts. */
export const normalizeAccountNo = (v: unknown): unknown => (typeof v === 'string' ? v.replace(/[\s.-]/g, '') : v)

/**
 * ADR 0027 (DRMS 13/10 Wave 4) "Rekening vendor": destination of a vendor payment ("Pembayaran vendor"), mirror of
 * `employee-bank-accounts` — vendor, bank (the shared bank master), account number, holder ("Atas nama"), default
 * flag, verification status (Admin / Finance only), active. PT derived from the vendor (company hook + DB trigger),
 * no delete (deactivate with a reason), a reason on every change of the account data, audited.
 * Access per PT: Admin / Finance create + update; Direktur reads; PM and Staff read (they file vendor payments and pick
 * the account — Staff since the owner request 2026-10-16; read only, never create / update).
 */
export const VendorBankAccounts: CollectionConfig = withAudit(
  {
    slug: 'vendor-bank-accounts',
    labels: { singular: 'Rekening vendor', plural: 'Rekening vendor' },
    admin: {
      useAsTitle: 'label',
      group: 'Master Data',
      defaultColumns: ['vendor', 'bank', 'accountNo', 'accountHolder', 'isDefault', 'verificationStatus', 'active'],
    },
    access: {
      read: byRole({ 'pk-admin': true, 'pk-finance': true, 'pk-owner': true, 'pk-pm': true, 'pk-staff': true }),
      create: rolesAllowed('pk-admin', 'pk-finance'),
      update: byRole({ 'pk-admin': true, 'pk-finance': true }),
      delete: denyAll,
    },
    hooks: {
      beforeValidate: [
        ({ data }) => {
          if (data && typeof data.accountNo === 'string') data.accountNo = normalizeAccountNo(data.accountNo)
          return data
        },
      ],
      beforeChange: [
        companyHook('vendor-bank-accounts', { derive: [{ field: 'vendor', collection: 'vendors' }] }),
        ({ data, originalDoc }) => {
          const no = typeof data.accountNo === 'string' ? data.accountNo : typeof originalDoc?.accountNo === 'string' ? originalDoc.accountNo : ''
          const holder = data.accountHolder !== undefined ? data.accountHolder : originalDoc?.accountHolder
          data.label = no ? `${String(holder ?? '').trim()} ••${no.slice(-4)}` : data.label
          return data
        },
      ],
    },
    fields: [
      companyField({ derived: true }),
      // DRMS 16/10 (b): "+ Vendor baru" — the PT of the account follows the vendor, so the drawer asks for the PT
      creatableRelationship({ name: 'vendor', type: 'relationship', relationTo: 'vendors', label: 'Vendor', required: true, index: true, ...pickerSameCompany({ required: true }), admin: { placeholder: 'Pilih vendor…' } }, { company: 'record' }),
      { name: 'bank', type: 'relationship', relationTo: 'banks', label: 'Bank', required: true, admin: { placeholder: 'Pilih bank…' } },
      {
        name: 'accountNo',
        type: 'text',
        label: 'Nomor rekening',
        required: true,
        maxLength: 34,
        validate: (v: unknown) => (typeof v === 'string' && /^[0-9]{5,34}$/.test(v) ? true : 'Nomor rekening hanya angka (5–34 digit).'),
      },
      { name: 'accountHolder', type: 'text', label: 'Atas nama', required: true, maxLength: 128 },
      { name: 'label', type: 'text', label: 'Label', admin: { readOnly: true, hidden: true } },
      { name: 'isDefault', type: 'checkbox', label: 'Rekening default', defaultValue: false },
      {
        name: 'verificationStatus',
        type: 'select',
        label: 'Status verifikasi',
        defaultValue: 'unverified',
        required: true,
        options: [
          { label: 'Belum diverifikasi', value: 'unverified' },
          { label: 'Terverifikasi', value: 'verified' },
        ],
        access: { update: fieldRoles('pk-admin', 'pk-finance'), create: fieldRoles('pk-admin', 'pk-finance') },
      },
      activeField(),
      uuidField(),
    ],
  },
  {
    docType: 'vendor_bank_account',
    exclude: ['label'],
    reasonRules: [
      reasonOnDeactivate,
      reasonOnChange(['accountNo', 'accountHolder', 'bank', 'vendor'], 'Alasan wajib diisi saat mengubah data rekening.'),
    ],
  },
)
