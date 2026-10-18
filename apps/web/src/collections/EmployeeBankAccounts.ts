import type { CollectionConfig, FieldHook } from 'payload'
import { creatableRelationship } from '@/admin/relationship-create'

import { denyAll, hasRole, isGroupAdmin, ownEmployees, relId } from '@/access/roles'
import { anyOf, byRole, fieldRoles, ownEmployee, rolesAllowed, teamProjectEmployees } from '@/access/policies'
import { reasonOnChange, reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, uuidField } from '@/fields/common'
import { companyField, companyHook, pickerSameCompany } from '@/fields/company'

/**
 * Rekening karyawan (transfer target). Sensitive: readable by the owning employee and by
 * Finance/Owner/Admin only (architecture §7.2). Admin + Finance C/U, Owner R.
 * Verification status only by Finance/Admin.
 * D1810 (owner decision 2026-10-18): a PM also reads the accounts of the members of his team projects (to file a
 * request on their behalf), with the number MASKED (`maskForeignNumber`).
 */
export const maskForeignNumber: FieldHook = ({ value, siblingData, overrideAccess, req }) => {
  // system reads (overrideAccess, e.g. the submit snapshot = the transfer destination) keep the full number
  if (overrideAccess !== false || typeof value !== 'string') return value
  const row = siblingData as { company?: unknown; employee?: unknown } | undefined
  if (isGroupAdmin(req) || hasRole(req, ['pk-admin', 'pk-finance', 'pk-owner'], relId(row?.company))) return value
  return ownEmployees(req).includes(relId(row?.employee) ?? -1) ? value : `••••${value.slice(-4)}` // = dto.ts maskAccountNo
}

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
        'pk-pm': anyOf(ownEmployee('employee'), teamProjectEmployees('employee')),
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
      beforeChange: [companyHook('employee-bank-accounts', { derive: [{ field: 'employee', collection: 'employees' }], companyIsFilter: true }),
        ({ data }) => {
          const no = typeof data.accountNo === 'string' ? data.accountNo : ''
          data.label = no ? `${String(data.accountHolder ?? '').trim()} ••${no.slice(-4)}` : data.label
          return data
        },
      ],
    },
    fields: [
      // DRMS UI 17/10 #4 (owner 2026-10-17): PT picker that only filters the Karyawan picker
      companyField({ derived: true, filter: true }),
      // DRMS 16/10 (b): "+ Karyawan baru" (plain employee form in a drawer, no user account); DRMS UI 17/10 #4: employees of
      // the chosen PT only — locked until the PT filter has a value. The account's PT follows the employee.
      creatableRelationship({ name: 'employee', type: 'relationship', relationTo: 'employees', label: 'Karyawan', required: true, index: true, ...pickerSameCompany({ required: true }), admin: { placeholder: 'Pilih karyawan…' } }, { company: 'form', lock: true }),
      { name: 'bank', type: 'relationship', relationTo: 'banks', label: 'Bank', required: true, admin: { placeholder: 'Pilih bank…' } },
      {
        name: 'accountNo',
        type: 'text',
        label: 'Nomor rekening',
        required: true,
        maxLength: 34,
        validate: (v: unknown) => (typeof v === 'string' && /^[0-9]{5,34}$/.test(v) ? true : 'Nomor rekening hanya angka (5–34 digit).'),
        hooks: { afterRead: [maskForeignNumber] },
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
