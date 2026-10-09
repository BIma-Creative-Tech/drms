import type { CollectionBeforeChangeHook, CollectionConfig, PayloadRequest, Where } from 'payload'

import { denyAll, relId } from '@/access/roles'
import { byRole, rolesAllowed, anyMember } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, odooRefField, uuidField } from '@/fields/common'
import { normalizeUnitCode, UNIT_STATUS_LABELS, UNIT_STATUSES, unitErrors } from '@/domain/field/rules'
import { formatPlate, normalizePlate, PLATE_RE } from '@/domain/plates'
import { companyField, companyHook } from '@/fields/company'
import { validationError } from '@/lib/validation'

const system = { create: () => false, update: () => false }

/** Unit code unique per PT (raw index `vehicles_company_unit_code_uq`, migration fr1_foundation) — checked first for a readable message. */
async function unitCodeTaken(req: PayloadRequest, company: number, code: string, id: unknown): Promise<boolean> {
  const and: Where[] = [{ company: { equals: company } }, { unitCode: { equals: code } }]
  if (typeof id === 'number' || typeof id === 'string') and.push({ id: { not_equals: id } })
  const r = await req.payload.find({ collection: 'vehicles', where: { and }, limit: 1, depth: 0, pagination: false, select: { unitCode: true }, overrideAccess: true /* SYSTEM-READ: uniqueness inside the PT */, req })
  return r.docs.length > 0
}

/**
 * FR1 (ADR 0020 §3): kind/plate/unit code/owner/customer rules on the MERGED document (create and
 * update), unit code unique per PT; an own unit carries no customer. Runs after companyHook (PT known).
 */
const unitRules: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  const d = data as Record<string, unknown>
  const merged = { ...(originalDoc ?? {}), ...d }
  if ((merged.owner ?? 'sendiri') === 'sendiri' && relId(merged.client) !== undefined) {
    d.client = null
    merged.client = null
  }
  const errors = unitErrors(merged)
  const company = relId(merged.company)
  if (typeof merged.unitCode === 'string' && merged.unitCode && company !== undefined && (d.unitCode !== undefined || !originalDoc)) {
    if (await unitCodeTaken(req, company, merged.unitCode, originalDoc?.id)) errors.push({ path: 'unitCode', message: `Kode unit "${merged.unitCode}" sudah dipakai di PT ini.` })
  }
  if (errors.length > 0) throw validationError(req, { collection: 'vehicles' }, errors)
  return data
}

/**
 * Unit & Kendaraan (US-51, FR1 ADR 0020 §3), per PT:
 * - `kind` kendaraan (plate required, unique when set, normalised `DA 1234 XY` → `DA1234XY`) or
 *   alat_berat (unit code required, unique per PT; plate optional);
 * - `owner` sendiri (rental fleet) or pelanggan (aftersales; `client` required, same PT);
 * - system fields written by the field reports only: `status` (siap | rusak | menunggu_part, from the
 *   service report), `lastHourMeter` / `lastHourMeterAt` (from timesheets and service reports).
 * All roles R (APK picker), Owner R/U, Admin C/R/U.
 */
export const Vehicles: CollectionConfig = withAudit(
  {
    slug: 'vehicles',
    labels: { singular: 'Unit & Kendaraan', plural: 'Unit & Kendaraan' },
    admin: {
      useAsTitle: 'displayName',
      group: 'Master Data',
      defaultColumns: ['displayName', 'kind', 'type', 'brandModel', 'owner', 'status', 'lastHourMeter', 'active'],
      listSearchableFields: ['displayName', 'plateNo', 'unitCode', 'serialNo'],
    },
    access: {
      read: anyMember,
      create: rolesAllowed('pk-admin'),
      update: byRole({ 'pk-admin': true, 'pk-owner': true }),
      delete: denyAll,
    },
    hooks: {
      beforeChange: [companyHook('vehicles', { check: [{ field: 'project', collection: 'projects' }, { field: 'costCenter', collection: 'cost-centers' }, { field: 'client', collection: 'clients' }] }), unitRules],
      beforeValidate: [
        ({ data, originalDoc }) => {
          if (!data) return data
          if (typeof data.plateNo === 'string') {
            if (data.plateNo.trim() === '') {
              data.plateNo = null
              data.plateDisplay = null
            } else {
              data.plateNo = normalizePlate(data.plateNo)
              data.plateDisplay = formatPlate(data.plateNo)
            }
          }
          if (typeof data.unitCode === 'string') data.unitCode = data.unitCode.trim() === '' ? null : normalizeUnitCode(data.unitCode)
          if ('plateNo' in data || 'unitCode' in data || !originalDoc) {
            const unitCode = 'unitCode' in data ? data.unitCode : originalDoc?.unitCode
            const plate = 'plateNo' in data ? data.plateDisplay : originalDoc?.plateDisplay
            data.displayName = [unitCode, plate].filter((x) => typeof x === 'string' && x.length > 0).join(' · ') || null
          }
          return data
        },
      ],
    },
    fields: [
      companyField(),
      {
        name: 'kind',
        type: 'select',
        label: 'Jenis',
        // default + DB NOT NULL (not `required` in Payload: typed creates without it stay valid)
        defaultValue: 'kendaraan',
        index: true,
        options: [
          { label: 'Kendaraan', value: 'kendaraan' },
          { label: 'Alat berat', value: 'alat_berat' },
        ],
      },
      { name: 'displayName', type: 'text', label: 'Unit', index: true, admin: { readOnly: true, description: 'Kode unit · nomor polisi (otomatis).' } },
      {
        name: 'unitCode',
        type: 'text',
        label: 'Kode unit',
        index: true,
        maxLength: 32,
        admin: { description: 'Wajib untuk alat berat, unik per PT (mis. EX-01).' },
      },
      {
        name: 'plateNo',
        type: 'text',
        label: 'Nomor polisi',
        unique: true,
        index: true,
        maxLength: 16,
        admin: { description: 'Wajib untuk kendaraan; opsional untuk alat berat (unik bila diisi).' },
        validate: (v: unknown) => (v === null || v === undefined || v === '' || (typeof v === 'string' && PLATE_RE.test(v)) ? true : 'Format nomor polisi tidak valid (contoh: DA 1234 XY).'),
      },
      { name: 'plateDisplay', type: 'text', label: 'Nomor polisi (tampilan)', admin: { readOnly: true } },
      { name: 'type', type: 'text', label: 'Tipe', required: true, maxLength: 64, admin: { description: 'mis. Hilux, Tronton, Excavator 20 t' } },
      { name: 'brandModel', type: 'text', label: 'Merek/model', maxLength: 128 },
      { name: 'serialNo', type: 'text', label: 'No. seri / rangka', maxLength: 64 },
      {
        type: 'row',
        fields: [
          {
            name: 'owner',
            type: 'select',
            label: 'Pemilik',
            defaultValue: 'sendiri',
            options: [
              { label: 'Milik sendiri (armada)', value: 'sendiri' },
              { label: 'Milik pelanggan', value: 'pelanggan' },
            ],
          },
          { name: 'client', type: 'relationship', relationTo: 'clients', label: 'Pelanggan', index: true, admin: { condition: (data) => data?.owner === 'pelanggan', description: 'Wajib bila milik pelanggan.' } },
        ],
      },
      { name: 'costCenter', type: 'relationship', relationTo: 'cost-centers', label: 'Pusat biaya default' },
      { name: 'project', type: 'relationship', relationTo: 'projects', label: 'Project default' },
      {
        name: 'status',
        type: 'select',
        label: 'Status unit',
        defaultValue: 'siap',
        index: true,
        options: UNIT_STATUSES.map((s) => ({ label: UNIT_STATUS_LABELS[s], value: s })),
        access: system,
        admin: { readOnly: true, position: 'sidebar', description: 'Dari laporan servis terakhir.' },
      },
      { name: 'lastHourMeter', type: 'number', label: 'HM terakhir', access: system, admin: { readOnly: true, position: 'sidebar', description: 'Dari timesheet / laporan servis.' } },
      { name: 'lastHourMeterAt', type: 'date', label: 'HM terakhir pada', access: system, admin: { readOnly: true, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } } },
      odooRefField('odooFleetRef', 'Ref. fleet Odoo'),
      activeField(),
      uuidField(),
    ],
  },
  { docType: 'vehicle', exclude: ['plateDisplay', 'displayName', 'lastHourMeter', 'lastHourMeterAt'], reasonRules: [reasonOnDeactivate] },
)
