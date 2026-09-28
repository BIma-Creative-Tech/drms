import { randomUUID } from 'node:crypto'

import type { PayloadRequest } from 'payload'
import { afterAll, describe, expect, it } from 'vitest'

import { parseBusinessDate } from '@/domain/numbering'
import { allocateDocNo } from '@/domain/numbering-db'
import { runImport, type ImportReport } from '@/import/run'
import { buildWorkbook } from '@/import/template'
import { withSystemTransaction } from '@/lib/system-tx'

import { getTestPayload, sqlAs } from './helpers'

/**
 * MC2-5 go-live import into a NEW fictional PT "CT9" (ADR 0016 §11): sheet Perusahaan creates the PT
 * with default numbering + approval rules, `kode_pt` scopes every master, AksesPT gives a user a role
 * in that PT only, cut-over runs per PT (PB start 1), a second run is a no-op. Only CT9 rows are in
 * the file, so DRMS (and the other test files) are untouched; CT9 is deactivated in afterAll (the
 * other files assume the single-company default).
 */
const GO_LIVE = '2019-07-01'
const tag = randomUUID().slice(0, 4).toUpperCase()
const PT = `CT9${tag.replace(/[^A-Z0-9]/g, 'X')}`.slice(0, 16)
const sub = randomUUID()
const settings = { tanggal_golive: GO_LIVE, nomor_pb_mulai: 229, tutup_periode_sebelum_golive: 'Tidak' }
const rows = {
  perusahaan: [{ kode_pt: PT, nama: `PT Contoh Sembilan ${tag} (FIKTIF)`, nama_legal: null, alamat: 'Jl. Fiktif 9', telepon: null, nomor_pb_mulai: 1 }],
  karyawan: [
    { kode_pt: PT, kode: 'MCI-001', nama: 'Hana Fiktif', aktif: 'Ya' },
    { kode_pt: PT, kode: 'MCI-002', nama: 'Iwan Contoh', aktif: 'Ya' },
  ],
  pengguna: [{ kode_pt: PT, username: `hana.${tag.toLowerCase()}`, email: `hana.${tag.toLowerCase()}@mc2-contoh.test`, nama: 'Hana Fiktif', kode_karyawan: 'MCI-001', peran: 'PM, Staff', aktif: 'Ya' }],
  aksesPt: [],
  pusatBiaya: [{ kode_pt: PT, kode: 'MCI-OPS', nama: 'Ops Sembilan (FIKTIF)', jenis: 'Operasional', penanggung_jawab: `hana.${tag.toLowerCase()}`, aktif: 'Ya' }],
  project: [{ kode_pt: PT, kode: 'MCI-PRJ', nama: 'Proyek Sembilan (FIKTIF)', pm: `hana.${tag.toLowerCase()}`, latitude: -3.1, longitude: 114.1, radius_m: 100, rab: 10000000, status: 'Berjalan' }],
  tahapan: [
    { kode_pt: PT, kode_project: 'MCI-PRJ', urutan: 1, nama: 'Persiapan', bobot_persen: 40 },
    { kode_pt: PT, kode_project: 'MCI-PRJ', urutan: 2, nama: 'Pelaksanaan', bobot_persen: 60 },
  ],
  penugasan: [{ kode_pt: PT, kode_karyawan: 'MCI-002', kode_project: 'MCI-PRJ', kode_pusat_biaya: null, peran: 'Staff' }],
  akunKas: [{ kode_pt: PT, nama: 'Kas Sembilan (FIKTIF)', jenis: 'Kas', saldo_awal: 2500000, aktif: 'Ya' }],
}
const bytes = () => buildWorkbook({ settings, rows }, { sample: true })
const run = async (mode: 'dry-run' | 'commit'): Promise<ImportReport> =>
  runImport(await getTestPayload(), { bytes: bytes(), fileName: 'mc2-contoh-fiktif.xlsx', mode, kcMap: new Map([[`hana.${tag.toLowerCase()}`, sub]]), operator: 'uji MC2-5' })
const ptId = async () => (await sqlAs('app', 'SELECT id FROM companies WHERE short_code = $1', [PT])).rows[0]?.id as number | undefined

afterAll(async () => {
  const p = await getTestPayload()
  const id = await ptId()
  if (id) await p.update({ collection: 'companies', id, data: { active: false, changeReason: 'uji MC2-5 selesai' }, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
  await p.destroy()
})

describe('MC2-5 import into a new PT', () => {
  it('dry-run: 0 errors, new PT announced, nothing written', async () => {
    const r = await run('dry-run')
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([])
    expect(r.issues.some((i) => i.sheet === 'Perusahaan' && /PT baru/.test(i.message))).toBe(true)
    expect(r.cutovers.map((c) => [c.pt, c.pbStartAt, c.firstPbNumber])).toEqual([[PT, 1, `1/PB-${PT}/01/VII/2019`]])
    expect(await ptId()).toBeUndefined()
  })

  it('commit: PT + defaults created, masters scoped to the PT, membership with roles + employee of that PT', async () => {
    const r = await run('commit')
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([])
    expect(r.committed).toBe(true)
    const id = (await ptId())!
    expect(id).toBeGreaterThan(0)
    const n = async (q: string) => Number((await sqlAs('app', q, [id])).rows[0].n)
    expect(await n('SELECT count(*) AS n FROM document_sequences WHERE company_id = $1')).toBeGreaterThanOrEqual(5)
    expect(await n('SELECT count(*) AS n FROM approval_rules WHERE company_id = $1')).toBeGreaterThanOrEqual(1)
    expect(await n("SELECT count(*) AS n FROM employees WHERE company_id = $1 AND code LIKE 'MCI-%'")).toBe(2)
    expect(await n("SELECT count(*) AS n FROM projects WHERE company_id = $1 AND code = 'MCI-PRJ'")).toBe(1)
    expect(await n('SELECT count(*) AS n FROM project_stages WHERE company_id = $1')).toBe(2)
    expect(await n('SELECT count(*) AS n FROM team_assignments WHERE company_id = $1')).toBe(1)
    expect(await n('SELECT count(*) AS n FROM cash_accounts WHERE company_id = $1')).toBe(1)
    const m = (
      await sqlAs(
        'app',
        "SELECT m.company_id, e.code, array_agg(r.value::text ORDER BY r.value::text) AS roles FROM company_memberships m JOIN users u ON u.id = m.user_id LEFT JOIN employees e ON e.id = m.employee_id JOIN company_memberships_roles r ON r.parent_id = m.id WHERE u.keycloak_sub = $1 GROUP BY m.company_id, e.code",
        [sub],
      )
    ).rows
    expect(m).toEqual([{ company_id: id, code: 'MCI-001', roles: ['pk-pm', 'pk-staff'] }])
    // PM of the project = the imported user (member of that PT, DB trigger satisfied)
    expect((await sqlAs('app', "SELECT u.keycloak_sub FROM projects p JOIN users u ON u.id = p.pm_id WHERE p.code = 'MCI-PRJ' AND p.company_id = $1", [id])).rows[0].keycloak_sub).toBe(sub)
  })

  it('numbering of the new PT starts at its own PB start (sheet Perusahaan)', async () => {
    const id = (await ptId())!
    const a = await withSystemTransaction(await getTestPayload(), null, (req: PayloadRequest) => allocateDocNo(req, 'expense_request', { companyId: id, date: parseBusinessDate(GO_LIVE) }))
    expect(a.docNo).toBe(`1/PB-${PT}/01/VII/2019`)
  })

  it('second commit is a no-op', async () => {
    const r = await run('commit')
    expect(r.ok).toBe(true)
    for (const m of r.masters) expect({ sheet: m.sheet, created: m.created, updated: m.updated }).toEqual({ sheet: m.sheet, created: 0, updated: 0 })
  })
})
