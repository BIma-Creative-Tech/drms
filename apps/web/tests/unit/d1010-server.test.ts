import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { CAMERA_BUSY, CAMERA_DENIED, cameraErrorMessage, cameraSupported, captureSize, NO_CAMERA } from '@/admin/components/absensi/camera'
import { bandGeometry, BRAND, fit, localStamp, renderBand, SELFIE_MAX_BYTES, stampImage, stampLines, tzLabel, type StampInfo } from '@/domain/attendance/stamp'
import { formatHours, hoursBetween, measure, monthInTz, percentile, queueAge, summarize } from '@/domain/expense/sla'
import { companyCodeError, DEFAULT_SEQUENCES, formatDocNo, LEGACY_DEFAULT_PATTERNS, parseBusinessDate, patternError, periodKey } from '@/domain/numbering'
import { glyph, toAscii } from '@/lib/bitmap-font'
import { isoDateInTz, parseZonedDateTime } from '@/lib/time'
import { NUMBERING_MOVES } from '@/migrations/20261012_200100_d1010_data'

const FIXTURE = readFileSync(fileURLToPath(new URL('../fixtures/selfie-720x960.jpg', import.meta.url)))

describe('D5 numbering: every number carries the PT short code', () => {
  const seq = (t: string) => DEFAULT_SEQUENCES.find((s) => s.docType === t)!

  it('every default is <DOC>/{COMPANY}/{YY}{MM}/{seq} with 4 digits, valid for its reset policy', () => {
    for (const s of DEFAULT_SEQUENCES) {
      expect(s.pattern).toBe(`${s.docCode}/{COMPANY}/{YY}{MM}/{seq}`)
      expect(s.padding).toBe(4)
      expect(patternError(s.pattern, s.resetPolicy)).toBeNull()
    }
  })

  it('formats TRF/LLAS/2610/0001; PB resets monthly from 1 (owner 2026-10-11)', () => {
    const d = parseBusinessDate('2026-10-11')
    expect(formatDocNo(seq('transfer'), 1, d, 'LLAS')).toBe('TRF/LLAS/2610/0001')
    expect(seq('expense_request').resetPolicy).toBe('monthly')
    expect(seq('expense_request').startAt).toBe(1)
    expect(formatDocNo(seq('expense_request'), 1, d, 'DRMS')).toBe('PB/DRMS/2610/0001')
    expect(formatDocNo(seq('daily_report'), 12, parseBusinessDate('2027-01-02'), 'CS1')).toBe('LH/CS1/2701/0012')
  })

  it('a mid-month pattern switch keeps the counter key (company, doc type, period) and never repeats an old string', () => {
    const d = parseBusinessDate('2026-10-20')
    const old = LEGACY_DEFAULT_PATTERNS.transfer!
    // same period key → the counter continues: TRF/2610/0005 then TRF/DRMS/2610/0006
    expect(periodKey('monthly', d)).toBe('2026-10')
    const before = formatDocNo({ pattern: old.pattern, padding: old.padding }, 5, d, 'DRMS')
    const after = formatDocNo(seq('transfer'), 6, d, 'DRMS')
    expect(before).toBe('TRF/2610/0005')
    expect(after).toBe('TRF/DRMS/2610/0006')
    // the new shape can never equal an issued old-shape number of the same doc type (any seq / PT code)
    for (const t of Object.keys(LEGACY_DEFAULT_PATTERNS)) {
      const o = LEGACY_DEFAULT_PATTERNS[t]!
      for (const n of [1, 229, 9999]) expect(formatDocNo(seq(t), n, d, 'DRMS')).not.toBe(formatDocNo({ pattern: o.pattern, padding: o.padding }, n, d, 'DRMS'))
    }
  })

  it('refuses to issue without a PT short code (clear message for the Admin)', () => {
    expect(companyCodeError('TRF/{COMPANY}/{YY}{MM}/{seq}', '')).toMatch(/Kode singkat PT belum diisi/)
    expect(companyCodeError('TRF/{COMPANY}/{YY}{MM}/{seq}', '  ')).toMatch(/Kode singkat/)
    expect(companyCodeError('TRF/{COMPANY}/{YY}{MM}/{seq}', null)).toMatch(/Kode singkat/)
    expect(companyCodeError('TRF/{COMPANY}/{YY}{MM}/{seq}', 'LLAS')).toBeNull()
    expect(companyCodeError('TRF/{YY}{MM}/{seq}', '')).toBeNull() // a custom pattern without {COMPANY}
  })

  it('the data migration moves exactly the old defaults to the new defaults (frozen copy matches the code)', () => {
    // ADR 0022: `project_loan` (PJ) is born in the D5 shape (seeded by 20261013_100100) — no legacy pattern to move;
    // ADR 0029: `intercompany_loan` (PJA) likewise (seeded by 20261015_100300)
    expect(NUMBERING_MOVES.map((m) => m.docType).sort()).toEqual(DEFAULT_SEQUENCES.filter((s) => s.docType !== 'project_loan' && s.docType !== 'intercompany_loan').map((s) => s.docType).sort())
    for (const m of NUMBERING_MOVES) {
      expect({ pattern: m.oldPattern, padding: m.oldPadding }).toEqual(LEGACY_DEFAULT_PATTERNS[m.docType])
      expect({ pattern: m.newPattern, padding: m.newPadding }).toEqual({ pattern: seq(m.docType).pattern, padding: seq(m.docType).padding })
    }
  })
})

describe('item 11: transfer date-time + SLA math', () => {
  it('reads a datetime-local value as wall clock in the PT zone, ISO with offset as is', () => {
    expect(parseZonedDateTime('2026-10-11T09:30', 'Asia/Makassar')!.toISOString()).toBe('2026-10-11T01:30:00.000Z')
    expect(parseZonedDateTime('2026-10-11T09:30', 'Asia/Jakarta')!.toISOString()).toBe('2026-10-11T02:30:00.000Z')
    expect(parseZonedDateTime('2026-10-11T09:30:15+07:00', 'Asia/Makassar')!.toISOString()).toBe('2026-10-11T02:30:15.000Z')
    expect(parseZonedDateTime('2026-10-11T01:30:00Z', 'Asia/Makassar')!.toISOString()).toBe('2026-10-11T01:30:00.000Z')
    expect(parseZonedDateTime('2026-02-30T09:30', 'Asia/Makassar')).toBeNull()
    expect(parseZonedDateTime('2026-10-11 09:30', 'Asia/Makassar')).toBeNull()
    expect(parseZonedDateTime('2026-10-11T24:00', 'Asia/Makassar')).toBeNull()
  })

  it('derives the business date of the transfer in the PT zone (00:30 WITA belongs to that day, not to UTC yesterday)', () => {
    const at = parseZonedDateTime('2026-10-01T00:30', 'Asia/Makassar')!
    expect(at.toISOString()).toBe('2026-09-30T16:30:00.000Z')
    expect(isoDateInTz(at, 'Asia/Makassar')).toBe('2026-10-01')
    expect(monthInTz(at, 'Asia/Makassar')).toBe('2026-10')
    expect(monthInTz(at, 'UTC')).toBe('2026-09')
  })

  it('measures approval → transfer against the PT SLA; unknown time falls back to the recording time', () => {
    const approvedAt = new Date('2026-10-01T01:00:00Z')
    const ok = measure({ approvedAt, transferAt: new Date('2026-10-02T01:00:00Z'), recordedAt: new Date('2026-10-05T00:00:00Z'), slaHours: 24 })
    expect(ok).toMatchObject({ hours: 24, late: false, timeKnown: true })
    const late = measure({ approvedAt, transferAt: new Date('2026-10-02T01:00:01Z'), recordedAt: new Date('2026-10-02T02:00:00Z'), slaHours: 24 })
    expect(late.late).toBe(true)
    const unknown = measure({ approvedAt, transferAt: null, recordedAt: new Date('2026-10-01T13:00:00Z'), slaHours: 24 })
    expect(unknown).toMatchObject({ hours: 12, late: false, timeKnown: false })
    expect(hoursBetween(approvedAt, new Date('2026-10-01T02:30:00Z'))).toBe(1.5)
  })

  it('summarises count / average / P90 (nearest rank) / % within SLA', () => {
    const at = new Date('2026-10-01T00:00:00Z')
    const ms = [1, 2, 3, 4, 5, 6, 7, 8, 9, 30].map((h) => measure({ approvedAt: at, transferAt: new Date(at.getTime() + h * 3_600_000), recordedAt: at, slaHours: 24 }))
    const s = summarize(ms)
    expect(s).toMatchObject({ count: 10, late: 1, withinSla: 9, pctWithin: 90 })
    expect(s.avgHours).toBeCloseTo(7.5)
    expect(s.p90Hours).toBe(9)
    expect(percentile([5], 90)).toBe(5)
    expect(percentile([], 90)).toBeNull()
    expect(summarize([])).toMatchObject({ count: 0, avgHours: null, p90Hours: null, pctWithin: null })
  })

  it('queue badge age + text', () => {
    const now = new Date('2026-10-03T00:00:00Z')
    expect(queueAge(null, now, 24)).toBeNull()
    expect(queueAge(new Date('2026-10-02T12:00:00Z'), now, 24)).toEqual({ hours: 12, over: false })
    expect(queueAge(new Date('2026-10-01T12:00:00Z'), now, 24)).toEqual({ hours: 36, over: true })
    expect(formatHours(0.4)).toBe('< 1 jam')
    expect(formatHours(5.9)).toBe('5 jam')
    expect(formatHours(36)).toBe('1 hr 12 jam')
    expect(formatHours(48)).toBe('2 hr')
    expect(formatHours(null)).toBe('—')
  })
})

describe('D7 selfie stamp (server-side band)', () => {
  const info: StampInfo = {
    time: new Date('2026-10-11T00:15:32Z'),
    timeZone: 'Asia/Makassar',
    timeTrust: 'server',
    kind: 'check_in',
    employee: 'Budi Santoso',
    location: 'Project PRJ-01 Gedung Kantor Balikpapan',
    lat: -1.2654321,
    lng: 116.8312345,
    accuracyM: 12.4,
  }

  it('bitmap font covers printable ASCII; text is transliterated', () => {
    expect(glyph('A')).toEqual([0x7e, 0x11, 0x11, 0x11, 0x7e])
    expect(glyph('~')).toHaveLength(5)
    expect(glyph('é')).toEqual(glyph('?'))
    expect(toAscii('José · Ñ — ±5')).toBe('Jose - N - +/-5')
  })

  it('band text: server time in the PT zone with its abbreviation, GPS 5 decimals + accuracy, location, employee, brand', () => {
    const { lines, right } = stampLines(info)
    expect(lines[0]).toBe('11/10/2026 08:15:32 WITA')
    expect(lines[1]).toBe('Masuk - Budi Santoso')
    expect(lines[2]).toBe('Project PRJ-01 Gedung Kantor Balikpapan')
    expect(lines[3]).toBe('-1.26543, 116.83123 - akurasi 12 m')
    expect(right).toBe(BRAND)
    expect(stampLines({ ...info, kind: 'check_out', onBehalfBy: 'PM Uji', timeTrust: 'estimated', accuracyM: null }).lines).toEqual([
      '11/10/2026 08:15:32 WITA (perkiraan server)',
      'Pulang - Budi Santoso (diabsenkan PM PM Uji)',
      'Project PRJ-01 Gedung Kantor Balikpapan',
      '-1.26543, 116.83123',
    ])
    expect(tzLabel('Asia/Jakarta', info.time)).toBe('WIB')
    expect(tzLabel('Asia/Jayapura', info.time)).toBe('WIT')
    expect(tzLabel('Asia/Tokyo', info.time)).toBe('UTC+09:00')
    expect(localStamp(info.time, 'Asia/Jakarta')).toBe('11/10/2026 07:15:32')
  })

  it('long text is cut to the image width', () => {
    expect(fit('x'.repeat(200), 120, 2)).toHaveLength(10)
    expect(fit('x'.repeat(200), 120, 2).endsWith('..')).toBe(true)
    expect(fit('pendek', 600, 2)).toBe('pendek')
    expect(bandGeometry(720, 4)).toMatchObject({ scale: 2 })
    expect(bandGeometry(300, 4).scale).toBe(1)
  })

  it('renders an opaque-ish band with white text pixels', () => {
    const band = renderBand(720, info)
    expect(band.height).toBe(bandGeometry(720, 4).height)
    let white = 0
    for (let o = 0; o < band.data.length; o += 4) if (band.data[o] === 255 && band.data[o + 3] === 255) white++
    expect(white).toBeGreaterThan(500)
  })

  it('burns the band into a real JPEG: same size, JPEG ≤ 150 KB, bottom darkened, top untouched', async () => {
    const before = await sharp(FIXTURE).metadata()
    const out = await stampImage(FIXTURE, info)
    const after = await sharp(out.data).metadata()
    expect(after.format).toBe('jpeg')
    expect([after.width, after.height]).toEqual([before.width, before.height])
    expect(out.data.length).toBeLessThanOrEqual(SELFIE_MAX_BYTES)
    const bandH = bandGeometry(before.width!, 4).height
    // stats() reads the INPUT of a pipeline → extract into a new buffer first
    const mean = async (buf: Buffer, top: number, height: number) => (await sharp(await sharp(buf).extract({ left: 0, top, width: before.width!, height }).toBuffer()).stats()).channels.map((c) => c.mean)
    const bottomBefore = await mean(FIXTURE, before.height! - bandH, bandH)
    const bottomAfter = await mean(out.data, before.height! - bandH, bandH)
    expect(bottomAfter[2]!).toBeLessThan(bottomBefore[2]! * 0.75) // band darkens the blue-ish background
    const topBefore = await mean(FIXTURE, 0, 100)
    const topAfter = await mean(out.data, 0, 100)
    for (let c = 0; c < 3; c++) expect(Math.abs(topAfter[c]! - topBefore[c]!)).toBeLessThan(3)
  })

  it('quality steps down when the stamped file would exceed the cap', async () => {
    const out = await stampImage(FIXTURE, info, 9_000)
    expect(out.data.length).toBeLessThan((await stampImage(FIXTURE, info)).data.length)
  })
})

describe('item 14: web check-in camera helpers', () => {
  it('maps getUserMedia failures to Indonesian messages pointing to the Android app', () => {
    expect(cameraErrorMessage({ name: 'NotAllowedError' })).toBe(CAMERA_DENIED)
    expect(cameraErrorMessage({ name: 'NotReadableError' })).toBe(CAMERA_BUSY)
    expect(cameraErrorMessage({ name: 'NotFoundError' })).toBe(NO_CAMERA)
    expect(cameraErrorMessage(new Error('x'))).toBe(NO_CAMERA)
    expect(NO_CAMERA).toBe('Kamera tidak tersedia — gunakan aplikasi Android.')
  })

  it('needs a secure context and mediaDevices.getUserMedia (no file-picker fallback)', () => {
    expect(cameraSupported({ mediaDevices: { getUserMedia: () => undefined } }, true)).toBe(true)
    expect(cameraSupported({ mediaDevices: { getUserMedia: () => undefined } }, false)).toBe(false)
    expect(cameraSupported({}, true)).toBe(false)
    expect(cameraSupported(undefined, true)).toBe(false)
  })

  it('scales the captured frame to ≤ 1280 px on the long side', () => {
    expect(captureSize(1920, 1080)).toEqual({ width: 1280, height: 720 })
    expect(captureSize(640, 480)).toEqual({ width: 640, height: 480 })
    expect(captureSize(0, 0)).toBeNull()
  })

  it('the self check-in form has no file input any more', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/admin/components/absensi/AttendanceActions.tsx', import.meta.url)), 'utf8')
    const form = src.slice(src.indexOf('export function SelfCheckForm'))
    expect(form).not.toMatch(/type="file"/)
    expect(form).toMatch(/<CameraCapture/)
  })
})
