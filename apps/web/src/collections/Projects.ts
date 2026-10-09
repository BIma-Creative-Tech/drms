import type { CollectionConfig } from 'payload'

import { readOnlyFieldsGuard } from '@/access/field-guard'
import { denyAll, hasRole, isOperatorOnly } from '@/access/roles'
import { assignedProjects, byRole, fieldRoles, rolesAllowed } from '@/access/policies'
import { inIds } from '@/access/scope'
import { reasonOnChange, withAudit } from '@/audit/hooks'
import { progressWriteGuard } from '@/domain/progress/guards'
import { codeField, odooRefField, percentField, rupiahField, uuidField } from '@/fields/common'
import { companyField, companyHook } from '@/fields/company'
import { userPicker } from '@/fields/users'

export const PROJECT_STATUSES = [
  { label: 'Perencanaan', value: 'perencanaan' },
  { label: 'Berjalan', value: 'berjalan' },
  { label: 'Ditunda', value: 'ditunda' },
  { label: 'Selesai', value: 'selesai' },
  { label: 'Arsip', value: 'arsip' },
] as const

/** Owner decision 2026-10-09: reverses QA-20(b) — PM and Admin gain the same project write rights as
 * Direktur (additive, Direktur keeps them too). */
const PROJECT_EDITOR_ROLES = ['pk-owner', 'pk-admin', 'pk-pm'] as const
const projectEditors = fieldRoles(...PROJECT_EDITOR_ROLES)

/**
 * Project (requirements v1.1 §4 "Project & tahapan"): Staff R assigned, Finance R.
 * Owner decision 2026-10-09 (reverses QA-20(b)/2026-10-08 "PM read-only, only Direktur edits"): PM
 * and Admin now have the same C/R/U/archive rights as Direktur (`PROJECT_EDITOR_ROLES`); PM's write
 * scope stays limited to their own team's projects, same as their read scope. No delete (US-29:
 * archive only). A Finance/Staff PATCH that changes a field → 403 naming the fields
 * (`readOnlyFieldsGuard`), never a silent 200. `progressPct` (E4) = Σ(weight × stage %) / 100, written
 * only by the progress recalculation (domain/progress/recalc.ts; guard + DB trigger pk_progress_guard).
 */
export const Projects: CollectionConfig = withAudit(
  {
    slug: 'projects',
    labels: { singular: 'Project', plural: 'Project' },
    admin: { useAsTitle: 'name', group: 'Proyek', defaultColumns: ['code', 'name', 'client', 'pm', 'status'] },
    access: {
      read: byRole({
        'pk-admin': true,
        'pk-owner': true,
        'pk-finance': true,
        'pk-pm': async ({ scope }) => inIds('id', (await scope()).teamProjects),
        'pk-staff': assignedProjects('id'),
        // Operator/Anggota: its assigned projects only — the APK attendance location list (masters)
        'pk-operator': assignedProjects('id'),
      }),
      create: rolesAllowed(...PROJECT_EDITOR_ROLES),
      update: byRole({
        'pk-owner': true,
        'pk-admin': true,
        'pk-pm': async ({ scope }) => inIds('id', (await scope()).teamProjects),
      }),
      delete: denyAll,
    },
    hooks: {
      beforeChange: [companyHook('projects', { check: [{ field: 'client', collection: 'clients' }, { field: 'pm', collection: 'users', member: true }] })],
      beforeOperation: [progressWriteGuard('projects'), readOnlyFieldsGuard('projects', (req, company) => hasRole(req, PROJECT_EDITOR_ROLES, company), 'Direktur, Admin, atau PM')],
    },
    fields: [
      companyField(),
      { ...codeField('Kode', 32, { perCompany: true }), access: { update: projectEditors } },
      { name: 'name', type: 'text', label: 'Nama project', required: true, maxLength: 160 },
      { name: 'client', type: 'relationship', relationTo: 'clients', label: 'Klien', access: { update: projectEditors } },
      { name: 'address', type: 'textarea', label: 'Alamat', maxLength: 500 },
      {
        type: 'row',
        fields: [
          { name: 'lat', type: 'number', label: 'Latitude', min: -90, max: 90 },
          { name: 'lng', type: 'number', label: 'Longitude', min: -180, max: 180 },
          { name: 'radiusM', type: 'number', label: 'Radius geofence (m)', min: 10, max: 5000, admin: { description: 'Kosong = radius default perusahaan (Setting perusahaan).' } },
        ],
      },
      // QA-16: only active PMs of the project's PT, shown by name (users.displayName)
      { name: 'pm', type: 'relationship', relationTo: 'users', label: 'Project Manager', index: true, access: { update: projectEditors }, ...userPicker({ roles: ['pk-pm'] }) },
      // RAB hidden from Operator/Anggota (attendance-only role reads its assigned project for the location only)
      { ...rupiahField('budget', 'RAB (Rp)'), access: { read: ({ req }) => !isOperatorOnly(req.user), update: projectEditors } },
      {
        type: 'row',
        fields: [
          { name: 'startDate', type: 'date', label: 'Tanggal mulai', admin: { date: { pickerAppearance: 'dayOnly' } } },
          { name: 'targetDate', type: 'date', label: 'Target selesai', admin: { date: { pickerAppearance: 'dayOnly' } } },
        ],
      },
      {
        name: 'status',
        type: 'select',
        label: 'Status',
        required: true,
        defaultValue: 'perencanaan',
        options: [...PROJECT_STATUSES],
        index: true,
        access: { update: projectEditors },
      },
      {
        ...percentField('progressPct', 'Progress fisik (%)'),
        defaultValue: 0,
        access: { create: () => false, update: () => false },
        admin: { readOnly: true, position: 'sidebar', description: 'Dihitung dari bobot × progress tahapan (hanya lewat laporan progress).' },
      },
      odooRefField('odooAnalyticRef', 'Ref. akun analitik Odoo'),
      uuidField(),
    ],
  },
  {
    docType: 'project',
    reasonRules: [
      ({ operation, data, original }) =>
        operation === 'update' && data.status === 'arsip' && original?.status !== 'arsip' ? 'Alasan wajib diisi saat mengarsipkan project.' : false,
      reasonOnChange(['budget'], 'Alasan wajib diisi saat mengubah RAB.'),
    ],
  },
)
