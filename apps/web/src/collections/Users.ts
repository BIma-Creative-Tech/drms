import { APIError, type CollectionBeforeOperationHook, type CollectionConfig, type Where } from 'payload'

import { PANEL_ROLES, companiesWithRole, denyAll, hasRoleAny, isGroupAdmin, relId, userId, userRoles } from '@/access/roles'
import { anyOf, byRoleAny, fieldRoles, ownUser, rolesAllowedAny, usersOfMyCompanies, type Rule } from '@/access/policies'
import { revokeCurrentWebSession } from '@/auth/sessions'
import { mobileBearerStrategy, oidcSessionStrategy } from '@/auth/strategies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { compensateKeycloak, deactivationAfterChange, keycloakSyncBeforeChange } from '@/domain/users-sync'
import { displayNameField, displayNameQuery } from '@/fields/users'

type UserExtras = { _pkSessionExp?: number }

const adminOnly = { create: fieldRoles('pk-admin'), update: fieldRoles('pk-admin') }

/**
 * Fields only an Admin may change (Keycloak-synced identity, active flag, group admin). Roles and
 * the employee link are per PT in `company-memberships` (ADR 0016 §2).
 */
const ADMIN_FIELDS = ['email', 'name', 'phone', 'active', 'keycloakSub', 'groupAdmin'] as const

function norm(field: string, v: unknown): unknown {
  if (field === 'groupAdmin') return v === true
  if (field === 'email' && typeof v === 'string') return v.trim().toLowerCase()
  return v === undefined || v === '' ? null : v
}

/**
 * F2c self-service profile (beforeOperation: sees the RAW input before field access strips it):
 * a non-admin caller (overrideAccess:false) may update ONLY their own row (collection access) and
 * only the `signature` — any attempt to change an admin field is a 403 instead of a silent drop
 * (the admin form re-sends the unchanged read-only values, which pass). The signature must be a
 * `media-signatures` row the caller uploaded (same resize/SSRF guards as every upload, see
 * collections/media/factory.ts) — never someone else's image. Admin keeps managing everyone.
 */
export const selfProfileGuard: CollectionBeforeOperationHook = async ({ args, operation, overrideAccess, req }) => {
  if (operation !== 'update' || overrideAccess || !req.user || hasRoleAny(req, 'pk-admin')) return args
  const a = args as { id?: number | string; data?: Record<string, unknown> }
  const data = a.data ?? {}
  const uid = userId(req)
  if (a.id === undefined || Number(a.id) !== uid) throw new APIError('Anda hanya dapat mengubah profil Anda sendiri.', 403, null, true)
  const current = (await req.payload.findByID({ collection: 'users', id: uid, depth: 0, overrideAccess: true /* SYSTEM-READ: own row, diff below */, req })) as unknown as Record<string, unknown>
  const changed = ADMIN_FIELDS.filter((f) => f in data && JSON.stringify(norm(f, data[f])) !== JSON.stringify(norm(f, current[f])))
  if (changed.length > 0) throw new APIError(`Hanya Admin yang dapat mengubah: ${changed.join(', ')}.`, 403, null, true)
  const sig = relId(data.signature)
  if (sig !== undefined && sig !== relId(current.signature)) {
    const m = await req.payload
      .findByID({ collection: 'media-signatures', id: sig, depth: 0, overrideAccess: true /* SYSTEM-READ: ownership checked below */, req })
      .catch(() => null)
    if (!m || relId(m.uploadedBy) !== uid) throw new APIError('Tanda tangan harus gambar yang Anda unggah sendiri.', 403, null, true)
  }
  return args
}

/**
 * Accounts a PT Admin may CHANGE (identity is cross-PT: email/name/active reach Keycloak and every PT
 * of the person). MC4 QA finding QA-MC4-02: `usersOfMyCompanies` let an Admin of PT A update anyone
 * with a membership in A — including people also active in PT B and group admins (an Admin may add
 * any account to A first) → cross-PT lock-out / takeover. Now: accounts whose ACTIVE memberships are
 * ALL in PTs where the caller is Admin (any PT of the caller, not only the read selection), plus
 * accounts without a membership (onboarding) — never a group admin. Group admins manage everyone.
 */
const usersOnlyInMyAdminCompanies: Rule = async ({ req }) => {
  if (isGroupAdmin(req)) return true
  const mine = companiesWithRole(req, ['pk-admin'], { all: true })
  if (mine.length === 0) return false
  const rows = await req.payload.find({
    collection: 'company-memberships',
    where: { active: { equals: true } },
    depth: 0,
    pagination: false,
    select: { user: true, company: true },
    overrideAccess: true, // SYSTEM-READ: access rule (which accounts belong ONLY to the caller's Admin PTs)
    req,
  })
  const any = new Set<number>()
  const foreign = new Set<number>()
  for (const m of rows.docs as unknown as Array<{ user: unknown; company: unknown }>) {
    const u = relId(m.user)
    if (u === undefined) continue
    any.add(u)
    if (!mine.includes(relId(m.company) ?? -1)) foreign.add(u)
  }
  const managed = [...any].filter((u) => !foreign.has(u))
  const or: Where[] = [any.size > 0 ? { id: { not_in: [...any] } } : { id: { exists: true } }]
  if (managed.length > 0) or.push({ id: { in: managed } })
  return { and: [{ or: [{ groupAdmin: { equals: false } }, { groupAdmin: { exists: false } }] }, { or }] }
}

/**
 * Users (ADR 0003 as revised by ADR 0016 §2): identity + credentials live in Keycloak realm `drms`;
 * this collection holds the link (`keycloakSub`), the active flag and the DB-only `groupAdmin`
 * flag. Per-PT roles + the employee of each PT live in `company-memberships`.
 * Admin C/R/U (identity synced to Keycloak, Keycloak-first), Owner R, everyone R self.
 */
export const Users: CollectionConfig = withAudit(
  {
    slug: 'users',
    labels: { singular: 'Pengguna', plural: 'Pengguna' },
    // Privacy notice (Q-46, ADR 0018): column "Privasi dibaca (versi/tanggal)" for Admins.
    // QA-16: pickers/labels show the name with the email as secondary (virtual `displayName`);
    // list search over the stored name + email.
    admin: { useAsTitle: 'displayName', listSearchableFields: ['name', 'email'], group: 'Pengguna & Akses', defaultColumns: ['email', 'name', 'active', 'privacyAck'] },
    auth: {
      // Keycloak-only login. No password/forgot/reset endpoints, no Payload JWT (spike a).
      disableLocalStrategy: true,
      strategies: [oidcSessionStrategy, mobileBearerStrategy],
    },
    access: {
      admin: ({ req }) => userRoles(req).some((r) => PANEL_ROLES.includes(r)),
      // ADR 0016 §5: Admin/Direktur see the accounts of THEIR PTs (+ not yet assigned ones); group admin all
      read: byRoleAny({
        'pk-admin': anyOf(ownUser('id'), usersOfMyCompanies('id', ['pk-admin', 'pk-owner'])),
        'pk-owner': anyOf(ownUser('id'), usersOfMyCompanies('id', ['pk-admin', 'pk-owner'])),
        'pk-finance': ownUser('id'),
        'pk-pm': ownUser('id'),
        'pk-staff': ownUser('id'),
        'pk-operator': ownUser('id'),
      }),
      create: rolesAllowedAny('pk-admin'),
      // F2c: everyone may update their OWN row — field access limits that to `signature`.
      update: byRoleAny({
        'pk-admin': anyOf(ownUser('id'), usersOnlyInMyAdminCompanies),
        'pk-owner': ownUser('id'),
        'pk-finance': ownUser('id'),
        'pk-pm': ownUser('id'),
        'pk-staff': ownUser('id'),
        'pk-operator': ownUser('id'),
      }),
      delete: denyAll,
    },
    hooks: {
      beforeOperation: [displayNameQuery, selfProfileGuard],
      beforeChange: [keycloakSyncBeforeChange],
      afterChange: [deactivationAfterChange],
      afterError: [async ({ req }) => compensateKeycloak(req)],
      // Admin UI reads `exp` from /me and /refresh-token to schedule its inactivity timers.
      me: [
        ({ args, user }) => {
          const exp = (args.req.user as UserExtras | null)?._pkSessionExp
          return exp ? { user, exp } : undefined
        },
      ],
      refresh: [
        ({ args, user }) => {
          const exp = (args.req.user as UserExtras | null)?._pkSessionExp
          // No Payload JWT cookie is ever issued (setCookie false); session lifetime is ours.
          return { exp: exp ?? 0, refreshedToken: '', setCookie: false, strategy: 'oidcSession', user }
        },
      ],
      afterLogout: [
        async ({ req }) => {
          await revokeCurrentWebSession(req, 'admin_logout')
        },
      ],
    },
    fields: [
      { name: 'email', type: 'email', label: 'Email', required: true, unique: true, access: adminOnly },
      { name: 'name', type: 'text', label: 'Nama', maxLength: 128, access: adminOnly },
      { name: 'phone', type: 'text', label: 'No. HP', maxLength: 32, access: adminOnly },
      displayNameField(),
      {
        name: 'signature',
        type: 'upload',
        relationTo: 'media-signatures',
        label: 'Tanda tangan',
        admin: {
          description:
            'PNG tanda tangan Anda (latar putih/transparan). Dipakai otomatis saat mengirim/menyetujui pengajuan. Klik "Buat Baru" untuk mengunggah, lalu Simpan.',
        },
      },
      // Owner decision 2026-10-10: read-only overview "Karyawan per PT" (memberships → employee, "Buka" /
      // "Buat karyawan"); the link is edited on the employee form ("Akun pengguna") or in Akses PT.
      {
        name: 'employeeLinks',
        type: 'ui',
        label: 'Karyawan per PT',
        admin: { components: { Field: '@/admin/components/users/EmployeeLinksPanel#EmployeeLinksPanel' } },
      },
      {
        name: 'keycloakSub',
        type: 'text',
        label: 'ID Keycloak (sub)',
        unique: true,
        index: true,
        access: { update: () => false },
        admin: { readOnly: true, position: 'sidebar', description: 'Diisi otomatis dari Keycloak.' },
      },
      { name: 'active', type: 'checkbox', label: 'Aktif', defaultValue: true, index: true, access: adminOnly, admin: { position: 'sidebar' } },
      // ADR 0016 §2 (DB only, never a Keycloak role): may create/deactivate PTs, edit the app-wide
      // setting and every PT's memberships. Only a group admin grants it.
      {
        name: 'groupAdmin',
        type: 'checkbox',
        label: 'Admin grup (semua PT)',
        defaultValue: false,
        access: { create: ({ req }) => isGroupAdmin(req), update: ({ req }) => isGroupAdmin(req) },
        admin: { position: 'sidebar', description: 'Mengelola daftar PT, setting aplikasi dan akses PT semua pengguna.' },
      },
      // Q-46 / ASVS 8.3.3 (ADR 0018): acknowledgement of the employee privacy notice. Read-only everywhere; set ONLY
      // by POST /api/v1/me/privacy-ack (own account, audited `privacy_ack`); the DB keeps it monotonic.
      {
        name: 'privacyAckVersion',
        type: 'number',
        label: 'Versi pemberitahuan privasi yang dibaca',
        min: 1,
        access: { create: () => false, update: () => false },
        admin: { readOnly: true, position: 'sidebar', step: 1, description: 'Diisi saat pengguna menekan "Saya mengerti" di web/aplikasi.' },
      },
      {
        name: 'privacyAckAt',
        type: 'date',
        label: 'Pemberitahuan privasi dibaca pada',
        access: { create: () => false, update: () => false },
        admin: { readOnly: true, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } },
      },
      // list-only column: "v1 · 05/10/2026 10.12" / "Belum" / outdated version
      {
        name: 'privacyAck',
        type: 'ui',
        label: 'Privasi dibaca (versi/tanggal)',
        admin: { disableListColumn: false, components: { Cell: '@/admin/components/users/PrivacyAckCell#PrivacyAckCell' } },
      },
    ],
  },
  {
    docType: 'user',
    reasonRules: [reasonOnDeactivate],
    actionFor: (c, op) => (op === 'update' && c.field === 'groupAdmin' ? 'role_change' : undefined),
  },
)
