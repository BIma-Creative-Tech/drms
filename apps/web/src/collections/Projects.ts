import type { CollectionConfig } from 'payload'

import { readOnlyFieldsGuard } from '@/access/field-guard'
import { denyAll, hasRole } from '@/access/roles'
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

const ownerOnly = fieldRoles('pk-owner')

/**
 * Project (requirements v1.1 §4 "Project & tahapan"): Staff R assigned, PM R team,
 * Finance R, Owner C/R/U/archive, Admin R. No delete (US-29: archive only).
 * QA-20(b) (owner decision 2026-10-08): the PM is READ-ONLY on projects — only the Direktur of the
 * project's PT changes them (RAB changes go through addenda, T12; progress through progress reports
 * and the stage editor). A PM/Finance/Admin PATCH that changes a field → 403 naming the fields
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
      }),
      create: rolesAllowed('pk-owner'),
      update: byRole({ 'pk-owner': true }),
      delete: denyAll,
    },
    hooks: { beforeChange: [companyHook('projects', { check: [{ field: 'client', collection: 'clients' }, { field: 'pm', collection: 'users', member: true }] })], beforeOperation: [progressWriteGuard('projects'), readOnlyFieldsGuard('projects', (req, company) => hasRole(req, 'pk-owner', company), 'Direktur')] },
    fields: [
      companyField(),
      { ...codeField('Kode', 32, { perCompany: true }), access: { update: ownerOnly } },
      { name: 'name', type: 'text', label: 'Nama project', required: true, maxLength: 160 },
      { name: 'client', type: 'relationship', relationTo: 'clients', label: 'Klien', access: { update: ownerOnly } },
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
      { name: 'pm', type: 'relationship', relationTo: 'users', label: 'Project Manager', index: true, access: { update: ownerOnly }, ...userPicker({ roles: ['pk-pm'] }) },
      { ...rupiahField('budget', 'RAB (Rp)'), access: { update: ownerOnly } },
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
        access: { update: ownerOnly },
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
