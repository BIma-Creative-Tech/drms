import { randomUUID } from 'node:crypto'

import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { postEntry } from '@/domain/cash/ledger'
import { DEFAULT_SEQUENCES, parseBusinessDate } from '@/domain/numbering'
import { allocateDocNo } from '@/domain/numbering-db'
import { formatReport } from '@/import/report'
import { parseKcMap } from '@/import/resolve'
import { runImport, type ImportReport } from '@/import/run'
import { SAMPLE } from '@/import/sample'
import { buildSample } from '@/import/template'
import { withSystemTransaction } from '@/lib/system-tx'

import { api, makeFlowUser, type FlowUser } from './flow-world'
import { auditRows, companyId, getTestPayload, sqlAs, sqlError, updateCompany } from './helpers'

/**
 * E11 go-live import against the throwaway DB. Test files share one DB (reset once per run), so the
 * cut-over uses go-live 2020-02-01 (closes 2020-01, a month no other file uses) and the PB counter
 * expectations are relative to what this file finds (numbering.int.test.ts pattern).
 */
const GO_LIVE = '2020-02-01'
const settings = { tanggal_golive: GO_LIVE, nomor_pb_mulai: 229, tutup_periode_sebelum_golive: 'Ya' }
const subs = new Map<string, string>(['andi.contoh', 'bunga.fiktif', 'candra.contoh', 'fitri.fiktif'].map((u) => [u, randomUUID()]))
const fileBytes = () => buildSample({ settings })

let pbBefore: number | null = null
/** Lock date left by other files (shared DB) before this file runs, e.g. 2026-08-31. */
let lockBefore: string | null = null
let finance: FlowUser

async function run(mode: 'dry-run' | 'commit', bytes = fileBytes(), kcMap: ReadonlyMap<string, string> = subs): Promise<ImportReport> {
  return runImport(await getTestPayload(), { bytes, fileName: 'contoh-fiktif.xlsx', mode, kcMap, operator: 'uji integrasi' })
}
const count = async (q: string, params: unknown[] = []) => Number((await sqlAs('app', q, params)).rows[0].n)
const sampleCount = async () => ({
  employees: await count("SELECT count(*) AS n FROM employees WHERE code LIKE 'CTH-%'"),
  users: await count("SELECT count(*) AS n FROM users WHERE email LIKE '%@drms-contoh.test' OR email LIKE '%.fiktif@pengguna.drms.invalid'"),
  bankAccounts: await count("SELECT count(*) AS n FROM employee_bank_accounts a JOIN employees e ON e.id = a.employee_id WHERE e.code LIKE 'CTH-%'"),
  costCenters: await count("SELECT count(*) AS n FROM cost_centers WHERE code LIKE 'CTH-%'"),
  sites: await count("SELECT count(*) AS n FROM sites WHERE code LIKE 'CTH-%'"),
  projects: await count("SELECT count(*) AS n FROM projects WHERE code LIKE 'CTH-%'"),
  stages: await count("SELECT count(*) AS n FROM project_stages s JOIN projects p ON p.id = s.project_id WHERE p.code LIKE 'CTH-%'"),
  budgetLines: await count("SELECT count(*) AS n FROM budget_lines b JOIN projects p ON p.id = b.project_id WHERE p.code LIKE 'CTH-%'"),
  vehicles: await count("SELECT count(*) AS n FROM vehicles WHERE plate_no LIKE '%ZZ'"),
  assignments: await count("SELECT count(*) AS n FROM team_assignments t JOIN employees e ON e.id = t.employee_id WHERE e.code LIKE 'CTH-%'"),
  cashAccounts: await count("SELECT count(*) AS n FROM cash_accounts WHERE name LIKE '%Contoh (FIKTIF)'"),
  banks: await count("SELECT count(*) AS n FROM banks WHERE code = 'BPD-CTH'"),
  clients: await count("SELECT count(*) AS n FROM clients WHERE name = 'PT Klien Contoh (FIKTIF)'"),
})
const importAudits = () => count("SELECT count(*) AS n FROM audit_logs WHERE action = 'import'")

beforeAll(async () => {
  const p = await getTestPayload()
  await updateCompany({ shortCode: 'DRMS' })
  for (const s of DEFAULT_SEQUENCES) {
    const found = await p.find({ collection: 'document-sequences', where: { and: [{ company: { equals: await companyId() } }, { docType: { equals: s.docType } }] }, overrideAccess: true /* SYSTEM-READ */ })
    if (found.docs[0]) await p.update({ collection: 'document-sequences', id: found.docs[0].id, data: { ...s, active: true, changeReason: 'test fixture' }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    else await p.create({ collection: 'document-sequences', data: { ...s, company: await companyId(), timezone: 'Asia/Makassar' }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  }
  const c = await sqlAs('app', "SELECT next_value FROM document_sequence_counters WHERE company_id = $1 AND doc_type = 'expense_request' AND period_key = '2020-02'", [await companyId()])
  pbBefore = c.rows[0] ? Number(c.rows[0].next_value) : null
  lockBefore = (await sqlAs('app', 'SELECT pk_cash_lock_date($1::integer)::text AS d', [await companyId()])).rows[0].d // ADR 0016: lock date per PT
  finance = await makeFlowUser(['pk-finance'], 'impor-finance', null, { signature: false })
})

afterAll(async () => {
  const p = await getTestPayload()
  const seq = await p.find({ collection: 'document-sequences', where: { and: [{ company: { equals: await companyId() } }, { docType: { equals: 'expense_request' } }] }, overrideAccess: true /* SYSTEM-READ */ })
  if (seq.docs[0]) await p.update({ collection: 'document-sequences', id: seq.docs[0].id, data: { startAt: 1, changeReason: 'uji impor selesai' }, overrideAccess: true /* SYSTEM-WRITE: restore */ })
  await p.destroy()
})

describe('E11 go-live import (dry-run → commit → idempotent re-run)', () => {
  it('dry-run with errors: reported per sheet/row/column, nothing written', async () => {
    const bytes = buildSample({
      settings,
      rows: {
        rekening: [...SAMPLE.rows.rekening!, { kode_karyawan: 'CTH-999', kode_bank: 'BCA', no_rekening: '9990009999', atas_nama: 'Tidak Ada' }],
        tahapan: SAMPLE.rows.tahapan!.map((t) => (t.urutan === 4 ? { ...t, bobot_persen: 10 } : t)),
        akunKas: [{ ...SAMPLE.rows.akunKas![0]!, saldo_awal: '-5' }],
      },
    })
    const auditsBefore = await importAudits()
    const r = await run('dry-run', bytes)
    expect(r.ok).toBe(false)
    expect(r.committed).toBe(false)
    const errs = r.issues.filter((i) => i.level === 'error').map((i) => `${i.sheet}:${i.row}:${i.column}`)
    expect(errs).toEqual(expect.arrayContaining(['Rekening:6:kode_karyawan', 'Tahapan:2:bobot_persen', 'AkunKas:2:saldo_awal']))
    expect(await sampleCount()).toMatchObject({ employees: 0, users: 0, cashAccounts: 0, projects: 0 })
    expect(await importAudits()).toBe(auditsBefore)
  })

  it('dry-run of the valid file: 0 errors, counts of what WOULD happen, still nothing written; Keycloak list = users without mapping', async () => {
    const r = await run('dry-run')
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([])
    expect(r.ok).toBe(true)
    const m = Object.fromEntries(r.masters.map((x) => [x.sheet, x]))
    expect(m.Karyawan).toMatchObject({ rows: 6, created: 6 })
    expect(m.Pengguna).toMatchObject({ rows: 5, created: 4, skipped: 1 })
    expect(m.AkunKas).toMatchObject({ rows: 2, created: 2 })
    expect(r.keycloakUsers).toEqual([{ username: 'dewi.fiktif', email: '', firstName: 'Dewi Fiktif', enabled: true, realmRoles: ['pk-staff'], employeeCode: 'CTH-004' }])
    expect(JSON.stringify(r)).not.toMatch(/password/i)
    expect(await sampleCount()).toMatchObject({ employees: 0, users: 0, cashAccounts: 0, projects: 0, vehicles: 0 })
    expect(await count("SELECT count(*) AS n FROM period_closings WHERE period = '2020-01'")).toBe(0)
  })

  it('commit imports every row (per master transactions), audit `import`, cut-over done', async () => {
    const r = await run('commit')
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([])
    expect(r.committed).toBe(true)
    const rows = SAMPLE.rows
    expect(await sampleCount()).toEqual({
      employees: rows.karyawan!.length,
      users: rows.pengguna!.length - 1, // dewi.fiktif waits for her Keycloak account
      bankAccounts: rows.rekening!.length,
      costCenters: rows.pusatBiaya!.length,
      sites: rows.site!.length,
      projects: rows.project!.length,
      stages: rows.tahapan!.length,
      budgetLines: rows.rab!.length,
      vehicles: rows.kendaraan!.length,
      assignments: rows.penugasan!.length,
      cashAccounts: rows.akunKas!.length,
      banks: 1,
      clients: 1,
    })
    const candra = (await sqlAs('app', "SELECT u.id, u.keycloak_sub, m.employee_id FROM users u LEFT JOIN company_memberships m ON m.user_id = u.id WHERE u.email = 'candra@drms-contoh.test'")).rows[0]
    expect(candra.keycloak_sub).toBe(subs.get('candra.contoh'))
    // ADR 0016: roles + employee = membership of the PT
    const roles = (await sqlAs('app', 'SELECT r.value::text AS value FROM company_memberships m JOIN company_memberships_roles r ON r.parent_id = m.id WHERE m.user_id = $1', [candra.id])).rows.map((x) => x.value).sort()
    expect(roles).toEqual(['pk-pm', 'pk-staff'])
    const prj = (await sqlAs('app', "SELECT pm_id, budget::bigint AS budget, lat, radius_m, status, start_date FROM projects WHERE code = 'CTH-PRJ-01'")).rows[0]
    expect(prj).toMatchObject({ pm_id: candra.id, budget: '250000000', status: 'berjalan' })
    expect(new Date(prj.start_date).toISOString().slice(0, 10)).toBe('2026-08-01')
    expect(Number((await sqlAs('app', "SELECT sum(s.weight_pct) AS s FROM project_stages s JOIN projects p ON p.id = s.project_id WHERE p.code = 'CTH-PRJ-02' AND s.active")).rows[0].s)).toBe(100)
    expect((await sqlAs('app', "SELECT manager_id FROM cost_centers WHERE code = 'CTH-OPS'")).rows[0].manager_id).toBe(candra.id)
    // ADR 0023: Site sheet + kode_site links (Karyawan is linked after the sites exist)
    const cab = (await sqlAs('app', "SELECT s.id, cc.code AS cc FROM sites s JOIN cost_centers cc ON cc.id = s.cost_center_id WHERE s.code = 'CTH-CAB'")).rows[0]
    expect(cab.cc).toBe('CTH-OPS')
    expect((await sqlAs('app', "SELECT code FROM employees WHERE home_site_id = $1 ORDER BY code", [cab.id])).rows.map((x) => x.code)).toEqual(['CTH-006'])
    expect((await sqlAs('app', "SELECT code FROM projects WHERE site_id = $1", [cab.id])).rows.map((x) => x.code)).toEqual(['CTH-PRJ-02'])
    expect((await sqlAs('app', "SELECT name FROM cash_accounts WHERE site_id = $1", [cab.id])).rows.map((x) => x.name)).toEqual(['Kas Kecil Contoh (FIKTIF)'])
    expect((await sqlAs('app', "SELECT e.code, t.role_in_project FROM team_assignments t JOIN employees e ON e.id = t.employee_id WHERE t.site_id = $1", [cab.id])).rows).toEqual([{ code: 'CTH-005', role_in_project: 'mandor' }])
    expect((await sqlAs('app', "SELECT account_no, verification_status FROM employee_bank_accounts WHERE account_no = '0990000000401'")).rows[0]).toEqual({ account_no: '0990000000401', verification_status: 'unverified' })
    const acc = (await sqlAs('app', "SELECT name, opening_balance::bigint AS ob, opening_balance_date FROM cash_accounts WHERE name LIKE '%Contoh (FIKTIF)' ORDER BY name")).rows
    expect(acc).toEqual([
      { name: 'Bank Operasional Contoh (FIKTIF)', ob: '125750000', opening_balance_date: GO_LIVE },
      { name: 'Kas Kecil Contoh (FIKTIF)', ob: '5000000', opening_balance_date: GO_LIVE },
    ])
    // cut-over: previous period closed, audited
    // (other files may already have closed a later month → the cut-over only notes that the month is locked)
    if (lockBefore === null || lockBefore < '2020-01-31') {
      expect((await sqlAs('app', "SELECT status FROM period_closings WHERE period = '2020-01'")).rows).toEqual([{ status: 'closed' }])
      expect(r.cutover).toMatchObject({ goLiveDate: GO_LIVE, pbStartAt: 229, closedPeriod: '2020-01' })
    } else {
      expect(r.cutover).toMatchObject({ goLiveDate: GO_LIVE, pbStartAt: 229, closedPeriod: null, closeNote: `sudah terkunci s/d ${lockBefore}` })
    }
    const audits = (await sqlAs('app', "SELECT field, source, reason, new_value FROM audit_logs WHERE action = 'import' AND doc_id = $1 ORDER BY id", [r.runId])).rows
    // "Pengaturan" is audited only when the cut-over changed something (period closed / PB counter raised);
    // with a lock left by another file (file order is not fixed) the cut-over is a no-op.
    const cutoverChanged = lockBefore === null || lockBefore < '2020-01-31'
    expect(audits.map((a) => a.field)).toEqual(expect.arrayContaining(['Karyawan', 'Pengguna', 'AkunKas', ...(cutoverChanged ? ['Pengaturan'] : []), 'selesai']))
    expect(audits.every((a) => a.source === 'system' && /^Impor data go-live contoh-fiktif\.xlsx \(sha256 [0-9a-f]{12}\) oleh uji integrasi$/.test(a.reason))).toBe(true)
    // business rows carry the same reason (field-level audit of the masters)
    const empAudit = await sqlAs('app', "SELECT reason, source FROM audit_logs WHERE doc_type = 'employee' AND action = 'create' AND doc_id = (SELECT id::text FROM employees WHERE code = 'CTH-001') LIMIT 1")
    expect(empAudit.rows[0].source).toBe('system')
  })

  it('Rekap Kas: balance per imported account = its opening balance', async () => {
    for (const a of SAMPLE.rows.akunKas!) {
      const id = (await sqlAs('app', 'SELECT id FROM cash_accounts WHERE name = $1', [a.nama])).rows[0].id
      const res = await api('GET', `/api/v1/reports/rekap-kas?akun=${id}`, finance)
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      const saldo = (res.body.extra as Array<{ key: string; rows: Array<Record<string, unknown>>; totals: Record<string, unknown> }>).find((t) => t.key === 'saldo')!
      expect(saldo.rows).toEqual([{ akun: a.nama, status: 'aktif', saldo: a.saldo_awal }])
      expect(saldo.totals).toMatchObject({ saldo: a.saldo_awal })
    }
  })

  it('second commit with the same file is a no-op (no create/update, no duplicates)', async () => {
    const before = await sampleCount()
    const r = await run('commit')
    expect(r.ok).toBe(true)
    for (const m of r.masters) expect({ sheet: m.sheet, created: m.created, updated: m.updated }).toEqual({ sheet: m.sheet, created: 0, updated: 0 })
    expect(await sampleCount()).toEqual(before)
    // only the run summary is audited
    expect((await sqlAs('app', "SELECT field FROM audit_logs WHERE action = 'import' AND doc_id = $1", [r.runId])).rows).toEqual([{ field: 'selesai' }])
  })

  it('first PB number of the go-live month = nomor_pb_mulai, e.g. PB/DRMS/2002/0229 (monthly series; counter continues if numbers were already issued)', async () => {
    const p = await getTestPayload()
    const cid = await companyId()
    const a = await withSystemTransaction(p, null, (req: PayloadRequest) => allocateDocNo(req, 'expense_request', { companyId: cid, date: parseBusinessDate(GO_LIVE), docId: 'impor-golive-pb' }))
    const expected = pbBefore === null || pbBefore <= 229 ? 229 : pbBefore
    expect(a.docNo).toBe(`PB/DRMS/2002/${String(expected).padStart(4, '0')}`)
    if (pbBefore === null) expect(a.docNo).toBe('PB/DRMS/2002/0229')
  })

  it('PB start is configurable in the workbook: counter raised (only upward), audited', async () => {
    const cur = Number((await sqlAs('app', "SELECT next_value FROM document_sequence_counters WHERE company_id = $1 AND doc_type = 'expense_request' AND period_key = '2020-02'", [await companyId()])).rows[0].next_value)
    const target = cur + 1000
    const r = await run('commit', buildSample({ settings: { ...settings, nomor_pb_mulai: target } }))
    expect(r.ok).toBe(true)
    expect(r.cutover).toMatchObject({ pbCounterBefore: cur, pbCounterAfter: target, firstPbNumber: `PB/DRMS/2002/${String(target).padStart(4, '0')}` })
    const cid = await companyId()
    const a = await withSystemTransaction(await getTestPayload(), null, (req) => allocateDocNo(req, 'expense_request', { companyId: cid, date: parseBusinessDate('2020-02-03') }))
    expect(a.seq).toBe(target)
    const au = await sqlAs('app', "SELECT old_value, new_value FROM audit_logs WHERE doc_type = 'document_sequence' AND field = 'nextValue' ORDER BY id DESC LIMIT 1")
    expect(au.rows[0]).toEqual({ old_value: { v: cur }, new_value: { v: target } })
    // lowering again is refused silently (warning), never moves the counter back
    const again = await run('dry-run', buildSample({ settings }))
    expect(again.issues.some((i) => i.level === 'warning' && /counter tidak diubah/.test(i.message))).toBe(true)
  })

  it('users created later in Keycloak: re-import with the mapping links them and fills pending references', async () => {
    const all = new Map(subs)
    all.set('dewi.fiktif', randomUUID())
    const r = await run('commit', fileBytes(), all)
    expect(r.ok).toBe(true)
    expect(r.keycloakUsers).toEqual([])
    const dewi = (await sqlAs('app', "SELECT email, keycloak_sub FROM users WHERE keycloak_sub = $1", [all.get('dewi.fiktif')])).rows[0]
    expect(dewi.email).toBe('dewi.fiktif@pengguna.drms.invalid')
    expect(Object.fromEntries(r.masters.map((m) => [m.sheet, m.created])).Pengguna).toBe(1)
  })

  it('E9 B-2 (G-22): deactivation by import revokes devices without calling Keycloak and reports ONE Keycloak follow-up', async () => {
    const p = await getTestPayload()
    const candra = (await sqlAs('app', "SELECT id FROM users WHERE email = 'candra@drms-contoh.test'")).rows[0]
    const device = await p.create({
      collection: 'devices',
      data: { deviceId: randomUUID(), user: candra.id, platform: 'android', model: 'Uji B-2', appVersion: '1.0.0', keycloakSid: randomUUID(), status: 'active' } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: fixture (registration endpoint not needed here)
    })
    const withCandra = (aktif: 'Ya' | 'Tidak') =>
      buildSample({ settings, rows: { pengguna: (SAMPLE.rows.pengguna ?? []).map((u) => (u.username === 'candra.contoh' ? { ...u, aktif } : u)) } })
    const warn = vi.spyOn(p.logger, 'warn')
    try {
      const dry = await run('dry-run', withCandra('Tidak'))
      expect(dry.ok, JSON.stringify(dry.issues)).toBe(true)
      expect(dry.keycloakFollowUp).toEqual([{ username: 'candra.contoh', email: 'candra@drms-contoh.test', keycloakSub: subs.get('candra.contoh'), action: 'disable_logout' }])
      expect((await sqlAs('app', 'SELECT status FROM devices WHERE id = $1', [device.id])).rows[0].status).toBe('active')

      const r = await run('commit', withCandra('Tidak'))
      expect(r.ok, JSON.stringify(r.issues)).toBe(true)
      expect(r.keycloakFollowUp.map((x) => [x.username, x.action])).toEqual([['candra.contoh', 'disable_logout']])
      expect((await sqlAs('app', 'SELECT status, revoke_reason FROM devices WHERE id = $1', [device.id])).rows[0]).toEqual({ status: 'revoked', revoke_reason: 'user_deactivated' })
      const revoke = (await auditRows('device', device.id)).find((a) => a.action === 'device_revoke')
      expect(revoke?.new_value).toEqual({ v: 'keycloak_skipped' })
      // no per-device "keycloak device session delete failed" noise, one summary block instead
      expect(warn.mock.calls.filter((c) => JSON.stringify(c).includes('keycloak device session delete failed'))).toEqual([])
      const text = formatReport(r)
      expect(text.match(/PERINGATAN KEYCLOAK/g)).toHaveLength(1)
      expect(text).toContain('1 pengguna dinonaktifkan → WAJIB disable + logout di Keycloak (runbook import-data-golive §Langkah Keycloak): candra.contoh')

      // re-activation is reported as well (enable in Keycloak)
      const back = await run('commit', withCandra('Ya'))
      expect(back.keycloakFollowUp.map((x) => [x.username, x.action])).toEqual([['candra.contoh', 'enable']])
      expect((await sqlAs('app', 'SELECT active FROM users WHERE id = $1', [candra.id])).rows[0].active).toBe(true)
      // unchanged state → nothing to follow up
      expect((await run('dry-run', withCandra('Ya'))).keycloakFollowUp).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })

  it('kcadm CSV mapping file is accepted as-is', () => {
    const csv = [...subs].map(([u, s]) => `${s},${u}`).join('\n')
    expect(parseKcMap(csv).map).toEqual(subs)
  })
})

describe('E11 opening balance lock + go-live date guard (ADR 0005 As implemented S3b)', () => {
  it('after a period on/after the opening date is closed, the opening balance is locked (hook 409, DB trigger, import dry-run error)', async () => {
    const p = await getTestPayload()
    const accRow = (await sqlAs('app', "SELECT id, company_id FROM cash_accounts WHERE name = 'Kas Kecil Contoh (FIKTIF)'")).rows[0]
    const acc = accRow.id
    // ADR 0016 §4: the lock is per PT — only a closing of the ACCOUNT's PT counts (mc2-isolation closes other PTs)
    const closedLater = Number((await sqlAs('app', "SELECT count(*) AS n FROM period_closings WHERE status = 'closed' AND period >= '2020-02' AND company_id = $1", [accRow.company_id])).rows[0].n)
    if (closedLater === 0) {
      // before the close: Finance may still correct it (reason required)
      await p.update({ collection: 'cash-accounts', id: acc, data: { openingBalance: 5000001, changeReason: 'koreksi uji' }, overrideAccess: true /* SYSTEM-WRITE: test */ })
      await p.update({ collection: 'cash-accounts', id: acc, data: { openingBalance: 5000000, changeReason: 'koreksi uji kembali' }, overrideAccess: true /* SYSTEM-WRITE: test */ })
      await withSystemTransaction(p, null, (req) => p.create({ collection: 'period-closings', data: { company: accRow.company_id, period: '2020-02', status: 'closed', note: 'uji kunci saldo awal' }, overrideAccess: true /* SYSTEM-WRITE: test */, req }))
    } // else: another file (shared DB) already closed a month after the go-live date → already locked
    await expect(p.update({ collection: 'cash-accounts', id: acc, data: { openingBalance: 1, changeReason: 'tidak boleh' }, overrideAccess: true /* SYSTEM-WRITE: test */ })).rejects.toThrow(/Saldo awal terkunci: periode \d{4}-\d{2} sudah ditutup/)
    const db = await sqlError('app', 'UPDATE cash_accounts SET opening_balance = 1 WHERE id = $1', [acc])
    expect(db?.code).toBe('42501')
    expect(await sqlError('app', "UPDATE cash_accounts SET opening_balance_date = '2020-03-01' WHERE id = $1", [acc])).toMatchObject({ code: '42501' })
    // other fields stay editable
    expect(await sqlError('app', "UPDATE cash_accounts SET account_holder = 'Kasir' WHERE id = $1", [acc])).toBeNull()
    const r = await run('dry-run', buildSample({ settings, rows: { akunKas: [{ ...SAMPLE.rows.akunKas![0]!, saldo_awal: 7000000 }] } }))
    expect(r.ok).toBe(false)
    expect(r.issues.find((i) => i.level === 'error')).toMatchObject({ sheet: 'AkunKas', row: 2 })
    expect(r.issues.find((i) => i.level === 'error')!.message).toMatch(/Saldo awal terkunci/)
  })

  it('no cash entry dated before the account opening date (DB guard)', async () => {
    const p = await getTestPayload()
    const acc = await p.create({ collection: 'cash-accounts', data: { name: `Akun uji golive ${randomUUID().slice(0, 6)}`, kind: 'cash', openingBalance: 0, openingBalanceDate: '2099-01-01' }, overrideAccess: true /* SYSTEM-WRITE: test */ })
    const today = new Date().toISOString().slice(0, 10)
    const err = await withSystemTransaction(p, null, (req) => postEntry(req, { direction: 'in', entryDate: today, cashAccountId: acc.id as number, amount: 1000, sourceType: 'manual', description: 'uji' })).then(
      () => null,
      (e: { message: string; status?: number }) => e,
    )
    // QA-05: the service answers first (400 with the date) — the trigger stays the last line of defence
    expect(err).toMatchObject({ status: 400, message: 'Tanggal sebelum tanggal saldo awal akun (01/01/2099).' })
    const db = await sqlError(
      'app',
      `INSERT INTO cash_entries (entry_no, entry_date, direction, amount, cash_account_id, company_id, source_type, status, uuid)
       VALUES ('KM/TEST/2099', $2, 'in', 1000, $1, (SELECT company_id FROM cash_accounts WHERE id = $1), 'manual', 'posted', gen_random_uuid()::text)`,
      [acc.id, today],
    )
    expect(db?.code).toBe('42501')
    expect(db?.message).toMatch(/before the opening balance date 2099-01-01/)
    // accounts without an opening date keep the F2 behaviour
    const legacy = await p.create({ collection: 'cash-accounts', data: { name: `Akun uji legacy ${randomUUID().slice(0, 6)}`, kind: 'cash', openingBalance: 0 }, overrideAccess: true /* SYSTEM-WRITE: test */ })
    const e = await withSystemTransaction(p, null, (req) => postEntry(req, { direction: 'in', entryDate: today, cashAccountId: legacy.id as number, amount: 1000, sourceType: 'manual', description: 'uji' }))
    expect(e.entryNo).toMatch(/^KM\//)
  })
})
