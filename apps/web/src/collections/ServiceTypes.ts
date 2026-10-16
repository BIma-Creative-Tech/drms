import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { denyAll, relId } from '@/access/roles'
import { anyMember, byRole, rolesAllowed } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, codeField, uuidField } from '@/fields/common'
import { companyField, companyHook } from '@/fields/company'

/**
 * FR1 "Jenis servis" master per PT (DRMS owner 2026-10-17, ADR 0020 amendment 2026-10-17): the service report picks
 * ONE OR MORE of these (`service-reports.serviceTypes`, web form / edit / correction, REST `serviceTypeIds`, sync
 * `service_type_ids`). Seeded per PT with the four legacy types (code = the 0.13 enum value `servis_berkala` /
 * `perbaikan` / `inspeksi` / `pemasangan`: migration 20261017_100000_d1710_service_types for existing PTs,
 * `ensureDefaultServiceTypes` for a new one) — the code is how APK 0.7.0 (single `service_type`) still finds the row,
 * so it is fixed once created (field access + DB `service_types_protect`). Pickers / GET /api/v1/service-types sort by
 * `sortOrder` (Urutan) then name; the four seeded types get 1–4 (their former order), a type created without an Urutan
 * the PT's highest + 1 (`nextSortOrder`, coordinator decision 2026-10-17). Managed by Admin +
 * Direktur (Owner implies Direktur), read by every member; never hard-deleted — "Hapus" (ADR 0030 soft delete) only
 * while no report uses the type (FK usage check), otherwise "Nonaktifkan" with a reason: an inactive type stays on old
 * reports and is no longer offered for new selections.
 */
/**
 * Create without an Urutan → the highest `sortOrder` of the PT + 1 (a new type lands after the existing ones; seeded
 * rows and an explicit value — also 0 — are kept). Runs after `companyHook` (the PT is resolved there).
 */
export const nextSortOrder: CollectionBeforeChangeHook = async ({ data, operation, req }) => {
  const d = data as { company?: unknown; sortOrder?: unknown }
  if (operation !== 'create' || (typeof d.sortOrder === 'number' && Number.isFinite(d.sortOrder))) return data
  const company = relId(d.company)
  if (company === undefined) return data
  const r = await req.payload.find({
    collection: 'service-types',
    where: { and: [{ company: { equals: company } }, { sortOrder: { exists: true } }] },
    sort: '-sortOrder',
    limit: 1,
    depth: 0,
    pagination: false,
    select: { sortOrder: true } as never,
    overrideAccess: true, // SYSTEM-READ: highest Urutan of the PT the caller creates in (no row data returned)
    req,
  })
  const max = Number((r.docs[0] as { sortOrder?: unknown } | undefined)?.sortOrder ?? 0) || 0
  d.sortOrder = Math.min(9999, Math.trunc(max) + 1)
  return data
}

export const ServiceTypes: CollectionConfig = withAudit(
  {
    slug: 'service-types',
    labels: { singular: 'Jenis servis', plural: 'Jenis servis' },
    admin: {
      useAsTitle: 'name',
      group: 'Master Data',
      defaultColumns: ['code', 'name', 'sortOrder', 'active'],
      description: 'Pilihan "Jenis servis" pada Laporan servis unit (boleh lebih dari satu per laporan). Kode tidak dapat diubah setelah dibuat.',
    },
    defaultSort: 'sortOrder',
    access: {
      read: anyMember,
      create: rolesAllowed('pk-admin', 'pk-owner'),
      update: byRole({ 'pk-admin': true, 'pk-owner': true }),
      delete: denyAll,
    },
    hooks: { beforeChange: [companyHook('service-types'), nextSortOrder] },
    fields: [
      companyField(),
      { ...codeField('Kode', 32, { perCompany: true }), access: { update: () => false }, admin: { description: 'Huruf, angka, titik, garis bawah, garis miring atau minus. Tetap setelah disimpan (dipakai aplikasi Android).' } },
      { name: 'name', type: 'text', label: 'Nama', required: true, maxLength: 120 },
      {
        name: 'sortOrder',
        type: 'number',
        label: 'Urutan',
        min: 0,
        max: 9999,
        validate: (v: unknown) => (v === null || v === undefined || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 9999) ? true : 'Urutan: bilangan bulat 0–9999.'),
        admin: { description: 'Urutan tampil di pilihan (kecil dulu, lalu nama). Kosong saat dibuat = setelah yang terakhir.' },
      },
      activeField(),
      uuidField(),
    ],
  },
  { docType: 'service_type', reasonRules: [reasonOnDeactivate] },
)
