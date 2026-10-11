import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { parseWorkbook } from '@/import/parse'
import { formatReport } from '@/import/report'
import { defaultPtOf, emptyDbKeys, ptSet, resolveReferences, type DbKeys } from '@/import/resolve'
import type { ImportReport } from '@/import/run'
import { SAMPLE, SAMPLE_CS1, sampleTwoPts } from '@/import/sample'
import { SHEET_BY_KEY, SHEETS } from '@/import/spec'
import { buildSample, buildSampleTwoPts, buildWorkbook } from '@/import/template'
import { readXlsx } from '@/import/xlsx-io'

/**
 * MC2-5 go-live import per PT (ADR 0016 §11): sheet Perusahaan, `kode_pt` on every per-PT sheet,
 * sheet AksesPT (roles per PT), validation of unknown PTs and cross-PT references. Fictional data.
 */
const docs = (f: string) => fileURLToPath(new URL(`../../../../docs/proyekkas/templates/${f}`, import.meta.url))
const two = () => parseWorkbook(readXlsx(buildSampleTwoPts()))
const errs = (issues: Array<{ level: string; sheet: string; row?: number; column?: string; message: string }>) => issues.filter((i) => i.level === 'error')
const PER_PT_SHEETS = ['kategori', 'karyawan', 'pengguna', 'rekening', 'pusatBiaya', 'project', 'tahapan', 'rab', 'kendaraan', 'penugasan', 'akunKas'] as const

function db(pts: Array<[string, boolean]> = [['DRMS', true]]): DbKeys {
  const d = emptyDbKeys()
  pts.forEach(([code, active], i) => d.companies.set(code, { id: i + 1, active }))
  return d
}

describe('spec + template (MC2-5)', () => {
  it('Perusahaan and AksesPT sheets; kode_pt first on every per-PT sheet, part of the natural key', () => {
    expect(SHEETS.map((s) => s.key).slice(0, 2)).toEqual(['pengaturan', 'perusahaan'])
    expect(SHEET_BY_KEY.aksesPt.naturalKey).toEqual(['username', 'kode_pt'])
    for (const k of PER_PT_SHEETS) {
      expect(SHEET_BY_KEY[k].columns[0]!.key, k).toBe('kode_pt')
      if (k !== 'pengguna' && k !== 'rekening' && k !== 'kendaraan') expect(SHEET_BY_KEY[k].naturalKey[0], k).toBe('kode_pt')
    }
    // shared masters stay without a PT
    for (const k of ['bank', 'satuan'] as const) expect(SHEET_BY_KEY[k].columns.some((c) => c.key === 'kode_pt')).toBe(false)
  })

  it('committed two-PT sample is up to date and parses without errors', () => {
    expect(Buffer.from(buildSampleTwoPts()).equals(readFileSync(docs('drms-impor-golive-contoh-fiktif-2pt.xlsx')))).toBe(true)
    const r = two()
    expect(errs(r.issues)).toEqual([])
    expect(r.data.companies.map((c) => [c.code, c.pbStartAt])).toEqual([['DRMS', null], ['CS1', 1]])
    expect(r.data.access).toEqual([
      expect.objectContaining({ username: 'candra.contoh', pt: 'CS1', roles: ['pk-pm'], employeeCode: 'CTH-003' }),
      expect.objectContaining({ username: 'bunga.fiktif', pt: 'CS1', roles: ['pk-finance', 'pk-owner'] }),
    ])
    // the same employee code in two PTs is two records, not a duplicate
    expect(r.data.employees.filter((e) => e.code === 'CTH-003').map((e) => e.pt)).toEqual(['DRMS', 'CS1'])
  })

  it('kode_pt is upper-cased and validated like companies.shortCode', () => {
    const r = parseWorkbook(readXlsx(buildSample({ rows: { karyawan: [{ kode_pt: 'cs1', kode: 'K-1', nama: 'A' }, { kode_pt: 'C S1', kode: 'K-2', nama: 'B' }] } })))
    expect(r.data.employees.map((e) => e.pt)).toEqual(['CS1'])
    expect(errs(r.issues).map((i) => `${i.sheet}:${i.row}:${i.column}`)).toContain('Karyawan:3:kode_pt')
  })

  it('duplicates are checked inside a PT (same code in two PTs is fine, twice in one PT is not)', () => {
    const r = parseWorkbook(
      readXlsx(
        buildSample({
          rows: {
            project: [
              { kode_pt: 'DRMS', kode: 'P-1', nama: 'A', pm: 'candra.contoh' },
              { kode_pt: 'CS1', kode: 'P-1', nama: 'B', pm: 'candra.contoh' },
              { kode_pt: 'CS1', kode: 'P-1', nama: 'C', pm: 'candra.contoh' },
            ],
          },
        }),
      ),
    )
    expect(errs(r.issues).map((i) => `${i.sheet}:${i.row}`)).toEqual(['Project:4'])
  })
})

describe('resolve per PT (MC2-5)', () => {
  it('two-PT sample against a DB with DRMS only: CS1 is created (warning), no errors', () => {
    const r = two()
    const res = resolveReferences(r.data, db(), new Map())
    expect(errs(res.issues)).toEqual([])
    expect(res.issues.some((i) => i.level === 'warning' && i.sheet === 'Perusahaan' && /PT baru "CS1"/.test(i.message))).toBe(true)
    expect(res.pts).toEqual(['CS1', 'DRMS'])
    expect(res.defaultPt).toBeNull() // two PTs in the file → every row must name its PT
  })

  it('default PT: the only PT of the sheet, else the only active PT of the DB, else none', () => {
    expect(defaultPtOf({ companies: [] }, db())).toBe('DRMS')
    expect(defaultPtOf({ companies: [] }, db([['DRMS', true], ['CS1', false]]))).toBe('DRMS')
    expect(defaultPtOf({ companies: [] }, db([['DRMS', true], ['CS1', true]]))).toBeNull()
    expect(defaultPtOf({ companies: [{ _row: 2, code: 'CS1', name: 'x', legalName: null, address: null, phone: null, pbStartAt: null }] }, db())).toBe('CS1')
  })

  it('unknown PT, inactive PT and a missing kode_pt with several PTs are errors', () => {
    const rows = {
      perusahaan: [],
      karyawan: [
        { kode_pt: 'ZZZ', kode: 'K-1', nama: 'A' },
        { kode_pt: 'CS2', kode: 'K-2', nama: 'B' },
        { kode_pt: null, kode: 'K-3', nama: 'C' },
      ],
    }
    const r = parseWorkbook(readXlsx(buildSample({ rows })))
    const res = resolveReferences(r.data, db([['DRMS', true], ['CS1', true], ['CS2', false]]), new Map())
    const e = errs(res.issues)
    expect(e.find((i) => i.row === 2)!.message).toMatch(/PT "ZZZ" tidak dikenal/)
    expect(e.find((i) => i.row === 3)!.message).toMatch(/PT "CS2" nonaktif/)
    expect(e.find((i) => i.row === 4)!.message).toMatch(/kode_pt wajib diisi/)
  })

  it('cross-PT references are rejected and name the PT where the code exists', () => {
    const rows = sampleTwoPts()
    rows.rekening = [...(rows.rekening ?? []), { kode_pt: 'CS1', kode_karyawan: 'CTH-004', kode_bank: 'BCA', no_rekening: '9990007777', atas_nama: 'Dewi Fiktif', rekening_default: 'Ya', aktif: 'Ya' }]
    rows.tahapan = [...(rows.tahapan ?? []), { kode_pt: 'CS1', kode_project: 'CTH-PRJ-01', urutan: 1, nama: 'Salah PT', bobot_persen: 100 }]
    const r = parseWorkbook(readXlsx(buildWorkbook({ settings: SAMPLE.settings, rows })))
    const res = resolveReferences(r.data, db(), new Map())
    const e = errs(res.issues)
    expect(e.map((i) => `${i.sheet}:${i.column}`)).toEqual(expect.arrayContaining(['Rekening:kode_karyawan', 'Tahapan:kode_project']))
    expect(e.find((i) => i.sheet === 'Rekening')!.message).toBe('Karyawan "CTH-004" tidak ada di PT CS1 (ada di PT DRMS) — referensi lintas PT tidak diperbolehkan.')
  })

  it('DB keys count per PT: an employee of DRMS in the DB does not satisfy a CS1 row', () => {
    const r = parseWorkbook(readXlsx(buildSample({ rows: { perusahaan: SAMPLE_CS1.perusahaan, rekening: [{ kode_pt: 'CS1', kode_karyawan: 'DB-EMP', kode_bank: 'BCA', no_rekening: '12345', atas_nama: 'X' }] } })))
    const d = db()
    ptSet(d.employees, 'DRMS').add('DB-EMP')
    expect(errs(resolveReferences(r.data, d, new Map()).issues).map((i) => i.message)).toEqual(['Karyawan "DB-EMP" tidak ada di PT CS1 (ada di PT DRMS) — referensi lintas PT tidak diperbolehkan.'])
    ptSet(d.employees, 'CS1').add('DB-EMP')
    expect(errs(resolveReferences(r.data, d, new Map()).issues)).toEqual([])
  })

  it('PM / manager must hold an active membership in the row PT (Pengguna row PT or AksesPT)', () => {
    const rows = sampleTwoPts()
    rows.aksesPt = (rows.aksesPt ?? []).filter((a) => a.username !== 'candra.contoh') // candra: no access in CS1 any more
    rows.karyawan = (rows.karyawan ?? []).filter((k) => !(k.kode_pt === 'CS1' && k.kode === 'CTH-003'))
    const r = parseWorkbook(readXlsx(buildWorkbook({ settings: SAMPLE.settings, rows })))
    const e = errs(resolveReferences(r.data, db(), new Map()).issues)
    expect(e).toEqual([expect.objectContaining({ sheet: 'Project', column: 'pm', message: '"candra.contoh" tidak punya akses aktif di PT CS1 (isi peran di sheet Pengguna/AksesPT untuk PT ini).' })])
  })

  it('AksesPT: unknown username, duplicate of the Pengguna row PT, employee already linked in that PT', () => {
    const rows = sampleTwoPts()
    rows.aksesPt = [
      ...(rows.aksesPt ?? []),
      { username: 'siapa', kode_pt: 'CS1', peran: 'Staff', kode_karyawan: null, aktif: 'Ya' },
      { username: 'andi.contoh', kode_pt: 'DRMS', peran: 'Admin', kode_karyawan: null, aktif: 'Ya' },
      { username: 'fitri.fiktif', kode_pt: 'CS1', peran: 'Staff', kode_karyawan: 'CTH-003', aktif: 'Ya' },
    ]
    const r = parseWorkbook(readXlsx(buildWorkbook({ settings: SAMPLE.settings, rows })))
    const e = errs(resolveReferences(r.data, db(), new Map()).issues).filter((i) => i.sheet === 'AksesPT')
    expect(e.map((i) => i.message)).toEqual([
      'Username "siapa" tidak ada di sheet Pengguna.',
      'Akses "andi.contoh" di PT DRMS sudah ada (sheet Pengguna baris 2).',
      'Karyawan CTH-003 (PT CS1) sudah terhubung ke akun candra.contoh.',
    ])
  })

  it('single-PT files keep working without kode_pt (only PT in the DB)', () => {
    const strip = (rows: Array<Record<string, string | number | null>> | undefined) => rows?.map(({ kode_pt: _pt, ...rest }) => rest)
    const rows = Object.fromEntries(Object.entries(SAMPLE.rows).map(([k, v]) => [k, k === 'perusahaan' ? [] : strip(v)]))
    const r = parseWorkbook(readXlsx(buildWorkbook({ settings: SAMPLE.settings, rows })))
    expect(errs(r.issues)).toEqual([])
    const res = resolveReferences(r.data, db(), new Map())
    expect(errs(res.issues)).toEqual([])
    expect(res.defaultPt).toBe('DRMS')
    expect(res.pts).toEqual(['DRMS'])
  })
})

describe('report (MC2-5)', () => {
  it('one cut-over line per PT', () => {
    const base = { goLiveDate: '2026-11-01', pbCounterBefore: null, pbCounterAfter: null, closedPeriod: '2026-10', closeNote: 'periode 2026-10 ditutup' }
    const r = {
      mode: 'dry-run',
      runId: 'x',
      file: 'f.xlsx',
      sha256: '0'.repeat(64),
      startedAt: '',
      finishedAt: '',
      ok: true,
      committed: false,
      issues: [],
      masters: [],
      cutover: null,
      cutovers: [
        { ...base, pt: 'DRMS', pbStartAt: 229, firstPbNumber: '229/PB-DRMS/01/XI/2026' },
        { ...base, pt: 'CS1', pbStartAt: 1, firstPbNumber: '1/PB-CS1/01/XI/2026' },
      ],
      keycloakUsers: [],
      keycloakFollowUp: [],
    } as ImportReport
    const text = formatReport(r)
    expect(text).toContain('Cut-over PT DRMS: go-live 2026-11-01 · PB mulai 229')
    expect(text).toContain('Cut-over PT CS1: go-live 2026-11-01 · PB mulai 1 (counter belum ada → belum ada) · PB pertama: 1/PB-CS1/01/XI/2026')
  })
})
