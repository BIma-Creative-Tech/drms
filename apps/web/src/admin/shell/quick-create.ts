import type { Role } from '@/access/roles'
import type { IconName } from '@/admin/modules/icons'
import type { FeatureKey, ModuleId } from '@/admin/modules/registry'
import { partnerFormHref } from '@/admin/partner-routes'

/**
 * DRMS 16/10 (owner 2026-10-16, "konsep no. 1"): the global "+ Buat" menu of the top bar (ModuleBar) — one click from
 * any page to the create form of a record, without walking through the module sub-menus. Pure data + pure functions
 * (no React, no Payload runtime): ModuleNav (server) resolves the caller's items, the client bar only renders them,
 * tests/unit/d1610-quick-create.test.ts pins the items per role.
 *
 * Visibility = what the caller may actually create, from the same layers as the module registry:
 * 1. Payload's create permission of the collection (`permissions.collections[slug].create`, like RowActionsCell
 *    reads `update`) ∧ the collection is visible to the caller (visibleEntities);
 * 2. role rules of the custom create views (the views and /api/v1 re-check every write);
 * 3. per-PT features (Laporan harian: companies.fieldReportsEnabled).
 * The menu is a convenience, not a guard. Only for Admin / Direktur / PM / Finance in the current PT selection (the
 * Owner acts as Direktur, ROLE_IMPLIES): Staff and Operator keep their own narrow panels.
 */

/** Roles that get the "+ Buat" button (any of them in a selected PT). */
export const QUICK_CREATE_ROLES: readonly Role[] = ['pk-admin', 'pk-owner', 'pk-pm', 'pk-finance']

/**
 * Role lists of the custom create views, mirrored here so this module stays free of server imports (the unit test
 * guards that they equal their sources): ExpenseRequests drafts.ts VENDOR_PAYMENT_ROLES (ADR 0027), domain/cash/book.ts
 * KAS_WRITE_ROLES (E2), admin/views/field-ui.tsx FIELD_CREATORS (P3 Laporan harian), Addendum (PM of the project, E5),
 * Pengguna (Admin of a PT, DRMS 13/10 W3 — same rule as the registry item "+ Pengguna baru").
 */
export const QUICK_ROLE_RULES = {
  vendorPayment: ['pk-finance', 'pk-pm'],
  kasWrite: ['pk-finance'],
  dailyReport: ['pk-owner', 'pk-pm', 'pk-staff'],
  addendum: ['pk-pm'],
  userOnboarding: ['pk-admin'],
} as const satisfies Record<string, readonly Role[]>

export type QuickGroupId = 'keuangan' | 'proyek' | 'mitra' | 'pengguna'

/** Group order = menu order; `mod` tints the item chips with the module colours of the launcher. */
export const QUICK_GROUPS: ReadonlyArray<{ id: QuickGroupId; label: string; mod: ModuleId }> = [
  { id: 'keuangan', label: 'Keuangan', mod: 'keuangan' },
  { id: 'proyek', label: 'Proyek', mod: 'proyek' },
  { id: 'mitra', label: 'Klien & vendor', mod: 'master' },
  { id: 'pengguna', label: 'Pengguna & karyawan', mod: 'pengguna' },
]

export type QuickCreateDef = {
  key: string
  label: string
  /** Absolute admin href of the create page (the tabbed one-page form where one exists). */
  href: string
  icon: IconName
  group: QuickGroupId
  /** Payload collection whose create permission (and visibility) the item needs. */
  collection?: string
  /** Any of these roles in a selected PT (omitted = no extra role rule). */
  roles?: readonly Role[]
  /** Shown only when a selected PT has this feature on. */
  feature?: FeatureKey
}

/**
 * Menu items in menu order (most frequent first inside each group). "Pembayaran vendor" is the expense-request form
 * with "Jenis penerima" = Vendor preset (`?penerima=vendor`, EditableOnlyFields PayeeTypeField). Laporan progress is
 * APK-only (progress-reports create = denyAll on the web), so the web field report of a project is "Laporan harian".
 */
export const QUICK_CREATE_DEFS: readonly QuickCreateDef[] = [
  { key: 'pengajuan', label: 'Pengajuan baru', href: '/admin/collections/expense-requests/create', icon: 'tReceiptText', group: 'keuangan', collection: 'expense-requests' },
  { key: 'pembayaran-vendor', label: 'Pembayaran vendor', href: '/admin/collections/expense-requests/create?penerima=vendor', icon: 'tShop', group: 'keuangan', collection: 'expense-requests', roles: QUICK_ROLE_RULES.vendorPayment },
  { key: 'kas-masuk', label: 'Kas masuk', href: '/admin/kas/baru?arah=masuk', icon: 'tMoneyRecive', group: 'keuangan', roles: QUICK_ROLE_RULES.kasWrite },
  { key: 'kas-keluar', label: 'Kas keluar', href: '/admin/kas/baru?arah=keluar', icon: 'tMoneySend', group: 'keuangan', roles: QUICK_ROLE_RULES.kasWrite },
  { key: 'proyek', label: 'Proyek baru', href: '/admin/collections/projects/create', icon: 'project', group: 'proyek', collection: 'projects' },
  { key: 'laporan-harian', label: 'Laporan harian', href: '/admin/laporan-harian/baru', icon: 'tCalendarEdit', group: 'proyek', roles: QUICK_ROLE_RULES.dailyReport, feature: 'fieldReports' },
  { key: 'addendum', label: 'Addendum RAB', href: '/admin/addendum/baru', icon: 'tNoteAdd', group: 'proyek', roles: QUICK_ROLE_RULES.addendum },
  // the tabbed Klien / Vendor pages (detail + Kontak PIC + Proyek / Rekening, one save — admin/partner-routes.ts)
  { key: 'klien', label: 'Klien baru', href: partnerFormHref('clients', 'baru')!, icon: 'users', group: 'mitra', collection: 'clients' },
  { key: 'vendor', label: 'Vendor baru', href: partnerFormHref('vendors', 'baru')!, icon: 'tShop', group: 'mitra', collection: 'vendors' },
  { key: 'pengguna', label: 'Pengguna baru', href: '/admin/pengguna/baru', icon: 'tUser', group: 'pengguna', collection: 'users', roles: QUICK_ROLE_RULES.userOnboarding },
  { key: 'karyawan', label: 'Karyawan baru', href: '/admin/collections/employees/create', icon: 'tPersonalcard', group: 'pengguna', collection: 'employees' },
]

/** Serialisable shapes handed to the client bar. */
export type QuickCreateItem = { key: string; label: string; href: string; icon: IconName }
export type QuickCreateGroup = { id: QuickGroupId; label: string; mod: ModuleId; items: QuickCreateItem[] }

export type QuickCreateInput = {
  /** Effective roles of the caller in the selected PTs (rolesOf). */
  roles: readonly Role[]
  /** Payload create permission ∧ visibleEntities of a collection. */
  canCreate: (collection: string) => boolean
  features?: Partial<Record<FeatureKey, boolean>>
}

/**
 * Payload's create permission as sent to the admin (`true`, or `{ permission, where? }`; a denied entry is absent or
 * `{ permission: false }`). Create has no row to match a `where` against, so a granted `where` counts as granted —
 * the server decides per PT on save.
 */
export function mayCreate(perm: unknown): boolean {
  if (perm === true) return true
  return Boolean(perm) && typeof perm === 'object' && (perm as { permission?: unknown }).permission !== false
}

/** True when the caller gets the "+ Buat" button at all. */
export function showsQuickCreate(roles: readonly Role[]): boolean {
  return roles.some((r) => QUICK_CREATE_ROLES.includes(r))
}

/** Items of the "+ Buat" menu for the caller, grouped (QUICK_GROUPS order), empty groups dropped. */
export function quickCreateGroups(input: QuickCreateInput, defs: readonly QuickCreateDef[] = QUICK_CREATE_DEFS): QuickCreateGroup[] {
  if (!showsQuickCreate(input.roles)) return []
  const allowed = defs.filter((d) => {
    if (d.feature && input.features?.[d.feature] !== true) return false
    if (d.roles && !d.roles.some((r) => input.roles.includes(r))) return false
    return d.collection === undefined || input.canCreate(d.collection)
  })
  return QUICK_GROUPS.map((g) => ({
    ...g,
    items: allowed.filter((d) => d.group === g.id).map(({ key, label, href, icon }) => ({ key, label, href, icon })),
  })).filter((g) => g.items.length > 0)
}

/** Shape of the permissions / visibleEntities Payload hands the Nav component (only what is read here). */
type PermissionsLike = { collections?: Record<string, { create?: unknown } | undefined> | null } | null | undefined
type VisibleLike = { collections?: readonly string[] | null } | null | undefined

/** `canCreate` from Payload's sanitized permissions + visibleEntities (the Nav server props). */
export function canCreateFrom(permissions: PermissionsLike, visibleEntities: VisibleLike): (collection: string) => boolean {
  return (slug) => Boolean(visibleEntities?.collections?.includes(slug)) && mayCreate(permissions?.collections?.[slug]?.create)
}

/**
 * "+ Buat" › "Pembayaran vendor" preset (`?penerima=`) of the expense-request create form: the payee types a link may
 * preset. Anything else → null (the form keeps its default, Karyawan).
 */
export const PAYEE_PRESETS = ['vendor', 'pt_grup'] as const
export type PayeePreset = (typeof PAYEE_PRESETS)[number]

export function payeePreset(value: string | null | undefined): PayeePreset | null {
  return (PAYEE_PRESETS as readonly string[]).includes(value ?? '') ? (value as PayeePreset) : null
}

/**
 * Global shortcut Alt+N opens the menu (no browser / Payload binding; Ctrl/Cmd+S stays Payload's save). By physical key
 * (macOS Option+N types a dead key) and never while typing in a field (Option+N is ñ there).
 */
export function isQuickCreateShortcut(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; code?: string; key?: string }, typing: boolean): boolean {
  if (typing || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false
  return e.code === 'KeyN' || e.key === 'n' || e.key === 'N'
}
