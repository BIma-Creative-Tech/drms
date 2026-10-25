import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'

import { F3_STYLE } from '@/admin/views/f3-ui'
import { VIZ_STYLE } from '@/admin/views/viz'

/**
 * D2510 PR-2 (ADR 0033, Nexus look): the dashboard primitives keep their hooks (`pk-card s{span}` + data-pk-card,
 * data-pk-kpi, data-pk-status-tone) while gaining the Nexus head glyph / buttons, the muted "Rp" prefix, the delta soft
 * badge, MetricRow ("Sale Metrics"), ProgressRows, QuickActions and the segmented tabs.
 */
const render = async (node: (h: typeof import('react').createElement, v: typeof import('@/admin/views/viz')) => ReactElement) => {
  const { createElement: h } = await import('react')
  const { renderToString } = await import('react-dom/server')
  const v = await import('@/admin/views/viz')
  return renderToString(node(h, v))
}

describe('Card / KpiTile / Delta (Nexus restyle, same hooks)', () => {
  it('Card: root classes stay `pk-card s{span}` before data-pk-card; glyph, extra actions and the action link in the head', async () => {
    const html = await render((h, v) => h(v.Card, { id: 'acc', title: 'Saldo kas total', sub: 'Per akun', span: 8, icon: 'finance', actions: h('a', { href: '#x', className: 'pk-btn sm' }, 'Ekspor'), action: { href: '/admin/kas', label: 'Buku kas' }, className: 'pk-hero' }, 'isi'))
    expect(html).toMatch(/class="pk-card s8 pk-anim pk-hero"[^>]*data-pk-card="acc"/)
    expect(html).toContain('aria-labelledby="pk-card-acc"')
    expect(html).toMatch(/<svg class="gl"/)
    expect(html).toMatch(/<div class="acts"><a href="#x" class="pk-btn sm">Ekspor<\/a><a class="pk-btn sm" href="\/admin\/kas" data-pk-card-action="">/)
    // without icon / actions: no glyph, no empty action box (Frame pages keep their markup)
    const plain = await render((h, v) => h(v.Card, { id: 'p', title: 'T' }, 'x'))
    expect(plain).not.toContain('class="gl"')
    expect(plain).not.toContain('class="acts"')
  })

  it('KpiTile: a Rupiah value gets a smaller "Rp" prefix, the exact text stays in the title; other values unchanged', async () => {
    const html = await render((h, v) => h(v.KpiTile, { id: 'cash', icon: 'wallet', label: 'Saldo kas total', value: 'Rp 12.500.000', kpi: 'k01-total' }))
    expect(html).toContain('data-pk-tile="cash"')
    expect(html).toMatch(/data-pk-kpi="k01-total" title="Rp 12.500.000"><span class="cur">Rp<\/span>(?: |<!-- -->)+12\.500\.000<\/p>/)
    expect(html).toContain('<span class="lt">Saldo kas total</span>')
    const neg = await render((h, v) => h(v.KpiTile, { id: 'x', icon: 'wallet', label: 'L', value: '-Rp 5.000' }))
    expect(neg).toMatch(/title="-Rp 5\.000">-(?:<!-- -->)?<span class="cur">Rp<\/span>/)
    const count = await render((h, v) => h(v.KpiTile, { id: 'n', icon: 'clock', label: 'Menunggu', value: '12', kpi: 'k10-count' }))
    expect(count).toMatch(/data-pk-kpi="k10-count">12<\/p>/)
    expect(count).not.toContain('title=')
  })

  it('Delta: soft badge (ok / bad / neutral by direction × good) with ↑/↓ and a muted "vs …"', async () => {
    const up = await render((h, v) => h(v.Delta, { d: { diff: 20, pct: 20, dir: 'up' }, good: 'up', vs: 'vs Sep' }))
    expect(up).toMatch(/class="pk-delta good"><span class="pk-nx-badge" data-tone="ok"><span class="ar" aria-hidden="true">↑<\/span>/)
    expect(up).toContain('<span class="vs">vs Sep</span>')
    const down = await render((h, v) => h(v.Delta, { d: { diff: -5, pct: null, dir: 'down' }, good: 'up', vs: 'vs Sep', money: false }))
    expect(down).toContain('data-tone="bad"')
    expect(down).toContain('↓')
    const neutral = await render((h, v) => h(v.Delta, { d: { diff: 5, pct: 1, dir: 'up' }, vs: 'vs Sep' }))
    expect(neutral).toContain('data-tone="neutral"')
  })
})

describe('MetricRow / ProgressRows / QuickActions / Segmented', () => {
  it('MetricRow: status dot + label, value with its data-pk-kpi (linked when href), muted sub line, column count', async () => {
    const html = await render((h, v) =>
      h(v.MetricRow, {
        label: 'Kelengkapan',
        cols: 4,
        items: [
          { key: 'a', label: 'Belum LPJ', value: '3', sub: 'pengajuan baru belum LPJ', tone: 'warn', kpi: 'k12a' },
          { key: 'b', label: 'Sisa', value: 'Rp 7.500.000', href: '/admin/laporan' },
        ],
      }),
    )
    expect(html).toContain('aria-label="Kelengkapan"')
    expect(html).toContain('--pk-mc:4')
    expect(html).toMatch(/data-pk-metric="a">.*class="pk-nx-status__dot" data-tone="warn"/)
    expect(html).toMatch(/data-pk-kpi="k12a">3<\/p><p class="pk-metric-x">pengajuan baru belum LPJ<\/p>/)
    expect(html).toMatch(/<a href="\/admin\/laporan"><span class="cur">Rp<\/span>/)
    expect(html).toContain('data-tone="primary"') // default tone
  })

  it('ProgressRows: kit Progress per row (clamped, named), link + attrs, empty state without rows', async () => {
    const html = await render((h, v) =>
      h(v.ProgressRows, { id: 'budget', empty: 'Kosong', aria: (it) => `${String(it.label)} anggaran`, items: [{ key: '1', label: 'P1 Gudang', value: 130, right: '130%', tone: 'bad', href: '/admin/laporan/anggaran-project?project=1', attrs: { 'data-pk-budget-project': 'P1' } }] }),
    )
    expect(html).toContain('data-pk-chart="budget"')
    expect(html).toContain('data-pk-budget-project="P1"')
    expect(html).toMatch(/<a class="pk-prow" href="\/admin\/laporan\/anggaran-project\?project=1">/)
    expect(html).toContain('aria-label="P1 Gudang anggaran"')
    expect(html).toContain('aria-valuenow="100"')
    const empty = await render((h, v) => h(v.ProgressRows, { id: 'e', empty: 'Belum ada project ber-RAB.', aria: () => '', items: [] }))
    expect(empty).toContain('data-pk-empty')
    expect(empty).toContain('Belum ada project ber-RAB.')
  })

  it('QuickActions: square icon links with labels and stable hooks; Segmented = nav with aria-label', async () => {
    const html = await render((h, v) => h(v.QuickActions, { label: 'Aksi cepat', items: [{ key: 'kas', href: '/admin/kas/baru', label: '+ Kas', icon: 'add', primary: true }, { key: 'lpj', href: '/admin/verifikasi-lpj', label: 'Verifikasi LPJ', icon: 'tReceiptSearch' }] }))
    expect(html).toMatch(/<a href="\/admin\/kas\/baru" class="primary" data-pk-quick-action="kas"><span class="qi" aria-hidden="true"><svg/)
    expect(html).toContain('<span>Verifikasi LPJ</span>')
    const seg = await render((h, v) => h(v.Segmented, { label: 'Tampilan peran' }, h('a', { href: '/admin/dashboard?peran=pm', 'aria-current': 'page', 'data-pk-role-tab': 'pm' }, 'PM')))
    expect(seg).toMatch(/<nav class="pk-seg" aria-label="Tampilan peran"><a href="\/admin\/dashboard\?peran=pm" aria-current="page" data-pk-role-tab="pm">PM<\/a><\/nav>/)
  })

  it('StatusPill keeps its tone hook and glyph', async () => {
    const html = await render((h, v) => h(v.StatusPill, { tone: 'bad', label: 'Void' }))
    expect(html).toMatch(/class="pk-pill bad" data-pk-status-tone="bad"><span aria-hidden="true">✕<\/span>Void/)
  })
})

describe('styles (DRMS 16/10 wrap rule, tokens only, touch targets)', () => {
  it('no ellipsis on data text in the dashboard / report styles', () => {
    expect(VIZ_STYLE).not.toMatch(/text-overflow:\s*ellipsis/)
    expect(F3_STYLE).not.toMatch(/text-overflow:\s*ellipsis/)
  })
  it('no raw hex colours (theme tokens only) and soft badges', () => {
    expect(F3_STYLE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(F3_STYLE).toMatch(/\.pk-badge \{[^}]*border-radius: 999px;[^}]*background: color-mix\(in oklab, currentColor 14%, var\(--pk-card\)\)/)
    expect(VIZ_STYLE).toMatch(/\.pk-pill \{[^}]*background: color-mix\(in oklab, var\(--pk-pill\) 14%, var\(--pk-card\)\)/)
  })
  it('44 px targets on touch for the new controls (segmented, card buttons, quick actions ≥ 92 px, account menu)', () => {
    expect(VIZ_STYLE).toMatch(/@media \(pointer: coarse\) \{ \.pk-f3 \.pk-seg a \{ min-height: 44px; \} \}/)
    expect(VIZ_STYLE).toMatch(/@media \(pointer: coarse\) \{ \.pk-f3 \.pk-card-h \.pk-btn\.sm, \.pk-f3 \.pk-es \.pk-btn\.sm \{ min-height: 44px; \} \}/)
    expect(VIZ_STYLE).toMatch(/@media \(pointer: coarse\) \{ \.pk-f3 \.pk-acc-m \{ width: 44px; height: 44px;/)
    expect(VIZ_STYLE).toMatch(/\.pk-f3 \.pk-qa a \{[^}]*min-height: 96px;/)
  })
})
