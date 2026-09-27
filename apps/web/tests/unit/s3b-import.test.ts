import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { parseWorkbook, parseMoney, parseDate, hasErrors } from '@/import/parse'
import { keycloakCsv } from '@/import/report'
import { effectiveEmail, emptyDbKeys, parseKcMap, PLACEHOLDER_EMAIL_DOMAIN, resolveReferences } from '@/import/resolve'
import { previousPeriod } from '@/import/run'
import { SAMPLE } from '@/import/sample'
import { SHEETS } from '@/import/spec'
import { buildSample, buildTemplate } from '@/import/template'
import { excelSerialToDate, readXlsx, writeXlsx, XlsxError } from '@/import/xlsx-io'

const docs = (f: string) => fileURLToPath(new URL(`../../../../docs/proyekkas/templates/${f}`, import.meta.url))

function parseSample(over: Parameters<typeof buildSample>[0] = {}) {
  return parseWorkbook(readXlsx(buildSample(over)))
}
const errorsOf = (r: ReturnType<typeof parseSample>) => r.issues.filter((i) => i.level === 'error')

describe('xlsx-io (E11 import)', () => {
  it('round-trips strings (escaping, unicode, control chars), numbers and holes', () => {
    const bytes = writeXlsx([{ name: 'A', rows: [['a&b <c> "d"', 'Rp ✓ ñ', 12.5], [null, 'x\u0001y', 0], [], ['last']] }])
    const wb = readXlsx(bytes)
    expect(wb.sheets[0]!.name).toBe('A')
    expect(wb.sheets[0]!.rows).toEqual([['a&b <c> "d"', 'Rp ✓ ñ', 12.5], [null, 'x\u0001y', 0], [], ['last']])
  })

  it('is deterministic (committed template reproducible)', () => {
    expect(Buffer.from(buildTemplate()).equals(Buffer.from(buildTemplate()))).toBe(true)
  })

  it('rejects non-xlsx input with a readable message', () => {
    expect(() => readXlsx(new TextEncoder().encode('hello'))).toThrow(XlsxError)
    expect(() => readXlsx(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]))).toThrow(XlsxError)
  })

  it('converts Excel serial dates (1900 and 1904 systems)', () => {
    expect(excelSerialToDate(45292)).toBe('2024-01-01')
    expect(excelSerialToDate(46327)).toBe('2026-11-01')
    expect(excelSerialToDate(0)).toBeNull()
    expect(excelSerialToDate(43830, true)).toBe('2024-01-01')
  })
})

describe('committed workbooks (docs/proyekkas/templates) are up to date', () => {
  it('template + fictional sample equal the generator output (npm run gen:import-template)', () => {
    expect(Buffer.from(buildTemplate()).equals(readFileSync(docs('drms-impor-golive-template.xlsx')))).toBe(true)
    expect(Buffer.from(buildSample()).equals(readFileSync(docs('drms-impor-golive-contoh-fiktif.xlsx')))).toBe(true)
  })

  it('template has Petunjuk + every master sheet with the spec headers; required columns marked *', () => {
    const wb = readXlsx(buildTemplate())
    expect(wb.sheets.map((s) => s.name)).toEqual(['Petunjuk', ...SHEETS.map((s) => s.name)])
    for (const spec of SHEETS) {
      const header = wb.sheets.find((s) => s.name === spec.name)!.rows[0]
      expect(header).toEqual(spec.columns.map((c) => (c.required ? `${c.key} *` : c.key)))
    }
  })

  it('blank template parses without errors except the missing go-live date', () => {
    const r = parseWorkbook(readXlsx(buildTemplate()))
    expect(errorsOf(r).map((e) => e.message)).toEqual(['tanggal_golive wajib diisi dengan tanggal valid (YYYY-MM-DD).'])
    expect(r.data.banks.length).toBeGreaterThan(0)
    expect(r.data.categories.find((c) => c.code === 'BBM')).toMatchObject({ defaultUom: 'L', requiresVehicle: true })
  })
})

describe('parse (E11 import)', () => {
  it('fictional sample: 0 errors, every row typed', () => {
    const r = parseSample()
    expect(errorsOf(r)).toEqual([])
    expect(r.data.settings).toEqual({ goLiveDate: '2026-11-01', pbStartAt: 229, closePrevPeriod: true })
    expect(r.data.employees).toHaveLength(SAMPLE.rows.karyawan!.length)
    expect(r.data.users.find((u) => u.username === 'candra.contoh')!.roles).toEqual(['pk-pm', 'pk-staff'])
    expect(r.data.users.find((u) => u.username === 'dewi.fiktif')!.email).toBeNull()
    expect(r.data.vehicles.map((v) => v.plateNo)).toEqual(['DA9001ZZ', 'KH9002ZZ'])
    expect(r.data.bankAccounts.find((a) => a.employeeCode === 'CTH-004' && a.bankCode === 'MANDIRI')!.accountNo).toBe('0990000000401')
    expect(r.data.cashAccounts.map((a) => [a.name, a.kind, a.openingBalance])).toEqual([
      ['Kas Kecil Contoh (FIKTIF)', 'cash', 5000000],
      ['Bank Operasional Contoh (FIKTIF)', 'bank', 125750000],
    ])
    expect(r.data.present).toContain('akunKas')
  })

  it('reports errors per sheet / Excel row / column', () => {
    const r = parseSample({
      rows: {
        karyawan: [
          { kode: 'OK-1', nama: 'Satu' },
          { kode: 'bad code', nama: 'Dua' },
          { kode: 'OK-1', nama: 'Duplikat' },
          { kode: 'OK-3', nama: null },
        ],
        akunKas: [{ nama: 'Kas', jenis: 'Tunai', saldo_awal: '1,5' }],
        tahapan: [
          { kode_project: 'CTH-PRJ-01', urutan: 1, nama: 'A', bobot_persen: 60 },
          { kode_project: 'CTH-PRJ-01', urutan: 2, nama: 'B', bobot_persen: 30 },
        ],
        kendaraan: [{ no_polisi: '12345', jenis: 'Hilux' }],
        pusatBiaya: [{ kode: 'CC-1', nama: 'Satu', latitude: -2.2 }],
        rekening: [
          { kode_karyawan: 'OK-1', kode_bank: 'BCA', no_rekening: '12345678', atas_nama: 'X', rekening_default: 'Ya' },
          { kode_karyawan: 'OK-1', kode_bank: 'BRI', no_rekening: '12-34', atas_nama: 'X', rekening_default: 'Ya' },
        ],
        pengguna: [{ username: 'x', nama: 'X', peran: 'Bos' }],
        project: [{ kode: 'P-1', nama: 'P', tanggal_mulai: '31/02/2026' }],
      },
    })
    const e = errorsOf(r).map((i) => `${i.sheet}:${i.row ?? ''}:${i.column ?? ''}`)
    expect(e).toEqual(
      expect.arrayContaining([
        'Karyawan:3:kode', // invalid code
        'Karyawan:4:', // duplicate
        'Karyawan:5:nama', // required
        'AkunKas:2:jenis',
        'AkunKas:2:saldo_awal',
        'Tahapan:2:bobot_persen', // Σ = 90
        'Kendaraan:2:no_polisi',
        'PusatBiaya:2:latitude', // geofence all-or-nothing
        'Rekening:3:no_rekening',
        'Pengguna:2:username',
        'Pengguna:2:peran',
        'Project:2:tanggal_mulai',
      ]),
    )
    expect(hasErrors(r.issues)).toBe(true)
  })

  it('header validation: missing required column, unknown and duplicate columns', () => {
    const bytes = writeXlsx([
      { name: 'Pengaturan', rows: [['pengaturan', 'nilai'], ['tanggal_golive', '2026-11-01']] },
      { name: 'Karyawan', rows: [['kode', 'nama_lengkap', 'kode'], ['K1', 'X', 'K1']] },
      { name: 'Lainnya', rows: [['a']] },
    ])
    const r = parseWorkbook(readXlsx(bytes))
    const msgs = r.issues.map((i) => `${i.level}:${i.sheet}:${i.row ?? ''}:${i.message}`)
    for (const re of [/^error:Karyawan:1:Kolom "kode" muncul dua kali/, /^error:Karyawan:1:Kolom "nama_lengkap" tidak dikenal/, /^error:Karyawan:1:Kolom wajib "nama" tidak ada/, /^warning:Lainnya::Sheet "Lainnya" tidak dikenal/]) {
      expect(msgs.some((m) => re.test(m))).toBe(true)
    }
    expect(r.data.employees).toEqual([])
  })

  it('missing Pengaturan sheet is an error; absent master sheets are simply not touched', () => {
    const r = parseWorkbook(readXlsx(writeXlsx([{ name: 'Karyawan', rows: [['kode', 'nama'], ['K1', 'X']] }])))
    expect(errorsOf(r)[0]!.message).toMatch(/Pengaturan/)
    expect(r.data.present).toEqual(['karyawan'])
  })

  it('cell conversions: money, dates, numbers typed as numbers', () => {
    expect(parseMoney('Rp 1.500.000')).toBe(1500000)
    expect(parseMoney('1.500.000,00')).toBe(1500000)
    expect(parseMoney(2500000)).toBe(2500000)
    expect(parseMoney('1,5')).toBeNull()
    expect(parseMoney(10.5)).toBeNull()
    expect(parseDate('01/11/2026')).toBe('2026-11-01')
    expect(parseDate('2026-2-3')).toBe('2026-02-03')
    expect(parseDate('2026-02-30')).toBeNull()
    expect(parseDate(46327)).toBe('2026-11-01')
    const r = parseSample({ rows: { karyawan: [{ kode: 'K-9', nama: 'Nomor', no_hp: 81234567 }], rekening: [{ kode_karyawan: 'K-9', kode_bank: 'BCA', no_rekening: 1234567, atas_nama: 'N' }] } })
    expect(r.data.employees[0]!.phone).toBe('081234567')
    expect(r.issues.filter((i) => i.level === 'warning' && (i.column === 'no_hp' || i.column === 'no_rekening'))).toHaveLength(2)
  })

  it('settings: PB start configurable, invalid values rejected, go-live not on the 1st warns', () => {
    expect(parseSample({ settings: { nomor_pb_mulai: 500 } }).data.settings!.pbStartAt).toBe(500)
    expect(errorsOf(parseSample({ settings: { nomor_pb_mulai: 'dua' } }))[0]!.message).toMatch(/nomor_pb_mulai/)
    const mid = parseSample({ settings: { tanggal_golive: '2026-11-15', tutup_periode_sebelum_golive: 'Tidak' } })
    expect(mid.data.settings).toMatchObject({ goLiveDate: '2026-11-15', closePrevPeriod: false })
    expect(mid.issues.some((i) => i.level === 'warning' && /bukan tanggal 1/.test(i.message))).toBe(true)
  })

  it('previous period of the go-live date', () => {
    expect(previousPeriod('2026-11-01')).toBe('2026-10')
    expect(previousPeriod('2027-01-15')).toBe('2026-12')
  })
})

describe('resolve (E11 import): references and Keycloak link plan', () => {
  it('unknown references are errors; workbook rows and DB keys both count', () => {
    const r = parseSample({ rows: { rab: [{ kode_project: 'CTH-PRJ-01', kode_kategori: 'NOPE', nominal: 1 }], rekening: [{ kode_karyawan: 'DB-EMP', kode_bank: 'BCA', no_rekening: '12345', atas_nama: 'X' }] } })
    const db = emptyDbKeys()
    db.employees.add('DB-EMP')
    const res = resolveReferences(r.data, db, new Map())
    expect(res.issues.filter((i) => i.level === 'error').map((i) => `${i.sheet}:${i.row}:${i.column}`)).toEqual(['RAB:2:kode_kategori'])
  })

  it('users without a Keycloak mapping are pending (warning) and dependent PM fields are left empty', () => {
    const r = parseSample()
    const res = resolveReferences(r.data, emptyDbKeys(), new Map())
    expect([...res.users.values()].every((u) => u.action === 'pending')).toBe(true)
    expect(res.issues.filter((i) => i.level === 'error')).toEqual([])
    expect(res.issues.some((i) => i.sheet === 'Project' && i.column === 'pm' && i.level === 'warning')).toBe(true)
    const mapped = resolveReferences(r.data, emptyDbKeys(), new Map([['candra.contoh', '11111111-1111-4111-8111-111111111111']]))
    expect(mapped.users.get('candra.contoh')).toMatchObject({ action: 'create', sub: '11111111-1111-4111-8111-111111111111' })
    expect(mapped.users.get('dewi.fiktif')).toMatchObject({ action: 'pending', email: `dewi.fiktif@${PLACEHOLDER_EMAIL_DOMAIN}` })
  })

  it('existing users are matched by Keycloak id or email; a conflicting id is an error', () => {
    const r = parseSample()
    const db = emptyDbKeys()
    db.usersByEmail.set('andi@drms-contoh.test', { id: 7, sub: '22222222-2222-4222-8222-222222222222', employee: null })
    db.usersBySub.set('22222222-2222-4222-8222-222222222222', { id: 7, email: 'andi@drms-contoh.test' })
    expect(resolveReferences(r.data, db, new Map()).users.get('andi.contoh')).toMatchObject({ action: 'update', id: 7 })
    const bad = resolveReferences(r.data, db, new Map([['andi.contoh', '33333333-3333-4333-8333-333333333333']]))
    expect(bad.issues.some((i) => i.level === 'error' && /Keycloak lain/.test(i.message))).toBe(true)
  })

  it('PM reference without the PM role warns; unknown username errors', () => {
    const r = parseSample({ rows: { project: [{ kode: 'P-1', nama: 'P', pm: 'dewi.fiktif' }, { kode: 'P-2', nama: 'Q', pm: 'siapa' }] } })
    const res = resolveReferences(r.data, emptyDbKeys(), new Map([['dewi.fiktif', '44444444-4444-4444-8444-444444444444']]))
    expect(res.issues.some((i) => i.level === 'warning' && i.row === 2 && /tidak berperan PM/.test(i.message))).toBe(true)
    expect(res.issues.some((i) => i.level === 'error' && i.row === 3 && /tidak ada di sheet Pengguna/.test(i.message))).toBe(true)
  })

  it('placeholder email for users without email (Q-37)', () => {
    expect(effectiveEmail({ username: 'dewi', email: null })).toBe(`dewi@${PLACEHOLDER_EMAIL_DOMAIN}`)
    expect(effectiveEmail({ username: 'dewi', email: 'd@x.id' })).toBe('d@x.id')
  })
})

describe('Keycloak files (no passwords)', () => {
  it('kc map: kcadm CSV (with/without header, either column order) and JSON', () => {
    const id = '55555555-5555-4555-8555-555555555555'
    expect(parseKcMap(`username,id\nAndi.Contoh,${id}\n`).map.get('andi.contoh')).toBe(id)
    expect(parseKcMap(`"${id}","andi.contoh"`).map.get('andi.contoh')).toBe(id)
    expect(parseKcMap(JSON.stringify([{ username: 'a1', id }])).map.get('a1')).toBe(id)
    expect(parseKcMap(JSON.stringify({ a2: id })).map.get('a2')).toBe(id)
    expect(parseKcMap('andi,not-a-uuid').errors).toHaveLength(1)
  })

  it('CSV export quotes and neutralises formula-like cells', () => {
    const csv = keycloakCsv([{ username: 'a', email: '', firstName: '=HYPERLINK("x")', enabled: true, realmRoles: ['pk-pm', 'pk-staff'], employeeCode: 'K,1' }])
    expect(csv).toBe(`username,email,firstName,enabled,realmRoles,roleLabels,employeeCode\na,,"'=HYPERLINK(""x"")",true,pk-pm pk-staff,PM Staff,"K,1"\n`)
    expect(csv).not.toMatch(/password/i)
  })
})
