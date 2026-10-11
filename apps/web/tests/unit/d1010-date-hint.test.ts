import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DateInput } from '@/admin/components/DateInput'
import { dateInputHint, formatDateTimeLocalHint, formatDateWeekday } from '@/pdf/format'

describe('date input helper text (DRMS 10/10 Lead review h)', () => {
  it('business date → weekday + Indonesian long date, no time-zone shift', () => {
    expect(formatDateWeekday('2026-10-12')).toBe('Senin, 12 Oktober 2026')
    expect(formatDateWeekday('2026-10-11')).toBe('Minggu, 11 Oktober 2026')
    expect(formatDateWeekday('2026-01-01')).toBe('Kamis, 1 Januari 2026')
    expect(formatDateWeekday('2024-02-29')).toBe('Kamis, 29 Februari 2024')
    // the same text in any process TZ (computed from the calendar date)
    const tz = process.env.TZ
    for (const z of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Makassar']) {
      process.env.TZ = z
      expect(formatDateWeekday('2026-12-31')).toBe('Kamis, 31 Desember 2026')
    }
    process.env.TZ = tz
  })

  it('empty / malformed / impossible → no hint', () => {
    for (const v of ['', null, undefined, '2026-2-1', '12/10/2026', '2026-02-30', '2026-13-01', '2026-10-12T10:00']) expect(formatDateWeekday(v)).toBe('')
    for (const v of ['', null, '2026-10-12', '2026-10-12T24:00', '2026-02-30T10:00']) expect(formatDateTimeLocalHint(v)).toBe('')
  })

  it('datetime-local → date + wall time as typed', () => {
    expect(formatDateTimeLocalHint('2026-10-12T14:30')).toBe('Senin, 12 Oktober 2026 14.30')
    expect(formatDateTimeLocalHint('2026-10-12T07:05:00')).toBe('Senin, 12 Oktober 2026 07.05')
    expect(dateInputHint('date', '2026-10-12')).toBe('Senin, 12 Oktober 2026')
    expect(dateInputHint('datetime-local', '2026-10-12T00:00')).toBe('Senin, 12 Oktober 2026 00.00')
  })

  it('DateInput: native input with all props + hint linked by aria-describedby (controlled and uncontrolled)', () => {
    const controlled = renderToStaticMarkup(React.createElement(DateInput, { id: 'd', name: 'tgl', value: '2026-10-12', max: '2026-10-31', required: true, onChange: () => {}, 'data-f': 'receiptDate' } as never))
    const input = /<input[^>]*>/.exec(controlled)?.[0] ?? ''
    for (const a of ['id="d"', 'name="tgl"', 'max="2026-10-31"', 'required=""', 'data-f="receiptDate"', 'type="date"', 'value="2026-10-12"']) expect(input, a).toContain(a)
    const hintId = /<small id="([^"]+)"/.exec(controlled)?.[1]
    expect(hintId).toBeTruthy()
    expect(controlled).toContain(`aria-describedby="${hintId}"`)
    expect(controlled).toContain('Senin, 12 Oktober 2026</small>')

    const filter = renderToStaticMarkup(React.createElement(DateInput, { name: 'dari', defaultValue: '2026-10-01', 'aria-describedby': 'own-help' }))
    expect(filter).toMatch(/value="2026-10-01"/)
    expect(filter).toMatch(/aria-describedby="own-help [^"]+"/)
    expect(filter).toContain('Kamis, 1 Oktober 2026')

    const empty = renderToStaticMarkup(React.createElement(DateInput, { name: 'sampai', defaultValue: '' }))
    expect(empty).not.toContain('<small')
    expect(empty).not.toContain('aria-describedby')

    const dt = renderToStaticMarkup(React.createElement(DateInput, { type: 'datetime-local', name: 'transferAt', defaultValue: '2026-10-12T14:30' }))
    expect(dt).toContain('type="datetime-local"')
    expect(dt).toContain('Senin, 12 Oktober 2026 14.30')
  })
})
