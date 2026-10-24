import { APIError, type CollectionBeforeChangeHook, type CollectionConfig } from 'payload'

import { readOnlyFieldsGuard } from '@/access/field-guard'
import { PROJECT_TABS } from '@/admin/config'
import { creatableRelationship } from '@/admin/relationship-create'
import { moneyRead } from '@/access/money'
import { denyAll, hasRole } from '@/access/roles'
import { assignedProjects, byRole, fieldRoles, rolesAllowed } from '@/access/policies'
import { inIds } from '@/access/scope'
import { reasonOnChange, withAudit } from '@/audit/hooks'
import { PROJECT_KIND_LABELS, PROJECT_KINDS } from '@/domain/field/rules'
import { projectFromClientDefault } from '@/domain/partners/project-prefill'
import { progressWriteGuard } from '@/domain/progress/guards'
import { codeField, odooRefField, percentField, rupiahField, uuidField } from '@/fields/common'
import { companyField, companyHook, lockedUntilCompany, legacySiteField, pickerSameCompany } from '@/fields/company'
import { pusatBiayaField } from '@/fields/pusat-biaya'
import { USER_NAME_VIEW, userPicker } from '@/fields/users'

export const PROJECT_STATUSES = [
  { label: 'Perencanaan', value: 'perencanaan' },
  { label: 'Berjalan', value: 'berjalan' },
  { label: 'Ditunda', value: 'ditunda' },
  { label: 'Selesai', value: 'selesai' },
  { label: 'Arsip', value: 'arsip' },
  // D1610 (ADR 0030): set ONLY by "Batalkan proyek" (domain/projects/cancel.ts: reason, cascade); terminal
  { label: 'Dibatalkan', value: 'dibatalkan' },
] as const

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]['value']

/** D1610: `dibatalkan` only through the cancel action, and never left again (the cascade cannot be undone). */
const cancelStatusGuard: CollectionBeforeChangeHook = ({ data, originalDoc, operation }) => {
  const next = data.status
  if (next === undefined) return data
  const prev = operation === 'update' ? originalDoc?.status : undefined
  if (next === 'dibatalkan' && prev !== 'dibatalkan') {
    throw new APIError('Status "Dibatalkan" hanya lewat aksi "Batalkan proyek" (dengan alasan; pengajuan yang masih berjalan ikut dibatalkan).', 409, { errors: [{ path: 'status', message: 'Gunakan aksi Batalkan proyek.' }] }, true)
  }
  if (prev === 'dibatalkan' && next !== 'dibatalkan') {
    throw new APIError('Project yang sudah dibatalkan tidak dapat diaktifkan kembali.', 409, { errors: [{ path: 'status', message: 'Project sudah dibatalkan.' }] }, true)
  }
  return data
}

/** Owner decision 2026-10-09: reverses QA-20(b) — PM and Admin gain the same project write rights as
 * Direktur (additive, Direktur keeps them too). */
const PROJECT_EDITOR_ROLES = ['pk-owner', 'pk-admin', 'pk-pm'] as const
const projectEditors = fieldRoles(...PROJECT_EDITOR_ROLES)

/** FR1 (ADR 0020 §1): the project kind is set by the Direktur or the Admin of the project's PT. */
const kindEditors = fieldRoles('pk-owner', 'pk-admin')

export const PROJECT_PM_REQUIRED = 'Project Manager wajib diisi'
export const PROJECT_PB_REQUIRED = 'Pusat biaya (akun kas) wajib dipilih'

/**
 * ADR 0031 (DRMS 21/10 #2): the Pusat Biaya (a cash account of the PT) is mapped when the project is created, so the
 * requester never picks one. Required on a USER create (admin form, REST); on an update only CLEARING a stored one is
 * refused — Payload validates the merged row, so a legacy project without a mapping stays editable (progress
 * recalculation, address …); it is listed on the dashboard and its transfers are refused until mapped. System writes
 * (seed, import, jobs — no user) are never refused here.
 */
export function projectCashAccountValidate(value: unknown, { operation, req, previousValue }: { operation?: string; req?: { user?: unknown }; previousValue?: unknown }): true | string {
  const empty = (v: unknown) => v === null || v === undefined || v === ''
  if (!empty(value) || !req?.user) return true
  if (operation === 'update' && empty(previousValue)) return true
  return PROJECT_PB_REQUIRED
}

/**
 * DRMS 10/10 #5: the PM of a project is mandatory — on create (admin form, REST, Local API: seed,
 * import, tests) and whenever a write SENDS `pm` (the admin form always does), so clearing it is refused
 * too. An update that does not touch `pm` (`undefined` = not in the request, e.g. the progress
 * recalculation writing `progressPct`) stays valid on a legacy row without a PM; the dashboard tile
 * "Project tanpa PM" lists those rows until someone fills them in.
 */
export function projectPmValidate(value: unknown, { operation }: { operation?: string }): true | string {
  if (value !== null && value !== undefined && value !== '') return true
  if (value === undefined && operation === 'update') return true
  return PROJECT_PM_REQUIRED
}

/**
 * FR1: a kind change is refused once the project has field reports, contract units or RAP items (409).
 */
const kindChangeGuard: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  if (operation !== 'update' || !originalDoc || data.kind === undefined || data.kind === originalDoc.kind) return data
  for (const collection of ['contract-units', 'service-reports', 'unit-timesheets', 'aftersales-activities'] as const) {
    const r = await req.payload.find({ collection, where: { project: { equals: originalDoc.id } }, limit: 1, depth: 0, pagination: false, select: { project: true } as never, overrideAccess: true /* SYSTEM-READ: does the project have field data? */, req })
    if (r.docs.length > 0) throw new APIError('Jenis project tidak dapat diubah: project ini sudah punya laporan lapangan atau unit kontrak.', 409, { errors: [{ path: 'kind', message: 'Sudah ada data lapangan.' }] }, true)
  }
  // P3 / DRMS 10/10 D4: RAP items (any kind now) also freeze the kind (DB trigger pk_project_kind_guard) — clear message
  const rap = await req.payload.find({ collection: 'rap-items', where: { project: { equals: originalDoc.id } }, limit: 1, depth: 0, pagination: false, select: { project: true } as never, overrideAccess: true /* SYSTEM-READ: does the project have a RAP? */, req })
  if (rap.docs.length > 0) throw new APIError('Jenis project tidak dapat diubah: project ini sudah punya RAP.', 409, { errors: [{ path: 'kind', message: 'Sudah ada RAP.' }] }, true)
  return data
}

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
    // DRMS 10/10 point 7: tabs Proyek (form) / RAP / Pengajuan (admin/config.ts PROJECT_TABS)
    admin: { useAsTitle: 'name', group: 'Proyek', defaultColumns: ['code', 'name', 'client', 'pm', 'cashAccount', 'status'], components: { views: { edit: PROJECT_TABS } } },
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
      beforeChange: [companyHook('projects', { check: [{ field: 'client', collection: 'clients' }, { field: 'pm', collection: 'users', member: true }, { field: 'costCenter', collection: 'cost-centers' }, { field: 'cashAccount', collection: 'cash-accounts' }, { field: 'site', collection: 'sites' }] }), kindChangeGuard, cancelStatusGuard],
      beforeOperation: [progressWriteGuard('projects'), readOnlyFieldsGuard('projects', (req, company) => hasRole(req, PROJECT_EDITOR_ROLES, company), 'Direktur, Admin, atau PM')],
    },
    fields: [
      // DRMS 10/10 #5: link to the custom project page (tahapan/progress); no DB column, no API value
      { name: 'detailLink', type: 'ui', admin: { position: 'sidebar', components: { Field: '@/admin/components/ProjectDetailLink#ProjectDetailLink' } } },
      // DRMS 16/10: "+ Proyek baru" of the Klien page (?client=<id>) starts with the client's PT and the client
      { ...companyField(), defaultValue: projectFromClientDefault('company') },
      { ...codeField('Kode', 32, { perCompany: true }), access: { update: projectEditors } },
      { name: 'name', type: 'text', label: 'Nama project', required: true, maxLength: 160 },
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
      // DRMS 16/10 (b): "+ Klien baru" opens the tabbed Klien form in a drawer, in the project's PT
      creatableRelationship({ name: 'client', type: 'relationship', relationTo: 'clients', label: 'Klien', access: { update: projectEditors }, defaultValue: projectFromClientDefault('client'), ...pickerSameCompany() }, { company: 'form' }),
      // ADR 0032: the project's site (ADR 0023) removed from the product — hidden legacy column (the 24/10 migration
      // used it to turn site team assignments into project assignments)
      legacySiteField('site', 'Site (lama)'),
      { name: 'address', type: 'textarea', label: 'Alamat', maxLength: 500 },
      {
        type: 'row',
        fields: [
          { name: 'lat', type: 'number', label: 'Latitude', min: -90, max: 90 },
          { name: 'lng', type: 'number', label: 'Longitude', min: -180, max: 180 },
          { name: 'radiusM', type: 'number', label: 'Radius geofence (m)', min: 10, max: 5000, admin: { description: 'Kosong = radius default perusahaan (Setting perusahaan).' } },
        ],
      },
      // QA-16: only active PMs of the project's PT, shown by name (users.displayName).
      // DRMS 10/10 #5: mandatory (projectPmValidate; DB NOT NULL via migration 20261012_100000_d1010_project_pm when no legacy row lacks a PM)
      {
        name: 'pm',
        type: 'relationship',
        relationTo: 'users',
        label: 'Project Manager',
        required: true,
        index: true,
        access: { update: projectEditors },
        ...userPicker({ roles: ['pk-pm'] }),
        validate: projectPmValidate,
      },
      // ADR 0031 (DRMS 21/10): the project's Pusat Biaya = a cash account of its PT. Finance pays from it by default; a
      // payment from another account creates an inter-project loan with its KK / KM (domain/loans/cash.ts).
      pusatBiayaField({
        name: 'cashAccount',
        access: { update: projectEditors },
        validate: projectCashAccountValidate,
        admin: { description: 'Akun kas/bank PT yang membiayai project ini. Pengajuan project memakai pusat biaya ini; bila Finance membayar dari akun lain, tercatat pinjaman antar project otomatis.' },
      }),
      // D2 (DRMS 10/10) legacy: the former cost-center master (ADR 0031 retired it) — kept read-only for old projects
      lockedUntilCompany({ name: 'costCenter', type: 'relationship', relationTo: 'cost-centers', label: 'Pusat biaya lama', index: true, access: { create: () => false, update: () => false }, ...pickerSameCompany(), admin: { readOnly: true, condition: (d) => Boolean(d?.costCenter), description: 'Master pusat biaya lama (sebelum 21/10/2026); tidak dipakai lagi.' } }),
      // RAB = contract value: money roles of the project's PT only (owner 2026-10-11: hidden from Staff on web, API and
      // APK; Operator/Anggota reads its assigned project for the attendance location only) — access/money.ts
      { ...rupiahField('budget', 'RAB (Rp)'), access: { read: moneyRead('projects'), update: projectEditors } },
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
        // D1610: "Dibatalkan" is not offered in the form (only the cancel action sets it); a cancelled project shows it
        filterOptions: ({ options, data }) => (data?.status === 'dibatalkan' ? options : options.filter((o) => (typeof o === 'string' ? o : o.value) !== 'dibatalkan')),
        index: true,
        access: { update: projectEditors },
      },
      // D1610 (ADR 0030): "Batalkan proyek" — reason / when / who (system fields, written by domain/projects/cancel.ts)
      { name: 'cancelReason', type: 'text', label: 'Alasan pembatalan', maxLength: 1000, access: { create: () => false, update: () => false }, admin: { readOnly: true, condition: (d) => d?.status === 'dibatalkan' } },
      { name: 'cancelledAt', type: 'date', label: 'Dibatalkan pada', access: { create: () => false, update: () => false }, admin: { readOnly: true, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' }, condition: (d) => d?.status === 'dibatalkan' } },
      { name: 'cancelledBy', type: 'relationship', relationTo: 'users', label: 'Dibatalkan oleh', access: { create: () => false, update: () => false }, admin: { readOnly: true, position: 'sidebar', condition: (d) => d?.status === 'dibatalkan', components: USER_NAME_VIEW } },
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
