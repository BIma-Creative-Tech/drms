import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { byRole, rolesAllowed, type Rule } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, odooRefField, uuidField } from '@/fields/common'
import { companyField, companyHook } from '@/fields/company'

/**
 * FR1 (ADR 0020 §2): Staff assigned to an AFTERSALES project of the PT read the PT's clients (customer
 * picker of the aftersales activity log); other Staff read none (403 as before).
 */
const aftersalesStaff: Rule = async ({ req, scope, companyId }) => {
  const assigned = (await scope()).assignedProjects
  // false (not NO_ROWS): other Staff keep the pre-FR1 answer (no client access at all)
  if (assigned.length === 0 || companyId === null) return false
  const r = await req.payload.find({
    collection: 'projects',
    where: { and: [{ id: { in: assigned } }, { company: { equals: companyId } }, { kind: { equals: 'aftersales' } }] },
    limit: 1,
    depth: 0,
    pagination: false,
    select: { kind: true },
    overrideAccess: true, // SYSTEM-READ: access rule (kind of the caller's assigned projects)
    req,
  })
  return r.docs.length > 0
}

/** Klien (pemberi kerja). Admin C/R/U, Owner C/R/U, Finance + PM R (project/kas masuk pickers), Staff of aftersales projects R. */
export const Clients: CollectionConfig = withAudit(
  {
    slug: 'clients',
    labels: { singular: 'Klien', plural: 'Klien' },
    admin: { useAsTitle: 'name', group: 'Proyek', defaultColumns: ['name', 'contact', 'phone', 'active'] },
    access: {
      read: byRole({ 'pk-admin': true, 'pk-owner': true, 'pk-finance': true, 'pk-pm': true, 'pk-staff': aftersalesStaff }),
      create: rolesAllowed('pk-admin', 'pk-owner'),
      update: byRole({ 'pk-admin': true, 'pk-owner': true }),
      delete: denyAll,
    },
    hooks: { beforeChange: [companyHook('clients')] },
    fields: [
      companyField(),
      { name: 'name', type: 'text', label: 'Nama', required: true, maxLength: 160 },
      { name: 'contact', type: 'text', label: 'Kontak', maxLength: 128 },
      { name: 'phone', type: 'text', label: 'No. HP/telepon', maxLength: 32 },
      { name: 'address', type: 'textarea', label: 'Alamat', maxLength: 500 },
      odooRefField('odooPartnerRef', 'Ref. partner Odoo'),
      activeField(),
      uuidField(),
    ],
  },
  { docType: 'client', reasonRules: [reasonOnDeactivate] },
)
