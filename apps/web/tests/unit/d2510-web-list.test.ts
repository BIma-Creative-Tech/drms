import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { ListToolbar, Pager } from '@/admin/components/list/ListToolbar'
import { paginate, parseListQuery } from '@/admin/list-query'
import { listChrome } from '@/admin/pk-list/chrome'

/**
 * D2510 PR-3 (user 2026-10-25, ADR 0033): list & form chrome after Nexus — the PkListView card head (glyph + module
 * tint), the toolbar as a card row with the page size moved into the card foot (bound by `form=`), and the
 * "D2510 list & form (Nexus)" styles (cards, sticky toolbar, no ellipsis on data cells).
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => undefined, push: () => undefined }) }))

const src = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8')

describe('listChrome', () => {
  it('the sidebar glyph of the collection and the module whose menu lists it', () => {
    expect(listChrome('vendors')).toEqual({ icon: 'tShop', mod: 'master' })
    expect(listChrome('expense-requests')).toEqual({ icon: 'tReceiptText', mod: 'keuangan' })
    expect(listChrome('attendances')).toEqual({ icon: 'tClock', mod: 'absensi' })
  })

  it('an unknown collection → the document glyph, no module tint (brand blue)', () => {
    expect(listChrome('nope-not-a-collection')).toEqual({ icon: 'document', mod: null })
  })
})

describe('ListToolbar / Pager (SSR)', () => {
  const query = parseListQuery({ per: '50' })
  const page = paginate(Array.from({ length: 57 }, (_, i) => i), 1, 50)

  it('default bar: own box, page size inside the form (custom views unchanged)', () => {
    const out = renderToStaticMarkup(h(ListToolbar, { id: 'rap', action: '/admin/rap', query, label: 'Cari RAP' }))
    expect(out).toMatch(/^<form class="pk-ltb" method="get" action="\/admin\/rap"/)
    expect(out).toContain('data-pk-page-size="rap"')
  })

  it('PkListView bar: card row (flush) with a form id, no page size of its own', () => {
    const out = renderToStaticMarkup(h(ListToolbar, { id: 'list-vendors', formId: 'pk-ltb-list-vendors', flush: true, pageSize: false, action: '/admin/collections/vendors', query, label: 'Cari vendor' }))
    expect(out).toMatch(/^<form id="pk-ltb-list-vendors" class="pk-ltb pk-ltb--flush"/)
    expect(out).toContain('data-pk-toolbar="list-vendors"')
    expect(out).not.toContain('data-pk-page-size')
  })

  it('Pager perPage: the page size in the foot joins the toolbar form; without it the pager is unchanged', () => {
    const foot = renderToStaticMarkup(h(Pager, { id: 'list-vendors', path: '/admin/collections/vendors', sp: { per: '50' }, page, perPage: { form: 'pk-ltb-list-vendors', value: 50 } }))
    expect(foot).toContain('1–50 dari 57 data')
    expect(foot).toMatch(/<select name="per" form="pk-ltb-list-vendors" data-pk-page-size="list-vendors">/)
    expect(foot).toMatch(/<option value="50" selected="">50<\/option>/)
    const plain = renderToStaticMarkup(h(Pager, { id: 'rap', path: '/admin/rap', sp: {}, page }))
    expect(plain).not.toContain('<select')
    expect(plain).toContain('rel="next"')
  })
})

describe('PkListView markup + styles', () => {
  const view = src('src/admin/pk-list/PkListView.tsx')
  const scss = src('src/app/(payload)/custom.scss')
  const start = scss.indexOf('// D2510 list & form (Nexus)')
  const section = scss.slice(start, scss.indexOf('// D2510 Nexus kit (src'))

  it('one card: head (chip, title, total badge, actions incl. Kolom + Buat baru), flush bar, foot pager with the page size', () => {
    expect(view).toContain('className="pk-nx-card pk-plist__card"')
    expect(view).toContain('data-mod={chrome.mod ?? undefined}')
    expect(view).toContain('<SoftBadge tone="primary"')
    expect(view.indexOf('<ColumnPicker')).toBeLessThan(view.indexOf('<ListToolbar'))
    expect(view).toContain('data-pk-create={slug}')
    expect(view).toContain('pageSize={false}')
    expect(view).toMatch(/<footer className="pk-nx-card__foot pk-plist__foot">\s*<Pager [^>]*perPage=\{\{ form: formId, value: query.per \}\}/)
    // behaviour hooks kept
    for (const hook of ['data-pk-list={slug}', 'data-pk-empty={slug}', 'data-pk-sort={name}', 'data-pk-link-filter', '<ClickableRow', '<TableScroll', 'className="pk-plist__cell"']) expect(view).toContain(hook)
  })

  it('the section sits right before the kit; cards, sticky toolbar, field cards; long text wraps (no ellipsis)', () => {
    expect(start).toBeGreaterThan(0)
    expect(section).toContain('.pk-plist__card .pk-plist__table > table > thead > tr > th {')
    expect(section).toContain('.pk-plist__cell :is([data-pk-status], [data-pk-bool], .pk-status-pill) {')
    expect(section).toMatch(/\.doc-controls \{\s*--theme-bg: var\(--pk-card\);/)
    expect(section).toMatch(/\.document-fields__fields,\s*\.document-fields__sidebar-fields > \.render-fields:not\(:empty\),/)
    expect(section).not.toMatch(/text-overflow:\s*ellipsis/)
    expect(section).toMatch(/\.doc-header__title \{[^}]*white-space: normal;/)
    // the 360 px wrap of the list cells (DRMS 16/10) is unchanged
    expect(scss).toMatch(/\.pk-plist__cell \{\s*width: max-content;\s*max-width: 360px;\s*white-space: normal;/)
  })
})
