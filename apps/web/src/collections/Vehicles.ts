import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { byRole, rolesAllowed, anyMember } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, odooRefField, uuidField } from '@/fields/common'
import { formatPlate, normalizePlate, PLATE_RE } from '@/domain/plates'
import { companyField, companyHook } from '@/fields/company'

/**
 * Kendaraan / unit (US-51): plate unique and normalised (`DA 1234 XY` → `DA1234XY`).
 * All roles R (APK picker), Owner R/U, Admin C/R/U.
 */
export const Vehicles: CollectionConfig = withAudit(
  {
    slug: 'vehicles',
    labels: { singular: 'Kendaraan', plural: 'Kendaraan' },
    admin: { useAsTitle: 'plateDisplay', group: 'Master Data', defaultColumns: ['plateDisplay', 'type', 'brandModel', 'costCenter', 'active'] },
    access: {
      read: anyMember,
      create: rolesAllowed('pk-admin'),
      update: byRole({ 'pk-admin': true, 'pk-owner': true }),
      delete: denyAll,
    },
    hooks: { beforeChange: [companyHook('vehicles', { check: [{ field: 'project', collection: 'projects' }, { field: 'costCenter', collection: 'cost-centers' }] })],
      beforeValidate: [
        ({ data }) => {
          if (data && typeof data.plateNo === 'string') {
            data.plateNo = normalizePlate(data.plateNo)
            data.plateDisplay = formatPlate(data.plateNo)
          }
          return data
        },
      ],
    },
    fields: [
      companyField(),
      {
        name: 'plateNo',
        type: 'text',
        label: 'Nomor polisi',
        required: true,
        unique: true,
        index: true,
        maxLength: 16,
        validate: (v: unknown) => (typeof v === 'string' && PLATE_RE.test(v) ? true : 'Format nomor polisi tidak valid (contoh: DA 1234 XY).'),
      },
      { name: 'plateDisplay', type: 'text', label: 'Nomor polisi (tampilan)', admin: { readOnly: true } },
      { name: 'type', type: 'text', label: 'Jenis', required: true, maxLength: 64, admin: { description: 'mis. Hilux, Tronton' } },
      { name: 'brandModel', type: 'text', label: 'Merek/model', maxLength: 128 },
      { name: 'costCenter', type: 'relationship', relationTo: 'cost-centers', label: 'Pusat biaya default' },
      { name: 'project', type: 'relationship', relationTo: 'projects', label: 'Project default' },
      odooRefField('odooFleetRef', 'Ref. fleet Odoo'),
      activeField(),
      uuidField(),
    ],
  },
  { docType: 'vehicle', exclude: ['plateDisplay'], reasonRules: [reasonOnDeactivate] },
)
