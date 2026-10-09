import type { CollectionConfig } from 'payload'

import { APIError, type CollectionBeforeChangeHook, type CollectionBeforeOperationHook } from 'payload'

import { changedFields, readOnlyFieldsGuard } from '@/access/field-guard'
import { denyAll, hasRole, relId } from '@/access/roles'
import { assignedProjects, byRole, fieldRoles, rolesAllowed } from '@/access/policies'
import { inIds } from '@/access/scope'
import { reasonOnChange, withAudit } from '@/audit/hooks'
import { PROJECT_KIND_LABELS, PROJECT_KINDS } from '@/domain/field/rules'
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
/** FR1 (ADR 0020 §1): the project kind is set by the Direktur or the Admin of the project's PT. */
const kindEditors = fieldRoles('pk-owner', 'pk-admin')

/** Fields an Admin (not Direktur) may change on a project: only the kind (+ the virtual reason). */
const ADMIN_FIELDS = new Set(['kind', 'changeReason'])

/**
 * QA-20(b) + FR1: the Direktur changes projects; the Admin of the PT only the project KIND. An Admin
 * body that changes only `kind` passes; anything else gets the QA-20(b) 403 naming the fields.
 */
const projectFieldsGuard = (async (args: Parameters<CollectionBeforeOperationHook>[0]) => {
  const { operation, overrideAccess, req } = args
  const a = args.args as { id?: number | string; data?: Record<string, unknown> }
  if (operation === 'update' && !overrideAccess && req.user && a.id !== undefined && a.data && typeof a.data === 'object') {
    const current = (await req.payload.findByID({ collection: 'projects', id: a.id, depth: 0, overrideAccess: true /* SYSTEM-READ: diff of the request body */, req, disableErrors: true })) as Record<string, unknown> | null
    const company = relId(current?.company)
    if (current && !hasRole(req, 'pk-owner', company) && hasRole(req, 'pk-admin', company)) {
      const changed = changedFields(req.payload.collections.projects.config.flattenedFields, a.data, current)
      if (changed.every((f) => ADMIN_FIELDS.has(f.name))) return args.args
    }
  }
  return readOnlyFieldsGuard('projects', (r, c) => hasRole(r, 'pk-owner', c), 'Direktur')(args)
}) as CollectionBeforeOperationHook

/**
 * Defence in depth for bulk updates (no id → the guard above does not run): a caller without the
 * Direktur role in the project's PT changes nothing but `kind` (field access drops the rest).
 * A kind change is refused once the project has field reports or contract units (409).
 */
const kindChangeGuard: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  if (operation !== 'update' || !originalDoc || data.kind === undefined || data.kind === originalDoc.kind) return data
  for (const collection of ['contract-units', 'service-reports', 'unit-timesheets', 'aftersales-activities'] as const) {
    const r = await req.payload.find({ collection, where: { project: { equals: originalDoc.id } }, limit: 1, depth: 0, pagination: false, select: { project: true } as never, overrideAccess: true /* SYSTEM-READ: does the project have field data? */, req })
    if (r.docs.length > 0) throw new APIError('Jenis project tidak dapat diubah: project ini sudah punya laporan lapangan atau unit kontrak.', 409, { errors: [{ path: 'kind', message: 'Sudah ada data lapangan.' }] }, true)
  }
  return data
}

/**
 * Project (requirements v1.1 §4 "Project & tahapan"): Staff R assigned, PM R team,
 * Finance R, Owner C/R/U/archive, Admin R. No delete (US-29: archive only).
 * QA-20(b) (owner decision 2026-10-08): the PM is READ-ONLY on projects — only the Direktur of the
 * project's PT changes them (RAB changes go through addenda, T12; progress through progress reports
 * and the stage editor). A PM/Finance/Admin PATCH that changes a field → 403 naming the fields
 * (`readOnlyFieldsGuard`), never a silent 200. `progressPct` (E4) = Σ(weight × stage %) / 100, written
 * only by the progress recalculation (domain/progress/recalc.ts; guard + DB trigger pk_progress_guard).
 * FR1 (ADR 0020 §1): `kind` (umum | konstruksi | kontrak_unit | aftersales | trading) decides the field
 * reports; set by the Direktur or the Admin of the PT (the Admin changes nothing else), frozen once
 * the project has field data (hook + DB trigger of migration fr1_security).
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
      // FR1: the Admin may update — only the project kind (projectFieldsGuard + field access)
      update: byRole({ 'pk-owner': true, 'pk-admin': true }),
      delete: denyAll,
    },
    hooks: {
      beforeChange: [companyHook('projects', { check: [{ field: 'client', collection: 'clients' }, { field: 'pm', collection: 'users', member: true }] }), kindChangeGuard],
      beforeOperation: [progressWriteGuard('projects'), projectFieldsGuard],
    },
    fields: [
      companyField(),
      { ...codeField('Kode', 32, { perCompany: true }), access: { update: ownerOnly } },
      { name: 'name', type: 'text', label: 'Nama project', required: true, maxLength: 160, access: { update: ownerOnly } },
      {
        name: 'kind',
        type: 'select',
        label: 'Jenis project',
        // not `required` at the Payload level (typed creates without it stay valid); default + DB NOT NULL
        defaultValue: 'umum',
        index: true,
        options: PROJECT_KINDS.map((k) => ({ label: PROJECT_KIND_LABELS[k], value: k })),
        access: { update: kindEditors },
        admin: {
          position: 'sidebar',
          description: 'Menentukan laporan lapangan: kontrak unit → timesheet + servis; aftersales → servis + aktivitas. Umum/konstruksi/trading: belum ada laporan lapangan. Diubah oleh Direktur/Admin.',
        },
      },
      { name: 'client', type: 'relationship', relationTo: 'clients', label: 'Klien', access: { update: ownerOnly } },
      { name: 'address', type: 'textarea', label: 'Alamat', maxLength: 500, access: { update: ownerOnly } },
      {
        type: 'row',
        fields: [
          { name: 'lat', type: 'number', label: 'Latitude', min: -90, max: 90, access: { update: ownerOnly } },
          { name: 'lng', type: 'number', label: 'Longitude', min: -180, max: 180, access: { update: ownerOnly } },
          { name: 'radiusM', type: 'number', label: 'Radius geofence (m)', min: 10, max: 5000, access: { update: ownerOnly }, admin: { description: 'Kosong = radius default perusahaan (Setting perusahaan).' } },
        ],
      },
      // QA-16: only active PMs of the project's PT, shown by name (users.displayName)
      { name: 'pm', type: 'relationship', relationTo: 'users', label: 'Project Manager', index: true, access: { update: ownerOnly }, ...userPicker({ roles: ['pk-pm'] }) },
      { ...rupiahField('budget', 'RAB (Rp)'), access: { update: ownerOnly } },
      {
        type: 'row',
        fields: [
          { name: 'startDate', type: 'date', label: 'Tanggal mulai', access: { update: ownerOnly }, admin: { date: { pickerAppearance: 'dayOnly' } } },
          { name: 'targetDate', type: 'date', label: 'Target selesai', access: { update: ownerOnly }, admin: { date: { pickerAppearance: 'dayOnly' } } },
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
      { ...odooRefField('odooAnalyticRef', 'Ref. akun analitik Odoo'), access: { update: ownerOnly } },
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
