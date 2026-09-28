import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { byRole, rolesAllowed, anyMember } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, codeField, uuidField } from '@/fields/common'
import { companyField, companyHook } from '@/fields/company'

/**
 * Kategori pengeluaran (requirements v1.1 §6): COA mapping, default + allowed UoMs ("daftar
 * satuan wajar", used by the uom_suspicious flag in F2), "perlu kendaraan?".
 * `allowedUoms` is hasMany → child table `expense_categories_rels` (mutable master → DELETE grant).
 */
export const ExpenseCategories: CollectionConfig = withAudit(
  {
    slug: 'expense-categories',
    labels: { singular: 'Kategori pengeluaran', plural: 'Kategori pengeluaran' },
    admin: { useAsTitle: 'name', group: 'Master Data', defaultColumns: ['code', 'name', 'coaCode', 'requiresVehicle', 'active'] },
    access: {
      read: anyMember,
      create: rolesAllowed('pk-admin', 'pk-finance'),
      update: byRole({ 'pk-admin': true, 'pk-finance': true, 'pk-owner': true }),
      delete: denyAll,
    },
    hooks: { beforeChange: [companyHook('expense-categories')] },
    fields: [
      companyField(),
      codeField('Kode', 32, { perCompany: true }),
      { name: 'name', type: 'text', label: 'Nama', required: true, maxLength: 128 },
      { name: 'coaCode', type: 'text', label: 'Kode akun (COA)', maxLength: 32 },
      { name: 'defaultUom', type: 'relationship', relationTo: 'uoms', label: 'Satuan default' },
      { name: 'allowedUoms', type: 'relationship', relationTo: 'uoms', hasMany: true, label: 'Satuan wajar' },
      { name: 'requiresVehicle', type: 'checkbox', label: 'Perlu kendaraan?', defaultValue: false },
      activeField(),
      uuidField(),
    ],
  },
  { docType: 'expense_category', reasonRules: [reasonOnDeactivate] },
)
