import type { CollectionBeforeChangeHook, CollectionConfig, Where } from 'payload'

import { denyAll, relId } from '@/access/roles'
import { assignedProjects, byRole, fieldRoles, rolesAllowed, teamProjects } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { kindOf, RATE_BASES, RATE_FIELD_ROLES } from '@/domain/field/rules'
import { isBusinessDate } from '@/domain/expense/types'
import { rupiahField, uuidField } from '@/fields/common'
import { companyField, companyHook } from '@/fields/company'
import { validationError } from '@/lib/validation'

import { businessDateField } from './fields-f2'

const rateRead = fieldRoles(...RATE_FIELD_ROLES)

/**
 * Project of kind kontrak_unit, own unit (not a customer's), end ≥ start, and no other ACTIVE
 * contract of the unit overlapping the period (readable 400 before the DB trigger
 * `pk_contract_unit_overlap` of migration fr1_security, which is the final guard).
 */
const contractRules: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  const m = { ...(originalDoc ?? {}), ...(data as Record<string, unknown>) }
  const errors: Array<{ path: string; message: string }> = []
  const projectId = relId(m.project)
  const unitId = relId(m.unit)
  if (projectId !== undefined) {
    const p = (await req.payload.findByID({ collection: 'projects', id: projectId, depth: 0, overrideAccess: true /* SYSTEM-READ: project kind */, req, disableErrors: true })) as { kind?: string } | null
    if (p && kindOf(p.kind) !== 'kontrak_unit') errors.push({ path: 'project', message: 'Project harus berjenis "Kontrak unit".' })
  }
  if (unitId !== undefined) {
    const u = (await req.payload.findByID({ collection: 'vehicles', id: unitId, depth: 0, overrideAccess: true /* SYSTEM-READ: unit owner */, req, disableErrors: true })) as { owner?: string } | null
    if (u && (u.owner ?? 'sendiri') !== 'sendiri') errors.push({ path: 'unit', message: 'Unit kontrak harus milik sendiri (bukan milik pelanggan).' })
  }
  const start = m.startDate as string | undefined
  const end = (m.endDate as string | null | undefined) || null
  if (start && end && isBusinessDate(start) && isBusinessDate(end) && end < start) errors.push({ path: 'endDate', message: 'Tanggal selesai tidak boleh sebelum tanggal mulai.' })
  if (unitId !== undefined && start && m.active !== false && errors.length === 0) {
    const and: Where[] = [
      { unit: { equals: unitId } },
      { active: { equals: true } },
      { or: [{ endDate: { exists: false } }, { endDate: { equals: null } }, { endDate: { greater_than_equal: start } }] },
    ]
    if (end) and.push({ startDate: { less_than_equal: end } })
    if (originalDoc?.id !== undefined) and.push({ id: { not_equals: originalDoc.id } })
    const r = await req.payload.find({ collection: 'contract-units', where: { and }, limit: 1, depth: 0, pagination: false, select: { startDate: true }, overrideAccess: true /* SYSTEM-READ: overlap check (no row data returned) */, req })
    if (r.docs.length > 0) errors.push({ path: 'unit', message: 'Unit ini sudah aktif di kontrak lain pada periode yang sama.' })
  }
  if (errors.length > 0) throw validationError(req, { collection: 'contract-units' }, errors)
  if ('endDate' in (data as Record<string, unknown>) && (data as Record<string, unknown>).endDate === '') (data as Record<string, unknown>).endDate = null
  return data
}

/**
 * Unit kontrak (FR1, ADR 0020 §4): a unit of the own fleet rented out in a project of kind
 * kontrak_unit for a period, with the contract rate (per jam with a monthly minimum, or per bulan).
 * The RATE and the MINIMUM hours are readable only by Direktur, Finance and Admin (field access; the
 * API strips them as well). Admin/Direktur create and change; never deleted (deactivate with a reason).
 * A unit is never ACTIVE in two contracts on the same day (hook + DB trigger).
 */
export const ContractUnits: CollectionConfig = withAudit(
  {
    slug: 'contract-units',
    labels: { singular: 'Unit kontrak', plural: 'Unit kontrak' },
    admin: {
      group: 'Proyek',
      useAsTitle: 'id',
      defaultColumns: ['project', 'unit', 'startDate', 'endDate', 'rateBasis', 'rate', 'active'],
      description: 'Unit armada sendiri yang disewakan di project berjenis "Kontrak unit". Tarif hanya terlihat oleh Direktur, Finance, dan Admin.',
    },
    defaultSort: '-id',
    access: {
      read: byRole({ 'pk-admin': true, 'pk-owner': true, 'pk-finance': true, 'pk-pm': teamProjects('project'), 'pk-staff': assignedProjects('project') }),
      create: rolesAllowed('pk-admin', 'pk-owner'),
      update: byRole({ 'pk-admin': true, 'pk-owner': true }),
      delete: denyAll,
    },
    hooks: { beforeChange: [companyHook('contract-units', { derive: [{ field: 'project', collection: 'projects' }], check: [{ field: 'unit', collection: 'vehicles' }] }), contractRules] },
    fields: [
      companyField({ derived: true }),
      { name: 'project', type: 'relationship', relationTo: 'projects', label: 'Project', required: true, index: true, filterOptions: { kind: { equals: 'kontrak_unit' } } },
      { name: 'unit', type: 'relationship', relationTo: 'vehicles', label: 'Unit', required: true, index: true, filterOptions: { owner: { equals: 'sendiri' } } },
      {
        type: 'row',
        fields: [
          businessDateField('startDate', 'Mulai', { required: true, index: true }),
          businessDateField('endDate', 'Selesai', { index: true, admin: { description: 'Kosong = berjalan.' } }),
        ],
      },
      {
        type: 'row',
        fields: [
          {
            name: 'rateBasis',
            type: 'select',
            label: 'Dasar tarif',
            required: true,
            defaultValue: 'per_jam',
            options: RATE_BASES.map((v) => ({ label: v === 'per_jam' ? 'Per jam' : 'Per bulan', value: v })),
          },
          { ...rupiahField('rate', 'Tarif (Rp)', { required: true }), access: { read: rateRead } },
          {
            name: 'minHoursPerMonth',
            type: 'number',
            label: 'Minimum jam / bulan',
            min: 0,
            max: 744,
            access: { read: rateRead },
            admin: { description: 'Per jam: tagihan estimasi = tarif × maks(jam kerja, minimum).' },
          },
        ],
      },
      { name: 'active', type: 'checkbox', label: 'Aktif', defaultValue: true, index: true, admin: { position: 'sidebar' } },
      { name: 'notes', type: 'textarea', label: 'Catatan', maxLength: 1000 },
      uuidField(),
    ],
  },
  { docType: 'contract_unit', reasonRules: [reasonOnDeactivate] },
)

