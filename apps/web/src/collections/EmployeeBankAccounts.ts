import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { byRole, fieldRoles, ownEmployee, rolesAllowed } from '@/access/policies'
import { reasonOnChange, reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, uuidField } from '@/fields/common'
import { companyField, companyHook } from '@/fields/company'

/**
 * Rekening karyawan (transfer target). Sensitive: readable by the owning employee and by
 * Finance/Owner/Admin only (architecture §7.2). Admin + Finance C/U, Owner R.
 * Verification status only by Finance/Admin.
 */
export const EmployeeBankAccounts: CollectionConfig = withAudit(
  {
    slug: 'employee-bank-accounts',
    labels: { singular: 'Rekening karyawan', plural: 'Rekening karyawan' },
    admin: {
      useAsTitle: 'label',
      group: 'Pengguna & Akses',
      defaultColumns: ['employee', 'bank', 'accountNo', 'accountHolder', 'verificationStatus', 'active'],
    },
    access: {
      read: byRole({
        'pk-admin': true,
        'pk-finance': true,
        'pk-owner': true,
        'pk-pm': ownEmployee('employee'),
        'pk-staff': ownEmployee('employee'),
      }),
      create: rolesAllowed('pk-admin', 'pk-finance'),
      update: byRole({ 'pk-admin': true, 'pk-finance': true }),
      delete: denyAll,
    },
    hooks: {
      beforeValidate: [
        ({ data }) => {
          if (data && typeof data.accountNo === 'string') data.accountNo = data.accountNo.replace(/[\s.-]/g, '')
          return data
        },
      ],
      beforeChange: [companyHook('employee-bank-accounts', { derive: [{ field: 'employee', collection: 'employees' }] }),
        ({ data }) => {
          const no = typeof data.accountNo === 'string' ? data.accountNo : ''
          data.label = no ? `${String(data.accountHolder ?? '').trim()} ••${no.slice(-4)}` : data.label
          return data
        },
      ],
    },
    fields: [
      companyField({ derived: true }),
      { name: 'employee', type: 'relationship', relationTo: 'employees', label: 'Karyawan', required: true, index: true },
      { name: 'bank', type: 'relationship', relationTo: 'banks', label: 'Bank', required: true },
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
    docType: 'employee_bank_account',
    exclude: ['label'],
    reasonRules: [
      reasonOnDeactivate,
      reasonOnChange(['accountNo', 'accountHolder', 'bank', 'employee'], 'Alasan wajib diisi saat mengubah data rekening.'),
    ],
  },
)
