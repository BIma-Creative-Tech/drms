import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { withAudit } from '@/audit/hooks'
import { companyField, companyHook } from '@/fields/company'

import { FIELD_AUDIT_EXCLUDE, fieldReportRead, fieldSystemFields } from './field-common'
import { businessDateField, ro } from './fields-f2'

/**
 * FR1 Timesheet harian unit (ADR 0020 §5, requirements v1.3): ONE row per unit and date (unique
 * index), for a unit in an ACTIVE contract unit of a kontrak_unit project on that date. HM start/end
 * (end ≥ start; HM_GAP flag when the start ≠ the previous day's end), work/standby/breakdown hours
 * (Σ ≤ 24, breakdown needs a reason), fuel, operator name (text — operators have no account),
 * exactly one HM meter photo (owner type `unit_timesheet`). Updates vehicles.lastHourMeter. Basis of
 * the monthly recap + billing ESTIMATE (`rekap-timesheet-kontrak`). Written only by
 * domain/field/timesheet.ts.
 */
export const UnitTimesheets: CollectionConfig = withAudit(
  {
    slug: 'unit-timesheets',
    labels: { singular: 'Timesheet unit', plural: 'Timesheet unit' },
    admin: {
      group: 'Proyek',
      useAsTitle: 'reportDate',
      defaultColumns: ['reportDate', 'project', 'unit', 'hmStart', 'hmEnd', 'workHours', 'standbyHours', 'breakdownHours', 'reporter'],
      description: 'Dibuat dari aplikasi Android atau API laporan lapangan (bukan dari form ini).',
    },
    defaultSort: '-reportDate',
    indexes: [{ fields: ['unit', 'reportDate'], unique: true }],
    access: { read: fieldReportRead, create: denyAll, update: denyAll, delete: denyAll },
    hooks: {
      beforeChange: [companyHook('unit-timesheets', { derive: [{ field: 'project', collection: 'projects' }], check: [{ field: 'unit', collection: 'vehicles' }, { field: 'contractUnit', collection: 'contract-units' }] })],
    },
    fields: [
      companyField({ derived: true }),
      { name: 'project', type: 'relationship', relationTo: 'projects', label: 'Project', required: true, index: true, admin: ro },
      { name: 'unit', type: 'relationship', relationTo: 'vehicles', label: 'Unit', required: true, index: true, admin: ro },
      { name: 'contractUnit', type: 'relationship', relationTo: 'contract-units', label: 'Unit kontrak', required: true, index: true, admin: ro },
      businessDateField('reportDate', 'Tanggal', { required: true, index: true, admin: ro }),
      { name: 'reporter', type: 'relationship', relationTo: 'users', label: 'Pelapor', required: true, index: true, admin: ro },
      { name: 'hmStart', type: 'number', label: 'HM awal', required: true, admin: ro },
      { name: 'hmEnd', type: 'number', label: 'HM akhir', required: true, admin: ro },
      { name: 'workHours', type: 'number', label: 'Jam kerja', required: true, admin: ro },
      { name: 'standbyHours', type: 'number', label: 'Jam standby', defaultValue: 0, admin: ro },
      { name: 'breakdownHours', type: 'number', label: 'Jam breakdown', defaultValue: 0, admin: ro },
      { name: 'breakdownReason', type: 'text', label: 'Alasan breakdown', maxLength: 500, admin: ro },
      { name: 'fuelLiters', type: 'number', label: 'BBM (liter)', admin: ro },
      { name: 'operatorName', type: 'text', label: 'Operator', maxLength: 128, admin: ro },
      { name: 'location', type: 'text', label: 'Lokasi', maxLength: 200, admin: ro },
      { name: 'notes', type: 'textarea', label: 'Catatan', maxLength: 2000, admin: ro },
      ...fieldSystemFields(),
    ],
  },
  { docType: 'unit_timesheet', exclude: FIELD_AUDIT_EXCLUDE },
)
