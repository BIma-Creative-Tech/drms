import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }))

import { FR1_ADMIN_VIEWS, LOAN_ADMIN_VIEWS, S2A_ADMIN_VIEWS } from '@/admin/config'
import { HolidayAdd } from '@/admin/components/absensi/AttendanceActions'
import { AddendumForm } from '@/admin/components/addendum/AddendumForm'
import { CompanyBadge } from '@/admin/components/companies/CompanyBadge'
import { CashEntryForm } from '@/admin/components/kas/CashEntryForm'
import { LoanForm } from '@/admin/components/loans/LoanForm'

/**
 * UI feedback 17/10 #5 ("edit = add" for every master + transaction page, user decision 2026-10-17): the edit routes,
 * the create widgets disabled in edit mode, the edit-only fields last, "Simpan perubahan" / "Batal", the expense-request
 * edit mode without header / stepper, the PT badge in the picker's slot and the holiday inline edit. Page layout with
 * real data: tests/integration/d1710-edit-equals-add.int.test.ts, fr1-web.int.test.ts, d1710-service-types.int.test.ts.
 */
const src = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8')
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)
const disabledEl = (out: string, attr: string) => {
  const m = out.match(new RegExp(`<(?:select|input)[^>]*${attr}[^>]*>`))
  return m !== null && m[0].includes('disabled=""')
}

describe('routes: own edit pages', () => {
  it('servis / aktivitas / timesheet / addendum / pinjaman have `…/:id/ubah` (exact) and an importMap entry', () => {
    const routes = {
      '/laporan-servis/:id/ubah': FR1_ADMIN_VIEWS.fieldServiceEdit,
      '/aftersales/aktivitas/:id/ubah': FR1_ADMIN_VIEWS.fieldActivityEdit,
      '/unit-kontrak/timesheet/:id/ubah': FR1_ADMIN_VIEWS.fieldTimesheetEdit,
      '/addendum/:id/ubah': S2A_ADMIN_VIEWS.addendumEdit,
      '/pinjaman/:id/ubah': LOAN_ADMIN_VIEWS.loanEdit,
    }
    const map = src('src/app/(payload)/admin/importMap.js')
    for (const [path, v] of Object.entries(routes)) {
      expect(v, path).toMatchObject({ path, exact: true })
      expect(map, v.Component).toContain(`"${v.Component}":`)
    }
  })
  it('the field-report Koreksi dialog is gone (no form → no dialog); detail buttons link to the edit pages', () => {
    for (const f of ['FieldService', 'FieldAftersales', 'FieldUnits']) {
      const v = src(`src/admin/views/${f}.tsx`)
      expect(v, f).not.toContain('CorrectionDialog')
      expect(v, f).toContain('<EditLink')
    }
    expect(() => src('src/admin/components/field/CorrectionDialog.tsx')).toThrow()
  })
})

describe('Kas: edit = the create form, locked widgets disabled', () => {
  const opts = { accounts: [{ id: 3, label: 'Kas Kantor' }, { id: 4, label: 'Bank BRI' }], projects: [], costCenters: [], categories: [], sources: [{ id: 9, label: 'Setoran' }], vehicles: [] }
  const entry = { id: 21, entryNo: 'KM/AAA/2610/0001', direction: 'in' as const, entryDate: '2026-10-08', amount: 2_500_000, account: 'Bank BRI', accountId: 4, description: 'Setoran', categoryId: null, cashInSourceId: 9, projectId: null, costCenterId: null, vehicleId: null }
  const create = html(createElement(CashEntryForm, { mode: 'create', today: '2026-10-09', minDate: '2026-10-01', lockDate: null, initialDirection: 'in', options: opts }))
  const edit = html(createElement(CashEntryForm, { mode: 'edit', today: '2026-10-09', minDate: '2026-10-01', lockDate: null, initialDirection: 'in', options: opts, entry }))
  it('Tanggal / Akun kas / Nominal: the same date input, account select and Rupiah field — disabled, with the stored values', () => {
    expect(disabledEl(create, 'type="date"')).toBe(false)
    expect(disabledEl(edit, 'type="date"')).toBe(true)
    expect(disabledEl(edit, 'data-pk-field="cashAccountId"')).toBe(true)
    expect(edit).toContain('<option value="4" selected="">Bank BRI</option>')
    expect(disabledEl(edit, 'data-pk-field="amount"')).toBe(true)
    expect(edit).toContain('<div class="pk-money"><span aria-hidden="true">Rp</span>')
    expect(edit).toContain('value="2.500.000"')
    for (const k of ['entryDate', 'cashAccountId', 'amount']) expect(edit).toContain(`data-pk-locked="${k}"`)
  })
  it('same field order; the summary box is gone; "Alasan perubahan" last; "Simpan perubahan" + "Batal"', () => {
    const labels = (out: string) => [...out.matchAll(/<label for="[^"]+">([^<]+)/g)].map((m) => m[1])
    expect(labels(edit).slice(0, -1)).toEqual(labels(create)) // Tanggal … Bukti (opsional): same order
    expect(labels(edit).at(-1)).toBe('Alasan perubahan')
    expect(edit).not.toContain('pk-alert info')
    expect(edit).toContain('Simpan perubahan')
    expect(edit).toContain('>Batal<')
  })
})

describe('Addendum / Pinjaman: edit = the create form', () => {
  it('Addendum: project disabled, the draft button reads "Simpan perubahan", "Batal" back to the detail', () => {
    const projects = [{ id: 5, code: 'P-1', name: 'Gedung', budget: 100_000_000 }]
    const create = html(createElement(AddendumForm, { projects }))
    const edit = html(createElement(AddendumForm, { projects, edit: { id: 8, projectId: 5, addition: 3_000_000, reason: 'Tambah' } }))
    expect(disabledEl(create, 'data-pk-field="project"')).toBe(false)
    expect(disabledEl(edit, 'data-pk-field="project"')).toBe(true)
    expect(create).toContain('Simpan draft')
    expect(edit).toContain('Simpan perubahan')
    expect(edit).toContain('href="/admin/addendum/detail/8"')
    expect(edit).toContain('Ajukan ke Direktur')
  })
  it('Pinjaman: borrower disabled, lender editable, "Simpan perubahan" + "Batal"', () => {
    const p = [
      { id: 5, code: 'P-1', name: 'Gedung', companyId: 1 },
      { id: 6, code: 'P-2', name: 'Jalan', companyId: 1 },
    ]
    const edit = html(createElement(LoanForm, { borrowers: [p[0]!], lenders: p, today: '2026-10-09', edit: { id: 3, borrowerProjectId: 5, lenderProjectId: 6, kind: 'dana', amount: 4_000_000, reason: 'Pinjam', loanDate: '2026-10-09', dueDate: '2026-11-09' } }))
    expect(disabledEl(edit, 'data-pk-field="borrower"')).toBe(true)
    expect(disabledEl(edit, 'data-pk-field="lender"')).toBe(false)
    expect(edit).toContain('value="4.000.000"')
    expect(edit).toContain('Simpan perubahan')
    expect(edit).toContain('href="/admin/pinjaman/detail/3"')
  })
  it('detail pages link "Ubah draft" instead of embedding a second form; the edit views reuse the "Alur" card', () => {
    for (const [f, help] of [
      ['Addendum', 'AddendumFlowHelp'],
      ['Loans', 'LoanFlowHelp'],
    ] as const) {
      const v = src(`src/admin/views/${f}.tsx`)
      expect(v).not.toContain('<h3 style={{ fontSize: 14, margin: \'0 0 8px\' }}>Ubah draft</h3>')
      expect(v.match(new RegExp(`<${help} />`, 'g'))?.length, f).toBe(2) // New + Edit
    }
  })
})

describe('field reports / daily: edit pages share the input layout', () => {
  it('help cards are one component used by the input AND the edit page; the daily edit card is span 8 (was 12)', () => {
    for (const [f, rules] of [
      ['FieldService', 'ServiceRules'],
      ['FieldAftersales', 'ActivityRules'],
      ['FieldUnits', 'TimesheetRules'],
      ['FieldDaily', 'DailyRules'],
    ] as const) {
      expect(src(`src/admin/views/${f}.tsx`).match(new RegExp(`<${rules} />`, 'g'))?.length, f).toBe(2)
    }
    const daily = src('src/admin/views/FieldDaily.tsx')
    expect(daily).not.toMatch(/id="daily-form"[^\n]*span=\{12\}/)
  })
})

describe('Pengajuan biaya: edit mode = the "Pengajuan baru" layout', () => {
  const scss = src('src/app/(payload)/custom.scss')
  it('the PT is no longer hidden while editing; header section + stepper column hidden in edit mode only', () => {
    expect(scss).not.toMatch(/&\.collection-edit--is-editing \[data-pk-field='company'\] \{\s*display: none;/)
    expect(scss).toMatch(/&\[data-pk-mode='edit'\] \[data-pk-panel='workflow'\] \[data-pk-section='header'\],\s*&\[data-pk-mode='edit'\] \.document-fields__sidebar-wrap \{\s*display: none;/)
  })
  it('the PT badge takes the picker slot: label "PT", a control-sized box, label-left cell in the request grid', () => {
    const out = html(createElement(CompanyBadge, { shortCode: 'CS1', name: 'PT Contoh Satu' }))
    expect(out).toMatch(/^<div class="field-type pk-company-field" data-pk-field="company" data-pk-company-inline="CS1"><span class="field-label">PT<\/span><div class="pk-company-field__box" aria-disabled="true">/)
    expect(out).not.toContain('style=')
    expect(scss).toMatch(/\.pk-company-field__box \{[^}]*min-height: 40px;/)
    expect(scss).toContain('.field-type.date-time-field, .field-type.pk-company-field, [data-pk-needs-company]) {')
  })
})

describe('Hari libur: "Ubah" inline in the add widget', () => {
  it('same fields; edit adds "Alasan perubahan" last, "Simpan perubahan" + "Batal"; the table links ?libur=<id>', () => {
    const add = html(createElement(HolidayAdd, { year: '2026' }))
    const edit = html(createElement(HolidayAdd, { year: '2026', edit: { id: 4, date: '2026-08-17', name: 'Hari Kemerdekaan RI' }, cancelHref: '/admin/absensi/jadwal?tahun=2026#hari-libur' }))
    expect(add).toContain('data-pk-form="holiday-add"')
    expect(edit).toContain('data-pk-form="holiday-edit"')
    expect(edit).toContain('value="2026-08-17"')
    expect(edit.indexOf('Alasan perubahan')).toBeGreaterThan(edit.indexOf('Keterangan'))
    expect(add).not.toContain('Alasan perubahan')
    expect(edit).toContain('Simpan perubahan')
    expect(edit).toContain('href="/admin/absensi/jadwal?tahun=2026#hari-libur"')
    const view = src('src/admin/views/Absensi.tsx')
    expect(view).toContain('href={`/admin/absensi/jadwal?tahun=${d.year}&libur=${h.id}#hari-libur`}')
    expect(view).not.toContain('/admin/collections/holidays/${h.id}')
  })
})
