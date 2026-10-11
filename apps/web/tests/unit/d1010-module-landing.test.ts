import { describe, expect, it } from 'vitest'

import type { Role } from '@/access/roles'
import { ICONS } from '@/admin/modules/icons'
import { ITEM_ICONS, itemHref, landingSections, MODULES, moduleForPath, moduleLandingHref, resolveModules, type ResolvedModule } from '@/admin/modules/registry'

/** DRMS 10/10 D9: every module with ≥ 2 visible sub-menus opens a landing page of tiles. */
const resolve = (roles: Role[], canSee: (k: 'collection' | 'global', s: string) => boolean, canManage?: (k: 'collection' | 'global', s: string) => boolean) =>
  resolveModules({ roles, staffOnly: roles.length === 1 && roles[0] === 'pk-staff', canSee, canManage, labelOf: (_, s) => s })
const tiles = (m: ResolvedModule | undefined) => (m ? landingSections(m).flatMap((s) => s.tiles.map((t) => t.href)) : [])

describe('module href → landing page', () => {
  it('Master Data opens /admin/modul/master, not the first sub-menu (Bank)', () => {
    const master = resolve(['pk-admin'], () => true, () => true).find((m) => m.id === 'master')!
    expect(master).toMatchObject({ href: moduleLandingHref('master'), firstHref: '/admin/collections/banks', landing: true })
    expect(moduleForPath(master.href)).toBe('master')
  })
  it('single-item modules keep the direct link (Dashboard, Laporan)', () => {
    const mods = resolve(['pk-owner'], () => false)
    expect(mods.find((m) => m.id === 'dashboard')).toMatchObject({ href: '/admin/dashboard', landing: false })
    expect(mods.find((m) => m.id === 'laporan')).toMatchObject({ href: '/admin/laporan', landing: false })
  })
  it('a module reduced to one visible item by permissions links that item directly', () => {
    const master = resolve(['pk-admin'], (_, s) => s === 'banks', () => true).find((m) => m.id === 'master')!
    expect(master).toMatchObject({ href: '/admin/collections/banks', landing: false })
  })
})

describe('landing tiles respect permissions / hidden entities / role rules', () => {
  it('only the visible entities of the caller', () => {
    const master = resolve(['pk-admin'], (_, s) => s === 'banks' || s === 'vendors', () => true).find((m) => m.id === 'master')
    expect(tiles(master)).toEqual(['/admin/collections/banks', '/admin/collections/vendors'])
  })
  it('role-gated views: Staff never gets Buku kas / Tutup buku tiles; Finance does', () => {
    const staffKeu = resolve(['pk-staff'], (_, s) => s === 'expense-requests' || s === 'receipts').find((m) => m.id === 'keuangan')
    expect(tiles(staffKeu)).not.toContain('/admin/kas')
    expect(tiles(staffKeu)).not.toContain('/admin/tutup-buku')
    expect(tiles(staffKeu)).toContain('/admin/collections/expense-requests/create')
    const finKeu = resolve(['pk-finance'], () => true).find((m) => m.id === 'keuangan')
    expect(tiles(finKeu)).toEqual(expect.arrayContaining(['/admin/kas', '/admin/tutup-buku']))
  })
  it('manage modules are absent for read-only callers (no landing page to open)', () => {
    expect(resolve(['pk-pm'], () => true, () => false).find((m) => m.id === 'master')).toBeUndefined()
  })
  it('tiles carry section groups, badges and a "Buat baru" create tile', () => {
    const keu = resolve(['pk-finance'], () => true).find((m) => m.id === 'keuangan')!
    const sections = landingSections(keu)
    expect(sections.map((s) => s.label)).toEqual(['Pengajuan', 'Kas', 'Transfer & LPJ', 'Tutup buku'])
    const create = sections[0]!.tiles.find((t) => t.href.endsWith('/create'))!
    expect(create).toMatchObject({ label: 'Buat pengajuan', hint: 'Buat baru', icon: 'add' })
    const per = resolveModules({ roles: ['pk-finance'], staffOnly: false, canSee: () => true, labelOf: (_, s) => s, badges: { transfers: 4 } }).find((m) => m.id === 'persetujuan')!
    expect(landingSections(per)[0]!.tiles.find((t) => t.navKey === 'antrian-transfer')).toMatchObject({ badge: 4 })
  })
})

describe('landing tile icons (Lead review f)', () => {
  it('every registry item has its own tile glyph, and every glyph exists', () => {
    const missing: string[] = []
    for (const m of MODULES) for (const s of m.sections) for (const it of s.items) {
      const rel = itemHref(it).slice('/admin'.length)
      if ('view' in it && it.label.startsWith('+')) continue
      if (!ITEM_ICONS[rel]) missing.push(rel)
    }
    expect(missing).toEqual([])
    for (const [k, v] of Object.entries(ITEM_ICONS)) expect(ICONS[v], k).toBeDefined()
  })
  it('tiles of a module are not all the same generic glyph', () => {
    for (const m of resolve(['pk-admin', 'pk-finance', 'pk-owner', 'pk-pm'], () => true, () => true)) {
      const icons = landingSections(m).flatMap((s) => s.tiles.map((t) => t.icon))
      for (const i of icons) expect(ICONS[i]).toBeDefined()
      expect(icons.filter((i) => i === 'document')).toEqual([])
      if (icons.length >= 3) expect(new Set(icons).size, m.id).toBeGreaterThanOrEqual(Math.ceil(icons.length * 0.8))
    }
    const master = resolve(['pk-admin'], () => true, () => true).find((m) => m.id === 'master')!
    expect(Object.fromEntries(landingSections(master)[0]!.tiles.map((t) => [t.href, t.icon]))).toMatchObject({ '/admin/collections/banks': 'tBuilding3', '/admin/collections/vehicles': 'tCar', '/admin/collections/uoms': 'tRuler' })
  })
})
