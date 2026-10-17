import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { SanitizedConfig } from 'payload'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { EXPENSE_REQUEST_VIEWS, RIWAYAT_TAB } from '@/admin/config'
import { KAS_STYLE } from '@/admin/components/kas/style'
import { RAP_EXCEL_SUMMARY, RapExcelTools } from '@/admin/components/rap/RapExcelTools'
import { RupiahInput, type RupiahField } from '@/admin/components/RupiahInput'
import { parseRupiah } from '@/lib/rupiah-input'

/**
 * UI feedback 17/10 (PR-A, #1–#3): the "Rp" prefix room out-ranks the generic `.pk-fld` input rule and the Rupiah input
 * has no placeholder; the expense-request page has no document tab row (Riwayat = action-bar button, /riwayat still
 * routed); the RAP Excel / template tools are folded (closed) below the item form on both RAP pages.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }))

const src = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8')

let config: SanitizedConfig
beforeAll(async () => {
  process.env.PK_SKIP_ENV_CHECK = 'true'
  config = await (await import('@/payload.config')).default
})

const field = (text = ''): RupiahField => ({ text, parsed: parseRupiah(text), error: null, onChange: () => undefined, onBlur: () => undefined, touch: () => undefined })

describe('#1 Rupiah input: prefix and placeholder', () => {
  it('the prefix room has a rule that out-ranks `.pk-fld :is(input:not(checkbox, radio), …)` (0,2,1)', () => {
    const generic = KAS_STYLE.indexOf(".pk-fld :is(input:not([type='checkbox'], [type='radio']), select, textarea) {")
    expect(generic).toBeGreaterThan(-1)
    // (0,3,1): class .pk-fld + class .pk-money + :not([type]) attribute + element input
    const money = KAS_STYLE.match(/\.pk-money > input, \.pk-fld \.pk-money > input:not\(\[type='checkbox'\], \[type='radio'\]\) \{([^}]*)\}/)
    expect(money?.[1]).toContain('padding-left: 36px')
    expect(KAS_STYLE.indexOf(money![0])).toBeGreaterThan(generic) // and later in the sheet, too
  })

  it('RupiahInput: "Rp" prefix, no placeholder "0"', () => {
    const html = renderToStaticMarkup(createElement(RupiahInput, { id: 'amt', field: field() }))
    expect(html).toContain('<div class="pk-money"><span aria-hidden="true">Rp</span><input id="amt"')
    expect(html).not.toContain('placeholder')
  })
  // (the field-report Koreksi dialog with its own .pk-money markup is gone since #5 — the forms use RupiahInput)
})

describe('#2 expense request: no tab row, Riwayat in the action bar', () => {
  it('views: default tab hidden; /riwayat keeps its route (path + Component) without a tab', () => {
    expect(EXPENSE_REQUEST_VIEWS.default.tab.condition()).toBe(false)
    expect(EXPENSE_REQUEST_VIEWS.riwayat).toEqual({ Component: '@/admin/views/RiwayatView#RiwayatView', path: '/riwayat' })
    expect('tab' in EXPENSE_REQUEST_VIEWS.riwayat).toBe(false)
  })

  it('wired on expense-requests only; Kas / Nota / Transfer / LPJ keep their Riwayat tab', () => {
    const edit = (slug: string) => (config.collections.find((c) => c.slug === slug)!.admin.components?.views as unknown as { edit?: Record<string, { tab?: { label?: unknown; condition?: () => boolean }; path?: string }> } | undefined)?.edit
    const er = edit('expense-requests')!
    expect(er.riwayat).toMatchObject({ path: '/riwayat' })
    expect(er.riwayat!.tab).toBeUndefined()
    // Payload's tab row = the default tab + every custom view with a tab whose condition passes → nothing to render
    const visible = Object.entries(er).filter(([, v]) => v.tab && (!v.tab.condition || v.tab.condition()))
    expect(visible).toEqual([])
    for (const slug of ['cash-entries', 'receipts', 'transfers', 'settlements']) expect(edit(slug)!.riwayat, slug).toMatchObject({ path: RIWAYAT_TAB.riwayat.path, tab: { label: 'Riwayat' } })
  })

  it('action bar renders "Riwayat" (read mode); the Riwayat page links back to the request', () => {
    const bar = src('src/admin/components/request/RequestActionsClient.tsx')
    expect(bar).toMatch(/mode === 'read' \? \(\s*<a className=\{BTN\} href=\{historyHref\} data-pk-link="history">\s*Riwayat\s*<\/a>/)
    const view = src('src/admin/views/RiwayatView.tsx')
    expect(view).toContain("collection?.slug === 'expense-requests'")
    expect(view).toContain('data-pk-link="back-to-request"')
    expect(view).toContain('← Kembali ke pengajuan')
  })
})

describe('#3 RAP: item form first, Excel / template optional and folded', () => {
  it('RapExcelTools: a closed <details> with the template link, download (only with items), templates and import', () => {
    const html = renderToStaticMarkup(createElement(RapExcelTools, { projectId: 7, hasItems: true, templates: [], needsReason: false, stageRequired: false }))
    expect(html).toMatch(/<details class="pk-rap-excel" data-pk-rap-excel="true">/)
    expect(html).not.toMatch(/<details[^>]*\sopen/)
    expect(html).toContain(`<summary data-pk-action="rap-excel-toggle">${RAP_EXCEL_SUMMARY}</summary>`)
    expect(RAP_EXCEL_SUMMARY).toBe('Impor / template Excel (opsional)')
    expect(html).toContain('href="/api/v1/rap/template.xlsx"')
    expect(html).toContain('href="/api/v1/projects/7/rap.xlsx"')
    expect(html).toContain('data-pk-form="rap-import"')
    const empty = renderToStaticMarkup(createElement(RapExcelTools, { projectId: 7, hasItems: false, templates: [], needsReason: false, stageRequired: false }))
    expect(empty).not.toContain('rap.xlsx"')
  })

  it('both RAP pages: RapItemsEditor before RapExcelTools; the old Excel-only card / link are gone', () => {
    for (const file of ['src/admin/views/ProjectTabs.tsx', 'src/admin/views/Rap.tsx']) {
      const s = src(file)
      expect(s.indexOf('<RapItemsEditor'), file).toBeGreaterThan(-1)
      expect(s.indexOf('<RapExcelTools'), file).toBeGreaterThan(s.indexOf('<RapItemsEditor'))
      expect(s, file).not.toContain('<RapImport')
      expect(s, file).not.toContain('<RapTemplateActions')
    }
    const tab = src('src/admin/views/ProjectTabs.tsx')
    expect(tab).not.toContain("label: 'Ubah item RAP'")
    expect(tab).toContain('Tambah item RAP lewat form di bawah (+ Tambah item), atau impor Excel bila banyak.')
    expect(src('src/admin/views/Rap.tsx')).not.toContain('id="rap-upload"')
  })
})
