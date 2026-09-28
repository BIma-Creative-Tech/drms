import type { CollectionConfig } from 'payload'

import { denyAll, hasRole, ownEmployees, relId } from '@/access/roles'
import { byRole, rolesAllowed, anyMember } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, codeField, odooRefField, uuidField } from '@/fields/common'
import { relationship } from 'payload/shared'

import { companyField, companyHook, pickerSameCompany, requireCompanyWhenAmbiguous } from '@/fields/company'

/**
 * Karyawan / staff, one row per PT (ADR 0016 D1). An employee without a user account can still be a
 * requester ("Diajukan Oleh"); the user ↔ employee link of a PT lives on `company-memberships`. Everyone with a role can list employees (requester/team pickers); phone numbers only
 * for Admin/Owner/Finance/PM and the employee themself. Admin C/R/U, Owner R/U.
 */
export const Employees: CollectionConfig = withAudit(
  {
    slug: 'employees',
    labels: { singular: 'Karyawan', plural: 'Karyawan' },
    admin: { useAsTitle: 'name', group: 'Pengguna & Akses', defaultColumns: ['code', 'name', 'position', 'active'], listSearchableFields: ['code', 'name', 'nickname'] },
    access: {
      read: anyMember,
      create: rolesAllowed('pk-admin'),
      update: byRole({ 'pk-admin': true, 'pk-owner': true }),
      delete: denyAll,
    },
    hooks: { beforeChange: [companyHook('employees', { check: [{ field: 'workSchedule', collection: 'work-schedules' }] })] },
    fields: [
      {
        ...companyField(),
        // MC2-4 (D1): one employee record = one PT; required on create when several PTs are selected
        validate: (value: unknown, opts: Parameters<typeof relationship>[1]) => {
          const own = requireCompanyWhenAmbiguous(value, opts as never)
          return own === true ? relationship(value as never, opts) : own
        },
        admin: { description: 'PT tempat karyawan ini bekerja (1 data karyawan = 1 PT; orang yang bekerja di 2 PT punya 2 data karyawan). Tidak dapat diubah setelah dibuat.' },
      },
      codeField('Kode', 32, { perCompany: true }),
      { name: 'name', type: 'text', label: 'Nama lengkap', required: true, maxLength: 128 },
      { name: 'nickname', type: 'text', label: 'Nama panggilan', maxLength: 64 },
      { name: 'position', type: 'text', label: 'Jabatan', maxLength: 128 },
      {
        name: 'phone',
        type: 'text',
        label: 'No. HP',
        maxLength: 32,
        access: {
          // office roles / PM of the employee's PT, or the employee themself (ADR 0016 §5)
          read: ({ req, doc }) =>
            hasRole(req, ['pk-admin', 'pk-owner', 'pk-finance', 'pk-pm'], relId((doc as { company?: unknown } | undefined)?.company)) ||
            ownEmployees(req).includes(relId((doc as { id?: unknown } | undefined)?.id) ?? -1),
        },
      },
      // E6: jadwal kerja karyawan (kosong = jadwal default di Setting perusahaan).
      { name: 'workSchedule', type: 'relationship', relationTo: 'work-schedules', label: 'Jadwal kerja', ...pickerSameCompany() },
      { name: 'faceRefPhoto', type: 'upload', relationTo: 'media-selfies', label: 'Foto wajah referensi' },
      odooRefField('odooEmployeeRef', 'Ref. karyawan Odoo'),
      activeField(),
      uuidField(),
    ],
  },
  { docType: 'employee', reasonRules: [reasonOnDeactivate] },
)
