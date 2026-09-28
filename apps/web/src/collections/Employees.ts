import type { CollectionConfig } from 'payload'

import { denyAll, hasRole, ownEmployees, relId } from '@/access/roles'
import { byRole, rolesAllowed, anyMember } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, codeField, odooRefField, uuidField } from '@/fields/common'
import { companyField, companyHook } from '@/fields/company'

/**
 * Karyawan / staff. An employee without a user account can still be a requester ("Diajukan
 * Oleh"); the link lives on `users.employee` (architecture §4.2). Everyone with a role can list employees (requester/team pickers); phone numbers only
 * for Admin/Owner/Finance/PM and the employee themself. Admin C/R/U, Owner R/U.
 */
export const Employees: CollectionConfig = withAudit(
  {
    slug: 'employees',
    labels: { singular: 'Karyawan', plural: 'Karyawan' },
    admin: { useAsTitle: 'name', group: 'Pengguna & Akses', defaultColumns: ['code', 'name', 'position', 'active'] },
    access: {
      read: anyMember,
      create: rolesAllowed('pk-admin'),
      update: byRole({ 'pk-admin': true, 'pk-owner': true }),
      delete: denyAll,
    },
    hooks: { beforeChange: [companyHook('employees', { check: [{ field: 'workSchedule', collection: 'work-schedules' }] })] },
    fields: [
      companyField(),
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
      { name: 'workSchedule', type: 'relationship', relationTo: 'work-schedules', label: 'Jadwal kerja' },
      { name: 'faceRefPhoto', type: 'upload', relationTo: 'media-selfies', label: 'Foto wajah referensi' },
      odooRefField('odooEmployeeRef', 'Ref. karyawan Odoo'),
      activeField(),
      uuidField(),
    ],
  },
  { docType: 'employee', reasonRules: [reasonOnDeactivate] },
)
