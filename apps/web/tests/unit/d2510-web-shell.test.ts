import { describe, expect, it } from 'vitest'

import { resolveModules } from '@/admin/modules/registry'
import { fold, isPaletteShortcut, navEntries, searchNav, sidebarCookie, sidebarMode, SIDEBAR_COOKIE } from '@/admin/shell/nav-search'

/** D2510 (user 2026-10-25, ADR 0033): Nexus sidebar shell — menu search + compact-sidebar cookie (pure helpers). */
const mods = (roles: Parameters<typeof resolveModules>[0]['roles']) =>
  resolveModules({ roles, staffOnly: false, canSee: () => true, canManage: () => true, labelOf: (_, s) => s, badges: { approvals: 3 }, features: { fieldReports: true } })

describe('navEntries', () => {
  it('one entry per menu href (alias placements de-duplicated), module + section path, item glyph and badge', () => {
    const e = navEntries(mods(['pk-owner']))
    const hrefs = e.map((x) => x.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
    const p = e.find((x) => x.href === '/admin/persetujuan')!
    expect(p).toMatchObject({ mod: 'persetujuan', moduleLabel: 'Persetujuan', badge: 3, icon: 'approval' })
    // every visible item is searchable
    const all = mods(['pk-owner']).flatMap((m) => m.sections.flatMap((s) => s.items.map((i) => i.href)))
    expect(new Set(hrefs)).toEqual(new Set(all))
  })

  it('"+ X baru" shortcuts read as "Buat X" and match "buat"/"tambah"', () => {
    const e = navEntries(mods(['pk-owner']))
    const plus = mods(['pk-owner']).flatMap((m) => m.sections.flatMap((s) => s.items)).filter((i) => i.label.startsWith('+'))
    for (const i of plus) {
      const x = e.find((y) => y.href === i.href)
      if (!x) continue // the same href placed earlier without "+"
      expect(x.label.startsWith('Buat ')).toBe(true)
      expect(x.haystack).toContain('tambah')
    }
  })
})

describe('searchNav', () => {
  const e = navEntries(mods(['pk-finance']))

  it('empty query → the first entries (never a blank list)', () => {
    expect(searchNav(e, '   ', 5)).toEqual(e.slice(0, 5))
  })

  it('every word must match (any order, case/diacritics folded); label prefix ranks first', () => {
    const r = searchNav(e, 'KAS')
    expect(r.length).toBeGreaterThan(0)
    expect(r.every((x) => x.haystack.includes('kas'))).toBe(true)
    expect(fold(r[0]!.label).split(' ').some((w) => w.startsWith('kas'))).toBe(true)
    expect(searchNav(e, 'zzz tidak ada')).toEqual([])
    expect(fold('  Pengajuan   Biáya ')).toBe('pengajuan biaya')
  })

  it('module name finds its items', () => {
    const r = searchNav(e, 'keuangan', 50)
    expect(r.length).toBeGreaterThan(1)
    expect(r.every((x) => x.haystack.includes('keuangan'))).toBe(true)
  })
})

describe('shortcut + cookie', () => {
  it('Ctrl+K / ⌘K only', () => {
    const k = (o: Partial<KeyboardEvent>) => isPaletteShortcut({ key: 'k', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o })
    expect(k({ ctrlKey: true })).toBe(true)
    expect(k({ metaKey: true, key: 'K' })).toBe(true)
    expect(k({})).toBe(false)
    expect(k({ ctrlKey: true, shiftKey: true })).toBe(false)
    expect(k({ ctrlKey: true, key: 'j' })).toBe(false)
  })

  it('sidebar mode: only "compact" is compact; the cookie is scoped to /admin for a year', () => {
    expect(sidebarMode('compact')).toBe('compact')
    for (const v of [undefined, null, '', 'full', 'x']) expect(sidebarMode(v)).toBe('full')
    expect(sidebarCookie('compact')).toBe(`${SIDEBAR_COOKIE}=compact; Path=/admin; Max-Age=31536000; SameSite=Lax`)
  })
})

describe('Nexus kit (SSR)', () => {
  it('PageHeader, Panel, SoftBadge, StatusDot, Progress render their hooks and clamp the progress value', async () => {
    const { createElement: h } = await import('react')
    const { renderToString } = await import('react-dom/server')
    const { PageHeader, Panel, Progress, SoftBadge, StatusDot } = await import('@/admin/components/ui/nexus')
    const html = renderToString(
      h('div', null, [
        h(PageHeader, { key: 'h', title: 'Buku kas', sub: 'Per hari ini', icon: 'finance', mod: 'keuangan', actions: h('a', { href: '#' }, 'Ekspor') }),
        h(Panel, { key: 'p', id: 'acc', title: 'Akun kas', icon: 'finance', note: '(3)', foot: 'kaki', flush: true, 'data-pk-card': 'acc' }, h(SoftBadge, { tone: 'ok' }, 'Aktif')),
        h(StatusDot, { key: 's', tone: 'warn', label: 'Tertunda' }),
        h(Progress, { key: 'g', value: 140, label: 'Anggaran terpakai' }),
      ]),
    )
    expect(html).toContain('data-pk-page-head')
    expect(html).toMatch(/<h1[^>]*>Buku kas<\/h1>/)
    expect(html).toContain('aria-labelledby="acc-title"')
    expect(html).toContain('data-pk-card="acc"')
    expect(html).toContain('pk-nx-card__body is-flush')
    expect(html).toContain('data-tone="ok"')
    expect(html).toContain('aria-valuenow="100"')
    expect(html).toContain('width:100%')
  })
})
