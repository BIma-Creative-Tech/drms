import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { anyOf, byRole, rolesAllowed } from '@/access/policies'
import { inIds } from '@/access/scope'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, codeField, odooRefField, uuidField } from '@/fields/common'

/**
 * Pusat biaya / lokasi operasional (form item 9: "Ops Palangka Banjar" is not a project).
 * Staff R assigned, PM R team, Finance R all, Owner/Admin C/R/U (requirements v1.1 §4).
 * E6 (Q-40): optional lat/lng/radius → attendance geofence of the location.
 */
export const CostCenters: CollectionConfig = withAudit(
  {
    slug: 'cost-centers',
    labels: { singular: 'Pusat biaya', plural: 'Pusat biaya' },
    admin: { useAsTitle: 'name', group: 'Proyek', defaultColumns: ['code', 'name', 'type', 'manager', 'active'] },
    access: {
      read: byRole({
        'pk-admin': true,
        'pk-owner': true,
        'pk-finance': true,
        'pk-pm': anyOf(async ({ scope }) => inIds('id', (await scope()).teamCostCenters)),
        'pk-staff': async ({ scope }) => inIds('id', (await scope()).assignedCostCenters),
      }),
      create: rolesAllowed('pk-admin', 'pk-owner'),
      update: byRole({ 'pk-admin': true, 'pk-owner': true }),
      delete: denyAll,
    },
    fields: [
      codeField(),
      { name: 'name', type: 'text', label: 'Nama', required: true, maxLength: 128 },
      {
        name: 'type',
        type: 'select',
        label: 'Jenis',
        required: true,
        defaultValue: 'operational',
        options: [
          { label: 'Operasional', value: 'operational' },
          { label: 'Departemen', value: 'department' },
        ],
      },
      { name: 'manager', type: 'relationship', relationTo: 'users', label: 'Penanggung jawab', index: true },
      // E6 / Q-40: optional geofence of an operational location (absensi di pusat biaya). No point =
      // attendance at this cost center is refused (NO_GEOFENCE), like a project without a point.
      // S3e: a point without radius uses company-settings.defaultGeofenceRadiusM.
      {
        type: 'row',
        fields: [
          { name: 'lat', type: 'number', label: 'Latitude', min: -90, max: 90 },
          { name: 'lng', type: 'number', label: 'Longitude', min: -180, max: 180 },
          { name: 'radiusM', type: 'number', label: 'Radius geofence (m)', min: 10, max: 5000, admin: { description: 'Kosong = radius default perusahaan (Setting perusahaan).' } },
        ],
      },
      odooRefField('odooAnalyticRef', 'Ref. akun analitik Odoo'),
      activeField(),
      uuidField(),
    ],
  },
  { docType: 'cost_center', reasonRules: [reasonOnDeactivate] },
)
