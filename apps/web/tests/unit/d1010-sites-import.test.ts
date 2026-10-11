import { describe, expect, it } from 'vitest'

import { parseWorkbook } from '@/import/parse'
import { emptyDbKeys, ptSet, resolveReferences, type DbKeys } from '@/import/resolve'
import { SAMPLE } from '@/import/sample'
import { SHEET_BY_KEY, SHEETS } from '@/import/spec'
import { buildSample, buildWorkbook } from '@/import/template'
import { readXlsx } from '@/import/xlsx-io'

/**
 * ADR 0023 §7.3: the go-live import workbook gets a sheet Site (kantor cabang per PT) and an optional `kode_site`
 * on Karyawan (Site penempatan), Project, Penugasan (third location) and AkunKas. Fictional data.
 */
const errs = (issues: Array<{ level: string; sheet: string; row?: number; column?: string; message: string }>) => issues.filter((i) => i.level === 'error')
const where = (issues: Array<{ sheet: string; row?: number; column?: string }>) => issues.map((i) => `${i.sheet}:${i.row}:${i.column}`)

function db(pts: string[] = ['DRMS']): DbKeys {
  const d = emptyDbKeys()
  pts.forEach((code, i) => d.companies.set(code, { id: i + 1, active: true }))
  return d
}

describe('spec (ADR 0023)', () => {
  it('sheet Site after PusatBiaya and before Project, natural key per PT', () => {
    const keys = SHEETS.map((s) => s.key)
    expect(keys.indexOf('site')).toBe(keys.indexOf('pusatBiaya') + 1)
    expect(keys.indexOf('site')).toBeLessThan(keys.indexOf('project'))
    expect(SHEET_BY_KEY.site.name).toBe('Site')
    expect(SHEET_BY_KEY.site.naturalKey).toEqual(['kode_pt', 'kode'])
    expect(SHEET_BY_KEY.site.columns.map((c) => c.key)).toEqual(['kode_pt', 'kode', 'nama', 'alamat', 'latitude', 'longitude', 'radius_m', 'kode_pusat_biaya', 'aktif'])
  })

  it('optional kode_site (ref sheet Site) on Karyawan, Project, Penugasan and AkunKas; Penugasan keys on it', () => {
    for (const k of ['karyawan', 'project', 'penugasan', 'akunKas'] as const) {
      const c = SHEET_BY_KEY[k].columns.find((x) => x.key === 'kode_site')
      expect(c, k).toBeDefined()
      expect(c!.required, k).toBeFalsy()
      expect(c!.ref, k).toEqual({ sheet: 'site', col: 'kode' })
    }
    expect(SHEET_BY_KEY.penugasan.naturalKey).toContain('kode_site')
  })
})

describe('parse + resolve (ADR 0023)', () => {
  it('the fictional sample carries a site and its links, without errors', () => {
    const r = parseWorkbook(readXlsx(buildSample()))
    expect(errs(r.issues)).toEqual([])
    expect(r.data.sites).toEqual([expect.objectContaining({ pt: 'DRMS', code: 'CTH-CAB', costCenterCode: 'CTH-OPS', lat: -2.2105, radiusM: 120, active: true })])
    expect(r.data.employees.find((e) => e.code === 'CTH-006')?.siteCode).toBe('CTH-CAB')
    expect(r.data.employees.find((e) => e.code === 'CTH-001')?.siteCode).toBeNull()
    expect(r.data.projects.find((p) => p.code === 'CTH-PRJ-02')?.siteCode).toBe('CTH-CAB')
    expect(r.data.cashAccounts.find((a) => a.kind === 'cash')?.siteCode).toBe('CTH-CAB')
    expect(r.data.assignments.filter((a) => a.siteCode !== null)).toEqual([expect.objectContaining({ employeeCode: 'CTH-005', siteCode: 'CTH-CAB', projectCode: null, costCenterCode: null })])
    expect(errs(resolveReferences(r.data, db(), new Map()).issues)).toEqual([])
  })

  it('empty kode_site and an empty sheet Site stay valid (links optional)', () => {
    const strip = (rows: Array<Record<string, string | number | null>> | undefined) => (rows ?? []).map(({ kode_site: _, ...rest }) => rest)
    const rows = { ...SAMPLE.rows, site: [], karyawan: strip(SAMPLE.rows.karyawan), project: strip(SAMPLE.rows.project), akunKas: strip(SAMPLE.rows.akunKas), penugasan: strip(SAMPLE.rows.penugasan).filter((a) => a.kode_karyawan !== 'CTH-005' || a.kode_project) }
    const r = parseWorkbook(readXlsx(buildWorkbook({ settings: SAMPLE.settings, rows })))
    expect(errs(r.issues)).toEqual([])
    expect(r.data.sites).toEqual([])
    expect(r.data.employees.every((e) => e.siteCode === null)).toBe(true)
  })

  it('Penugasan: exactly one of kode_project / kode_pusat_biaya / kode_site', () => {
    const r = parseWorkbook(
      readXlsx(
        buildSample({
          rows: {
            penugasan: [
              { kode_pt: 'DRMS', kode_karyawan: 'CTH-004', kode_project: 'CTH-PRJ-01', kode_site: 'CTH-CAB' },
              { kode_pt: 'DRMS', kode_karyawan: 'CTH-004', kode_pusat_biaya: 'CTH-OPS', kode_site: 'CTH-CAB' },
              { kode_pt: 'DRMS', kode_karyawan: 'CTH-004' },
              { kode_pt: 'DRMS', kode_karyawan: 'CTH-005', kode_site: 'CTH-CAB' },
            ],
          },
        }),
      ),
    )
    expect(where(errs(r.issues))).toEqual(['Penugasan:2:kode_project', 'Penugasan:3:kode_project', 'Penugasan:4:kode_project'])
  })

  it('unknown site codes are errors; an existing DB site of the PT resolves; a site of another PT is a cross-PT reference', () => {
    const r = parseWorkbook(
      readXlsx(
        buildSample({
          rows: {
            site: [],
            karyawan: [
              { kode_pt: 'DRMS', kode: 'K-1', nama: 'A', kode_site: 'CAB-DB' },
              { kode_pt: 'DRMS', kode: 'K-2', nama: 'B', kode_site: 'CAB-CS1' },
              { kode_pt: 'DRMS', kode: 'K-3', nama: 'C', kode_site: 'CAB-X' },
            ],
            pengguna: [],
            rekening: [],
            penugasan: [],
            akunKas: [],
            project: [],
            tahapan: [],
            rab: [],
            kendaraan: [],
          },
        }),
      ),
    )
    expect(errs(r.issues)).toEqual([])
    const keys = db(['DRMS', 'CS1'])
    ptSet(keys.sites, 'DRMS').add('CAB-DB')
    ptSet(keys.sites, 'CS1').add('CAB-CS1')
    const issues = errs(resolveReferences(r.data, keys, new Map()).issues).filter((i) => i.column === 'kode_site')
    expect(where(issues)).toEqual(['Karyawan:3:kode_site', 'Karyawan:4:kode_site'])
    expect(issues[0]!.message).toMatch(/lintas PT/)
    expect(issues[1]!.message).toMatch(/tidak ditemukan/)
  })

  it('the default cost center of a site must be an operational one of the same PT', () => {
    const r = parseWorkbook(
      readXlsx(
        buildSample({
          rows: {
            site: [
              { kode_pt: 'DRMS', kode: 'CAB-1', nama: 'Cabang 1', kode_pusat_biaya: 'CTH-KANTOR' },
              { kode_pt: 'DRMS', kode: 'CAB-2', nama: 'Cabang 2', kode_pusat_biaya: 'TIDAK-ADA' },
              { kode_pt: 'DRMS', kode: 'CAB-2', nama: 'Cabang 2 lagi' },
            ],
          },
        }),
      ),
    )
    expect(where(errs(r.issues))).toEqual(['Site:4:undefined']) // duplicate kode (PT / kode)
    const res = errs(resolveReferences(r.data, db(), new Map()).issues).filter((i) => i.sheet === 'Site')
    expect(where(res)).toEqual(['Site:3:kode_pusat_biaya', 'Site:2:kode_pusat_biaya'])
  })
})
