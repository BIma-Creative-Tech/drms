import type { Role } from '@/access/roles'

import type { IconName } from './icons'

/**
 * Odoo-style module registry — the single source of truth of the admin navigation (launcher tiles
 * at /admin + the top menu bar of each module). Payload's `admin.group` values stay untouched; this
 * file only decides where an entity appears in the new navigation. Pure data + pure functions (no
 * React, no Payload runtime): used by the server components (ModuleNav, Launcher), the client bar
 * (active-module resolution) and the unit tests (tests/unit/admin-modules.test.ts guards that every
 * collection/global of payload.config.ts maps to exactly one module).
 *
 * Visibility (resolveModules) = three existing layers, unchanged:
 * 1. Payload read permission of the entity (same check as Payload's groupNavItems),
 * 2. `visibleEntities` (admin.hidden, incl. the F2c staff whitelist of access/panel-visibility.ts),
 * 3. role rules of the custom views (moved here from the retired F2NavLinks.tsx).
 * A module appears only when at least one item is visible. The server re-checks everything
 * (views + /api/v1); the menu is a convenience, not a guard.
 */

export type ModuleId =
  | 'dashboard'
  | 'persetujuan'
  | 'proyek'
  | 'keuangan'
  | 'absensi'
  | 'laporan'
  | 'pengguna'
  | 'master'
  | 'media'
  | 'pengaturan'
  | 'sistem'

export type BadgeKey = 'transfers' | 'lpj'

/** An entity list/edit route or a custom admin view (href relative to /admin). */
export type ModuleItem =
  | { collection: string; label?: string; navKey?: string; personal?: true }
  | { global: string; label?: string; navKey?: string; personal?: true }
  | {
      view: string
      label: string
      /** QA-20(c): own-data shortcut that the top bar already offers (see `personal` below). */
      personal?: true
      /** Any of these roles (omitted = every panel role). */
      roles?: readonly Role[]
      badge?: BadgeKey
      /** `data-pk-nav-link` value (kept from F2NavLinks for tests/e2e). */
      navKey?: string
      /** Label for staff-only users (e.g. "Rekap absensi saya"). */
      staffLabel?: string
    }

export type ModuleSection = { label?: string; items: readonly ModuleItem[] }

export type ModuleDef = {
  id: ModuleId
  label: string
  /** Iconsax Bulk glyph on the tile (src/admin/modules/icons.ts). */
  icon: IconName
  /** One line under the tile label (launcher). */
  hint: string
  /** Deeper custom-view routes (/kas/baru, /laporan/<kode>, …) resolve to the module of their parent view. */
  sections: readonly ModuleSection[]
  /**
   * QA-20(c): a configuration module (master data, settings) — shown only to callers who may CREATE
   * or UPDATE at least one of its entities (Payload permissions). Read-only reference data is still
   * reachable from the pickers that use it; a tile that only opens read-only lists is noise.
   */
  manage?: true
}

/** ADR 0013: decisions + cash = Direktur (pk-owner) / Finance. */
const OFFICE: readonly Role[] = ['pk-finance', 'pk-owner']
const OFFICE_PM: readonly Role[] = [...OFFICE, 'pk-pm']
const OFFICE_PM_ADMIN: readonly Role[] = [...OFFICE_PM, 'pk-admin']
const OFFICE_ADMIN: readonly Role[] = [...OFFICE, 'pk-admin']
/** Creating requests: Staff/PM/Admin/Finance (collection create access, Q-09). */
export const CREATOR_ROLES: readonly Role[] = ['pk-staff', 'pk-pm', 'pk-admin', 'pk-finance']

export const MODULES: readonly ModuleDef[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'home',
    hint: 'Ringkasan per peran',
    sections: [{ items: [{ view: '/dashboard', label: 'Dashboard', navKey: 'dashboard' }] }],
  },
  {
    id: 'persetujuan',
    label: 'Persetujuan',
    icon: 'approval',
    hint: 'Approval, transfer, LPJ',
    sections: [
      {
        items: [
          { view: '/persetujuan', label: 'Persetujuan', roles: OFFICE, navKey: 'persetujuan' },
          { view: '/antrian-transfer', label: 'Antrian Transfer', roles: OFFICE, badge: 'transfers', navKey: 'antrian-transfer' },
          { view: '/verifikasi-lpj', label: 'Verifikasi LPJ', roles: OFFICE, badge: 'lpj', navKey: 'verifikasi-lpj' },
          { collection: 'approvals' },
        ],
      },
    ],
  },
  {
    id: 'proyek',
    label: 'Proyek',
    icon: 'project',
    hint: 'Project, RAB, progress',
    sections: [
      // Grouped so the whole menu fits one bar row at 1440px (7 flat entries + 2 dropdowns did not).
      { items: [{ collection: 'projects' }, { collection: 'budget-lines' }] },
      { label: 'Tahapan', items: [{ collection: 'project-stages' }, { collection: 'stage-templates' }] },
      { label: 'Data pendukung', items: [{ collection: 'clients' }, { collection: 'cost-centers' }, { collection: 'team-assignments' }] },
      {
        label: 'Progress',
        items: [
          { view: '/progress', label: 'Progress project', roles: OFFICE_PM, navKey: 'progress' },
          { view: '/progress/laporan', label: 'Laporan progress', roles: OFFICE_PM, navKey: 'laporan-progress' },
          { collection: 'progress-reports', label: 'Data laporan progress' },
        ],
      },
      { label: 'Addendum', items: [{ view: '/addendum', label: 'Addendum RAB', roles: OFFICE_PM, navKey: 'addendum' }, { collection: 'budget-addenda', label: 'Data addendum' }] },
    ],
  },
  {
    id: 'keuangan',
    label: 'Keuangan',
    icon: 'finance',
    hint: 'Pengajuan, kas, transfer',
    sections: [
      {
        label: 'Pengajuan',
        items: [
          { collection: 'expense-requests', navKey: 'pengajuan' },
          { view: '/collections/expense-requests/create', label: '+ Buat pengajuan', roles: CREATOR_ROLES, navKey: 'buat-pengajuan' },
          { collection: 'expense-line-snapshots' },
          { collection: 'receipts' },
          { collection: 'receipt-flags' },
        ],
      },
      {
        label: 'Kas',
        items: [
          { view: '/kas', label: 'Buku kas', roles: OFFICE, navKey: 'kas' },
          { collection: 'cash-entries' },
          { collection: 'cash-accounts' },
          { collection: 'cash-in-sources' },
        ],
      },
      { label: 'Transfer & LPJ', items: [{ collection: 'transfers' }, { collection: 'settlements' }] },
      { label: 'Tutup buku', items: [{ view: '/tutup-buku', label: 'Tutup buku', roles: OFFICE, navKey: 'tutup-buku' }, { collection: 'period-closings', label: 'Riwayat tutup buku' }] },
    ],
  },
  {
    id: 'absensi',
    label: 'Absensi',
    icon: 'attendance',
    hint: 'Kehadiran & jadwal',
    sections: [
      {
        items: [
          { view: '/absensi', label: 'Tim hari ini', roles: OFFICE_PM_ADMIN, navKey: 'absensi' },
          { view: '/absensi/rekap', label: 'Rekap bulanan', staffLabel: 'Rekap absensi saya', navKey: 'absensi-saya' },
          { view: '/absensi/jadwal', label: 'Jadwal & hari libur', roles: OFFICE_PM_ADMIN, navKey: 'absensi-jadwal' },
          { collection: 'attendances' },
          { collection: 'attendance-corrections' },
        ],
      },
      { label: 'Konfigurasi', items: [{ collection: 'work-schedules' }, { collection: 'holidays' }] },
    ],
  },
  {
    id: 'laporan',
    label: 'Laporan',
    icon: 'report',
    hint: 'Laporan & ekspor',
    // S3e (S-23): Admin gets the attendance report (only report besides the audit log).
    sections: [{ items: [{ view: '/laporan', label: 'Semua laporan', roles: OFFICE_PM_ADMIN, navKey: 'laporan' }] }],
  },
  {
    id: 'pengguna',
    label: 'Pengguna & Akses',
    icon: 'users',
    hint: 'User, karyawan, perangkat',
    sections: [
      {
        items: [
          // MC2-4: role matrix user × PT (Admin of a PT / group admin; the view re-checks)
          { view: '/akses-pt', label: 'Akses PT (matriks)', roles: ['pk-admin'], navKey: 'akses-pt' },
          // own profile = avatar menu "Profil & tanda tangan" (profileHref)
          { collection: 'users', personal: true },
          { collection: 'company-memberships', label: 'Data akses PT' },
          { collection: 'employees' },
          { collection: 'employee-bank-accounts' },
        ],
      },
      { label: 'Perangkat & sesi', items: [{ collection: 'devices' }, { collection: 'web-sessions' }] },
    ],
  },
  {
    id: 'master',
    label: 'Master Data',
    icon: 'master',
    hint: 'Bank, satuan, vendor',
    manage: true,
    sections: [{ items: [{ collection: 'banks' }, { collection: 'uoms' }, { collection: 'expense-categories' }, { collection: 'vehicles' }, { collection: 'vendors' }] }],
  },
  {
    id: 'media',
    label: 'Media',
    icon: 'media',
    hint: 'Foto, bukti, lampiran',
    sections: [
      {
        items: [
          { collection: 'media-receipts' },
          { collection: 'media-transfer-proofs' },
          { collection: 'media-selfies' },
          { collection: 'media-progress-photos' },
          { collection: 'media-signatures' },
          { collection: 'media-company' },
          { collection: 'media-attachments' },
        ],
      },
    ],
  },
  {
    id: 'pengaturan',
    label: 'Pengaturan',
    icon: 'settings',
    hint: 'Perusahaan & aturan',
    manage: true,
    sections: [{ items: [{ collection: 'companies' }, { global: 'company-settings' }, { collection: 'approval-rules' }, { collection: 'notification-templates' }, { collection: 'document-sequences' }] }],
  },
  {
    id: 'sistem',
    label: 'Sistem',
    icon: 'system',
    hint: 'Audit & notifikasi',
    sections: [
      {
        items: [
          { view: '/audit-log', label: 'Audit Log', roles: OFFICE_ADMIN, navKey: 'audit-log' },
          { collection: 'audit-logs', label: 'Data audit log' },
          // own notifications = the bell in the top bar
          { view: '/notifikasi', label: 'Notifikasi saya', navKey: 'notifikasi-saya', personal: true },
          { collection: 'notifications', label: 'Data notifikasi', personal: true },
        ],
      },
    ],
  },
]

// ------------------------------------------------------------------------------------ lookup

export const ADMIN_ROUTE = '/admin'

export function itemKind(item: ModuleItem): 'collection' | 'global' | 'view' {
  return 'collection' in item ? 'collection' : 'global' in item ? 'global' : 'view'
}

export function itemHref(item: ModuleItem): string {
  if ('collection' in item) return `${ADMIN_ROUTE}/collections/${item.collection}`
  if ('global' in item) return `${ADMIN_ROUTE}/globals/${item.global}`
  return `${ADMIN_ROUTE}${item.view}`
}

function allItems(m: ModuleDef): ModuleItem[] {
  return m.sections.flatMap((s) => [...s.items])
}

/** entity slug → module id (collections and globals separately). Throws on a duplicate mapping. */
export function entityModuleMap(modules: readonly ModuleDef[] = MODULES): { collections: Map<string, ModuleId>; globals: Map<string, ModuleId> } {
  const collections = new Map<string, ModuleId>()
  const globals = new Map<string, ModuleId>()
  for (const m of modules) {
    for (const it of allItems(m)) {
      const [map, slug] = 'collection' in it ? [collections, it.collection] : 'global' in it ? [globals, it.global] : [null, '']
      if (!map) continue
      const prev = map.get(slug)
      if (prev && prev !== m.id) throw new Error(`entity ${slug} is mapped to both ${prev} and ${m.id}`)
      map.set(slug, m.id)
    }
  }
  return { collections, globals }
}

/** Custom-view path prefixes (relative to /admin) → module, longest first. */
function viewPrefixes(modules: readonly ModuleDef[]): Array<[string, ModuleId]> {
  const out: Array<[string, ModuleId]> = []
  for (const m of modules) {
    for (const it of allItems(m)) if ('view' in it && !it.view.startsWith('/collections/') && !it.view.startsWith('/globals/')) out.push([it.view, m.id])
  }
  return out.sort((a, b) => b[0].length - a[0].length)
}

const MAPS = entityModuleMap()
const PREFIXES = viewPrefixes(MODULES)

/**
 * Module of an admin pathname: `/admin/collections/<slug>…`, `/admin/globals/<slug>…` or a custom
 * view (exact or deeper path of a registered view, e.g. /admin/laporan/rekap-kas → laporan,
 * /admin/kas/12/ubah → keuangan). `/admin` itself (the launcher) and unknown paths → null.
 */
export function moduleForPath(pathname: string): ModuleId | null {
  const clean = (pathname.split(/[?#]/)[0] ?? '').replace(/\/+$/, '')
  if (clean !== ADMIN_ROUTE && !clean.startsWith(`${ADMIN_ROUTE}/`)) return null
  const rel = clean.slice(ADMIN_ROUTE.length)
  if (rel === '') return null
  const seg = rel.split('/').filter(Boolean)
  if (seg[0] === 'collections' && seg[1]) return MAPS.collections.get(seg[1]) ?? null
  if (seg[0] === 'globals' && seg[1]) return MAPS.globals.get(seg[1]) ?? null
  for (const [prefix, id] of PREFIXES) if (rel === prefix || rel.startsWith(`${prefix}/`)) return id
  return null
}

/**
 * The menu item (href) that best matches a pathname: the longest item href that equals the path
 * or is a path prefix of it (`/admin/collections/cash-entries/5` → the cash-entries item).
 */
export function activeHref(pathname: string, hrefs: readonly string[]): string | null {
  const clean = (pathname.split(/[?#]/)[0] ?? '').replace(/\/+$/, '')
  let best: string | null = null
  for (const h of hrefs) {
    if ((clean === h || clean.startsWith(`${h}/`)) && (!best || h.length > best.length)) best = h
  }
  return best
}

/** F2d: "Profil & tanda tangan" (own user doc, signature US-43) for EVERY panel role — Owner signs
 * approvals too. Lives in the avatar menu of the top bar. */
export function profileHref(user: { id: number | string }): string {
  return `${ADMIN_ROUTE}/collections/users/${user.id}`
}

// ------------------------------------------------------------------------------ visibility

/** Serialisable shapes handed to the client bar and the launcher. */
export type ResolvedItem = { key: string; label: string; href: string; kind: 'collection' | 'global' | 'view'; navKey?: string; badge?: number }
export type ResolvedSection = { key: string; label?: string; items: ResolvedItem[] }
export type ResolvedModule = { id: ModuleId; label: string; icon: IconName; hint: string; href: string; badge: number; sections: ResolvedSection[] }

export type VisibilityInput = {
  roles: readonly Role[]
  staffOnly: boolean
  /** Payload read permission AND visibleEntities for an entity. */
  canSee: (kind: 'collection' | 'global', slug: string) => boolean
  /** Payload create or update permission of an entity (QA-20(c) `manage` modules). Omitted = none. */
  canManage?: (kind: 'collection' | 'global', slug: string) => boolean
  /** Entity label (Payload labels.plural / global label). */
  labelOf: (kind: 'collection' | 'global', slug: string) => string
  badges?: Partial<Record<BadgeKey, number>>
}

function viewAllowed(item: Extract<ModuleItem, { view: string }>, roles: readonly Role[]): boolean {
  if (roles.length === 0) return false
  return !item.roles || item.roles.some((r) => roles.includes(r))
}

/** True when the caller may create/update at least one entity of a `manage` module. */
function canManageModule(m: ModuleDef, input: VisibilityInput): boolean {
  if (!input.canManage) return false
  return allItems(m).some((it) => ('collection' in it ? input.canManage!('collection', it.collection) : 'global' in it ? input.canManage!('global', it.global) : false))
}

/**
 * Visible modules (registry order) with their visible items. Dropped (QA-20(c), "only what the role can
 * use"): modules without a visible item, modules whose visible items are all `personal` shortcuts the
 * top bar already has (staff: "Pengguna & Akses" = own profile, "Sistem" = own notifications), and
 * `manage` modules for callers who can neither create nor update any of their entities (PM: Master
 * Data, Pengaturan). Everything is derived from the caller's Payload permissions + view roles.
 */
export function resolveModules(input: VisibilityInput, modules: readonly ModuleDef[] = MODULES): ResolvedModule[] {
  const out: ResolvedModule[] = []
  if (input.roles.length === 0) return out // no ProyekKas role → no panel access at all (Users.access.admin)
  for (const m of modules) {
    if (m.manage && !canManageModule(m, input)) continue
    const personal = new Set<string>()
    const sections: ResolvedSection[] = []
    m.sections.forEach((s, si) => {
      const items: ResolvedItem[] = []
      for (const it of s.items) {
        const kind = itemKind(it)
        const href = itemHref(it)
        if ('view' in it) {
          if (!viewAllowed(it, input.roles)) continue
          const badge = it.badge ? (input.badges?.[it.badge] ?? 0) : undefined
          items.push({ key: href, label: input.staffOnly && it.staffLabel ? it.staffLabel : it.label, href, kind, navKey: it.navKey, ...(badge ? { badge } : {}) })
          if (it.personal) personal.add(href)
        } else {
          const slug = 'collection' in it ? it.collection : it.global
          const k = kind as 'collection' | 'global'
          if (!input.canSee(k, slug)) continue
          items.push({ key: href, label: it.label ?? input.labelOf(k, slug), href, kind, navKey: it.navKey })
          if (it.personal) personal.add(href)
        }
      }
      if (items.length) sections.push({ key: `${m.id}-${si}`, label: s.label, items })
    })
    if (!sections.length) continue
    if (sections.every((sec) => sec.items.every((i) => personal.has(i.href)))) continue
    const first = sections[0]!.items.find((i) => !i.label.startsWith('+')) ?? sections[0]!.items[0]!
    const badge = sections.reduce((n, s) => n + s.items.reduce((k, i) => k + (i.badge ?? 0), 0), 0)
    out.push({ id: m.id, label: m.label, icon: m.icon, hint: m.hint, href: first.href, badge, sections })
  }
  return out
}
