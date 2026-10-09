import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }))

import { ActivityForm } from '@/admin/components/field/ActivityForm'
import { CorrectionDialog } from '@/admin/components/field/CorrectionDialog'
import { linesOut, newLine } from '@/admin/components/field/parts'
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

describe('correction dialog', () => {
  it('PM/Direktur correction: required reason, a real button, modal dialog', () => {
    const out = html(React.createElement(CorrectionDialog, { url: '/api/v1/unit-timesheets/1/corrections', mode: 'correction', buttonLabel: 'Koreksi', title: 'Koreksi timesheet', description: 'x', fields: [{ name: 'hmStart', label: 'HM awal', kind: 'decimal', value: 1020 }], testId: 't' }))
    expect(out).toContain('<button type="button" class="pk-kbtn" data-pk-action="t">Koreksi</button>')
    expect(out).toContain('<dialog')
    expect(out).toContain('Alasan koreksi')
    expect(out).toContain('required=""')
    expect(out).toContain('value="1.020"')
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
  it('styles: tokens only (no raw colours except white on solid tones), matrix scrolls in its own box', () => {
    expect(FIELD_STYLE).not.toMatch(/#[0-9a-f]{3,6}\b/i)
    expect(FIELD_STYLE).toContain('.pk-mxw { position: relative; overflow-x: auto;') // hidden cell texts stay inside the scroll box (390 px)
  })
})
