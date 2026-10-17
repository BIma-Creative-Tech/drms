import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { byRole, rolesAllowed, teamProjects } from '@/access/policies'
import { reasonOnAnyUpdate, withAudit } from '@/audit/hooks'
import { rupiahField } from '@/fields/common'
import { companyField, companyHook, lockedUntilCompany, pickerSameCompany } from '@/fields/company'

/** RAB per kategori (opsional). Owner C/R/U; Finance/Admin R; PM R team. Every change needs a reason. */
export const BudgetLines: CollectionConfig = withAudit(
  {
    slug: 'budget-lines',
    labels: { singular: 'RAB per kategori', plural: 'RAB per kategori' },
    admin: { group: 'Proyek', defaultColumns: ['project', 'category', 'amount'] },
    access: {
      read: byRole({ 'pk-admin': true, 'pk-owner': true, 'pk-finance': true, 'pk-pm': teamProjects() }),
      create: rolesAllowed('pk-owner'),
      update: byRole({ 'pk-owner': true }),
      delete: denyAll,
    },
    hooks: { beforeChange: [companyHook('budget-lines', { derive: [{ field: 'project', collection: 'projects' }], check: [{ field: 'category', collection: 'expense-categories' }] })] },
    fields: [
      companyField({ derived: true }),
      { name: 'project', type: 'relationship', relationTo: 'projects', label: 'Project', required: true, index: true, access: { update: () => false }, ...pickerSameCompany({ required: true, decidesCompany: true }) },
      // DRMS UI 17/10 #4: categories of the chosen project's PT only (same names in every PT)
      lockedUntilCompany(
        { name: 'category', type: 'relationship', relationTo: 'expense-categories', label: 'Kategori', required: true, access: { update: () => false }, ...pickerSameCompany({ required: true, parent: { field: 'project', collection: 'projects' } }) },
        { field: 'project', label: 'project' },
      ),
      rupiahField('amount', 'Nominal (Rp)', { required: true }),
    ],
    indexes: [{ fields: ['project', 'category'], unique: true }],
  },
  { docType: 'budget_line', reasonRules: [reasonOnAnyUpdate] },
)
