import type { Payload, SanitizedConfig, TypedUser } from 'payload'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { withCompanyContext, type Role } from '@/access/roles'
import { activeHref, entityModuleMap, landingSections, MODULES, moduleForPath, resolveModules, viewHomes, type ModuleId, type ResolvedModule } from '@/admin/modules/registry'
import { deriveCrumbs, routeOf, type StepLike } from '@/admin/shell/crumbs'
import { loadBadges, loadModules, navUser } from '@/admin/shell/modules-server'

/**
 * Odoo-style navigation (src/admin/modules/registry.ts): guard that every collection/global of the
 * Payload config maps to exactly one module (a new collection must not silently disappear from the
 * menu), per-role tile visibility with the REAL config (admin.hidden = visibleEntities, access.read
 * = Payload read permission) + the registry role rules, and active-module resolution.
 */
let config: SanitizedConfig

const nav = vi.hoisted(() => ({ path: '/admin', steps: [] as Array<{ label: unknown; url?: string }> }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.path }))
vi.mock('@payloadcms/ui', () => ({
  useTheme: () => ({ theme: 'light', setTheme: () => undefined, autoMode: false }),
  useStepNav: () => ({ stepNav: nav.steps, setStepNav: () => undefined }),
  useTranslation: () => ({ i18n: { language: 'id', fallbackLanguage: 'en' }, t: (k: string) => k }),
}))

beforeAll(async () => {
  process.env.PK_SKIP_ENV_CHECK = 'true'
  config = await (await import('@/payload.config')).default
})

// ADR 0032: `sites` is a hidden legacy collection (no menu, no create) — kept for history / old APKs only
const INTERNAL = (slug: string) => slug.startsWith('payload-') || slug === 'sites'

/** Same rule as @payloadcms/ui getVisibleEntities (3.90.1): hidden fn(user) / boolean. */
function visibleFor(user: unknown) {
  const vis = (h: unknown) => !(typeof h === 'function' ? (h as (a: { user: unknown }) => boolean)({ user }) : h)
  return {
    collections: config.collections.filter((c) => vis(c.admin?.hidden)).map((c) => c.slug),
    globals: config.globals.filter((g) => vis(g.admin?.hidden)).map((g) => g.slug),
  }
}

/**
 * Payload read permission: access.read(true | Where | Promise<…>) is truthy → read = true
 * (payload getEntityPermissions: a Where query still grants the nav entry). A rule that needs the
 * database (row-level scopes) counts as granted — the stub payload throws, like a Where it only
 * narrows rows, it never hides the entity.
 */
async function readPermissions(user: { id: number; roles: Role[] }) {
  const payload = new Proxy({}, { get: () => () => Promise.reject(new Error('no db in unit test')) })
  // ADR 0016: roles come from a membership (company #1) — same shape as the auth strategies build
  const req = { user: withCompanyContext({ ...user, collection: 'users' }, [{ company: 1, roles: user.roles, employee: null }], null, user.roles.includes('pk-admin')), payload, context: {} }
  type P = { read: boolean; create?: boolean; update: boolean }
  const out: { collections: Record<string, P>; globals: Record<string, P> } = { collections: {}, globals: {} }
  const check = async (fn: unknown) => {
    if (fn === undefined) return true
    try {
      return Boolean(await (fn as (a: unknown) => unknown)({ req }))
    } catch {
      return true
    }
  }
  // QA-20(c): create/update decide the `manage` modules (Master Data, Pengaturan)
  for (const c of config.collections) out.collections[c.slug] = { read: await check(c.access?.read), create: await check(c.access?.create), update: await check(c.access?.update) }
  for (const g of config.globals) out.globals[g.slug] = { read: await check(g.access?.read), update: await check(g.access?.update) }
  return out
}

async function modulesFor(roles: Role[], badge = 0, fieldReports = false): Promise<ResolvedModule[]> {
  const user = withCompanyContext({ id: 42, collection: 'users', email: 'uji@contoh.test', name: 'Uji Coba' }, [{ company: 1, roles, employee: null }], null, roles.includes('pk-admin')) as unknown as TypedUser
  // FR1: companies.fieldReportsEnabled of the selected PT (loadFeatures); without `find` → off
  const find = fieldReports ? { find: async () => ({ docs: [{ id: 1 }] }) } : {}
  // DRMS 24/10: loan transfer orders (also in the transfer badge) are counted in d2410-pinjaman.test.ts — 0 here
  const count = async (a: { collection: string }) => ({ totalDocs: a.collection.startsWith('project-loan') ? 0 : badge })
  const payload = { config, count, ...find } as unknown as Payload
  return loadModules({ payload, user, permissions: (await readPermissions({ id: 42, roles })) as never, visibleEntities: visibleFor(user) as never })
}

const ids = (m: ResolvedModule[]) => m.map((x) => x.id)
const navKeys = (m: ResolvedModule[]) => m.flatMap((x) => x.sections.flatMap((s) => s.items.map((i) => i.navKey))).filter(Boolean)
const hrefs = (m: ResolvedModule[]) => m.flatMap((x) => x.sections.flatMap((s) => s.items.map((i) => i.href)))

describe('registry guard: every entity maps to exactly one module', () => {
  it('each collection of payload.config.ts is in exactly one module', () => {
    const map = entityModuleMap()
    const slugs: string[] = config.collections.map((c) => c.slug as string).filter((s) => !INTERNAL(s))
    const missing = slugs.filter((s) => !map.collections.has(s))
    expect(missing).toEqual([])
    // exactly once (entityModuleMap throws on a slug mapped to two modules; also no double listing)
    const listed = MODULES.flatMap((m) => m.sections.flatMap((s) => s.items.flatMap((i) => ('collection' in i ? [i.collection] : []))))
    expect(listed.length).toBe(new Set(listed).size)
    // and no stale slug in the registry
    expect([...map.collections.keys()].filter((s) => !slugs.includes(s))).toEqual([])
  })

  it('each global is in exactly one module', () => {
    const map = entityModuleMap()
    expect(config.globals.map((g) => g.slug as string).filter((s) => !INTERNAL(s) && !map.globals.has(s))).toEqual([])
    expect([...map.globals.keys()].filter((s) => !config.globals.some((g) => g.slug === s))).toEqual([])
  })

  it('DRMS 15/10 #3: every custom view has exactly one home module; other placements are marked `alias`', () => {
    for (const [view, homes] of viewHomes()) expect(homes, view).toHaveLength(1)
    // the transfer queue / LPJ verification live in Keuangan › Transfer & LPJ, Persetujuan keeps them as shortcuts
    expect(viewHomes().get('/antrian-transfer')).toEqual(['keuangan'])
    expect(viewHomes().get('/verifikasi-lpj')).toEqual(['keuangan'])
    const dup = [
      { ...MODULES[0]!, sections: [{ items: [{ view: '/x', label: 'X' }] }] },
      { ...MODULES[1]!, sections: [{ items: [{ view: '/x', label: 'X' }] }] },
    ]
    expect(viewHomes(dup).get('/x')).toHaveLength(2)
    expect(viewHomes([{ ...MODULES[0]!, sections: [{ items: [{ view: '/y', label: 'Y', alias: true }] }] }]).get('/y')).toEqual([])
  })

  it('a slug in two modules is rejected', () => {
    const dup = [
      { ...MODULES[0]!, sections: [{ items: [{ collection: 'banks' }] }] },
      { ...MODULES[1]!, sections: [{ items: [{ collection: 'banks' }] }] },
    ]
    expect(() => entityModuleMap(dup)).toThrow(/banks/)
  })

  it('every custom view item points at a registered admin view path', async () => {
    const { E2_ADMIN_VIEWS, E6_ADMIN_VIEWS, F2_ADMIN_VIEWS, F3_ADMIN_VIEWS, FR1_ADMIN_VIEWS, IC_LOAN_ADMIN_VIEWS, LOAN_ADMIN_VIEWS, MC2_ADMIN_VIEWS, PARTNER_ADMIN_VIEWS, RAP_ADMIN_VIEWS, S2A_ADMIN_VIEWS, S3E_ADMIN_VIEWS, USER_ONBOARDING_ADMIN_VIEWS } = await import('@/admin/config')
    const paths = new Set(Object.values({ ...F2_ADMIN_VIEWS, ...F3_ADMIN_VIEWS, ...E2_ADMIN_VIEWS, ...E6_ADMIN_VIEWS, ...S2A_ADMIN_VIEWS, ...S3E_ADMIN_VIEWS, ...MC2_ADMIN_VIEWS, ...FR1_ADMIN_VIEWS, ...LOAN_ADMIN_VIEWS, ...IC_LOAN_ADMIN_VIEWS, ...RAP_ADMIN_VIEWS, ...USER_ONBOARDING_ADMIN_VIEWS, ...PARTNER_ADMIN_VIEWS }).map((v) => ('path' in v ? v.path : '')))
    for (const m of MODULES)
      for (const s of m.sections)
        for (const i of s.items) if ('view' in i && !i.view.startsWith('/collections/')) expect(paths, `${m.id}: ${i.view}`).toContain(i.view)
  })

  it('launcher = dashboard view, role dashboard = /dashboard (exact)', async () => {
    const { F3_ADMIN_VIEWS } = await import('@/admin/config')
    expect(F3_ADMIN_VIEWS.dashboard.Component).toBe('@/admin/views/Launcher#Launcher')
    expect(F3_ADMIN_VIEWS.dashboardPage).toMatchObject({ path: '/dashboard', exact: true, Component: '@/admin/views/Dashboard#DashboardPage' })
  })

  it('Nav slot replaced by the module bar; before/afterNavLinks gone', () => {
    const c = config.admin.components as Record<string, unknown>
    expect(c.Nav).toBe('@/admin/shell/ModuleNav#ModuleNav')
    expect(c.beforeNavLinks ?? []).toEqual([])
    expect(c.afterNavLinks ?? []).toEqual([])
  })
})

describe('tile visibility per role (real config: admin.hidden + access.read + role rules)', () => {
  it('Direktur (pk-owner): office modules incl. Persetujuan, Keuangan with Kas + Tutup buku', async () => {
    const m = await modulesFor(['pk-owner'])
    expect(ids(m)).toEqual(expect.arrayContaining<ModuleId>(['dashboard', 'persetujuan', 'proyek', 'keuangan', 'absensi', 'laporan', 'sistem', 'pengaturan']))
    expect(navKeys(m)).toEqual(expect.arrayContaining(['persetujuan', 'antrian-transfer', 'verifikasi-lpj', 'kas', 'tutup-buku', 'progress', 'addendum', 'laporan', 'absensi', 'audit-log']))
    expect(navKeys(m)).toContain('buat-pengajuan') // ADR 0024: the Direktur files his own requests
  })

  it('Finance: same office views + "+ Buat pengajuan"', async () => {
    const k = navKeys(await modulesFor(['pk-finance']))
    expect(k).toEqual(expect.arrayContaining(['persetujuan', 'kas', 'tutup-buku', 'buat-pengajuan', 'audit-log']))
  })

  it('PM: Persetujuan (ADR 0021: "Persetujuan PM"), no transfer/LPJ queues, no cash, no audit log; progress/addendum/laporan/absensi', async () => {
    const m = await modulesFor(['pk-pm'])
    const k = navKeys(m)
    expect(k).toEqual(expect.arrayContaining(['persetujuan', 'progress', 'laporan-progress', 'addendum', 'laporan', 'absensi', 'buat-pengajuan']))
    for (const no of ['antrian-transfer', 'verifikasi-lpj', 'kas', 'tutup-buku', 'audit-log']) expect(k).not.toContain(no)
  })

  it('Admin: users/master/sistem + laporan (S3e S-23) + audit log, no cash/decisions', async () => {
    const m = await modulesFor(['pk-admin'])
    expect(ids(m)).toEqual(expect.arrayContaining<ModuleId>(['dashboard', 'pengguna', 'master', 'media', 'pengaturan', 'sistem', 'laporan', 'absensi']))
    const k = navKeys(m)
    expect(k).toEqual(expect.arrayContaining(['laporan', 'absensi', 'audit-log']))
    for (const no of ['persetujuan', 'kas', 'tutup-buku', 'progress']) expect(k).not.toContain(no)
    expect(hrefs(m)).toContain('/admin/collections/web-sessions') // admin-only entity
  })

  it('staff-only: a small set — own requests/receipts, own attendance recap, their projects (profile + notifications live in the top bar)', async () => {
    const m = await modulesFor(['pk-staff'])
    // QA-20(c): "Pengguna & Akses" (= own profile only) and "Sistem" (= own notifications only) are gone
    expect(ids(m).sort()).toEqual(['absensi', 'dashboard', 'keuangan', 'proyek'])
    // owner decision 2026-10-11: the project list (read-only, no money); one item → the tile opens it directly
    expect(m.find((x) => x.id === 'proyek')).toMatchObject({ href: '/admin/collections/projects', landing: false })
    expect(m.find((x) => x.id === 'proyek')!.sections.flatMap((s) => s.items.map((i) => i.href))).toEqual(['/admin/collections/projects'])
    const keu = m.find((x) => x.id === 'keuangan')!
    expect(keu.sections.flatMap((s) => s.items.map((i) => i.href))).toEqual(['/admin/collections/expense-requests', '/admin/collections/expense-requests/create', '/admin/collections/receipts', '/admin/collections/settlements'])
    const abs = m.find((x) => x.id === 'absensi')!
    // owner decision 2026-10-09: web self check-in ("Absen") for every role
    expect(abs.sections.flatMap((s) => s.items.map((i) => i.label))).toEqual(['Absen', 'Rekap absensi saya'])
    expect(hrefs(m)).not.toContain('/admin/kas')
    expect(hrefs(m)).not.toContain('/admin/laporan')
    for (const hidden of ['persetujuan', 'master', 'media', 'pengaturan', 'laporan', 'pengguna', 'sistem']) expect(ids(m)).not.toContain(hidden)
    for (const no of ['/admin/pinjaman', '/admin/progress', '/admin/addendum', '/admin/collections/budget-lines', '/admin/collections/rap-items']) expect(hrefs(m)).not.toContain(no)
  })

  it('QA-20(c) PM: no Master Data / Pengaturan tiles (read-only reference data), no Sistem (own notifications only)', async () => {
    const m = await modulesFor(['pk-pm'])
    for (const hidden of ['master', 'pengaturan', 'sistem']) expect(ids(m)).not.toContain(hidden)
    expect(ids(m)).toEqual(expect.arrayContaining<ModuleId>(['dashboard', 'proyek', 'keuangan', 'absensi', 'laporan', 'pengguna']))
  })

  it('QA-20(c) Finance keeps Master Data (creates banks/UoM/vendors); settings it can only read are hidden', async () => {
    const m = await modulesFor(['pk-finance'])
    expect(ids(m)).toContain('master')
    expect(ids(m)).not.toContain('pengaturan')
  })

  it('QA-20(c) a module of only `personal` items is dropped; a `manage` module needs create/update', () => {
    const base = { roles: ['pk-owner'] as Role[], staffOnly: false, canSee: () => true, labelOf: (_: unknown, s: string) => s }
    const r = resolveModules({ ...base, canManage: (_k, s) => s === 'company-settings' })
    expect(r.find((x) => x.id === 'pengaturan')).toBeDefined()
    expect(r.find((x) => x.id === 'master')).toBeUndefined()
    const sistem = resolveModules({ ...base, roles: ['pk-pm'], canSee: (_k, s) => s === 'notifications' })
    expect(sistem.find((x) => x.id === 'sistem')).toBeUndefined()
  })

  it('staff + PM = PM menu (roles are a union)', async () => {
    expect(navKeys(await modulesFor(['pk-staff', 'pk-pm']))).toContain('progress')
    expect(navKeys(await modulesFor(['pk-pm', 'pk-staff']))).not.toContain('kas')
  })

  it('FR1: field views only where a selected PT has field reports on (per-PT flag), by role', async () => {
    const FIELD = ['unit-kontrak', 'laporan-servis', 'aftersales', 'aktivitas-aftersales']
    for (const r of ['pk-owner', 'pk-finance', 'pk-pm', 'pk-admin', 'pk-staff'] as Role[]) expect(navKeys(await modulesFor([r])).filter((k) => FIELD.includes(k as string)), `${r} flag off`).toEqual([])
    expect(navKeys(await modulesFor(['pk-owner'], 0, true))).toEqual(expect.arrayContaining(FIELD))
    expect(navKeys(await modulesFor(['pk-pm'], 0, true))).toEqual(expect.arrayContaining(FIELD))
    // Staff (assigned projects): input + lists, no weekly recap; the Proyek tile opens its landing page
    // (D9) whose first sub-menu is the project list (owner decision 2026-10-11)
    const staff = await modulesFor(['pk-staff'], 0, true)
    expect(navKeys(staff).filter((k) => FIELD.includes(k as string))).toEqual(['unit-kontrak', 'laporan-servis', 'aktivitas-aftersales'])
    expect(staff.find((x) => x.id === 'proyek')).toMatchObject({ href: '/admin/modul/proyek', firstHref: '/admin/collections/projects', landing: true })
    expect(moduleForPath('/admin/unit-kontrak/kontrak/5')).toBe('proyek')
    expect(moduleForPath('/admin/aftersales/aktivitas/detail/9')).toBe('proyek')
    expect(moduleForPath('/admin/laporan-servis/baru')).toBe('proyek')
  })

  it('no role → no module', async () => {
    expect(await modulesFor([])).toEqual([])
  })

  it('badges on the items and summed on the tile (office only)', async () => {
    const m = await modulesFor(['pk-finance'], 3)
    const p = m.find((x) => x.id === 'persetujuan')!
    expect(p.badge).toBe(6)
    expect(p.sections[0]!.items.find((i) => i.navKey === 'antrian-transfer')!.badge).toBe(3)
    // DRMS 15/10 #3: Keuangan › Transfer & LPJ opens with the transfer queue (badge), then LPJ verification
    const keu = m.find((x) => x.id === 'keuangan')!
    const tl = keu.sections.find((s) => s.label === 'Transfer & LPJ')!
    expect(tl.items.map((i) => i.navKey ?? i.href)).toEqual(['antrian-transfer', 'verifikasi-lpj', '/admin/collections/transfers', '/admin/collections/settlements'])
    expect(tl.items[0]).toMatchObject({ href: '/admin/antrian-transfer', label: 'Antrian Transfer', badge: 3 })
    expect(keu.badge).toBe(6)
    expect((await modulesFor(['pk-pm'], 3)).every((x) => x.badge === 0)).toBe(true)
  })

  it('a module with nothing visible is dropped; firstHref = first visible item, href = landing (D9)', () => {
    const r = resolveModules({ roles: ['pk-pm'], staffOnly: false, canSee: (k, s) => s === 'holidays', labelOf: (_, s) => s })
    const abs = r.find((x) => x.id === 'absensi')!
    expect(abs.firstHref).toBe('/admin/absensi/absen') // "Absen" (every role, owner decision 2026-10-09) is the first item
    expect(abs.href).toBe('/admin/modul/absensi')
    expect(r.find((x) => x.id === 'master')).toBeUndefined()
    expect(r.find((x) => x.id === 'media')).toBeUndefined()
  })
})

describe('active module resolution', () => {
  it.each([
    ['/admin', null],
    ['/admin/', null],
    ['/admin/account', null],
    ['/elsewhere/kas', null],
    ['/admin/dashboard', 'dashboard'],
    ['/admin/dashboard?peran=pm', 'dashboard'],
    ['/admin/collections/cash-entries', 'keuangan'],
    ['/admin/collections/cash-entries/12', 'keuangan'],
    ['/admin/collections/expense-requests/create', 'keuangan'],
    ['/admin/collections/media-selfies/3', 'media'],
    ['/admin/collections/unknown-thing', null],
    ['/admin/globals/company-settings', 'pengaturan'],
    ['/admin/kas', 'keuangan'],
    ['/admin/kas/baru', 'keuangan'],
    ['/admin/kas/7/ubah', 'keuangan'],
    ['/admin/tutup-buku', 'keuangan'],
    ['/admin/laporan', 'laporan'],
    ['/admin/laporan/rekap-kas', 'laporan'],
    ['/admin/progress/laporan/4', 'proyek'],
    ['/admin/progress/project/9', 'proyek'],
    ['/admin/addendum/detail/2', 'proyek'],
    ['/admin/absensi/jadwal', 'absensi'],
    // DRMS 15/10 #3: home = Keuangan (Persetujuan only links to them)
    ['/admin/antrian-transfer', 'keuangan'],
    ['/admin/verifikasi-lpj', 'keuangan'],
    ['/admin/persetujuan', 'persetujuan'],
    ['/admin/audit-log', 'sistem'],
    ['/admin/notifikasi', 'sistem'],
    ['/admin/modul/master', 'master'],
    ['/admin/modul/keuangan/', 'keuangan'],
    ['/admin/modul/unknown', null],
    ['/admin/modul/master/x', null],
  ] as Array<[string, ModuleId | null]>)('%s → %s', (path, id) => {
    expect(moduleForPath(path)).toBe(id)
  })

  it('active menu item = longest matching href', () => {
    const hs = ['/admin/collections/expense-requests', '/admin/collections/expense-requests/create', '/admin/progress', '/admin/progress/laporan']
    expect(activeHref('/admin/collections/expense-requests/5', hs)).toBe('/admin/collections/expense-requests')
    expect(activeHref('/admin/collections/expense-requests/create', hs)).toBe('/admin/collections/expense-requests/create')
    expect(activeHref('/admin/progress/laporan/3', hs)).toBe('/admin/progress/laporan')
    expect(activeHref('/admin/progress-x', hs)).toBeNull()
  })
})

describe('server helpers', () => {
  it('navUser: display name, initials, role labels (pk-owner shown as Direktur)', () => {
    const u = navUser({ id: 7, roles: ['pk-owner', 'pk-finance'], email: 'budi.santoso@contoh.test' } as unknown as TypedUser)
    expect(u).toMatchObject({ id: 7, name: 'budi.santoso', initials: 'BS', roleLabel: 'Direktur · Finance', staffOnly: false })
    expect(navUser({ id: 1, roles: ['pk-staff'], name: 'Sari Dewi' } as unknown as TypedUser)).toMatchObject({ initials: 'SD', staffOnly: true })
  })

  it('loadBadges: a failing count never breaks the nav', async () => {
    const payload = { count: async () => Promise.reject(new Error('db down')) } as unknown as Payload
    const failing = async () => Promise.reject(new Error('db down'))
    expect(await loadBadges(payload, { id: 1, roles: ['pk-owner'] } as unknown as TypedUser, failing)).toEqual({ transfers: 0, lpj: 0, approvals: 0 })
  })

  it('DRMS 20/10: the "Persetujuan" tile carries the inbox badge; the module badge sums it with the queues', () => {
    const m = resolveModules({ roles: ['pk-owner'], staffOnly: false, canSee: () => true, labelOf: (_, s) => s, badges: { transfers: 3, lpj: 1, approvals: 4 } })
    const p = m.find((x) => x.id === 'persetujuan')!
    expect(p.sections[0]!.items.find((i) => i.navKey === 'persetujuan')!.badge).toBe(4)
    expect(p.badge).toBe(8)
    const pm = resolveModules({ roles: ['pk-pm'], staffOnly: false, canSee: () => true, labelOf: (_, s) => s, badges: { approvals: 2 } })
    expect(pm.find((x) => x.id === 'persetujuan')!.badge).toBe(2)
  })
})

describe('ModuleBar (SSR with mocked pathname/theme)', () => {
  async function bar(path: string, roles: Role[], steps: Array<{ label: unknown; url?: string }> = []) {
    nav.path = path
    nav.steps = steps
    const { ModuleBar } = await import('@/admin/shell/ModuleBar')
    const modules = await modulesFor(roles, 2)
    const user = navUser({ id: 42, roles, name: 'Uji Coba' } as unknown as TypedUser)
    return renderToString(createElement(ModuleBar, { modules, user, bell: createElement('a', { 'data-pk-nav-link': 'notifikasi' }), logout: null }))
  }

  it('launcher page: brand, launcher link current, no module menu', async () => {
    const html = await bar('/admin', ['pk-finance'])
    expect(html).toContain('data-module="launcher"')
    expect(html).toContain('data-pk-nav-link="launcher"')
    expect(html).toMatch(/data-pk-nav-link="launcher"[^>]*aria-current="page"|aria-current="page"[^>]*data-pk-nav-link="launcher"/)
    expect(html).not.toContain('pk-bar__nav')
    expect(html).toContain('data-pk-nav-link="notifikasi"')
    expect(html).toContain('data-pk-avatar')
  })

  it('DRMS 13/10 #9: Persetujuan module — no module menu in the bar; module name → landing page, module badge kept', async () => {
    const html = await bar('/admin/persetujuan', ['pk-owner'])
    expect(html).toContain('data-module="persetujuan"')
    expect(html).not.toContain('pk-bar__nav')
    expect(html).not.toContain('pk-bar__link')
    expect(html).not.toContain('data-pk-burger')
    expect(html).not.toContain('href="/admin/persetujuan"')
    expect(html).toMatch(/data-pk-nav-link="module-home"[^>]*href="\/admin\/modul\/persetujuan"/)
    expect(html).toContain('pk-bar__count')
    // PT switcher slot, bell and avatar stay
    expect(html).toContain('data-pk-nav-link="notifikasi"')
    expect(html).toContain('data-pk-avatar')
  })

  it('DRMS 13/10 #9: every former menu entry stays reachable as a landing tile of its module', async () => {
    for (const roles of [['pk-owner'], ['pk-finance'], ['pk-pm'], ['pk-admin'], ['pk-staff']] as Role[][]) {
      for (const m of await modulesFor(roles, 2)) {
        const tiles = landingSections(m).flatMap((s) => s.tiles.map((t) => t.href))
        const items = m.sections.flatMap((s) => s.items.map((i) => i.href))
        if (m.landing) expect(tiles).toEqual(items)
        else expect(m.href).toBe(items[0])
      }
    }
  })

  it('breadcrumb line: none on the launcher (no empty row), module home on entity pages and (D9) custom views', async () => {
    const kas = await bar('/admin/kas', ['pk-finance'])
    expect(kas).toMatch(/data-pk-crumb="home"[^>]*href="\/admin\/modul\/keuangan"/)
    expect(kas).toMatch(/aria-current="page"[^>]*>.*?Buku kas/)
    expect(await bar('/admin', ['pk-finance'])).not.toContain('pk-crumbs')
    expect(await bar('/admin/dashboard', ['pk-finance'])).not.toContain('pk-crumbs')
    const html = await bar('/admin/collections/expense-requests/1', ['pk-finance'], [
      { label: { id: 'Pengajuan biaya', en: 'Expense requests' }, url: '/admin/collections/expense-requests' },
      { label: 'PB-2026-0001' },
    ])
    expect(html).toContain('aria-label="Lokasi halaman"')
    expect(html).toMatch(/data-pk-crumb="home" data-mod="keuangan"/)
    expect(html).toContain('>Keuangan<')
    expect(html).toContain('>Pengajuan biaya<')
    expect(html).toMatch(/aria-current="page"[^>]*>.*?PB-2026-0001/)
    // no Payload graphics icon / "D" home crumb
    expect(html).not.toContain('step-nav')
  })
})

describe('breadcrumbs (deriveCrumbs)', () => {
  const t = (l: unknown) => (typeof l === 'string' ? l : ((l as Record<string, string>)?.id ?? ''))
  let keu: ResolvedModule
  let persetujuan: ResolvedModule
  beforeAll(async () => {
    const mods = await modulesFor(['pk-finance'])
    keu = mods.find((m) => m.id === 'keuangan')!
    persetujuan = mods.find((m) => m.id === 'persetujuan')!
  })
  const crumbs = (pathname: string, module: ResolvedModule | null, steps: StepLike[] | null) =>
    deriveCrumbs({ pathname, module, steps, translate: t }).map((c) => [c.label, c.href ?? null, c.current ? 'current' : ''])

  it('routeOf', () => {
    expect(routeOf('/admin/collections/receipts/5?x=1')).toEqual({ kind: 'collection', slug: 'receipts', deeper: true })
    expect(routeOf('/admin/globals/company-settings/')).toEqual({ kind: 'global', slug: 'company-settings', deeper: false })
    expect(routeOf('/admin/account')).toEqual({ kind: 'account' })
    expect(routeOf('/admin/kas')).toEqual({ kind: 'other' })
    expect(routeOf('/admin')).toEqual({ kind: 'other' })
  })

  it('list view: module home (→ first menu item) › collection (current)', () => {
    expect(crumbs('/admin/collections/expense-requests', keu, [{ label: { id: 'Pengajuan biaya' } }])).toEqual([
      ['Keuangan', keu.href, ''],
      ['Pengajuan biaya', null, 'current'],
    ])
    const home = deriveCrumbs({ pathname: '/admin/collections/expense-requests', module: keu, steps: null, translate: t })[0]!
    expect(home).toMatchObject({ icon: 'finance', mod: 'keuangan' })
  })

  it('edit view: module › collection (link) › document (current)', () => {
    expect(
      crumbs('/admin/collections/expense-requests/1', keu, [
        { label: 'Pengajuan biaya', url: '/admin/collections/expense-requests' },
        { label: 'PB-2026-0001' },
      ]),
    ).toEqual([
      ['Keuangan', keu.href, ''],
      ['Pengajuan biaya', '/admin/collections/expense-requests', ''],
      ['PB-2026-0001', null, 'current'],
    ])
  })

  it('before Payload set its steps (SSR / previous page): fallback from the module menu, no jump', () => {
    const label = keu.sections.flatMap((s) => s.items).find((i) => i.href === '/admin/collections/cash-entries')!.label
    expect(crumbs('/admin/collections/cash-entries', keu, null)).toEqual([
      ['Keuangan', keu.href, ''],
      [label, null, 'current'],
    ])
    expect(crumbs('/admin/collections/cash-entries/9', keu, null)).toEqual([
      ['Keuangan', keu.href, ''],
      [label, '/admin/collections/cash-entries', ''],
    ])
  })

  it('launcher / unknown pages: no crumbs → no row', () => {
    expect(crumbs('/admin', null, null)).toEqual([])
    expect(crumbs('/admin/collections/unknown', null, null)).toEqual([])
  })

  it('D9: custom views of a module with a landing page lead back to it (module › menu item)', () => {
    expect(keu.href).toBe('/admin/modul/keuangan')
    expect(crumbs('/admin/kas', keu, null)).toEqual([
      ['Keuangan', '/admin/modul/keuangan', ''],
      ['Buku kas', null, 'current'],
    ])
    // deeper page of a view: the menu item stays a link
    expect(crumbs('/admin/kas/baru', keu, null)).toEqual([
      ['Keuangan', '/admin/modul/keuangan', ''],
      ['Buku kas', '/admin/kas', ''],
    ])
    expect(crumbs('/admin/antrian-transfer', keu, null)).toEqual([
      ['Keuangan', '/admin/modul/keuangan', ''],
      ['Antrian Transfer', null, 'current'],
    ])
  })

  it('D9: the landing page itself shows "Semua modul › module"', () => {
    expect(crumbs('/admin/modul/keuangan', keu, null)).toEqual([
      ['Semua modul', '/admin', ''],
      ['Keuangan', null, 'current'],
    ])
  })

  it('outside every module (account, entity hidden from the menu): home = "Semua modul" → launcher', () => {
    expect(crumbs('/admin/account', null, [{ label: 'Akun' }])).toEqual([
      ['Semua modul', '/admin', ''],
      ['Akun', null, 'current'],
    ])
    expect(crumbs('/admin/account', null, null)).toEqual([
      ['Semua modul', '/admin', ''],
      ['Akun', null, 'current'],
    ])
  })

  it('a step repeating the module name is not shown twice', () => {
    expect(crumbs('/admin/collections/approvals', persetujuan, [{ label: 'Persetujuan' }])).toEqual([['Persetujuan', null, 'current']])
    expect(crumbs('/admin/collections/approvals/3', persetujuan, [{ label: 'Persetujuan', url: '/admin/collections/approvals' }, { label: 'APV-1' }])).toEqual([
      ['Persetujuan', persetujuan.href, ''],
      ['APV-1', null, 'current'],
    ])
  })

  it('empty labels are dropped', () => {
    expect(crumbs('/admin/globals/company-settings', null, [{ label: '' }])).toEqual([])
  })
})


describe('pk-operator (owner decision 2026-10-09): attendance-only panel', () => {
  it('sees only Dashboard + Absensi; inside Absensi only "Absen" and its own recap', async () => {
    const m = await modulesFor(['pk-operator'])
    expect(ids(m)).toEqual(['dashboard', 'absensi'])
    expect(navKeys(m.filter((x) => x.id === 'absensi'))).toEqual(['absensi-absen', 'absensi-saya'])
    expect(m.find((x) => x.id === 'absensi')!.sections[0]!.items.find((i) => i.navKey === 'absensi-saya')!.label).toBe('Rekap absensi saya')
  })

  it('every other role also gets the "Absen" entry (web self check-in for all roles)', async () => {
    for (const r of ['pk-staff', 'pk-pm', 'pk-finance', 'pk-owner', 'pk-admin'] as Role[]) {
      expect(navKeys(await modulesFor([r])), r).toContain('absensi-absen')
    }
  })

  it('navUser flags an operator-only account', () => {
    expect(navUser({ id: 1, roles: ['pk-operator'], name: 'Opr Satu' } as unknown as TypedUser)).toMatchObject({ operatorOnly: true, staffOnly: false, roleLabel: 'Operator/Anggota' })
  })
})
