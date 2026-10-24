import { randomUUID } from 'node:crypto'

import React, { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createLocalReq, type AdminViewServerProps } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@payloadcms/next/templates', () => ({ DefaultTemplate: ({ children }: { children: ReactNode }) => children }))
vi.mock('@payloadcms/ui', () => ({ Gutter: ({ children }: { children: ReactNode }) => React.createElement('div', { 'data-gutter': '' }, children) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }), usePathname: () => '/admin' }))

import { FieldContractDetail, FieldTimesheetNew } from '@/admin/views/FieldUnits'
import { addDays } from '@/domain/field/rules'
import { hmWeeks } from '@/domain/field/views'
import { resetRateLimits } from '@/lib/rate-limit'

import { api, sysCreate, type FlowUser } from './flow-world'
import { makeFr1World, uploadFieldPhoto, type Fr1World } from './fr1-world'
import { accessToken, companyId, getTestPayload, http, installLocalJwks, registerDevice, sqlAs, sqlError, type TestUser, updateCompany } from './helpers'

/**
 * D2410 (user 2026-10-24, ADR 0020 amendment 2026-10-24) — client feedback on the unit timesheet:
 * 1. backdate: the field reporter keeps 14 days; the PM of the project (projects.pm) and the Direktur may file ANY past
 *    date inside the contract unit's period (API + sync, `timesheetMinDate` for the APK, web matrix "+" / form notice);
 * 2. weekly HM: HM start/end + photo optional (both or none, photo only with HM, DB pair CHECK), HM_GAP against the
 *    previous timesheet WITH HM, the unit's last HM ignores timesheets without HM, an edit clears HM or adds the
 *    missing photo, weekly HM in the recap report; old APKs (always HM + photo) unchanged.
 * Fictional data only.
 */
let w: Fr1World
let ex03 = 0
let cuOld = 0

beforeAll(async () => {
  installLocalJwks()
  w = await makeFr1World('d2410')
  // a second unit whose contract started 40 days ago (older than the 14-day window)
  ex03 = await sysCreate('vehicles', { kind: 'alat_berat', unitCode: 'D2410-EX03', type: 'Excavator 30 t' })
  cuOld = await sysCreate('contract-units', { project: w.kontrak, unit: ex03, startDate: addDays(w.today, -40), rateBasis: 'per_bulan', rate: 90_000_000 })
})
beforeEach(() => resetRateLimits())
afterAll(async () => {
  await updateCompany({ fieldReportsEnabled: false })
})

const photo = async (u: FlowUser) => {
  const p = await uploadFieldPhoto(u)
  expect(p.status, JSON.stringify(p.body)).toBe(201)
  return p.id
}
const lastHm = async (unit: number) => Number((await sqlAs('app', 'SELECT last_hour_meter FROM vehicles WHERE id = $1', [unit])).rows[0].last_hour_meter)
const ts = (unitId: number, reportDate: string, extra: Record<string, unknown> = {}) => ({ projectId: w.kontrak, unitId, reportDate, workHours: 8, ...extra })

describe('D2410 backdate: reporter 14 days, PM of the project / Direktur the whole contract period', () => {
  it('Staff is refused beyond 14 days; PM (projects.pm) and Direktur file older dates inside the period; never before the contract or in the future', async () => {
    const old = addDays(w.today, -20)
    const staff = await api('POST', '/api/v1/unit-timesheets', w.users.staffA, ts(ex03, old))
    expect(staff.status, JSON.stringify(staff.body)).toBe(400)
    expect(staff.body.code).toBe('VALIDATION')
    expect(JSON.stringify(staff.body)).toMatch(/hanya dapat diisi PM project atau Direktur/)
    const pm = await api('POST', '/api/v1/unit-timesheets', w.users.pm, ts(ex03, old))
    expect(pm.status, JSON.stringify(pm.body)).toBe(201)
    expect(pm.body.flags).toContain('BACKDATED')
    expect(pm.body.contractUnitId).toBe(cuOld)
    const own = await api('POST', '/api/v1/unit-timesheets', w.users.owner, ts(ex03, addDays(w.today, -35)))
    expect(own.status, JSON.stringify(own.body)).toBe(201)
    const before = await api('POST', '/api/v1/unit-timesheets', w.users.pm, ts(ex03, addDays(w.today, -45)))
    expect(before.status).toBe(409)
    expect(before.body.code).toBe('NOT_IN_CONTRACT')
    const future = await api('POST', '/api/v1/unit-timesheets', w.users.owner, ts(ex03, addDays(w.today, 1)))
    expect(future.status).toBe(400)
    // within 14 days Staff still files as before
    expect((await api('POST', '/api/v1/unit-timesheets', w.users.staffA, ts(ex03, addDays(w.today, -14)))).status).toBe(201)
  })

  it('GET /projects/{id}/contract-units carries the caller\'s timesheetMinDate (APK date picker)', async () => {
    expect((await api('GET', `/api/v1/projects/${w.kontrak}/contract-units`, w.users.staffA)).body.timesheetMinDate).toBe(addDays(w.today, -14))
    expect((await api('GET', `/api/v1/projects/${w.kontrak}/contract-units`, w.users.pm)).body.timesheetMinDate).toBe(addDays(w.today, -40))
    expect((await api('GET', `/api/v1/projects/${w.kontrak}/contract-units`, w.users.owner)).body.timesheetMinDate).toBe(addDays(w.today, -40))
  })
})

describe('D2410 weekly HM: optional HM, pair + photo rule, HM_GAP / last HM with HM only', () => {
  let tA = 0
  let tB = 0
  let tE = 0
  it('create without HM (no photo) passes; half a pair or HM without photo → 400; HM_GAP against the previous timesheet WITH HM', async () => {
    const a = await api('POST', '/api/v1/unit-timesheets', w.users.staffA, ts(w.ex01, addDays(w.today, -6), { hmStart: 1000, hmEnd: 1008, hmPhotoId: await photo(w.users.staffA) }))
    expect(a.status, JSON.stringify(a.body)).toBe(201)
    tA = a.body.id
    const b = await api('POST', '/api/v1/unit-timesheets', w.users.staffA, ts(w.ex01, addDays(w.today, -5)))
    expect(b.status, JSON.stringify(b.body)).toBe(201)
    tB = b.body.id
    expect(b.body).toMatchObject({ hmStart: null, hmEnd: null, hmUsed: null, hmPhoto: null })
    expect(b.body.flags).not.toContain('HM_GAP')
    expect((await sqlAs('app', 'SELECT hm_start, hm_end, photo_count FROM unit_timesheets WHERE id = $1', [tB])).rows[0]).toMatchObject({ hm_start: null, hm_end: null })
    const half = await api('POST', '/api/v1/unit-timesheets', w.users.staffA, ts(w.ex01, addDays(w.today, -4), { hmStart: 1010 }))
    expect(half.status).toBe(400)
    expect(JSON.stringify(half.body)).toMatch(/HM akhir wajib bila HM awal diisi/)
    const noPhoto = await api('POST', '/api/v1/unit-timesheets', w.users.staffA, ts(w.ex01, addDays(w.today, -4), { hmStart: 1010, hmEnd: 1012 }))
    expect(noPhoto.status).toBe(400)
    expect(JSON.stringify(noPhoto.body)).toMatch(/Foto meter HM wajib bila HM diisi/)
    expect(await lastHm(w.ex01)).toBe(1008)
    // the day without HM is skipped: 1050 vs 1008 (tA) → HM_GAP; the unit's last HM = 1058
    const e = await api('POST', '/api/v1/unit-timesheets', w.users.staffA, ts(w.ex01, addDays(w.today, -3), { hmStart: 1050, hmEnd: 1058, hmPhotoId: await photo(w.users.staffA) }))
    expect(e.status, JSON.stringify(e.body)).toBe(201)
    tE = e.body.id
    expect(e.body.flags).toContain('HM_GAP')
    expect(await lastHm(w.ex01)).toBe(1058)
    // a later timesheet without HM leaves the unit's last HM alone
    expect((await api('POST', '/api/v1/unit-timesheets', w.users.staffA, ts(w.ex01, addDays(w.today, -2)))).status).toBe(201)
    expect(await lastHm(w.ex01)).toBe(1058)
  })

  it('edit: adding HM needs the photo (added, never replaced); clearing HM recalculates the unit\'s last HM', async () => {
    const noPhoto = await api('PATCH', `/api/v1/unit-timesheets/${tB}`, w.users.staffA, { hmStart: 1008, hmEnd: 1010 })
    expect(noPhoto.status).toBe(400)
    const add = await api('PATCH', `/api/v1/unit-timesheets/${tB}`, w.users.staffA, { hmStart: 1008, hmEnd: 1010, hmPhotoId: await photo(w.users.staffA) })
    expect(add.status, JSON.stringify(add.body)).toBe(200)
    expect(add.body.hmPhoto).not.toBeNull()
    expect(add.body.hmUsed).toBe(2)
    expect(add.body.flags).not.toContain('HM_GAP')
    const replace = await api('PATCH', `/api/v1/unit-timesheets/${tA}`, w.users.staffA, { hmPhotoId: await photo(w.users.staffA) })
    expect(replace.status).toBe(400)
    expect(replace.body.code).toBe('PHOTO_LIMIT')
    const clear = await api('PATCH', `/api/v1/unit-timesheets/${tE}`, w.users.staffA, { hmStart: null, hmEnd: null })
    expect(clear.status, JSON.stringify(clear.body)).toBe(200)
    expect(clear.body).toMatchObject({ hmStart: null, hmEnd: null })
    expect(clear.body.flags).not.toContain('HM_GAP')
    expect(await lastHm(w.ex01)).toBe(1010) // tB is now the latest timesheet with HM
    const half = await api('PATCH', `/api/v1/unit-timesheets/${tA}`, w.users.staffA, { hmEnd: null })
    expect(half.status).toBe(400)
  })

  it('DB: half an HM pair is refused (CHECK unit_timesheets_hm_pair)', async () => {
    const company = await companyId()
    const err = await sqlError(
      'app',
      `INSERT INTO unit_timesheets (company_id, project_id, unit_id, contract_unit_id, report_date, reporter_id, hm_start, hm_end, work_hours) VALUES (${company}, ${w.kontrak}, ${w.ex01}, ${w.contract}, '${addDays(w.today, -8)}', ${w.users.staffA.id}, 5, NULL, 1)`,
    )
    expect(err?.code).toBe('23514')
  })

  it('rekap-timesheet-kontrak: weekly HM per unit (Mon–Sun weeks of the month); Total HM null-safe', async () => {
    const month = addDays(w.today, -6).slice(0, 7)
    const r = await api('GET', `/api/v1/reports/rekap-timesheet-kontrak?bulan=${month}&project=${w.kontrak}`, w.users.owner)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const weekly = r.body.extra.find((t: { key: string }) => t.key === 'hm-mingguan')
    expect(weekly).toBeTruthy()
    const weeks = hmWeeks(month)
    const rows = weekly.rows.filter((x: { unit: string }) => x.unit.includes('D2410-EX01'))
    expect(rows.map((x: { minggu: string }) => x.minggu)).toEqual(weeks.map((x) => x.label))
    const wkA = weeks.findIndex((x) => x.from <= addDays(w.today, -6) && x.to >= addDays(w.today, -6))
    expect(rows[wkA].hariHm).toBeGreaterThanOrEqual(1)
    expect(rows[wkA].hmAwal).toBe(1000)
    // a unit without any HM in the month: Total HM empty, not 0
    const ex03Row = r.body.main.rows.find((x: { unit: string }) => x.unit.includes('D2410-EX03'))
    expect(ex03Row.hm).toBeNull()
  })
})

describe('D2410 offline sync: HM optional, old APK payload unchanged', () => {
  type Mobile = { token: string; device: string }
  let m: Mobile
  const bearer = (x: Mobile) => ({ Authorization: `Bearer ${x.token}`, 'X-Device-Id': x.device, 'X-App-Version': '1.0.0' })
  async function sync(items: Array<Record<string, unknown>>) {
    resetRateLimits()
    const now = Date.now()
    const clock = { device_time: new Date(now).toISOString(), elapsed_ms: 10_000_000, boot_id: 'boot-1', last_server_time: new Date(now - 600_000).toISOString(), last_server_elapsed_ms: 10_000_000 - 600_000 }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return http('POST', '/api/v1/sync/batch', { headers: bearer(m), json: { batch_id: randomUUID(), device_id: m.device, clock, items } }) as Promise<{ status: number; body: any }>
  }
  const item = (payload: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    client_uuid: randomUUID(),
    type: 'unit_timesheet.upsert',
    schema_version: 1,
    offline: true,
    device_time: new Date(Date.now() - 300_000).toISOString(),
    elapsed_ms: 10_000_000 - 300_000,
    payload,
    ...over,
  })

  beforeAll(async () => {
    const p = await getTestPayload()
    const doc = await p.findByID({ collection: 'users', id: w.users.staffA.id, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })
    const t: TestUser = { ...w.users.staffA, keycloakSub: doc.keycloakSub as string }
    const token = await accessToken(t, ['pk-staff'])
    m = { token, device: await registerDevice(t, token) }
  })

  it('new APK: a timesheet without HM is applied (copy with null HM); an edit adds HM + photo; an old-APK edit resending the stored photo id passes', async () => {
    const company = await companyId()
    const it1 = item({ project_id: w.kontrak, unit_id: w.ex01, report_date: addDays(w.today, -1), work_hours: 7 }, { company_id: company })
    const r = await sync([it1])
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.results[0], JSON.stringify(r.body.results[0])).toMatchObject({ status: 'applied', rev: 1 })
    expect(r.body.results[0].server_unit_timesheet).toMatchObject({ hm_start: null, hm_end: null, hm_photo_media_id: null })
    const half = await sync([item({ project_id: w.kontrak, unit_id: ex03, report_date: addDays(w.today, -1), hm_start: 5, work_hours: 1 }, { company_id: company })])
    expect(half.body.results[0]).toMatchObject({ status: 'rejected', errors: [{ code: 'VALIDATION' }] })
    const up = await uploadFieldPhoto(w.users.staffA)
    const edit = await sync([item({ timesheet_client_uuid: it1.client_uuid, hm_start: 1010, hm_end: 1017, hm_photo_media_id: up.id }, { company_id: company, base_rev: 1 })])
    expect(edit.body.results[0], JSON.stringify(edit.body)).toMatchObject({ status: 'applied', rev: 2 })
    expect(edit.body.results[0].server_unit_timesheet).toMatchObject({ hm_start: 1010, hm_end: 1017, hm_photo_media_id: up.id })
    const again = await sync([item({ timesheet_client_uuid: it1.client_uuid, hm_end: 1018, hm_photo_media_id: up.id }, { company_id: company, base_rev: 2 })])
    expect(again.body.results[0], JSON.stringify(again.body)).toMatchObject({ status: 'applied', rev: 3 })
  })

  it('old APK: create with HM + photo (all fields, as before) is applied unchanged', async () => {
    const company = await companyId()
    const up = await uploadFieldPhoto(w.users.staffA)
    const r = await sync([item({ project_id: w.kontrak, unit_id: ex03, report_date: addDays(w.today, -2), hm_start: 500, hm_end: 508, work_hours: 8, hm_photo_media_id: up.id }, { company_id: company })])
    expect(r.body.results[0], JSON.stringify(r.body.results[0])).toMatchObject({ status: 'applied' })
    expect(r.body.results[0].server_unit_timesheet).toMatchObject({ hm_start: 500, hm_end: 508, hm_photo_media_id: up.id })
  })
})

describe('D2410 web: matrix "+" per caller, form keeps the matrix date', () => {
  type Props = AdminViewServerProps
  async function propsFor(user: FlowUser, segments: string[], searchParams: Record<string, string> = {}): Promise<Props> {
    const req = await createLocalReq({ user: { ...user, collection: 'users' } as never }, await getTestPayload())
    return { initPageResult: { req, locale: undefined, permissions: {}, visibleEntities: { collections: [], globals: [] } }, params: { segments }, searchParams } as unknown as Props
  }
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
  const plus = (date: string, unit: number) => `href="/admin/unit-kontrak/timesheet/baru?project=${w.kontrak}&amp;unit=${unit}&amp;tanggal=${date}"`

  it('a missing day older than 14 days: "+" for the PM, a non-link with the reason for Staff', async () => {
    const day = addDays(w.today, -16) // ex03: in its contract, no timesheet
    const month = day.slice(0, 7)
    const staff = await render(FieldContractDetail, w.users.staffA, ['unit-kontrak', 'kontrak', String(w.kontrak)], { tab: 'timesheet', bulan: month })
    expect(staff).not.toContain(plus(day, ex03))
    expect(staff).toContain('hanya dapat diisi PM project atau Direktur')
    const pm = await render(FieldContractDetail, w.users.pm, ['unit-kontrak', 'kontrak', String(w.kontrak)], { tab: 'timesheet', bulan: month })
    expect(pm).toContain(plus(day, ex03))
  })

  it('the form keeps the matrix date: preselected unit for the PM, a notice (not today) for Staff', async () => {
    const day = addDays(w.today, -16)
    const sp = { project: String(w.kontrak), unit: String(ex03), tanggal: day }
    const pm = await render(FieldTimesheetNew, w.users.pm, ['unit-kontrak', 'timesheet', 'baru'], sp)
    expect(pm).toContain(`value="${day}"`)
    expect(pm).toContain(`<option value="${ex03}" selected="">D2410-EX03</option>`)
    expect(pm).not.toContain('data-pk-date-limit')
    const staff = await render(FieldTimesheetNew, w.users.staffA, ['unit-kontrak', 'timesheet', 'baru'], sp)
    expect(staff).toContain(`value="${day}"`)
    expect(staff).toContain('data-pk-date-limit')
  })

  it('Rekap tab: weekly HM card for the office', async () => {
    const month = addDays(w.today, -6).slice(0, 7)
    const own = await render(FieldContractDetail, w.users.owner, ['unit-kontrak', 'kontrak', String(w.kontrak)], { tab: 'rekap', bulan: month })
    expect(own).toContain('data-pk-table="hm-weekly"')
    expect(own).toContain(hmWeeks(month)[0]!.label)
  })
})
