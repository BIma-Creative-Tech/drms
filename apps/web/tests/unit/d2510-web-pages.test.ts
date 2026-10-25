import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { KAS_STYLE } from '@/admin/components/kas/style'
import { SlaAgeBadge } from '@/admin/components/SlaAgeBadge'
import { FIELD_STYLE } from '@/admin/views/field-style'
import { Badge, NX_TABLE, pageModuleOf, pageModuleOfPath } from '@/admin/views/page-ui'
import { PROGRESS_STYLE } from '@/admin/views/progress-ui'

/**
 * D2510 PR-4 (ADR 0033): the custom pages in the Nexus look — page header chip per route, soft badges that keep
 * their data-pk-* hooks, the custom-page CSS section (tokens only, wrap not ellipsis), no inline-style helpers left.
 */
// alias: the kit badges take `children` as a typed prop (react/no-children-prop only knows createElement)
const h = createElement
const src = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8')

describe('page header module chip (page-ui.tsx)', () => {
  it('route → module of the sidebar + glyph of the longest matching item', () => {
    expect(pageModuleOfPath('/admin/kas')).toEqual({ mod: 'keuangan', icon: 'tBook' })
    expect(pageModuleOfPath('/admin/kas/12/ubah')).toEqual({ mod: 'keuangan', icon: 'tBook' })
    expect(pageModuleOfPath('/admin/absensi/rekap?bulan=2026-10')).toEqual({ mod: 'absensi', icon: 'tCalendar2' })
    expect(pageModuleOfPath('/admin/laporan/rekap-kas')).toEqual({ mod: 'laporan', icon: 'report' })
    expect(pageModuleOf({ params: { segments: ['persetujuan'] } })).toEqual({ mod: 'persetujuan', icon: 'approval' })
  })

  it('unknown route / no segments → no chip', () => {
    expect(pageModuleOfPath('/admin/tidak-ada')).toBeNull()
    expect(pageModuleOf({ params: {} })).toBeNull()
    expect(pageModuleOf({})).toBeNull()
  })
})

describe('soft badges keep the hooks', () => {
  it('Badge: kit markup, legacy tones mapped, data-* / aria-label / title forwarded', () => {
    const html = renderToStaticMarkup(h(Badge, { tone: 'muted', title: 't', 'aria-label': 'Label', 'data-pk-queue-vendor': 7, children: 'Pembayaran vendor' }))
    expect(html).toBe('<span class="pk-nx-badge" data-tone="neutral" title="t" aria-label="Label" data-pk-queue-vendor="7">Pembayaran vendor</span>')
    expect(renderToStaticMarkup(h(Badge, { tone: 'bad', children: 'x' }))).toContain('data-tone="bad"')
    expect(renderToStaticMarkup(h(Badge, { tone: 'info', children: 'x' }))).toContain('data-tone="info"')
    expect(NX_TABLE).toBe('pk-nx-table')
  })

  it('SlaAgeBadge: soft badge with data-pk-sla, no inline style', () => {
    const over = renderToStaticMarkup(createElement(SlaAgeBadge, { sla: { approvedAt: '2026-10-20T00:00:00Z', slaHours: 24, ageHours: 30, over: true } }))
    expect(over).toMatch(/^<span class="pk-nx-badge" data-tone="bad"[^>]*data-pk-sla="over"/)
    expect(over).not.toContain('style=')
    const none = renderToStaticMarkup(createElement(SlaAgeBadge, { sla: { approvedAt: null, slaHours: 24, ageHours: null, over: false } }))
    expect(none).toBe('<span class="pk-nx-sub">Umur sejak disetujui: —</span>')
  })

  it('ReimburseReceiptReview (rendered by the f2d integration test): one Nexus card, item cards, centred empty line', () => {
    const v = src('src/admin/components/ReimburseReceiptReview.tsx')
    expect(v).toContain('<Panel id="verifikasi-nota" icon="tReceipt" title={`Verifikasi nota Reimburse (${data.review.length})`} data-pk-section="reimburse-review">')
    expect(v).toContain('<section id={`reimburse-${d.id}`} className="pk-nx-item" data-pk-receipt-review={d.id}>')
    expect(v).toContain('<p className="pk-nx-empty">Tidak ada nota Reimburse yang menunggu verifikasi.</p>')
  })
})

describe('custom page styles', () => {
  const scss = src('src/app/(payload)/custom.scss')
  const section = scss.slice(scss.indexOf('// D2510 custom pages (Nexus)'))

  it('one appended section, tokens only, never an ellipsis', () => {
    expect(scss.indexOf('// D2510 custom pages (Nexus)')).toBeGreaterThan(scss.indexOf('// D2510 Nexus kit'))
    expect(section).toContain('.pk-nx-table')
    expect(section).toContain('.pk-nx-item')
    expect(section).not.toMatch(/#[0-9a-f]{3,6}\b/i)
    expect(section).not.toContain('text-overflow')
    // the overrides of the unlayered view-style strings stay scoped to the custom views
    for (const sel of section.slice(section.indexOf('// Unlayered on purpose')).match(/^[^\s/@}][^{\n]*\{/gm) ?? []) expect(sel, sel).toMatch(/^\.pk-f3/)
  })

  it('view style strings: no ellipsis on data text, soft alerts, Nexus tabs, no new hard-coded colours', () => {
    expect(PROGRESS_STYLE).not.toContain('text-overflow')
    expect(src('src/admin/views/Absensi.tsx')).not.toContain('text-overflow: ellipsis')
    expect(KAS_STYLE).toContain('.pk-alert.info {')
    expect(KAS_STYLE).toContain('.pk-kbtn.ghost {')
    expect(KAS_STYLE.match(/#[0-9A-Fa-f]{3,6}\b/g)?.every((c) => c === '#FFFFFF')).toBe(true)
    expect(FIELD_STYLE).toContain(".pk-f3 .pk-ftabs a[aria-current='page'] { color: var(--pk-primary-hover); background: var(--pk-card);")
  })
})

describe('one page shell for the custom views', () => {
  const VIEWS = ['Kas', 'Absensi', 'FieldService', 'FieldAftersales', 'FieldUnits', 'FieldDaily', 'Loans', 'IntercompanyLoans', 'Rap', 'Pengguna', 'Partners', 'Progress', 'Addendum', 'NoAccess', 'KeamananAkun', 'AksesPt']
  const SHELL = ['ApprovalInbox', 'TransferQueue', 'LpjVerification', 'Notifikasi', 'Reports', 'RiwayatView', 'ShortfallInbox']

  it('every Frame view titles itself with PageHead (shared PageHeader + module chip), never DashHead / a bare <h1>', () => {
    for (const f of VIEWS) {
      const v = src(`src/admin/views/${f}.tsx`)
      expect(v, f).not.toContain('<DashHead')
      expect(v, f).not.toMatch(/<h1[\s>]/)
      expect(v, f).toMatch(/<PageHead\s+props=\{props\}/)
    }
    expect(src('src/admin/views/shared.tsx')).toMatch(/<PageHeader title=\{title\} sub=\{sub\} actions=\{actions\} mod=\{m\?\.mod\} icon=\{m\?\.icon\} \/>/)
    expect(src('src/admin/views/ModuleLanding.tsx')).toContain('<PageHeader id="pk-modland-title"')
  })

  it('the Shell views use the Nexus table / Badge classes, not the former inline-style helpers', () => {
    for (const f of SHELL) {
      const v = src(`src/admin/views/${f}.tsx`)
      expect(v, f).not.toMatch(/style=\{(table|th|td|num|badge\()/)
      expect(v, f).not.toMatch(/style=\{\{ \.\.\.(table|th|td)/)
    }
    expect(src('src/admin/components/ReimburseReceiptReview.tsx')).not.toContain('style=')
  })
})
