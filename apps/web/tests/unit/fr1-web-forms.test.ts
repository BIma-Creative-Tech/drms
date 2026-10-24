import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }))

import { ActivityForm } from '@/admin/components/field/ActivityForm'
import { linesFrom, linesOut, newLine } from '@/admin/components/field/parts'
import { ServiceReportForm } from '@/admin/components/field/ServiceReportForm'
import { TimesheetForm } from '@/admin/components/field/TimesheetForm'
import { FIELD_STYLE } from '@/admin/views/field-style'

/**
 * FR1 web input forms (SSR markup): visible labels, required marks, real buttons for every action,
 * the APK field set; and the spare-part / item line rules. Behaviour against the API is covered by the
 * integration tests of the endpoints (fr1-api.int.test.ts).
 */
const html = (el: React.ReactElement) => renderToStaticMarkup(el)

describe('Laporan servis form', () => {
  const out = html(
    React.createElement(ServiceReportForm, {
      projects: [{ id: 5, label: 'K-001 Sewa PT Kalteng Coal', companyId: 1, kind: 'kontrak_unit' }],
      units: [{ id: 11, label: 'EX-01', sub: 'Excavator · milik sendiri', lastHm: 1023, status: 'siap' }],
      unitsByProject: { '5': [11] },
      serviceTypes: [
        { id: 31, companyId: 1, name: 'Servis berkala' },
        { id: 32, companyId: 1, name: 'Perbaikan sistem hidrolik dan penggantian seal silinder boom' },
        { id: 41, companyId: 2, name: 'Jenis PT lain' },
      ],
      today: '2026-10-09',
      minDate: '2026-09-25',
      initialProject: 5,
      initialUnit: 11,
    }),
  )
  it('has the APK field set with labels and the date window', () => {
    for (const l of ['Project / kontrak', 'Unit', 'Tanggal', 'HM saat servis', 'Jam mulai', 'Jam selesai', 'Jenis servis', 'Keluhan', 'Tindakan / pekerjaan', 'Helper (opsional)', 'Sparepart', 'Status unit', 'Foto sebelum / sesudah', 'Catatan']) expect(out, l).toContain(l)
    expect(out).toContain('min="2026-09-25"')
    expect(out).toContain('max="2026-10-09"')
    expect(out).toContain('HM terakhir 1.023')
  })
  it('every action is a button; photos via a labelled file control', () => {
    expect(out).toContain('data-pk-submit="service-report"')
    expect(out).toContain('>+ Tambah sparepart</button>')
    expect(out).toContain('+ Tambah foto</label>')
    expect(out).toContain('accept="image/jpeg,image/png,image/webp"')
  })
  it('DRMS owner 2026-10-17: Jenis servis = checkbox pills of the project PT only; no "No. part"; 25 photos', () => {
    expect(out).toContain('type="checkbox"')
    expect(out).toContain('data-pk-choice="31"')
    expect(out).toContain('Perbaikan sistem hidrolik dan penggantian seal silinder boom') // long name in full (wraps)
    expect(out).not.toContain('data-pk-choice="41"') // another PT's type
    expect(out).not.toContain('No. part')
    expect(out).toContain('(0/25)')
    expect(out).toContain('Maks. 25 foto')
  })
})

describe('Timesheet form', () => {
  const out = html(
    React.createElement(TimesheetForm, {
      projects: [
        {
          projectId: 5,
          label: 'K-001',
          companyId: 1,
          units: [
            { contractUnitId: 1, unitId: 11, label: 'EX-01', startDate: '2026-09-01', endDate: null, active: true, lastHm: 1023 },
            { contractUnitId: 2, unitId: 12, label: 'EX-02', startDate: '2026-10-20', endDate: null, active: true, lastHm: null },
            { contractUnitId: 3, unitId: 13, label: 'DZ-01', startDate: '2026-09-01', endDate: null, active: false, lastHm: null },
          ],
        },
      ],
      today: '2026-10-09',
      minDate: '2026-09-25',
      initialProject: 5,
    }),
  )
  it('unit picker offers only the units active in the contract on the date', () => {
    expect(out).toContain('>EX-01</option>')
    expect(out).not.toContain('>EX-02</option>') // starts later
    expect(out).not.toContain('>DZ-01</option>') // inactive contract unit
  })
  it('HM, hours (live total of 24), HM photo required, operator copy, submit', () => {
    for (const l of ['HM awal', 'HM akhir', 'Kerja', 'Standby', 'Breakdown', 'Foto meter HM akhir', 'Nama operator', 'BBM', 'Lokasi']) expect(out, l).toContain(l)
    expect(out).toContain('data-pk-hours-total="0"')
    expect(out).toContain('Total 0 dari 24 jam')
    expect(out).toContain('data-pk-submit="unit-timesheet"')
  })
})

/** D2410 (user 2026-10-24): date window per project (matrix "+" date honoured or a visible notice), HM optional. */
describe('Timesheet form — D2410 backdate window + optional HM', () => {
  const units = [{ contractUnitId: 1, unitId: 11, label: 'EX-01', startDate: '2026-08-01', endDate: null, active: true, lastHm: 1023 }]
  const form = (minDate: string | undefined, initialDate: string) =>
    html(React.createElement(TimesheetForm, { projects: [{ projectId: 5, label: 'K-001', companyId: 1, minDate, units }], today: '2026-10-24', minDate: '2026-10-10', initialProject: 5, initialUnit: 11, initialDate }))
  it('PM / Direktur (minDate = contract start): an old matrix date is kept and its unit preselected, no notice', () => {
    const out = form('2026-08-01', '2026-09-05')
    expect(out).toContain('value="2026-09-05"')
    expect(out).toContain('min="2026-08-01"')
    expect(out).toContain('<option value="11" selected="">EX-01</option>')
    expect(out).not.toContain('data-pk-date-limit')
  })
  it('reporter: a date older than 14 days is NOT swapped for today — it stays with a visible notice', () => {
    const out = form('2026-10-10', '2026-09-05')
    expect(out).toContain('value="2026-09-05"')
    expect(out).toContain('data-pk-date-limit')
    expect(out).toContain('hanya dapat diisi PM project atau Direktur')
    expect(out).toContain('min="2026-10-10"')
  })
  it('HM section is optional (weekly): no required mark on HM, photo required only with HM', () => {
    const out = form('2026-10-10', '2026-10-24')
    expect(out).toContain('Hour meter (HM) · opsional')
    expect(out).toContain('data-pk-hm-optional')
    expect(out).toContain('HM dicatat ±1× seminggu')
    expect(out).not.toMatch(/HM awal<span class="req"/)
    expect(out).not.toMatch(/HM akhir<span class="req"/)
    expect(out).toContain('Wajib 1 foto bila HM diisi.')
  })
})

describe('Aktivitas aftersales form', () => {
  it('customer, kind chips (radio), value optional with the visibility note', () => {
    const out = html(React.createElement(ActivityForm, { projects: [{ id: 9, label: 'AS-01', companyId: 1, clientId: null }], clients: [{ id: 3, name: 'CV Maju Jaya', companyId: 1 }], today: '2026-10-09', minDate: '2026-09-25', initial: { kind: 'pengiriman', client: 3 } }))
    expect(out).toContain('Pelanggan')
    for (const k of ['Penawaran', 'PO masuk', 'Pengiriman', 'Penagihan', 'Kunjungan']) expect(out).toContain(`value="${k === 'PO masuk' ? 'po_masuk' : k.toLowerCase()}"`)
    expect(out).toContain('Untuk PO (PO terbuka pelanggan ini)')
    expect(out).toContain('PO ini sudah terkirim semua')
    expect(out).toContain('Penerima')
    expect(out).toContain('Hanya terlihat oleh Direktur/Finance/Admin dan Anda.')
    expect(out).toContain('data-pk-submit="aftersales-activity"')
  })
})

/**
 * UI feedback 17/10 #5 ("edit = add"): the former Ubah / Koreksi dialogs are the input forms in `mode` edit /
 * correction — same field set; project / unit / date (and customer / kind / PO) disabled in place; stored photos shown,
 * new ones added; "Alasan" the last field (required for a correction); "Simpan perubahan" / "Simpan koreksi" + "Batal".
 */
describe('edit / correction mode of the input forms', () => {
  const disabled = (out: string, attr: string) => expect(out, attr).toMatch(new RegExp(`<(select|input)[^>]*data-pk-locked="${attr}"[^>]*disabled=""|<(select|input)[^>]*disabled=""[^>]*data-pk-locked="${attr}"`))
  it('service report correction: same sections, locked project / unit / date, stored photos, inactive type, reason last', () => {
    const out = html(
      React.createElement(ServiceReportForm, {
        mode: 'correction',
        report: {
          id: 7,
          projectId: 5,
          unitId: 11,
          reportDate: '2026-10-08',
          hourMeter: 1020,
          startTime: '08:00',
          endTime: null,
          serviceTypeIds: [31, 39],
          complaint: null,
          action: 'Ganti seal',
          helpers: null,
          unitStatusAfter: 'siap',
          spareparts: [{ name: 'Seal', partNo: 'SL-1', qty: 1 }],
          notes: null,
          photos: [{ id: 501, url: '/api/v1/media/progress-photos/501/file', thumbUrl: '/t/501' }],
        },
        projects: [{ id: 5, label: 'K-001 Sewa', companyId: 1, kind: 'kontrak_unit' }],
        units: [{ id: 11, label: 'EX-01', sub: 'Excavator', lastHm: null, status: 'siap' }],
        unitsByProject: { '5': [11] },
        serviceTypes: [
          { id: 31, companyId: 1, name: 'Servis berkala' },
          { id: 39, companyId: 1, name: 'Overhaul (nonaktif)' },
        ],
        today: '2026-10-09',
        minDate: '2026-10-08',
      }),
    )
    expect(out).toContain('data-pk-form="service-report-correction"')
    for (const l of ['Project / kontrak', 'Unit', 'Tanggal', 'HM saat servis', 'Jenis servis', 'Tindakan / pekerjaan', 'Sparepart', 'Status unit', 'Foto sebelum / sesudah', 'Catatan']) expect(out, l).toContain(l)
    for (const k of ['project', 'unit', 'reportDate']) disabled(out, k)
    expect(out).toContain('value="1.020"')
    expect(out).toContain('Overhaul (nonaktif)')
    expect((out.match(/type="checkbox"[^>]*checked=""/g) ?? []).length).toBe(2)
    expect(out).toContain('data-pk-photo-stored="501"')
    expect(out).toContain('(1/25)')
    expect(out).not.toContain('No. part')
    expect(out).toContain('Alasan koreksi')
    expect(out.indexOf('data-pk-field="reason"')).toBeGreaterThan(out.indexOf('Foto sebelum / sesudah'))
    expect(out).toContain('href="/admin/laporan-servis/detail/7"')
    expect(out).toContain('Simpan koreksi')
  })
  it('aftersales edit: customer / kind / date disabled, hidden value disabled, reason optional', () => {
    const out = html(
      React.createElement(ActivityForm, {
        mode: 'edit',
        activity: { id: 4, projectId: 9, clientId: 3, kind: 'penawaran', activityDate: '2026-10-08', docNo: 'Q-1', items: [], value: null, valueVisible: false, followUpDate: null, receiver: null, relatesTo: null, poStatus: null, notes: null, photos: [] },
        projects: [{ id: 9, label: 'AS-01', companyId: 1, clientId: 3 }],
        clients: [{ id: 3, name: 'CV Maju Jaya', companyId: 1 }],
        today: '2026-10-09',
        minDate: '2026-10-08',
      }),
    )
    expect(out).toContain('data-pk-form="aftersales-activity-edit"')
    for (const k of ['project', 'client', 'activityDate']) disabled(out, k)
    expect(out).toMatch(/<fieldset class="pk-fld pk-choice"[^>]*disabled=""/)
    expect(out).toContain('Nilai hanya terlihat dan diubah oleh Direktur/Finance/Admin dan pelapor.')
    expect(out).toContain('Alasan perubahan (opsional)')
    expect(out).toContain('Simpan perubahan')
    expect(out).not.toContain('PO ini sudah terkirim semua')
  })
  it('timesheet edit: contract / date / unit disabled, stored HM photo (not replaceable), reason last', () => {
    const out = html(
      React.createElement(TimesheetForm, {
        mode: 'edit',
        report: { id: 12, projectId: 5, unitId: 11, reportDate: '2026-10-08', hmStart: 1020, hmEnd: 1028, workHours: 8, standbyHours: 0, breakdownHours: 0, breakdownReason: null, fuelLiters: null, operatorName: 'Op', location: null, notes: null, hmPhoto: { id: 77, url: '/u/77', thumbUrl: '/t/77' } },
        projects: [{ projectId: 5, label: 'K-001', companyId: 1, units: [{ contractUnitId: 1, unitId: 11, label: 'EX-01', startDate: '2026-10-08', endDate: '2026-10-08', active: true, lastHm: null }] }],
        today: '2026-10-09',
        minDate: '2026-10-08',
      }),
    )
    expect(out).toContain('data-pk-form="unit-timesheet-edit"')
    for (const k of ['project', 'reportDate', 'unit']) disabled(out, k)
    expect(out).toContain('value="1.028"')
    expect(out).toContain('data-pk-photo-stored="77"')
    expect(out).toContain('Foto meter HM tersimpan dan tidak dapat diganti.')
    expect(out).not.toContain('+ Tambah foto')
    expect(out).toContain('Alasan perubahan (opsional)')
    expect(out).toContain('href="/admin/unit-kontrak/timesheet/detail/12"')
  })
})

describe('line rules (spare parts / items)', () => {
  it('blank rows dropped; name required; qty > 0 with the Indonesian comma', () => {
    const r = linesOut([newLine({ name: 'Seal kit', qty: '1', uom: 'SET' }), newLine(), newLine({ name: 'Oli', qty: '20,5' }), newLine({ name: '', qty: '2' }), newLine({ name: 'X', qty: '0' })], false)
    expect(r.lines).toEqual([
      { name: 'Seal kit', partNo: null, qty: 1, uom: 'SET' },
      { name: 'Oli', partNo: null, qty: 20.5, uom: null },
    ])
    expect(Object.keys(r.errors)).toEqual(['3', '4'])
  })
  it('a stored part no. survives editor rows without that column (linesFrom → linesOut)', () => {
    const rows = linesFrom([{ name: 'Seal kit', partNo: '707-99', qty: 1, uom: 'SET', note: null }])
    expect(linesOut(rows, true).lines).toEqual([{ name: 'Seal kit', partNo: '707-99', qty: 1, uom: 'SET', note: null }])
  })
  it('styles: tokens only (no raw colours except white on solid tones), matrix scrolls in its own box', () => {
    expect(FIELD_STYLE).not.toMatch(/#[0-9a-f]{3,6}\b/i)
    expect(FIELD_STYLE).toContain('.pk-mxw { position: relative; overflow-x: auto;') // hidden cell texts stay inside the scroll box (390 px)
  })
})
