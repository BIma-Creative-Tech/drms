import { type CollectionBeforeChangeHook, type CollectionConfig } from 'payload'
import { relationship } from 'payload/shared'

import { denyAll, hasRole, hasRoleAny, ownEmployees, relId, userId, type Role } from '@/access/roles'
import { byRole, rolesAllowed, anyMember } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, codeField, odooRefField, uuidField } from '@/fields/common'

import { companyField, companyHook, pickerSameCompany, requireCompanyWhenAmbiguous, siteOptions } from '@/fields/company'
import { validationError } from '@/lib/validation'
import { ATTENDANCE_TYPE_LABEL, ATTENDANCE_TYPES, DEFAULT_ATTENDANCE_TYPE } from '@/domain/attendance/area'
import { adminCreatePrefill, applyUserAccount, readUserAccount, USER_ACCOUNT, userAccountOptions, userAccountReadAccess, validateUserAccount } from '@/domain/employee-user-link'

/**
 * QA-MC4-14: a NEWLY set face reference photo must be a selfie of the employee's PT — one whose
 * `ownerCompany` (DB-derived from its attendance, QA-MC4-07) is that PT, or a not yet linked upload of
 * the caller (the admin panel uploads the photo first). Another PT's selfie, someone else's unlinked
 * upload and a missing id get the same 400 (no existence oracle). System writes (no user) are trusted.
 */
/** Roles that read an employee's phone number (No. HP). */
const PHONE_READERS: Role[] = ['pk-admin', 'pk-owner', 'pk-finance', 'pk-pm']

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
  if (!ok) throw validationError(req, { collection: 'employees' }, [{ path: 'faceRefPhoto', message: 'Foto wajah tidak ditemukan (harus selfie PT karyawan ini atau unggahan Anda sendiri).' }])
  return data
}

/**
 * Karyawan / staff, one row per PT (ADR 0016 D1). An employee without a user account can still be a
 * requester ("Diajukan Oleh"); the user ↔ employee link of a PT lives on `company-memberships` and is
 * edited here through the virtual "Akun pengguna" (domain/employee-user-link.ts). Everyone with a role can list employees (requester/team pickers); phone numbers only
 * for Admin/Owner/Finance/PM and the employee themself. Admin C/R/U, Owner R/U.
 */
export const Employees: CollectionConfig = withAudit(
  {
    slug: 'employees',
    labels: { singular: 'Karyawan', plural: 'Karyawan' },
    admin: { useAsTitle: 'name', group: 'Pengguna & Akses', defaultColumns: ['code', 'name', 'position', 'attendanceType', 'homeSite', 'active'], listSearchableFields: ['code', 'name', 'nickname'] },
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
          if (msg !== true) throw validationError(req, { collection: 'employees' }, [{ path: 'company', message: msg }])
          return data
        },
      ],
      // validateUserAccount after the company hook (needs the resolved PT); errors land on the field
      beforeChange: [companyHook('employees', { check: [{ field: 'workSchedule', collection: 'work-schedules' }, { field: 'homeSite', collection: 'sites' }] }), faceRefSamePt, validateUserAccount],
      // same req = same transaction as the employee write (create: the id exists now)
      afterChange: [applyUserAccount],
    },
    fields: [
      {
        ...companyField(),
        // MC2-4 (D1): one employee record = one PT; required on create when several PTs are selected
        validate: (value: unknown, opts: Parameters<typeof relationship>[1]) => {
          const own = requireCompanyWhenAmbiguous(value, opts as never)
          return own === true ? relationship(value as never, opts) : own
        },
        // "Buat karyawan" on the user form opens /admin/collections/employees/create?company=<PT>&user=<id>
        defaultValue: ({ req }: { req: Parameters<typeof adminCreatePrefill>[0] }) => adminCreatePrefill(req, 'employees', 'company'),
        admin: { description: 'PT tempat karyawan ini bekerja (1 data karyawan = 1 PT; orang yang bekerja di 2 PT punya 2 data karyawan). Tidak dapat diubah setelah dibuat.' },
      },
      codeField('Kode', 32, { perCompany: true }),
      { name: 'name', type: 'text', label: 'Nama lengkap', required: true, maxLength: 128 },
      { name: 'nickname', type: 'text', label: 'Nama panggilan', maxLength: 64 },
      { name: 'position', type: 'text', label: 'Jabatan', maxLength: 128 },
      // Owner decision 2026-10-10: the login account of this employee in this PT, shown and edited on the
      // employee form. VIRTUAL — stored only as company-memberships.employee (read/write: domain/employee-user-link.ts).
      {
        name: USER_ACCOUNT,
        type: 'relationship',
        relationTo: 'users',
        label: 'Akun pengguna',
        virtual: true,
        defaultValue: ({ req }: { req: Parameters<typeof adminCreatePrefill>[0] }) => adminCreatePrefill(req, 'employees', 'user'),
        filterOptions: userAccountOptions,
        access: { read: userAccountReadAccess },
        // a duplicated employee starts without an account (1 account = 1 employee per PT)
        hooks: { afterRead: [readUserAccount], beforeDuplicate: [() => null] },
        admin: {
          readOnly: false, // Payload makes `virtual` fields readOnly by default (sanitize.js)
          allowCreate: false, // accounts are created in Pengguna (Keycloak sync), access in Akses PT
          disableBulkEdit: true,
          disableListColumn: true,
          disableListFilter: true,
          description:
            'Akun yang login sebagai karyawan ini di PT ini (diperlukan untuk absensi di APK/web). Hanya akun yang sudah punya akses di PT ini (menu Akses PT); 1 akun hanya untuk 1 karyawan per PT. Kosongkan untuk melepas tautan.',
        },
      },
      {
        name: 'phone',
        type: 'text',
        label: 'No. HP',
        maxLength: 32,
        access: {
          // office roles / PM of the employee's PT, or the employee themself (ADR 0016 §5). QA-31: the
          // create form has no document yet → the office roles in any selected PT (the company hook
          // still checks the create role in the resolved PT).
          read: ({ req, doc }) => {
            const d = doc as { id?: unknown; company?: unknown } | undefined
            if (d?.id === undefined) return hasRoleAny(req, ...PHONE_READERS) // no document yet (create form / permission probe)
            return hasRole(req, PHONE_READERS, relId(d.company)) || ownEmployees(req).includes(relId(d.id) ?? -1)
          },
        },
      },
      // E6: jadwal kerja karyawan (kosong = jadwal default di Setting perusahaan).
      { name: 'workSchedule', type: 'relationship', relationTo: 'work-schedules', label: 'Jadwal kerja', ...pickerSameCompany(), admin: { description: 'Kosong = jadwal default site penempatan, lalu jadwal default perusahaan.' } },
      // ADR 0023 (Q-S5): "Site penempatan" — the branch office where the employee is stationed: may check in there
      // without a team assignment; its default work schedule applies when the employee has none; report filter.
      {
        name: 'homeSite',
        type: 'relationship',
        relationTo: 'sites',
        label: 'Site penempatan',
        index: true,
        ...pickerSameCompany(),
        filterOptions: siteOptions,
        admin: { placeholder: 'Pilih site…', description: 'Kantor cabang tempat karyawan ditempatkan (opsional): boleh absen di site ini tanpa penugasan tim.' },
      },
      // DRMS 13/10 A2 (ADR 0023 amendment 2026-10-13): where the employee may check in — OnSite: any registered location
      // of the PT with a point (site, project, cost center; no assignment needed); Non-OnSite: head office + branch
      // offices (sites) only. Default OnSite (= no check-in that worked before is refused). Rule: domain/attendance/area.ts.
      {
        name: 'attendanceType',
        type: 'select',
        label: 'Tipe absensi',
        required: true,
        defaultValue: DEFAULT_ATTENDANCE_TYPE,
        options: ATTENDANCE_TYPES.map((value) => ({ value, label: ATTENDANCE_TYPE_LABEL[value] })),
        admin: {
          description:
            'Karyawan OnSite: boleh absen di semua lokasi terdaftar PT yang punya titik (site, kantor pusat, project, pusat biaya) tanpa penugasan. Karyawan Non-OnSite (staf kantor): hanya di kantor pusat dan kantor cabang (site).',
        },
      },
      { name: 'faceRefPhoto', type: 'upload', relationTo: 'media-selfies', label: 'Foto wajah referensi' },
      odooRefField('odooEmployeeRef', 'Ref. karyawan Odoo'),
      activeField(),
      uuidField(),
    ],
  },
  { docType: 'employee', reasonRules: [reasonOnDeactivate] },
)
