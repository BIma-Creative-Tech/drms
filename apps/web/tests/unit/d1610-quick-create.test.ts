import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { SanitizedConfig, TypedUser } from 'payload'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { ROLES, withCompanyContext, type Role } from '@/access/roles'
import * as adminViews from '@/admin/config'
import { ICONS } from '@/admin/modules/icons'
import { navUser, quickCreateFor } from '@/admin/shell/modules-server'
import {
  canCreateFrom,
  isQuickCreateShortcut,
  mayCreate,
  payeePreset,
  QUICK_CREATE_DEFS,
  QUICK_CREATE_ROLES,
  QUICK_GROUPS,
  QUICK_ROLE_RULES,
  quickCreateGroups,
  showsQuickCreate,
  type QuickCreateGroup,
} from '@/admin/shell/quick-create'
import { REQUEST_CREATE_ROLES } from '@/collections/ExpenseRequests'
import { KAS_WRITE_ROLES } from '@/domain/cash/book'
import { VENDOR_PAYMENT_ROLES } from '@/domain/expense/drafts'

/**
 * DRMS 16/10 (owner 2026-10-16, "konsep no. 1"): the global "+ Buat" menu of the top bar. Items per role with the REAL
 * Payload config (create access + admin.hidden), the custom-view role rules, PT features, menu order, the routes the
 * items open, the Alt+N shortcut and the "Pembayaran vendor" preset.
 */
let config: SanitizedConfig

const nav = vi.hoisted(() => ({ path: '/admin' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.path, useSearchParams: () => new URLSearchParams() }))
vi.mock('@payloadcms/ui', () => ({
  useTheme: () => ({ theme: 'light', setTheme: () => undefined, autoMode: false }),
  useStepNav: () => ({ stepNav: [], setStepNav: () => undefined }),
  useTranslation: () => ({ i18n: { language: 'id', fallbackLanguage: 'en' }, t: (k: string) => k }),
}))

beforeAll(async () => {
  process.env.PK_SKIP_ENV_CHECK = 'true'
  config = await (await import('@/payload.config')).default
})

/** The user object of the auth strategies: roles from one membership (PT #1). */
const userWith = (roles: Role[]) => withCompanyContext({ id: 42, collection: 'users', email: 'uji@contoh.test', name: 'Uji Coba' }, [{ company: 1, roles, employee: null }], null, roles.includes('pk-admin')) as unknown as TypedUser

/** Payload create permission per collection (access.create truthy; a rule that needs the DB counts as granted) + visibleEntities (admin.hidden). */
async function navProps(user: TypedUser) {
  const payload = new Proxy({}, { get: () => () => Promise.reject(new Error('no db in unit test')) })
  const req = { user, payload, context: {} }
  const collections: Record<string, { create: boolean }> = {}
  for (const c of config.collections) {
    let create = true
    if (c.access?.create) {
      try {
        create = Boolean(await (c.access.create as (a: unknown) => unknown)({ req }))
      } catch {
        create = true
      }
    }
    collections[c.slug] = { create }
  }
  const vis = (h: unknown) => !(typeof h === 'function' ? (h as (a: { user: unknown }) => boolean)({ user }) : h)
  return { permissions: { collections }, visibleEntities: { collections: config.collections.filter((c) => vis(c.admin?.hidden)).map((c) => c.slug) } }
}

async function menuFor(roles: Role[], fieldReports = false): Promise<QuickCreateGroup[]> {
  const user = userWith(roles)
  const { permissions, visibleEntities } = await navProps(user)
  return quickCreateFor({ user, permissions: permissions as never, visibleEntities: visibleEntities as never, features: { fieldReports } })
}
const labels = (g: QuickCreateGroup[]) => g.flatMap((x) => x.items.map((i) => i.label))

describe('"+ Buat" items per role (real Payload config)', () => {
  it('Finance: requests, vendor payment, Kas masuk / keluar, new vendor', async () => {
    const g = await menuFor(['pk-finance'])
    expect(g.map((x) => x.id)).toEqual(['keuangan', 'mitra'])
    expect(labels(g)).toEqual(['Pengajuan baru', 'Pembayaran vendor', 'Kas masuk', 'Kas keluar', 'Vendor baru'])
  })

  it('PM: requests, vendor payment, project, Addendum RAB (+ Laporan harian where a PT has field reports)', async () => {
    expect(labels(await menuFor(['pk-pm']))).toEqual(['Pengajuan baru', 'Pembayaran vendor', 'Proyek baru', 'Addendum RAB'])
    expect(labels(await menuFor(['pk-pm'], true))).toEqual(['Pengajuan baru', 'Pembayaran vendor', 'Proyek baru', 'Laporan harian', 'Addendum RAB'])
  })

  it('Direktur (and the Owner, ADR 0026): own request, project, client — no Kas, no vendor payment', async () => {
    const want = ['Pengajuan baru', 'Proyek baru', 'Klien baru']
    expect(labels(await menuFor(['pk-owner']))).toEqual(want)
    expect(labels(await menuFor(['pk-principal']))).toEqual(want)
    expect(labels(await menuFor(['pk-owner'], true))).toEqual(['Pengajuan baru', 'Proyek baru', 'Laporan harian', 'Klien baru'])
  })

  it('Admin: request on behalf, project, client, vendor, the tabbed Pengguna form, employee', async () => {
    const g = await menuFor(['pk-admin'])
    expect(g.map((x) => x.id)).toEqual(['keuangan', 'proyek', 'mitra', 'pengguna'])
    expect(labels(g)).toEqual(['Pengajuan baru', 'Proyek baru', 'Klien baru', 'Vendor baru', 'Pengguna baru', 'Karyawan baru'])
    expect(g.find((x) => x.id === 'pengguna')!.items.find((i) => i.key === 'pengguna')!.href).toBe('/admin/pengguna/baru')
  })

  it('several roles: union in menu order, no duplicates', async () => {
    const all = labels(await menuFor(['pk-finance', 'pk-pm', 'pk-admin', 'pk-owner'], true))
    expect(all).toEqual(['Pengajuan baru', 'Pembayaran vendor', 'Kas masuk', 'Kas keluar', 'Proyek baru', 'Laporan harian', 'Addendum RAB', 'Klien baru', 'Vendor baru', 'Pengguna baru', 'Karyawan baru'])
    expect(new Set(all).size).toBe(all.length)
  })

  it('Staff / Operator get no button (even when Staff may create requests)', async () => {
    expect(await menuFor(['pk-staff'], true)).toEqual([])
    expect(await menuFor(['pk-operator'])).toEqual([])
    expect(showsQuickCreate(['pk-staff', 'pk-operator'])).toBe(false)
    // a Staff who is also PM in the selected PT gets the PM menu
    expect(labels(await menuFor(['pk-staff', 'pk-pm']))).toContain('Pengajuan baru')
  })

  it('no role in the selected PT → nothing', () => {
    expect(quickCreateGroups({ roles: [], canCreate: () => true, features: { fieldReports: true } })).toEqual([])
  })
})

describe('items follow the permissions, not the role names', () => {
  const all = () => true
  it('a collection without create permission drops its items (vendor payment needs the request create too)', () => {
    const g = quickCreateGroups({ roles: ['pk-finance'], canCreate: (s) => s !== 'expense-requests' })
    expect(labels(g)).toEqual(['Kas masuk', 'Kas keluar', 'Vendor baru'])
  })
  it('a hidden collection (visibleEntities) counts as not creatable', () => {
    const can = canCreateFrom({ collections: { vendors: { create: true }, clients: { create: true } } }, { collections: ['clients'] })
    expect(can('vendors')).toBe(false)
    expect(can('clients')).toBe(true)
    expect(can('projects')).toBe(false)
  })
  it('custom create views keep their role rules even with every permission granted', () => {
    expect(labels(quickCreateGroups({ roles: ['pk-owner'], canCreate: all }))).not.toContain('Kas masuk')
    expect(labels(quickCreateGroups({ roles: ['pk-owner'], canCreate: all }))).not.toContain('Pengguna baru')
    expect(labels(quickCreateGroups({ roles: ['pk-admin'], canCreate: all }))).not.toContain('Addendum RAB')
  })
  it('mayCreate: Payload sends true, { permission, where? }, or nothing', () => {
    expect(mayCreate(true)).toBe(true)
    expect(mayCreate({ permission: true })).toBe(true)
    expect(mayCreate({ permission: true, where: { company: { in: [1] } } })).toBe(true)
    expect(mayCreate({ permission: false })).toBe(false)
    expect(mayCreate(false)).toBe(false)
    expect(mayCreate(undefined)).toBe(false)
  })
})

describe('menu definition', () => {
  it('role rules mirror their sources (custom views + /api/v1 re-check them)', () => {
    expect([...QUICK_ROLE_RULES.vendorPayment].sort()).toEqual([...VENDOR_PAYMENT_ROLES].sort())
    expect([...QUICK_ROLE_RULES.kasWrite].sort()).toEqual([...KAS_WRITE_ROLES].sort())
    // admin/views/field-ui.tsx renders the admin template (not importable in a node unit test) → read the constant
    const fieldUi = readFileSync(fileURLToPath(new URL('../../src/admin/views/field-ui.tsx', import.meta.url)), 'utf8')
    const creators = fieldUi.match(/export const FIELD_CREATORS: readonly Role\[\] = \[([^\]]*)\]/)?.[1]
    expect(creators?.match(/pk-[a-z]+/g)?.sort()).toEqual([...QUICK_ROLE_RULES.dailyReport].sort())
    // every button role may file a request (ADR 0024: the Direktur its own)
    for (const r of QUICK_CREATE_ROLES) expect(REQUEST_CREATE_ROLES).toContain(r)
    expect(QUICK_CREATE_ROLES.every((r) => ROLES.includes(r))).toBe(true)
  })

  it('keys unique, labels Indonesian without the "+" prefix, glyphs exist, groups in QUICK_GROUPS order', () => {
    const keys = QUICK_CREATE_DEFS.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const d of QUICK_CREATE_DEFS) {
      expect(d.label).not.toMatch(/^\+/)
      expect(ICONS[d.icon]).toBeDefined()
    }
    const order = QUICK_GROUPS.map((g) => g.id)
    const seen = QUICK_CREATE_DEFS.map((d) => order.indexOf(d.group))
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
  })

  it('every item opens an existing create page: a collection create view or a registered custom view', () => {
    const viewPaths = new Set(
      Object.values(adminViews)
        .flatMap((group) => Object.values(group as unknown as Record<string, { path?: unknown }>))
        .map((v) => v.path)
        .filter((p): p is string => typeof p === 'string'),
    )
    for (const d of QUICK_CREATE_DEFS) {
      const path = d.href.split('?')[0]!
      expect(path.startsWith('/admin/')).toBe(true)
      const m = path.match(/^\/admin\/collections\/([^/]+)\/create$/)
      if (m) {
        expect(config.collections.some((c) => c.slug === m[1])).toBe(true)
        expect(d.collection).toBe(m[1])
      } else expect(viewPaths.has(path.slice('/admin'.length))).toBe(true)
    }
  })

  it('"Pembayaran vendor" presets Jenis penerima on the request form; only known payee types', () => {
    expect(QUICK_CREATE_DEFS.find((d) => d.key === 'pembayaran-vendor')!.href).toBe('/admin/collections/expense-requests/create?penerima=vendor')
    expect(payeePreset('vendor')).toBe('vendor')
    expect(payeePreset('pt_grup')).toBe('pt_grup')
    expect(payeePreset('karyawan')).toBeNull()
    expect(payeePreset('x')).toBeNull()
    expect(payeePreset(null)).toBeNull()
  })
})

describe('Alt+N shortcut', () => {
  const ev = (o: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; code: string; key: string }>) => ({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...o })
  it('Alt+N (Windows/Linux) and Option+N (macOS dead key, by code) open the menu', () => {
    expect(isQuickCreateShortcut(ev({ altKey: true, key: 'n', code: 'KeyN' }), false)).toBe(true)
    expect(isQuickCreateShortcut(ev({ altKey: true, key: 'Dead', code: 'KeyN' }), false)).toBe(true)
  })
  it('never while typing, never with Ctrl/Cmd/Shift, never plain N', () => {
    expect(isQuickCreateShortcut(ev({ altKey: true, key: 'n', code: 'KeyN' }), true)).toBe(false)
    expect(isQuickCreateShortcut(ev({ altKey: true, ctrlKey: true, key: 'n', code: 'KeyN' }), false)).toBe(false)
    expect(isQuickCreateShortcut(ev({ altKey: true, metaKey: true, key: 'n', code: 'KeyN' }), false)).toBe(false)
    expect(isQuickCreateShortcut(ev({ altKey: true, shiftKey: true, key: 'N', code: 'KeyN' }), false)).toBe(false)
    expect(isQuickCreateShortcut(ev({ key: 'n', code: 'KeyN' }), false)).toBe(false)
  })
})

describe('ModuleBar "+ Buat" button (SSR)', () => {
  async function bar(roles: Role[], quickCreate?: QuickCreateGroup[]) {
    const { ModuleBar } = await import('@/admin/shell/ModuleBar')
    const user = navUser({ id: 42, roles, name: 'Uji Coba' } as unknown as TypedUser)
    return renderToString(createElement(ModuleBar, { modules: [], user, quickCreate, bell: createElement('a', { 'data-pk-nav-link': 'notifikasi' }), logout: null }))
  }

  it('closed button with the accessible name, shortcut and the visible "Buat" text; before the bell and the avatar', async () => {
    const html = await bar(['pk-finance'], await menuFor(['pk-finance']))
    expect(html).toContain('data-pk-quick-create')
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-label="Buat baru"[^>]*aria-keyshortcuts="Alt\+N"/)
    expect(html).toContain('pk-quick__text')
    expect(html.indexOf('data-pk-quick-create')).toBeLessThan(html.indexOf('data-pk-nav-link="notifikasi"'))
    expect(html.indexOf('data-pk-quick-create')).toBeLessThan(html.indexOf('data-pk-avatar'))
    // the menu renders only when opened
    expect(html).not.toContain('data-pk-quick=')
  })

  it('no items (Staff) → no button; the rest of the bar unchanged', async () => {
    for (const q of [undefined, [] as QuickCreateGroup[], await menuFor(['pk-staff'])]) {
      const html = await bar(['pk-staff'], q)
      expect(html).not.toContain('data-pk-quick-create')
      expect(html).toContain('data-pk-avatar')
    }
  })
})
