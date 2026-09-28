import { APIError, type CollectionBeforeChangeHook, type CollectionConfig, type Where } from 'payload'

import { ROLES, ROLE_LABELS, companiesWithRole, denyAll, hasRole, isGroupAdmin, relId, userId } from '@/access/roles'
import { withAudit } from '@/audit/hooks'

/**
 * Keanggotaan PT (ADR 0016 §2, US-MC-02/03): the ONLY source of per-PT roles and of the user ↔
 * employee link of that PT. One row per (user, PT); the employee must belong to the same PT (hook +
 * DB trigger `company_memberships_company`), one employee → one account (unique (company, employee)).
 * Roles are never synced to Keycloak (Keycloak keeps identity + the coarse realm role `pk-user`).
 *
 * Access: read = own rows, Admin of that PT, group admin; create/update = Admin of the row's PT
 * (+ group admin); never deleted (deactivate instead, audited).
 */
const adminOf = (req: never, company: unknown): boolean => {
  const c = relId(company)
  return c !== undefined && (isGroupAdmin(req) || hasRole(req, 'pk-admin', c))
}

const membershipGuard: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  const company = relId(data.company ?? originalDoc?.company)
  const user = relId(data.user ?? originalDoc?.user)
  if (company === undefined || user === undefined) throw new APIError('Pengguna dan PT wajib diisi.', 400, null, true)
  if (Array.isArray(data.roles)) data.roles = [...new Set(data.roles as string[])].sort()
  const employee = relId(data.employee !== undefined ? data.employee : originalDoc?.employee)
  if (employee !== undefined) {
    const emp = await req.payload.findByID({ collection: 'employees', id: employee, depth: 0, overrideAccess: true /* SYSTEM-READ: same-PT check */, req, disableErrors: true })
    if (!emp || relId((emp as { company?: unknown }).company) !== company) {
      throw new APIError('Karyawan harus dari PT yang sama dengan keanggotaan.', 400, null, true)
    }
  }
  if (operation === 'update' && originalDoc && (relId(originalDoc.company) !== company || relId(originalDoc.user) !== user)) {
    throw new APIError('Pengguna dan PT keanggotaan tidak dapat diubah.', 400, null, true)
  }
  return data
}

export const CompanyMemberships: CollectionConfig = withAudit(
  {
    slug: 'company-memberships',
    labels: { singular: 'Akses PT', plural: 'Akses PT' },
    admin: { group: 'Pengguna & Akses', defaultColumns: ['user', 'company', 'roles', 'employee', 'active'] },
    access: {
      read: ({ req }) => {
        if (isGroupAdmin(req)) return true
        const uid = userId(req)
        if (uid === undefined) return false
        const admin = companiesWithRole(req, ['pk-admin'], { all: true })
        const own: Where = { user: { equals: uid } }
        return admin.length > 0 ? { or: [own, { company: { in: admin } }] } : own
      },
      create: ({ req, data }) => adminOf(req as never, (data as { company?: unknown } | undefined)?.company) || (data?.company === undefined && (isGroupAdmin(req) || companiesWithRole(req, ['pk-admin']).length > 0)),
      update: ({ req }) => (isGroupAdmin(req) ? true : { company: { in: companiesWithRole(req, ['pk-admin'], { all: true }) } }),
      delete: denyAll,
    },
    hooks: {
      beforeChange: [
        membershipGuard,
        // defence in depth (create access sees `data`, but repeat after hooks filled it)
        ({ data, originalDoc, req, operation }) => {
          if (!req.user || req.context?.pkSystemMembership === true) return data
          const company = data.company ?? originalDoc?.company
          if (operation === 'create' && !adminOf(req as never, company)) throw new APIError('Anda bukan Admin PT ini.', 403, null, true)
          return data
        },
      ],
    },
    fields: [
      { name: 'user', type: 'relationship', relationTo: 'users', label: 'Pengguna', required: true, index: true, access: { update: () => false } },
      { name: 'company', type: 'relationship', relationTo: 'companies', label: 'PT', required: true, index: true, access: { update: () => false } },
      {
        name: 'employee',
        type: 'relationship',
        relationTo: 'employees',
        label: 'Karyawan di PT ini',
        filterOptions: ({ data }) => {
          const c = relId((data as { company?: unknown } | undefined)?.company)
          return c === undefined ? false : { company: { equals: c } }
        },
      },
      {
        name: 'roles',
        type: 'select',
        label: 'Peran di PT ini',
        hasMany: true,
        options: ROLES.map((r) => ({ label: ROLE_LABELS[r], value: r })),
      },
      { name: 'active', type: 'checkbox', label: 'Aktif', defaultValue: true, index: true, admin: { position: 'sidebar' } },
    ],
    indexes: [
      { fields: ['user', 'company'], unique: true },
      { fields: ['company', 'employee'], unique: true },
    ],
  },
  {
    docType: 'company_membership',
    actionFor: (c, op) => (op === 'update' && (c.field === 'roles' || c.field === 'active') ? 'role_change' : undefined),
  },
)
