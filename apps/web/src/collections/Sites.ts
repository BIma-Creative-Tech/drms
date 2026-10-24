import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { denyAll, relId } from '@/access/roles'
import { byRole } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, codeField, uuidField } from '@/fields/common'
import { andCompany, companyField, companyHook, lockedUntilCompany, pickerSameCompany } from '@/fields/company'
import { validationError } from '@/lib/validation'

/**
 * DRMS 13/10 A2: at most ONE head office ("Kantor pusat") per PT — a field error here, the partial unique index
 * `sites_one_head_office_per_company` (migration 20261013_620100_d1310_onsite_guard) in the DB.
 */
const oneHeadOfficePerPt: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  const d = data as { isHeadOffice?: boolean | null; company?: unknown }
  const prev = originalDoc as { id?: number; isHeadOffice?: boolean | null; company?: unknown } | undefined
  const flagged = d.isHeadOffice ?? prev?.isHeadOffice
  if (flagged !== true) return data
  const company = relId(d.company) ?? relId(prev?.company)
  if (company === undefined) return data
  const res = await req.payload.find({
    collection: 'sites',
    where: { and: [{ company: { equals: company } }, { isHeadOffice: { equals: true } }, ...(prev?.id !== undefined ? [{ id: { not_equals: prev.id } }] : [])] },
    depth: 0,
    limit: 1,
    select: { code: true, name: true } as never,
    overrideAccess: true, // SYSTEM-READ: the head office of the same PT (the caller edits a site of that PT)
    req,
  })
  const other = res.docs[0] as { code?: string; name?: string } | undefined
  if (other) {
    throw validationError(req, { collection: 'sites' }, [
      { path: 'isHeadOffice', message: `PT ini sudah punya kantor pusat: ${other.code ?? ''} ${other.name ?? ''}. Hapus tanda kantor pusat di site itu dulu (1 kantor pusat per PT).`.replace(/\s+/g, ' ') },
    ])
  }
  return data
}

/**
 * ADR 0023 (owner 2026-10-11): Site = kantor cabang of the PT (same legal entity, same numbering, approvals
 * and access per PT). One site handles several projects; a project belongs to at most one site. Per-PT master:
 * Admin C/R/U, Direktur R/U, every member of the PT R (it carries no money; APK attendance location list).
 * Optional geofence (same fields as projects / cost centers; empty radius → PT default), default work schedule
 * (schedule resolution employee → home site → PT) and default cost center (operational, transfer default of the
 * site's projects without their own). No delete: deactivate (history keeps it).
 * DRMS 13/10 A2 (ADR 0023 amendment 2026-10-13): `isHeadOffice` "Kantor pusat" marks the PT's head office (at most
 * one per PT); Non-OnSite employees check in at the head office and the branch offices only.
 * ADR 0032 (DRMS 24/10, user decision): sites are REMOVED from the product — the collection stays (history, rollback,
 * old APKs) but is hidden from the admin navigation and from every form, list, filter and attendance location; no
 * new site is created or linked. Projects carry the attendance points (`projects.lat/lng/radiusM`).
 */
export const Sites: CollectionConfig = withAudit(
  {
    slug: 'sites',
    labels: { singular: 'Site (kantor cabang)', plural: 'Site' },
    admin: {
      useAsTitle: 'name',
      group: 'Master Data',
      // ADR 0032: removed from the product (no menu, no form); the table and its history stay
      hidden: true,
      defaultColumns: ['code', 'name', 'isHeadOffice', 'address', 'costCenter', 'active'],
      description:
        'Kantor pusat dan kantor cabang PT (mis. Cabang Balikpapan). Satu site menangani beberapa project; absensi di kantor memakai titik + radius site. Tandai satu site sebagai Kantor pusat.',
    },
    access: {
      read: byRole({ 'pk-admin': true, 'pk-owner': true, 'pk-finance': true, 'pk-pm': true, 'pk-staff': true, 'pk-operator': true }),
      // ADR 0032: no new site (the master is no longer part of the product)
      create: denyAll,
      update: byRole({ 'pk-admin': true, 'pk-owner': true }),
      delete: denyAll,
    },
    hooks: {
      beforeChange: [
        companyHook('sites', {
          check: [
            { field: 'defaultWorkSchedule', collection: 'work-schedules' },
            { field: 'costCenter', collection: 'cost-centers' },
          ],
        }),
        oneHeadOfficePerPt,
      ],
    },
    fields: [
      companyField(),
      codeField('Kode', 32, { perCompany: true }),
      { name: 'name', type: 'text', label: 'Nama site', required: true, maxLength: 128 },
      {
        name: 'isHeadOffice',
        type: 'checkbox',
        label: 'Kantor pusat',
        defaultValue: false,
        admin: {
          description:
            'Centang untuk kantor pusat PT (maksimal 1 per PT). Karyawan Non-OnSite hanya boleh absen di kantor pusat dan kantor cabang; isi titik + radius agar absensi bisa dipakai.',
        },
      },
      { name: 'address', type: 'textarea', label: 'Alamat', maxLength: 500 },
      {
        type: 'row',
        fields: [
          { name: 'lat', type: 'number', label: 'Latitude', min: -90, max: 90 },
          { name: 'lng', type: 'number', label: 'Longitude', min: -180, max: 180 },
          {
            name: 'radiusM',
            type: 'number',
            label: 'Radius geofence (m)',
            min: 10,
            max: 5000,
            admin: { description: 'Kosong = radius default perusahaan (Setting perusahaan). Tanpa titik = absensi di site ini belum bisa.' },
          },
        ],
      },
      lockedUntilCompany({
        name: 'defaultWorkSchedule',
        type: 'relationship',
        relationTo: 'work-schedules',
        label: 'Jadwal kerja default',
        ...pickerSameCompany(),
        admin: { placeholder: 'Pilih jadwal kerja…', description: 'Untuk karyawan dengan site penempatan ini yang tidak punya jadwal sendiri. Kosong = jadwal default perusahaan.' },
      }),
      lockedUntilCompany({
        name: 'costCenter',
        type: 'relationship',
        relationTo: 'cost-centers',
        label: 'Pusat biaya default',
        index: true,
        ...pickerSameCompany(),
        filterOptions: andCompany({ type: { equals: 'operational' } }),
        admin: { placeholder: 'Pilih pusat biaya…', description: 'Pusat biaya operasional kantor cabang; diusulkan ke Finance untuk project site ini yang belum punya pusat biaya.' },
      }),
      activeField(),
      uuidField(),
    ],
  },
  { docType: 'site', reasonRules: [reasonOnDeactivate] },
)
