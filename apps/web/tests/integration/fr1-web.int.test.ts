import React, { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createLocalReq, type AdminViewServerProps } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@payloadcms/next/templates', () => ({ DefaultTemplate: ({ children }: { children: ReactNode }) => children }))
vi.mock('@payloadcms/ui', () => ({ Gutter: ({ children }: { children: ReactNode }) => React.createElement('div', { 'data-gutter': '' }, children) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }), usePathname: () => '/admin' }))

import { FieldActivityDetail, FieldActivityEdit, FieldActivityList, FieldActivityNew, FieldAftersalesRecap } from '@/admin/views/FieldAftersales'
import { FieldServiceDetail, FieldServiceList, FieldServiceNew } from '@/admin/views/FieldService'
import { FieldContractDetail, FieldContracts, FieldTimesheetDetail, FieldTimesheetEdit, FieldTimesheetNew, FieldUnitDetail } from '@/admin/views/FieldUnits'
import { ProjectProgressView } from '@/admin/views/Progress'
import { addDays } from '@/domain/field/rules'
import { contractsOf, enabledCompanies, historyOf } from '@/domain/field/web'
import { resetRateLimits } from '@/lib/rate-limit'

import { api, type FlowUser } from './flow-world'
import { makeFr1World, uploadFieldPhoto, type Fr1World } from './fr1-world'
import { getTestPayload, installLocalJwks, updateCompany } from './helpers'

/**
 * FR1 admin web views (ADR 0020, plan "Web"): every custom view rendered server-side with REAL data
 * and the caller's access — feature flag off → no-access page, the contract matrix / recap (billing
 * ESTIMATE only for Direktur/Finance/Admin, never an empty "Rp" for Staff/PM), Staff not assigned →
 * not found, service/timesheet/activity details with history incl. corrections, the aftersales week
 * (values only for the rate roles), the project timeline tab and the input forms per role.
 * Payload's DefaultTemplate/Gutter are stubbed; async server components are resolved before the
 * static render. Fictional data only.
 */
let w: Fr1World
let svId = 0
let tsGapId = 0
let poId = 0
let d1 = ''
let d2 = ''

type Props = AdminViewServerProps

async function propsFor(user: FlowUser, segments: string[], searchParams: Record<string, string> = {}): Promise<Props> {
  const req = await createLocalReq({ user: { ...user, collection: 'users' } as never }, await getTestPayload())
  return { initPageResult: { req, locale: undefined, permissions: {}, visibleEntities: { collections: [], globals: [] } }, params: { segments }, searchParams } as unknown as Props
}

/** Resolves async server components (anywhere in the element tree) so the static renderer can render the rest. */
async function resolve(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolve))
  if (!isValidElement(node)) return node
  const el = node as ReactElement<{ children?: ReactNode }>
  if (typeof el.type === 'function' && el.type.constructor.name === 'AsyncFunction') return resolve(await (el.type as (p: unknown) => Promise<ReactNode>)(el.props))
  if (el.props && 'children' in el.props && el.props.children !== undefined) return cloneElement(el, undefined, ...([] as ReactNode[]).concat(await resolve(el.props.children)))
  return el
}

async function render(view: (p: Props) => Promise<ReactNode>, user: FlowUser, segments: string[], sp: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(React.createElement(React.Fragment, null, await resolve(await view(await propsFor(user, segments, sp)))))
}

const photo = async (u: FlowUser) => {
  const p = await uploadFieldPhoto(u)
  expect(p.status, JSON.stringify(p.body)).toBe(201)
  return p.id
}

beforeAll(async () => {
  installLocalJwks()
  w = await makeFr1World('fr1web')
  d1 = addDays(w.today, -2)
  d2 = addDays(w.today, -1)
  resetRateLimits()
  const t1 = await api('POST', '/api/v1/unit-timesheets', w.users.staffA, { projectId: w.kontrak, unitId: w.ex01, reportDate: d1, hmStart: 1000, hmEnd: 1008, workHours: 8, standbyHours: 1, hmPhotoId: await photo(w.users.staffA), operatorName: 'Slamet' })
  expect(t1.status, JSON.stringify(t1.body)).toBe(201)
  const t2 = await api('POST', '/api/v1/unit-timesheets', w.users.staffA, { projectId: w.kontrak, unitId: w.ex01, reportDate: d2, hmStart: 1010, hmEnd: 1015, workHours: 5, breakdownHours: 4, breakdownReason: 'Hidrolik bocor', hmPhotoId: await photo(w.users.staffA) })
  expect(t2.status, JSON.stringify(t2.body)).toBe(201)
  expect(t2.body.flags).toContain('HM_GAP')
  tsGapId = t2.body.id
  const sv = await api('POST', '/api/v1/service-reports', w.users.staffA, { projectId: w.kontrak, unitId: w.ex01, reportDate: d2, hourMeter: 1015, serviceType: 'perbaikan', complaint: 'Boom turun sendiri', action: 'Ganti seal kit silinder boom', unitStatusAfter: 'menunggu_part', spareparts: [{ name: 'Seal kit boom', qty: 1, uom: 'SET' }] })
  expect(sv.status, JSON.stringify(sv.body)).toBe(201)
  svId = sv.body.id
  const corr = await api('POST', `/api/v1/service-reports/${svId}/corrections`, w.users.pm, { helpers: 'Joko', reason: 'Helper lupa diisi' })
  expect(corr.status, JSON.stringify(corr.body)).toBe(200)
  const po = await api('POST', '/api/v1/aftersales-activities', w.users.staffA, { projectId: w.aftersales, clientId: w.client, kind: 'po_masuk', docNo: 'PO-WEB-0912', value: 4_250_000, items: [{ name: 'Filter oli', qty: 6, uom: 'PCS' }] })
  expect(po.status, JSON.stringify(po.body)).toBe(201)
  poId = po.body.id
})
beforeEach(() => resetRateLimits())
afterAll(async () => {
  await updateCompany({ fieldReportsEnabled: false })
})

describe('gate', () => {
  it('flag off → the uniform no-access page with the feature hint (menu hidden as well)', async () => {
    await updateCompany({ fieldReportsEnabled: false })
    try {
      for (const view of [FieldContracts, FieldServiceList, FieldAftersalesRecap, FieldActivityList]) {
        const html = await render(view, w.users.owner, ['x'])
        expect(html).toContain('data-pk-denied="no-access"')
        expect(html).toContain('data-pk-feature-off="fieldReports"')
      }
    } finally {
      await updateCompany({ fieldReportsEnabled: true })
    }
  })
  it('enabled PTs; Finance/Admin may not open the input forms (they read, they do not report)', async () => {
    const req = (await propsFor(w.users.owner, [])).initPageResult.req
    expect((await enabledCompanies(req)).length).toBeGreaterThan(0)
    for (const u of [w.users.finance, w.users.admin]) {
      expect(await render(FieldServiceNew, u, ['laporan-servis', 'baru'])).toContain('data-pk-denied="no-access"')
      expect(await render(FieldTimesheetNew, u, ['unit-kontrak', 'timesheet', 'baru'])).toContain('data-pk-denied="no-access"')
    }
    // the weekly aftersales recap is an office/PM page
    expect(await render(FieldAftersalesRecap, w.users.staffA, ['aftersales'])).toContain('data-pk-denied="no-access"')
  })
})

describe('Unit & kontrak', () => {
  it('contract list: the kontrak_unit project with today\'s fill status and a Buka row action (button, not a bare link)', async () => {
    const html = await render(FieldContracts, w.users.pm, ['unit-kontrak'])
    expect(html).toContain('data-pk-row="fr1web-K"')
    expect(html).toMatch(/class="pk-row-act"[^>]*aria-label="Buka kontrak fr1web-K"/)
    expect(html).toContain('0 dari 1 diisi')
  })
  it('matrix: filled cells link to the timesheet, breakdown orange, HM gap ⚠, missing days link to the form', async () => {
    const html = await render(FieldContractDetail, w.users.staffA, ['unit-kontrak', 'kontrak', String(w.kontrak)], { tab: 'timesheet', bulan: d2.slice(0, 7) })
    expect(html).toContain(`data-pk-matrix="${d2.slice(0, 7)}"`)
    expect(html).toContain(`href="/admin/unit-kontrak/timesheet/detail/${tsGapId}"`)
    expect(html).toContain('data-pk-cell="breakdown"')
    expect(html).toContain('selisih HM')
    if (w.today.slice(0, 7) === d2.slice(0, 7)) expect(html).toContain(`href="/admin/unit-kontrak/timesheet/baru?project=${w.kontrak}&amp;unit=${w.ex01}&amp;tanggal=`)
  })
  it('rekap: billing ESTIMATE + rate only for Direktur/Finance (labelled "estimasi — bukan invoice"), exports via the registry', async () => {
    const own = await render(FieldContractDetail, w.users.owner, ['unit-kontrak', 'kontrak', String(w.kontrak)], { tab: 'rekap', bulan: d2.slice(0, 7) })
    expect(own).toContain('Estimasi — bukan invoice')
    expect(own).toContain('data-pk-estimate=')
    expect(own).toContain('Rp 350.000/jam · min 200 jam')
    expect(own).toContain(`href="/api/v1/reports/rekap-timesheet-kontrak/pdf?bulan=${d2.slice(0, 7)}&amp;project=${w.kontrak}"`)
    expect(own).toContain('1.000 → 1.015')
    const fin = await render(FieldContractDetail, w.users.finance, ['unit-kontrak', 'kontrak', String(w.kontrak)], { tab: 'rekap', bulan: d2.slice(0, 7) })
    expect(fin).toContain('data-pk-estimate=')
    // PM: recap without any money — no estimate, no tariff, no empty "Rp" column
    const pm = await render(FieldContractDetail, w.users.pm, ['unit-kontrak', 'kontrak', String(w.kontrak)], { tab: 'rekap', bulan: d2.slice(0, 7) })
    expect(pm).toContain('data-pk-table="recap"')
    expect(pm).not.toContain('data-pk-estimate')
    expect(pm).not.toMatch(/Rp\s?\d|Tarif<\/th>|Estimasi tagihan/)
  })
  it('Staff (assigned): no Rekap tab, unit tab without rates; Staff B (not assigned) → not found', async () => {
    const staff = await render(FieldContractDetail, w.users.staffA, ['unit-kontrak', 'kontrak', String(w.kontrak)], { tab: 'rekap' })
    expect(staff).not.toContain('data-pk-tab="rekap"')
    expect(staff).toContain('data-pk-matrix') // falls back to the timesheet tab
    const units = await render(FieldContractDetail, w.users.staffA, ['unit-kontrak', 'kontrak', String(w.kontrak)], { tab: 'unit' })
    expect(units).toContain('data-pk-table="contract-units"')
    expect(units).not.toMatch(/Rp\s?\d|Tarif/)
    expect(units).not.toContain('Tambah unit ke kontrak') // Direktur/Admin only
    const own = await render(FieldContractDetail, w.users.owner, ['unit-kontrak', 'kontrak', String(w.kontrak)], { tab: 'unit' })
    expect(own).toContain('Tambah unit ke kontrak')
    expect(own).toContain(`href="/admin/collections/contract-units/${w.contract}"`)
    expect(await render(FieldContractDetail, w.users.staffB, ['unit-kontrak', 'kontrak', String(w.kontrak)])).toContain('Kontrak tidak ditemukan')
    const req = (await propsFor(w.users.pm, [])).initPageResult.req
    expect((await contractsOf(req, [w.kontrak]))[0]!.terms).toBeNull()
  })
  it('timeline tab: service entry + timesheet day summaries ("1 dari 1 unit diisi", ⚠ selisih HM)', async () => {
    const html = await render(FieldContractDetail, w.users.pm, ['unit-kontrak', 'kontrak', String(w.kontrak)], { tab: 'timeline' })
    expect(html).toContain(`data-pk-timeline="${w.kontrak}"`)
    expect(html).toContain('1 dari 1 unit diisi · ⚠ selisih HM')
    expect(html).toContain(`href="/admin/laporan-servis/detail/${svId}"`)
    expect(html).toContain('data-pk-chip="servis"')
    const only = await render(FieldContractDetail, w.users.pm, ['unit-kontrak', 'kontrak', String(w.kontrak)], { tab: 'timeline', jenis: 'servis' })
    expect(only).not.toContain('data-pk-timeline-entry="timesheet"')
  })
  it('unit detail: identity, status from the service report, last HM, history', async () => {
    const html = await render(FieldUnitDetail, w.users.pm, ['unit-kontrak', 'unit', String(w.ex01)])
    expect(html).toContain('Komatsu PC200')
    expect(html).toContain('Menunggu part')
    expect(html).toContain('1.015')
    expect(html).toContain('data-pk-unit-history="servis"')
    expect(html).toContain('data-pk-unit-history="timesheet"')
  })
  it('timesheet detail: HM gap flag, breakdown suggestion, correction for the PM, history', async () => {
    const html = await render(FieldTimesheetDetail, w.users.pm, ['unit-kontrak', 'timesheet', 'detail', String(tsGapId)])
    expect(html).toContain('data-pk-flags="')
    expect(html).toContain('⚠ selisih HM')
    expect(html).toContain('data-pk-alert="suggest-service"')
    expect(html).toContain('data-pk-action="timesheet-correct"')
    expect(html).not.toContain('data-pk-action="timesheet-edit"') // PM is not the reporter
    const own = await render(FieldTimesheetDetail, w.users.staffA, ['unit-kontrak', 'timesheet', 'detail', String(tsGapId)])
    expect(own).toContain('data-pk-action="timesheet-edit"')
    expect(own).not.toContain('data-pk-action="timesheet-correct"')
    // UI feedback 17/10 #5: links to the edit page (no dialog)
    expect(own).toContain(`href="/admin/unit-kontrak/timesheet/${tsGapId}/ubah"`)
    expect(html).toContain(`href="/admin/unit-kontrak/timesheet/${tsGapId}/ubah?koreksi=1"`)
    expect(own).not.toContain('<dialog')
  })
  it('timesheet edit / correction page (UI feedback 17/10 #5): the input layout (form 8 + "Aturan"), contract / date / unit disabled, HM photo kept', async () => {
    const created = await render(FieldTimesheetNew, w.users.staffA, ['unit-kontrak', 'timesheet', 'baru'], { project: String(w.kontrak) })
    const edit = await render(FieldTimesheetEdit, w.users.staffA, ['unit-kontrak', 'timesheet', String(tsGapId), 'ubah'])
    const cards = (h: string) => [...h.matchAll(/data-pk-card="([^"]+)"/g)].map((m) => m[1])
    expect(cards(edit)).toEqual(cards(created))
    expect(edit).toContain('data-pk-card="timesheet-help"')
    expect(edit).toContain('data-pk-form="unit-timesheet-edit"')
    for (const k of ['project', 'reportDate', 'unit']) expect(edit, k).toMatch(new RegExp(`<(select|input)[^>]*(data-pk-locked="${k}"[^>]*disabled=""|disabled=""[^>]*data-pk-locked="${k}")`))
    expect(edit).toContain('value="1.015"') // HM akhir prefilled
    expect(edit).toContain('data-pk-photo-stored=')
    const fix = await render(FieldTimesheetEdit, w.users.pm, ['unit-kontrak', 'timesheet', String(tsGapId), 'ubah'], { koreksi: '1' })
    expect(fix).toContain('data-pk-form="unit-timesheet-correction"')
    expect(fix).toContain('Alasan koreksi')
    // the PM is not the reporter → the reporter's edit page refuses
    expect(await render(FieldTimesheetEdit, w.users.pm, ['unit-kontrak', 'timesheet', String(tsGapId), 'ubah'])).toContain('data-pk-alert="not-editable"')
  })
  it('timesheet form: the contract with its active unit for an assigned Staff', async () => {
    const html = await render(FieldTimesheetNew, w.users.staffA, ['unit-kontrak', 'timesheet', 'baru'], { project: String(w.kontrak) })
    expect(html).toContain('data-pk-form="unit-timesheet"')
    expect(html).toContain('fr1web-K')
  })
})

describe('Laporan servis', () => {
  it('list with filters and a Buka action; detail with spare parts, corrections in the history', async () => {
    const list = await render(FieldServiceList, w.users.pm, ['laporan-servis'], { project: String(w.kontrak) })
    expect(list).toContain('data-pk-filter="laporan-servis"')
    expect(list).toMatch(/aria-label="Buka laporan servis SV\//)
    const html = await render(FieldServiceDetail, w.users.pm, ['laporan-servis', 'detail', String(svId)])
    expect(html).toContain('Seal kit boom')
    expect(html).toContain('Ganti seal kit silinder boom')
    expect(html).toContain('data-pk-history-action="correction"')
    expect(html).toContain('alasan: Helper lupa diisi')
    expect(html).toContain('dikoreksi')
    const req = (await propsFor(w.users.pm, [])).initPageResult.req
    expect((await historyOf(req, 'service_report', svId)).map((h) => h.action)).toEqual(['create', 'correction'])
  })
  it('form for the assigned Staff offers both field projects', async () => {
    const html = await render(FieldServiceNew, w.users.staffA, ['laporan-servis', 'baru'])
    expect(html).toContain('data-pk-form="service-report"')
    expect(html).toContain('fr1web-K')
    expect(html).toContain('fr1web-A')
  })
})

describe('Aftersales', () => {
  it('weekly recap: Direktur sees the PO value, PM never sees money; open PO in "Perlu ditindaklanjuti"', async () => {
    const own = await render(FieldAftersalesRecap, w.users.owner, ['aftersales'])
    expect(own).toContain('Nilai PO minggu ini')
    expect(own).toContain(`href="/admin/aftersales/aktivitas/detail/${poId}"`)
    expect(own).toContain('data-pk-todo-kind="po"')
    expect(own).toContain('href="/api/v1/reports/rekap-aftersales/pdf?')
    const pm = await render(FieldAftersalesRecap, w.users.pm, ['aftersales'])
    expect(pm).toContain('PO-WEB-0912')
    expect(pm).not.toMatch(/Nilai PO|Rp\s?\d/)
  })
  it('activity list: no value column for Staff (even their own value); detail shows the reporter\'s own value only to them', async () => {
    const list = await render(FieldActivityList, w.users.staffA, ['aftersales', 'aktivitas'])
    expect(list).toContain('PO-WEB-0912')
    expect(list).not.toMatch(/Rp\s?\d|>Nilai</)
    const own = await render(FieldActivityDetail, w.users.staffA, ['aftersales', 'aktivitas', 'detail', String(poId)])
    expect(own).toContain('diisi oleh Anda')
    expect(own).toContain('4.250.000')
    const pm = await render(FieldActivityDetail, w.users.pm, ['aftersales', 'aktivitas', 'detail', String(poId)])
    expect(pm).not.toMatch(/Rp\s?\d|4\.250\.000/)
    expect(pm).toContain('data-pk-action="activity-correct"')
    expect(pm).toContain('data-pk-link="catat-pengiriman"') // open PO → record a delivery
  })
  it('activity edit / correction page (UI feedback 17/10 #5): input layout, customer / kind / date disabled; the value stays hidden from the PM', async () => {
    const own = await render(FieldActivityEdit, w.users.staffA, ['aftersales', 'aktivitas', String(poId), 'ubah'])
    expect(own).toContain('data-pk-card="activity-form"')
    expect(own).toContain('data-pk-card="activity-help"')
    expect(own).toContain('data-pk-form="aftersales-activity-edit"')
    for (const k of ['client', 'activityDate']) expect(own, k).toMatch(new RegExp(`<(select|input)[^>]*(data-pk-locked="${k}"[^>]*disabled=""|disabled=""[^>]*data-pk-locked="${k}")`))
    expect(own).toContain('value="4.250.000"') // the reporter sees (and may change) the value
    const pm = await render(FieldActivityEdit, w.users.pm, ['aftersales', 'aktivitas', String(poId), 'ubah'], { koreksi: '1' })
    expect(pm).toContain('data-pk-form="aftersales-activity-correction"')
    expect(pm).not.toMatch(/Rp\s?\d|4\.250\.000/)
    expect(pm).toContain('data-pk-field="poStatus"') // correction of a PO masuk: "Status PO" before the reason
    expect(pm.indexOf('data-pk-field="poStatus"')).toBeLessThan(pm.indexOf('data-pk-field="reason"'))
  })
  it('quick input form for the assigned Staff', async () => {
    const html = await render(FieldActivityNew, w.users.staffA, ['aftersales', 'aktivitas', 'baru'], { jenis: 'pengiriman', po: String(poId) })
    expect(html).toContain('data-pk-form="aftersales-activity"')
    expect(html).toContain('fr1web Pelanggan Tambang')
  })
})

describe('project detail timeline tab', () => {
  it('Progress project view shows Ringkasan/Timeline tabs for a field project and the merged timeline', async () => {
    const html = await render(ProjectProgressView, w.users.pm, ['progress', 'project', String(w.kontrak)], { tab: 'timeline' })
    expect(html).toContain('data-pk-tab="timeline"')
    expect(html).toContain(`data-pk-timeline="${w.kontrak}"`)
    const plain = await render(ProjectProgressView, w.users.pm, ['progress', 'project', String(w.project)])
    expect(plain).not.toContain('data-pk-tab="timeline"') // umum project: no field reports
  })
})
