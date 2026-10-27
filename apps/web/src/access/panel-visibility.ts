import type { CollectionConfig, GlobalConfig } from 'payload'

import { isAdminStaffOnly, isOperatorOnly, isStaffOnly } from './roles'

/**
 * F2c: admin-panel visibility for restricted panels (staff-only, and operator-only since owner
 * decision 2026-10-09). `admin.hidden` removes an entity from the nav, dashboard and its list/edit
 * ROUTES (@payloadcms/next 3.90.1 views/List + views/Document return notFound for hidden entities;
 * drawers opened from a relationship/upload field keep working because DocumentDrawer/ListDrawer
 * default `overrideEntityVisibility = true`). It does NOT affect the REST/Local API — data access
 * stays with the access functions (defence in depth, not a guard).
 *
 * Staff-only users see just these collections (their projects, own requests, their receipts, the LPJ of their
 * requests, their notifications, their own profile). Everything else — masters, finance, system, media libraries — is hidden.
 */
// Owner request 2026-10-09 ("LPJ belum ada di staff"): `settlements` (the LPJ records of the own requests) added.
// Owner decision 2026-10-11: `projects` — the Staff's assigned projects, read-only and without money (RAB hidden by
// field access, access/money.ts; tabs Proyek / RAP / Pengajuan, no Pinjaman).
export const STAFF_VISIBLE_COLLECTIONS: readonly string[] = ['projects', 'expense-requests', 'receipts', 'settlements', 'notifications', 'users']

/**
 * Operator/Anggota-only users (owner decision 2026-10-09: "hanya untuk melakukan absensi") see
 * nothing but their own profile in the collection list — their attendance self-check-in and recap
 * are custom views (`/absensi/absen`, `/absensi/rekap`), not collection list/edit routes, and are
 * reachable regardless of this list (see `admin/modules/registry.ts`).
 */
export const OPERATOR_VISIBLE_COLLECTIONS: readonly string[] = ['users']

/**
 * ADR 0032: Admin Staff-only users (attendance administration of their PT) see the attendance records, the
 * corrections, the employees (Data Karyawan, read) and the schedule masters (read) besides their own profile and
 * notifications; the board / recap / on-behalf pages are custom views (`/absensi…`).
 */
export const ADMIN_STAFF_VISIBLE_COLLECTIONS: readonly string[] = ['users', 'notifications', 'attendances', 'attendance-corrections', 'employees', 'work-schedules', 'holidays']

const RESTRICTED_PANELS: ReadonlyArray<{ isOnly: (user: unknown) => boolean; visible: readonly string[] }> = [
  { isOnly: isStaffOnly, visible: STAFF_VISIBLE_COLLECTIONS },
  { isOnly: isOperatorOnly, visible: OPERATOR_VISIBLE_COLLECTIONS },
  { isOnly: isAdminStaffOnly, visible: ADMIN_STAFF_VISIBLE_COLLECTIONS },
]

type HiddenFn = (args: { user: unknown }) => boolean
type HiddenOpt = boolean | ((args: { user: never }) => boolean) | undefined

function combine(existing: HiddenOpt, slug: string): HiddenFn {
  return ({ user }) => {
    if (RESTRICTED_PANELS.some((p) => p.isOnly(user) && !p.visible.includes(slug))) return true
    if (typeof existing === 'function') return existing({ user: user as never })
    return existing === true
  }
}

export function withStaffPanelVisibility(collections: CollectionConfig[]): CollectionConfig[] {
  return collections.map((c) => ({ ...c, admin: { ...c.admin, hidden: combine(c.admin?.hidden, c.slug) } }))
}

export function withStaffHiddenGlobals(globals: GlobalConfig[]): GlobalConfig[] {
  // Globals have no collection-visible-list exception for either restricted panel: hide unconditionally.
  return globals.map((g) => ({ ...g, admin: { ...g.admin, hidden: combine(g.admin?.hidden, '\0') } }))
}
