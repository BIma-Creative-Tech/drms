import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { addDays } from '@/domain/field/rules'
import { runDailyReminders } from '@/domain/reminders/service'
import { resetRateLimits } from '@/lib/rate-limit'

import { api, type FlowUser } from './flow-world'
import { makeFr1World, uploadFieldPhoto, type Fr1World } from './fr1-world'
import { accessToken, auditRows, companyId, getTestPayload, http, installLocalJwks, registerDevice, sqlAs, type TestUser, updateCompany } from './helpers'

/**
 * FR1 API (ADR 0020, requirements v1.3): access per project kind and assignment, feature flag,
 * service reports (number, HM rule, unit status + PM notification), timesheets (contract, unique
 * date, HM_GAP, last HM), aftersales log (values hidden, PO status by deliveries, open POs, follow-up
 * reminder), rates hidden from Staff/PM, edits / corrections (audited), idempotent replay, offline
 * sync, recaps (billing estimate for Direktur/Finance/Admin only), /me capabilities and the E4
 * negative rule (Staff still cannot create MANUAL progress reports). Fictional data only.
 */
let w: Fr1World
let svId: number
let tsId: number
let poId: number
let d1 = ''
let d2 = ''

beforeAll(async () => {
  installLocalJwks()
  w = await makeFr1World('fr1api')
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

describe('gate: feature flag, project kind, assignment', () => {
  it('flag off → 403 FEATURE_DISABLED on every create (reads keep working)', async () => {
    await updateCompany({ fieldReportsEnabled: false })
    try {
      const sv = await api('POST', '/api/v1/service-reports', w.users.staffA, { projectId: w.kontrak, unitId: w.ex01, serviceType: 'inspeksi', action: 'Cek rutin', unitStatusAfter: 'siap' })
      expect(sv.status).toBe(403)
      expect(sv.body.code).toBe('FEATURE_DISABLED')
      const ac = await api('POST', '/api/v1/aftersales-activities', w.users.staffA, { projectId: w.aftersales, clientId: w.client, kind: 'kunjungan' })
      expect(ac.body.code).toBe('FEATURE_DISABLED')
      expect((await api('GET', '/api/v1/service-reports', w.users.staffA)).status).toBe(200)
      // E4 rule kept: Staff photo upload is refused while no PT of theirs has field reports on
      expect((await uploadFieldPhoto(w.users.staffA)).status).toBe(403)
      const me = await api('GET', '/api/v1/me', w.users.staffA)
      expect(me.body.companies[0].capabilities).toMatchObject({ serviceReportCreate: false, unitTimesheetCreate: false, aftersalesActivityCreate: false })
      expect(me.body.companies[0].settings.fieldReportsEnabled).toBe(false)
    } finally {
      await updateCompany({ fieldReportsEnabled: true })
    }
    const me = await api('GET', '/api/v1/me', w.users.staffA)
    expect(me.body.companies[0].capabilities).toMatchObject({ serviceReportCreate: true, unitTimesheetCreate: true, aftersalesActivityCreate: true, progressReportCreate: false })
  })

  it('wrong project kind → 409 WRONG_PROJECT_KIND', async () => {
    const a = await api('POST', '/api/v1/unit-timesheets', w.users.pm, { projectId: w.aftersales, unitId: w.ex01, reportDate: w.today, hmStart: 1, hmEnd: 2, workHours: 1, hmPhotoId: 1 })
    expect(a.status).toBe(409)
    expect(a.body).toMatchObject({ code: 'WRONG_PROJECT_KIND', projectKind: 'aftersales' })
    const b = await api('POST', '/api/v1/aftersales-activities', w.users.pm, { projectId: w.kontrak, clientId: w.client, kind: 'kunjungan' })
    expect(b.body.code).toBe('WRONG_PROJECT_KIND')
    const c = await api('POST', '/api/v1/service-reports', w.users.owner, { projectId: w.project, unitId: w.ex01, serviceType: 'inspeksi', action: 'Cek', unitStatusAfter: 'siap' })
    expect(c.body.code).toBe('WRONG_PROJECT_KIND')
  })

  it('Staff not assigned / Finance / Admin / PM of another team → 403 (audited); E4: Staff still cannot create progress reports', async () => {
    for (const u of [w.users.staffB, w.users.finance, w.users.admin, w.users.otherPm]) {
      const r = await api('POST', '/api/v1/service-reports', u, { projectId: w.kontrak, unitId: w.ex01, serviceType: 'inspeksi', action: 'Cek', unitStatusAfter: 'siap' })
      expect(r.status, u.email).toBe(403)
      expect(r.body.code, u.email).toBe('FORBIDDEN')
    }
    const denied = await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE doc_type = 'service_report' AND action = 'access_denied' AND user_id = $1", [String(w.users.staffB.id)])
    expect(denied.rows[0].n).toBeGreaterThanOrEqual(1)
    const lp = await api('POST', '/api/v1/progress-reports', w.users.staffA, { projectId: w.kontrak, stageId: 1, pctAfter: 10, work: 'Staff mencoba laporan progress' })
    expect(lp.status).toBe(403)
  })
})

describe('service reports', () => {
  it('assigned Staff creates SV/YYMM/#### with photos and spare parts; unit status + HM follow; menunggu_part notifies the PM', async () => {
    const ph = [await photo(w.users.staffA), await photo(w.users.staffA)]
    const r = await api('POST', '/api/v1/service-reports', w.users.staffA, {
      projectId: w.kontrak,
      unitId: w.ex01,
      startTime: '08:00',
      endTime: '11:30',
      hourMeter: 1200,
      serviceType: 'perbaikan',
      complaint: 'Hidrolik boom lemah',
      action: 'Bongkar silinder boom, seal bocor',
      unitStatusAfter: 'menunggu_part',
      spareparts: [{ name: 'Seal kit boom', partNo: '707-99-47640', qty: 1, uom: 'SET' }],
      photoIds: ph,
    })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    svId = r.body.id
    const yymm = `${w.today.slice(2, 4)}${w.today.slice(5, 7)}`
    expect(r.body.docNo).toMatch(new RegExp(`^SV/${yymm}/\\d{4}$`))
    expect(r.body).toMatchObject({ reportDate: w.today, unitStatusAfter: 'menunggu_part', hourMeter: 1200, editable: true, project: { kind: 'kontrak_unit' } })
    expect(r.body.photos).toHaveLength(2)
    expect(r.body.spareparts[0]).toMatchObject({ name: 'Seal kit boom', qty: 1 })
    const unit = (await sqlAs('app', 'SELECT status::text AS s, last_hour_meter FROM vehicles WHERE id = $1', [w.ex01])).rows[0]
    expect(unit).toMatchObject({ s: 'menunggu_part' })
    expect(Number(unit.last_hour_meter)).toBe(1200)
    const n = await sqlAs('app', "SELECT user_id, title FROM notifications WHERE event = 'field.unit_waiting_part' AND doc_id = $1", [String(svId)])
    expect(n.rows.map((x) => Number(x.user_id))).toEqual([w.users.pm.id])
    expect(n.rows[0].title).toMatch(/menunggu part/i)
    // photos of the report are readable by the PM (team) and by the reporter, not by Staff B
    const pid = r.body.photos[0].id
    expect((await api('GET', `/api/v1/media/progress-photos/${pid}/file`, w.users.pm)).status).toBe(200)
    expect((await api('GET', `/api/v1/media/progress-photos/${pid}/file`, w.users.staffB)).status).toBe(404)
  })

  it('HM below the unit\'s latest reading → 409 HM_DECREASED; customer unit of another client → 400', async () => {
    const r = await api('POST', '/api/v1/service-reports', w.users.pm, { projectId: w.kontrak, unitId: w.ex01, hourMeter: 1100, serviceType: 'inspeksi', action: 'Cek ulang', unitStatusAfter: 'siap' })
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: 'HM_DECREASED', lastHourMeter: 1200 })
    // kontrak project has client w.client; the customer unit belongs to w.client → ok; on aftersales project (no client) → ok
    const ok = await api('POST', '/api/v1/service-reports', w.users.staffA, { projectId: w.aftersales, unitId: w.custUnit, serviceType: 'servis_berkala', action: 'Servis 500 jam', unitStatusAfter: 'siap' })
    expect(ok.status, JSON.stringify(ok.body)).toBe(201)
    await sqlAs('owner', `UPDATE projects SET client_id = ${w.client2} WHERE id = ${w.kontrak}`)
    try {
      const bad = await api('POST', '/api/v1/service-reports', w.users.staffA, { projectId: w.kontrak, unitId: w.custUnit, serviceType: 'inspeksi', action: 'Cek', unitStatusAfter: 'siap' })
      expect(bad.status).toBe(400)
    } finally {
      await sqlAs('owner', `UPDATE projects SET client_id = ${w.client} WHERE id = ${w.kontrak}`)
    }
  })

  it('reads: Staff A (assigned) and PM see it; Staff B and the other PM do not; list filters', async () => {
    expect((await api('GET', `/api/v1/service-reports/${svId}`, w.users.staffB)).status).toBe(404)
    expect((await api('GET', `/api/v1/service-reports/${svId}`, w.users.otherPm)).status).toBe(404)
    expect((await api('GET', `/api/v1/service-reports/${svId}`, w.users.finance)).status).toBe(200)
    const list = await api('GET', `/api/v1/service-reports?project=${w.kontrak}&status=menunggu_part`, w.users.pm)
    expect(list.body.items.map((x: { id: number }) => x.id)).toEqual([svId])
    expect((await api('GET', '/api/v1/service-reports', w.users.staffB)).body.items).toEqual([])
  })

  it('edit by the reporter within 24 h; others NOT_EDITABLE; after the window 409; PM correction with reason is audited', async () => {
    const e = await api('PATCH', `/api/v1/service-reports/${svId}`, w.users.staffA, { notes: 'Part dipesan ke Balikpapan' })
    expect(e.status, JSON.stringify(e.body)).toBe(200)
    expect(e.body).toMatchObject({ notes: 'Part dipesan ke Balikpapan', rev: 2 })
    const other = await api('PATCH', `/api/v1/service-reports/${svId}`, w.users.pm, { notes: 'PM mencoba edit' })
    expect(other.status).toBe(403)
    expect(other.body.code).toBe('NOT_EDITABLE')
    await sqlAs('owner', `ALTER TABLE service_reports DISABLE TRIGGER service_reports_protect; UPDATE service_reports SET editable_until = now() - interval '1 minute' WHERE id = ${svId}; ALTER TABLE service_reports ENABLE TRIGGER service_reports_protect;`)
    const late = await api('PATCH', `/api/v1/service-reports/${svId}`, w.users.staffA, { notes: 'terlambat' })
    expect(late.status).toBe(409)
    expect(late.body.code).toBe('NOT_EDITABLE')
    expect((await api('POST', `/api/v1/service-reports/${svId}/corrections`, w.users.staffA, { notes: 'x', reason: 'staff mencoba koreksi' })).status).toBe(403)
    expect((await api('POST', `/api/v1/service-reports/${svId}/corrections`, w.users.otherPm, { notes: 'x', reason: 'pm lain' })).status).toBe(404)
    expect((await api('POST', `/api/v1/service-reports/${svId}/corrections`, w.users.pm, { notes: 'x' })).status).toBe(400)
    // HM typo corrected below the last reading is allowed for a correction; the unit follows; status back to siap
    const c = await api('POST', `/api/v1/service-reports/${svId}/corrections`, w.users.pm, { hourMeter: 1020, unitStatusAfter: 'siap', reason: 'Salah ketik HM (1200 → 1020), part sudah terpasang' })
    expect(c.status, JSON.stringify(c.body)).toBe(200)
    expect(c.body).toMatchObject({ hourMeter: 1020, unitStatusAfter: 'siap', correctedBy: { id: w.users.pm.id } })
    expect(c.body.flags).toContain('CORRECTED')
    const unit = (await sqlAs('app', 'SELECT status::text AS s, last_hour_meter FROM vehicles WHERE id = $1', [w.ex01])).rows[0]
    expect(unit.s).toBe('siap')
    expect(Number(unit.last_hour_meter)).toBe(1020)
    const audit = await auditRows('service_report', svId)
    expect(audit.find((a) => a.action === 'update' && a.field === 'hourMeter')?.reason).toMatch(/^Koreksi: Salah ketik HM/)
  })

  it('clientUuid replay: same reporter → 200 same report; another user → 409 CLIENT_UUID_CONFLICT', async () => {
    const clientUuid = randomUUID()
    const body = { projectId: w.aftersales, unitId: w.custUnit, serviceType: 'inspeksi', action: 'Inspeksi bulanan', unitStatusAfter: 'siap', clientUuid }
    const first = await api('POST', '/api/v1/service-reports', w.users.staffA, body)
    expect(first.status).toBe(201)
    const again = await api('POST', '/api/v1/service-reports', w.users.staffA, body)
    expect(again.status).toBe(200)
    expect(again.body.id).toBe(first.body.id)
    const foreign = await api('POST', '/api/v1/service-reports', w.users.pm, body)
    expect(foreign.status).toBe(409)
    expect(foreign.body.code).toBe('CLIENT_UUID_CONFLICT')
    expect((await sqlAs('app', 'SELECT count(*)::int AS n FROM service_reports WHERE client_uuid = $1', [clientUuid])).rows[0].n).toBe(1)
  })
})

describe('unit timesheets', () => {
  it('contract required, one per unit and date, HM_GAP vs the previous end, last HM updated', async () => {
    d1 = addDays(w.today, -3)
    d2 = addDays(w.today, -2)
    const t1 = await api('POST', '/api/v1/unit-timesheets', w.users.staffA, { projectId: w.kontrak, unitId: w.ex01, reportDate: d1, hmStart: 1000, hmEnd: 1008, workHours: 8, standbyHours: 1, operatorName: 'Pak Udin', hmPhotoId: await photo(w.users.staffA) })
    expect(t1.status, JSON.stringify(t1.body)).toBe(201)
    expect(t1.body.flags).not.toContain('HM_GAP')
    expect(t1.body.flags).toContain('BACKDATED')
    expect(t1.body.hmPhoto).not.toBeNull()
    const t2 = await api('POST', '/api/v1/unit-timesheets', w.users.staffA, { projectId: w.kontrak, unitId: w.ex01, reportDate: d2, hmStart: 1006, hmEnd: 1015, workHours: 7, breakdownHours: 5, breakdownReason: 'Selang hidrolik pecah', hmPhotoId: await photo(w.users.staffA) })
    expect(t2.status, JSON.stringify(t2.body)).toBe(201)
    tsId = t2.body.id
    expect(t2.body.flags).toEqual(expect.arrayContaining(['HM_GAP', 'BREAKDOWN_SUGGEST_SERVICE']))
    expect(t2.body.suggestServiceReport).toBe(true)
    const dup = await api('POST', '/api/v1/unit-timesheets', w.users.pm, { projectId: w.kontrak, unitId: w.ex01, reportDate: d2, hmStart: 1015, hmEnd: 1016, workHours: 1, hmPhotoId: await photo(w.users.pm) })
    expect(dup.status).toBe(409)
    expect(dup.body.code).toBe('DUPLICATE_DATE')
    const notIn = await api('POST', '/api/v1/unit-timesheets', w.users.staffA, { projectId: w.kontrak, unitId: w.ex02, reportDate: d2, hmStart: 1, hmEnd: 2, workHours: 1, hmPhotoId: await photo(w.users.staffA) })
    expect(notIn.status).toBe(409)
    expect(notIn.body.code).toBe('NOT_IN_CONTRACT')
    const over = await api('POST', '/api/v1/unit-timesheets', w.users.staffA, { projectId: w.kontrak, unitId: w.ex01, reportDate: addDays(w.today, -4), hmStart: 990, hmEnd: 1000, workHours: 20, standbyHours: 5, hmPhotoId: await photo(w.users.staffA) })
    expect(over.status).toBe(400)
    // the unit's last HM = the reading of the latest document by date (service report of today: 1020)
    expect(Number((await sqlAs('app', 'SELECT last_hour_meter FROM vehicles WHERE id = $1', [w.ex01])).rows[0].last_hour_meter)).toBe(1020)
    // edit fixes the HM start → HM_GAP disappears
    const fix = await api('PATCH', `/api/v1/unit-timesheets/${tsId}`, w.users.staffA, { hmStart: 1008 })
    expect(fix.status, JSON.stringify(fix.body)).toBe(200)
    expect(fix.body.flags).not.toContain('HM_GAP')
  })

  it('contract rates: hidden from Staff and PM (API + collection field access), visible to Finance/Direktur/Admin', async () => {
    const staff = await api('GET', `/api/v1/projects/${w.kontrak}/contract-units`, w.users.staffA)
    expect(staff.status).toBe(200)
    expect(staff.body.items[0]).toMatchObject({ rate: null, minHoursPerMonth: null, ratesVisible: false, rateBasis: 'per_jam' })
    const pm = await api('GET', `/api/v1/projects/${w.kontrak}/contract-units`, w.users.pm)
    expect(pm.body.items[0].rate).toBeNull()
    const fin = await api('GET', `/api/v1/projects/${w.kontrak}/contract-units`, w.users.finance)
    expect(fin.body.items[0]).toMatchObject({ rate: 350_000, minHoursPerMonth: 200, ratesVisible: true })
    const rest = await api('GET', `/api/contract-units/${w.contract}`, w.users.staffA)
    expect(rest.status).toBe(200)
    expect(rest.body.rate).toBeUndefined()
    expect(rest.body.minHoursPerMonth).toBeUndefined()
    expect((await api('GET', `/api/contract-units/${w.contract}`, w.users.admin)).body.rate).toBe(350_000)
    expect((await api('GET', `/api/v1/projects/${w.kontrak}/contract-units`, w.users.staffB)).status).toBe(404)
    // units for the APK: contract info without rates
    const units = await api('GET', `/api/v1/units?project=${w.kontrak}`, w.users.staffA)
    expect(units.status).toBe(200)
    expect(units.body.items.map((u: { id: number }) => u.id)).toEqual([w.ex01])
    expect(units.body.items[0]).toMatchObject({ kind: 'alat_berat', contract: { id: w.contract }, status: 'siap' })
    expect(JSON.stringify(units.body)).not.toMatch(/rate/i)
  })
})

describe('aftersales activity log', () => {
  it('PO masuk value hidden from the PM (API + field access), visible to the reporter and Finance; deliveries move the PO status', async () => {
    const po = await api('POST', '/api/v1/aftersales-activities', w.users.staffA, {
      projectId: w.aftersales,
      clientId: w.client,
      kind: 'po_masuk',
      docNo: 'PO-0912',
      items: [
        { name: 'Filter oli', partNo: '600-211-1340', qty: 10, uom: 'PCS' },
        { name: 'Filter solar', qty: 10, uom: 'PCS' },
      ],
      value: 4_250_000,
    })
    expect(po.status, JSON.stringify(po.body)).toBe(201)
    poId = po.body.id
    expect(po.body).toMatchObject({ poStatus: 'belum_kirim', value: 4_250_000, valueVisible: true })
    const asPm = await api('GET', `/api/v1/aftersales-activities/${poId}`, w.users.pm)
    expect(asPm.body).toMatchObject({ value: null, valueVisible: false })
    expect((await api('GET', `/api/aftersales-activities/${poId}`, w.users.pm)).body.value).toBeUndefined()
    expect((await api('GET', `/api/v1/aftersales-activities/${poId}`, w.users.finance)).body.value).toBe(4_250_000)
    expect((await api('GET', `/api/v1/aftersales-activities/${poId}`, w.users.staffB)).status).toBe(404)
    let open = await api('GET', `/api/v1/aftersales/open-pos?client=${w.client}`, w.users.staffA)
    expect(open.body.items.map((x: { id: number }) => x.id)).toEqual([poId])
    // delivery without "selesai" → sebagian; a delivery for another customer's PO is refused
    const wrongClient = await api('POST', '/api/v1/aftersales-activities', w.users.staffA, { projectId: w.aftersales, clientId: w.client2, kind: 'pengiriman', relatesTo: poId })
    expect(wrongClient.status).toBe(400)
    const d1 = await api('POST', '/api/v1/aftersales-activities', w.users.staffA, { projectId: w.aftersales, clientId: w.client, kind: 'pengiriman', docNo: 'SJ-0440', relatesTo: poId, receiver: 'Gudang site', photoIds: [await photo(w.users.staffA)] })
    expect(d1.status, JSON.stringify(d1.body)).toBe(201)
    expect((await api('GET', `/api/v1/aftersales-activities/${poId}`, w.users.staffA)).body.poStatus).toBe('sebagian')
    open = await api('GET', `/api/v1/aftersales/open-pos?client=${w.client}`, w.users.pm)
    expect(open.body.items[0]).toMatchObject({ id: poId, poStatus: 'sebagian', deliveries: 1, value: null })
    // the PO is past its window: the delivery still closes it (system override)
    await sqlAs('owner', `ALTER TABLE aftersales_activities DISABLE TRIGGER aftersales_activities_protect; UPDATE aftersales_activities SET editable_until = now() - interval '1 minute' WHERE id = ${poId}; ALTER TABLE aftersales_activities ENABLE TRIGGER aftersales_activities_protect;`)
    const d2 = await api('POST', '/api/v1/aftersales-activities', w.users.staffA, { projectId: w.aftersales, clientId: w.client, kind: 'pengiriman', docNo: 'SJ-0441', relatesTo: poId, poDelivered: true })
    expect(d2.status, JSON.stringify(d2.body)).toBe(201)
    expect((await api('GET', `/api/v1/aftersales-activities/${poId}`, w.users.staffA)).body.poStatus).toBe('terkirim')
    expect((await api('GET', `/api/v1/aftersales/open-pos?client=${w.client}`, w.users.staffA)).body.items).toEqual([])
    const d3 = await api('POST', '/api/v1/aftersales-activities', w.users.staffA, { projectId: w.aftersales, clientId: w.client, kind: 'pengiriman', relatesTo: poId })
    expect(d3.status).toBe(409)
    expect(d3.body.code).toBe('PO_CLOSED')
    expect((await auditRows('aftersales_activity', poId)).some((a) => a.field === 'poStatus' && /Pengiriman/.test(a.reason ?? ''))).toBe(true)
  })

  it('quotation follow-up due → reminder to the reporter and the PM (once)', async () => {
    const q = await api('POST', '/api/v1/aftersales-activities', w.users.staffA, { projectId: w.aftersales, clientId: w.client2, kind: 'penawaran', docNo: 'Q-0077', followUpDate: w.today })
    expect(q.status, JSON.stringify(q.body)).toBe(201)
    const company = await companyId()
    await runDailyReminders(await getTestPayload(), { force: true, companyId: company })
    await runDailyReminders(await getTestPayload(), { force: true, companyId: company })
    const n = await sqlAs('app', "SELECT user_id FROM notifications WHERE event = 'reminder.aftersales_followup' AND doc_id = $1 ORDER BY user_id", [String(q.body.id)])
    expect(n.rows.map((x) => Number(x.user_id)).sort((a, b) => a - b)).toEqual([w.users.staffA.id, w.users.pm.id].sort((a, b) => a - b))
  })
})

describe('recaps (registry reports)', () => {
  it('rekap-timesheet-kontrak: estimate only for Finance/Direktur/Admin; PM sees hours; CSV export works', async () => {
    const month = d2.slice(0, 7)
    const fin = await api('GET', `/api/v1/reports/rekap-timesheet-kontrak?bulan=${month}`, w.users.finance)
    expect(fin.status, JSON.stringify(fin.body)).toBe(200)
    const cols = fin.body.main.columns.map((c: { key: string }) => c.key)
    expect(cols).toEqual(expect.arrayContaining(['kerja', 'pctAvail', 'estimasi']))
    const row = fin.body.main.rows.find((r: { unit: string }) => r.unit.includes('FR1API-EX01'))
    const inMonth = [[d1, 8], [d2, 7]].filter(([d]) => String(d).startsWith(month)) as Array<[string, number]>
    expect(row).toMatchObject({ hariTs: inMonth.length, kerja: inMonth.reduce((a, [, h]) => a + h, 0) })
    expect(row.estimasi).toBeGreaterThan(0)
    expect(fin.body.notes.join(' ')).toMatch(/ESTIMASI, BUKAN INVOICE/)
    const pm = await api('GET', '/api/v1/reports/rekap-timesheet-kontrak', w.users.pm)
    expect(pm.status).toBe(200)
    expect(pm.body.main.columns.map((c: { key: string }) => c.key)).not.toContain('estimasi')
    expect(JSON.stringify(pm.body)).not.toMatch(/350000|350\.000/)
    expect((await api('GET', '/api/v1/reports/rekap-timesheet-kontrak', w.users.staffA)).status).toBe(403)
    const csv = await api('GET', '/api/v1/reports/rekap-timesheet-kontrak/csv', w.users.finance)
    expect(csv.status).toBe(200)
    expect(String(csv.headers.get('content-type'))).toMatch(/text\/csv/)
  })

  it('rekap-aftersales: per customer PO masuk / terkirim / belum, value for the office only', async () => {
    const own = await api('GET', `/api/v1/reports/rekap-aftersales?dari=${addDays(w.today, -7)}&sampai=${w.today}`, w.users.owner)
    expect(own.status, JSON.stringify(own.body)).toBe(200)
    const row = own.body.main.rows.find((r: { pelanggan: string }) => r.pelanggan.includes('fr1api Pelanggan Tambang'))
    expect(row).toMatchObject({ po: 1, terkirim: 1, belum: 0, pengiriman: 2, nilai: 4_250_000 })
    const pm = await api('GET', `/api/v1/reports/rekap-aftersales?dari=${addDays(w.today, -7)}&sampai=${w.today}`, w.users.pm)
    expect(pm.body.main.columns.map((c: { key: string }) => c.key)).not.toContain('nilai')
  })
})

describe('offline sync (unit_timesheet.upsert / service_report.upsert)', () => {
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
  const item = (type: string, payload: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    client_uuid: randomUUID(),
    type,
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

  it('offline timesheet applied once (OFFLINE, apk), replay = duplicate, stale base_rev = conflict + server copy, edit with base_rev', async () => {
    const up = await uploadFieldPhoto(w.users.staffA)
    const company = await companyId()
    const it1 = item('unit_timesheet.upsert', { project_id: w.kontrak, unit_id: w.ex01, report_date: addDays(w.today, -1), hm_start: 1020, hm_end: 1028, work_hours: 8, operator_name: 'Pak Udin', hm_photo_media_id: up.id }, { company_id: company })
    const r = await sync([it1])
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const res = r.body.results[0]
    expect(res, JSON.stringify(res)).toMatchObject({ status: 'applied', rev: 1 })
    expect(res.flags).toContain('OFFLINE')
    expect(res.server_unit_timesheet).toMatchObject({ client_uuid: it1.client_uuid, hm_start: 1020, hm_end: 1028, hm_photo_media_id: up.id })
    const id = Number(res.server_id)
    expect((await sqlAs('app', 'SELECT offline, source, flags FROM unit_timesheets WHERE id = $1', [id])).rows[0]).toMatchObject({ offline: true, source: 'apk' })
    const again = await sync([it1])
    expect(again.body.results[0]).toMatchObject({ status: 'duplicate', original_status: 'applied', server_id: String(id) })
    const stale = await sync([item('unit_timesheet.upsert', { timesheet_client_uuid: it1.client_uuid, notes: 'tanpa base_rev' }, { company_id: company })])
    expect(stale.body.results[0]).toMatchObject({ status: 'conflict', errors: [{ code: 'STALE_REV' }] })
    expect(stale.body.results[0].server_unit_timesheet.hm_end).toBe(1028)
    const edit = await sync([item('unit_timesheet.upsert', { timesheet_client_uuid: it1.client_uuid, hm_end: 1029, work_hours: 9 }, { company_id: company, base_rev: 1 })])
    expect(edit.body.results[0], JSON.stringify(edit.body)).toMatchObject({ status: 'applied', rev: 2 })
    expect(edit.body.results[0].server_unit_timesheet).toMatchObject({ hm_end: 1029, work_hours: 9 })
    expect((await auditRows('unit_timesheet', id)).map((a) => a.action)).toEqual(expect.arrayContaining(['create', 'sync_offline']))
  })

  it('rejections carry stable codes: WRONG_PROJECT_KIND, FEATURE_DISABLED', async () => {
    const company = await companyId()
    const wrong = await sync([item('service_report.upsert', { project_id: w.project, unit_id: w.ex01, service_type: 'inspeksi', action: 'Cek', unit_status_after: 'siap' }, { company_id: company })])
    expect(wrong.body.results[0]).toMatchObject({ status: 'rejected', errors: [{ code: 'WRONG_PROJECT_KIND' }] })
    await updateCompany({ fieldReportsEnabled: false })
    try {
      const off = await sync([item('aftersales_activity.upsert', { project_id: w.aftersales, client_id: w.client, kind: 'kunjungan' }, { company_id: company })])
      expect(off.body.results[0]).toMatchObject({ status: 'rejected', errors: [{ code: 'FEATURE_DISABLED' }] })
    } finally {
      await updateCompany({ fieldReportsEnabled: true })
    }
  })
})
