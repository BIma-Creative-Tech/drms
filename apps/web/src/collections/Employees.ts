import { ValidationError, type CollectionBeforeChangeHook, type CollectionConfig } from 'payload'
import { relationship } from 'payload/shared'

import { denyAll, hasRole, ownEmployees, relId, userId } from '@/access/roles'
import { byRole, rolesAllowed, anyMember } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, codeField, odooRefField, uuidField } from '@/fields/common'

import { companyField, companyHook, pickerSameCompany, requireCompanyWhenAmbiguous } from '@/fields/company'

/**
 * QA-MC4-14: a NEWLY set face reference photo must be a selfie of the employee's PT — one whose
 * `ownerCompany` (DB-derived from its attendance, QA-MC4-07) is that PT, or a not yet linked upload of
 * the caller (the admin panel uploads the photo first). Another PT's selfie, someone else's unlinked
 * upload and a missing id get the same 400 (no existence oracle). System writes (no user) are trusted.
 */
const faceRefSamePt: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  const d = data as { faceRefPhoto?: unknown; company?: unknown }
  if (!req.user || !('faceRefPhoto' in d)) return data
  const id = relId(d.faceRefPhoto)
  if (id === undefined || id === relId((originalDoc as { faceRefPhoto?: unknown } | undefined)?.faceRefPhoto)) return data
  const company = relId(d.company) ?? relId((originalDoc as { company?: unknown } | undefined)?.company)
  const m = (await req.payload.findByID({ collection: 'media-selfies', id, depth: 0, overrideAccess: true /* SYSTEM-READ: PT + uploader of the photo being linked */, req, disableErrors: true })) as {
    ownerCompany?: unknown
    uploadedBy?: unknown
  } | null
  const owner = relId(m?.ownerCompany)
  const ok = !!m && (owner !== undefined ? owner === company : relId(m.uploadedBy) === userId(req))
  if (!ok) throw new ValidationError({ collection: 'employees', errors: [{ path: 'faceRefPhoto', message: 'Foto wajah tidak ditemukan (harus selfie PT karyawan ini atau unggahan Anda sendiri).' }], req })
  return data
}

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
    hooks: {
      // MC2-4: a field error next to the PT picker (collection beforeChange hooks run before field
      // validation in Payload 3, so the company hook's generic 400 would win otherwise)
      beforeValidate: [
        ({ data, operation, req }) => {
          const msg = requireCompanyWhenAmbiguous(data?.company, { operation, req })
          if (msg !== true) throw new ValidationError({ collection: 'employees', errors: [{ path: 'company', message: msg }], req })
          return data
        },
      ],
      beforeChange: [companyHook('employees', { check: [{ field: 'workSchedule', collection: 'work-schedules' }] }), faceRefSamePt],
    },
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
