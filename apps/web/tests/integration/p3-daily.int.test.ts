import { createHash, randomUUID } from 'node:crypto'

import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildRapWorkbook } from '@/domain/rap/workbook'
import { addDays } from '@/domain/field/rules'
import { resetRateLimits } from '@/lib/rate-limit'
import config from '@/payload.config'

import { api, ORIGIN, sysCreate, type FlowUser } from './flow-world'
import { makeFr1World, type Fr1World } from './fr1-world'
import { accessToken, companyId, getTestPayload, http, installLocalJwks, registerDevice, sqlAs, sqlError, type TestUser, updateCompany } from './helpers'

/**
 * P3 konstruksi RAP + Laporan Harian (owner decisions 2026-10-10): RAP Excel import (preview → commit,
 * FILE_CHANGED), prices hidden from Staff, daily report create (LH number, ledger, stage % from the RAP
 * value-weighted, project %), DAILY_EXISTS, over-RAP (note required, flag, PM notified), POSSIBLE_DUPLICATE,
 * reporter edit + PM correction as ledger deltas, DB guards (append-only ledger, realisation only via the
 * ledger, no delete), RAP lock after realisation, manual progress refused on RAP stages, weekly recap,
 * offline sync item; Finance / Admin read-only on daily reports. Fictional data only.
 */
let w: Fr1World
let proj = 0
const st = { tanah: 0, struktur: 0 }
const item: Record<string, number> = {}
let lhStaff = 0

const RAP_ROWS = [
  { code: 'A.1', description: 'Galian tanah pondasi', stageName: 'Pekerjaan tanah', kind: 'pekerjaan' as const, uomCode: 'M3', volume: 100, unitPrice: 50_000, weightPct: null },
  { code: 'A.2', description: 'Urugan pasir', stageName: 'Pekerjaan tanah', kind: 'pekerjaan' as const, uomCode: 'M3', volume: 50, unitPrice: 20_000, weightPct: null },
  { code: 'B.1', description: 'Beton K-250', stageName: 'Struktur', kind: 'pekerjaan' as const, uomCode: 'M3', volume: 20, unitPrice: 1_000_000, weightPct: null },
  { code: 'M.1', description: 'Semen 50 kg', stageName: 'Struktur', kind: 'material' as const, uomCode: 'SAK', volume: 300, unitPrice: 65_000, weightPct: null },
]

async function rapUpload(user: FlowUser, step: 'preview' | 'commit', bytes: Uint8Array, payload?: Record<string, unknown>) {
  const form = new FormData()
  form.append('file', new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'rap.xlsx')
  if (payload) form.append('_payload', JSON.stringify(payload))
  const res = await handleEndpoints({ config, request: new Request(`${ORIGIN}/api/v1/projects/${proj}/rap/import/${step}`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: user.cookie }, body: form }) })
  return { status: res.status, body: (await res.json()) as any } // eslint-disable-line @typescript-eslint/no-explicit-any
}

const stagePct = async (id: number) => Number((await sqlAs('app', 'SELECT progress_pct FROM project_stages WHERE id = $1', [id])).rows[0].progress_pct)
const realised = async (code: string) => {
  const r = (await sqlAs('app', 'SELECT realised_qty, received_qty, used_qty FROM rap_items WHERE id = $1', [item[code]])).rows[0]
  return { realised: Number(r.realised_qty), received: Number(r.received_qty), used: Number(r.used_qty) }
}

beforeAll(async () => {
  installLocalJwks()
  w = await makeFr1World('lhkon')
  proj = await sysCreate('projects', { code: 'lhkon-KS', name: 'lhkon Gudang beton', kind: 'konstruksi', pm: w.users.pm.id, budget: 50_000_000, status: 'berjalan' })
  await sysCreate('team-assignments', { employee: w.emp.a, project: proj, roleInProject: 'staff' })
  st.tanah = await sysCreate('project-stages', { project: proj, name: 'Pekerjaan tanah', weightPct: 40, sequence: 1 })
  st.struktur = await sysCreate('project-stages', { project: proj, name: 'Struktur', weightPct: 60, sequence: 2 })
})
beforeEach(() => resetRateLimits())
afterAll(async () => {
  await updateCompany({ fieldReportsEnabled: false })
})

describe('RAP import (PM of the project)', () => {
  it('preview → commit; FILE_CHANGED on another file; stages become RAP-driven', async () => {
    const bytes = buildRapWorkbook(['M3', 'SAK'], RAP_ROWS)
    const pv = await rapUpload(w.users.pm, 'preview', bytes)
    expect(pv.status, JSON.stringify(pv.body)).toBe(200)
    expect(pv.body).toMatchObject({ counts: { new: 4, changed: 0, deactivated: 0 }, newStages: [], issues: [], locked: false })
    expect(pv.body.fileHash).toBe(createHash('sha256').update(bytes).digest('hex'))
    const other = await rapUpload(w.users.pm, 'commit', buildRapWorkbook(['M3'], RAP_ROWS.slice(0, 1)), { fileHash: pv.body.fileHash })
    expect(other.status).toBe(409)
    expect(other.body.code).toBe('FILE_CHANGED')
    const ok = await rapUpload(w.users.pm, 'commit', bytes, { fileHash: pv.body.fileHash })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    for (const i of ok.body.items as Array<{ code: string; id: number }>) item[i.code] = i.id
    expect(Object.keys(item).sort()).toEqual(['A.1', 'A.2', 'B.1', 'M.1'])
    expect(ok.body.stages.map((s: { progressMode: string; basis: string }) => [s.progressMode, s.basis])).toEqual([
      ['rap', 'value'],
      ['rap', 'value'],
    ])
    expect(ok.body.totals).toMatchObject({ rapValue: 5_000_000 + 1_000_000 + 20_000_000 + 19_500_000, budget: 50_000_000, overBudget: false })
    // idempotent by code: the same file again changes nothing
    const again = await rapUpload(w.users.pm, 'preview', bytes)
    expect(again.body.counts).toMatchObject({ new: 0, changed: 0, unchanged: 4 })
  })

  it('Staff reads quantities only (no prices / totals); Staff and Finance cannot edit', async () => {
    const r = await api('GET', `/api/v1/projects/${proj}/rap`, w.users.staffA)
    expect(r.status).toBe(200)
    expect(r.body.totals).toBeNull()
    expect(Object.keys(r.body.items[0])).not.toContain('unitPrice')
    expect(r.body.canEdit).toBe(false)
    for (const u of [w.users.staffA, w.users.finance]) {
      const p = await api('PATCH', `/api/v1/rap-items/${item['A.2']}`, u, { volume: 60 })
      expect(p.status, u.email).toBe(403)
    }
    const x = await api('GET', `/api/v1/projects/${proj}/rap.xlsx`, w.users.staffA)
    expect(x.status).toBe(200)
  })
})

describe('daily reports', () => {
  it('assigned Staff creates LH/YYMM/####; ledger moves the RAP; stage % value-weighted; project % from the weights', async () => {
    const r = await api('POST', '/api/v1/daily-reports', w.users.staffA, {
      projectId: proj,
      weather: { morning: 'cerah', noon: 'cerah', afternoon: 'hujan' },
      rainHours: 1.5,
      work: [
        { rapItemId: item['A.1'], qty: 40 },
        { rapItemId: item['B.1'], qty: 5 },
      ],
      materials: [{ rapItemId: item['M.1'], received: 100, used: 60 }],
      manpower: [],
      issues: 'Hujan sore, galian tergenang',
      clientUuid: randomUUID(),
    })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    lhStaff = r.body.id
    const yymm = `${w.today.slice(2, 4)}${w.today.slice(5, 7)}`
    expect(r.body.docNo).toMatch(new RegExp(`^LH/${yymm}/\\d{4}$`))
    expect(r.body).toMatchObject({ reportDate: w.today, editable: true, project: { kind: 'konstruksi' } })
    expect(r.body.work.map((x: { item: { code: string }; qty: number }) => [x.item.code, x.qty]).sort()).toEqual([
      ['A.1', 40],
      ['B.1', 5],
    ])
    expect(await realised('A.1')).toMatchObject({ realised: 40 })
    expect(await realised('M.1')).toMatchObject({ received: 100, used: 60 })
    // Tanah: A.1 40 % of 5 000 000 + A.2 0 % of 1 000 000 → 2 000 000 / 6 000 000 = 33.33 %; Struktur: B.1 5/20 = 25 %
    expect(await stagePct(st.tanah)).toBeCloseTo(33.33, 2)
    expect(await stagePct(st.struktur)).toBeCloseTo(25, 2)
    const p = (await sqlAs('app', 'SELECT progress_pct FROM projects WHERE id = $1', [proj])).rows[0]
    expect(Number(p.progress_pct)).toBeCloseTo(0.4 * 33.33 + 0.6 * 25, 1)
  })

  it('one per project, reporter and date → 409 DAILY_EXISTS; other kinds / not assigned refused', async () => {
    const dup = await api('POST', '/api/v1/daily-reports', w.users.staffA, { projectId: proj, work: [{ rapItemId: item['A.2'], qty: 1 }] })
    expect(dup.status).toBe(409)
    expect(dup.body).toMatchObject({ code: 'DAILY_EXISTS', id: lhStaff })
    const kind = await api('POST', '/api/v1/daily-reports', w.users.pm, { projectId: w.kontrak, notes: 'x' })
    expect(kind.body.code).toBe('WRONG_PROJECT_KIND')
    for (const u of [w.users.staffB, w.users.finance, w.users.otherPm]) {
      const x = await api('POST', '/api/v1/daily-reports', u, { projectId: proj, notes: 'x' })
      expect(x.status, u.email).toBe(403)
    }
    const wrongItem = await api('POST', '/api/v1/daily-reports', w.users.pm, { projectId: proj, work: [{ rapItemId: item['M.1'], qty: 1 }] })
    expect(wrongItem.status).toBe(400)
  })

  it('above the RAP volume (Direktur): note required, flag MELEBIHI_RAP, project PM notified; same item by another reporter → POSSIBLE_DUPLICATE', async () => {
    const day = addDays(w.today, -1)
    const noNote = await api('POST', '/api/v1/daily-reports', w.users.owner, { projectId: proj, reportDate: day, work: [{ rapItemId: item['A.1'], qty: 70 }] })
    expect(noNote.status).toBe(400)
    expect(noNote.body.code).toBe('OVER_RAP_NOTE_REQUIRED')
    const over = await api('POST', '/api/v1/daily-reports', w.users.owner, {
      projectId: proj,
      reportDate: day,
      work: [
        { rapItemId: item['A.1'], qty: 70 },
        { rapItemId: item['B.1'], qty: 2 },
      ],
      notes: 'Galian diperdalam sesuai instruksi konsultan',
    })
    expect(over.status, JSON.stringify(over.body)).toBe(201)
    expect(over.body.flags).toEqual(expect.arrayContaining(['MELEBIHI_RAP', 'BACKDATED']))
    const n = await sqlAs('app', "SELECT user_id FROM notifications WHERE event = 'field.daily_over_rap' AND doc_id = $1", [String(over.body.id)])
    expect(n.rows.map((x) => Number(x.user_id))).toEqual([w.users.pm.id])
    expect(await stagePct(st.tanah)).toBeCloseTo((5_000_000 + 0) / 6_000_000 * 100, 1) // A.1 capped at 100 %
    const owner = await api('POST', '/api/v1/daily-reports', w.users.pm, { projectId: proj, reportDate: day, work: [{ rapItemId: item['B.1'], qty: 1 }] })
    expect(owner.status, JSON.stringify(owner.body)).toBe(201)
    expect(owner.body.flags).toContain('POSSIBLE_DUPLICATE')
  })

  it('reporter edit (24 h) and PM correction are ledger deltas; Staff cannot correct', async () => {
    const e = await api('PATCH', `/api/v1/daily-reports/${lhStaff}`, w.users.staffA, { work: [{ rapItemId: item['A.1'], qty: 30 }] })
    expect(e.status, JSON.stringify(e.body)).toBe(200)
    expect(await realised('A.1')).toMatchObject({ realised: 100 }) // 30 + 70
    expect((await api('POST', `/api/v1/daily-reports/${lhStaff}/corrections`, w.users.staffA, { reason: 'coba', work: [] })).status).toBe(403)
    const c = await api('POST', `/api/v1/daily-reports/${lhStaff}/corrections`, w.users.pm, { work: [{ rapItemId: item['B.1'], qty: 6 }], reason: 'Volume beton sesuai berita acara' })
    expect(c.status, JSON.stringify(c.body)).toBe(200)
    expect(c.body.flags).toContain('CORRECTED')
    const d = await api('GET', `/api/v1/daily-reports/${lhStaff}`, w.users.pm)
    const ledger = (d.body.ledger as Array<{ item: { code: string }; qty: number; origin: string; reason: string | null }>).map((l) => [l.item.code, l.qty, l.origin])
    expect(ledger).toEqual(
      expect.arrayContaining([
        ['A.1', 40, 'report'],
        ['A.1', -10, 'edit'],
        ['B.1', 1, 'correction'],
      ]),
    )
    expect(await realised('B.1')).toMatchObject({ realised: 9 }) // 6 + 2 + 1
  })

  it('DB guards: ledger append-only, realisation only through the ledger, reports never deleted', async () => {
    expect(await sqlError('app', `UPDATE daily_report_lines SET qty = 1 WHERE report_id = ${lhStaff}`)).not.toBeNull()
    expect(await sqlError('app', `DELETE FROM daily_report_lines WHERE report_id = ${lhStaff}`)).not.toBeNull()
    expect(await sqlError('app', `UPDATE rap_items SET realised_qty = 0 WHERE id = ${item['A.1']}`)).not.toBeNull()
    expect(await sqlError('app', `DELETE FROM daily_reports WHERE id = ${lhStaff}`)).not.toBeNull()
    expect(await sqlError('app', `DELETE FROM rap_items WHERE id = ${item['A.2']}`)).not.toBeNull()
  })

  it('RAP locked after realisation: PM refused, Direktur needs a reason; manual progress refused on RAP stages', async () => {
    const pm = await api('PATCH', `/api/v1/rap-items/${item['A.2']}`, w.users.pm, { volume: 60 })
    expect(pm.status).toBe(409)
    expect(pm.body.code).toBe('RAP_LOCKED')
    const noReason = await api('PATCH', `/api/v1/rap-items/${item['A.2']}`, w.users.owner, { volume: 60 })
    expect(noReason.status).toBeGreaterThanOrEqual(400)
    const ok = await api('PATCH', `/api/v1/rap-items/${item['A.2']}`, w.users.owner, { volume: 60, reason: 'Addendum volume urugan' })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.volume).toBe(60)
    const lp = await api('POST', '/api/v1/progress-reports', w.users.pm, { projectId: proj, stageId: st.tanah, pctAfter: 90, work: 'Manual' })
    expect(lp.status).toBe(409)
    expect(lp.body.code).toBe('STAGE_RAP_DRIVEN')
  })

  it('weekly recap: Minggu ke-N with reports and volume per work item; list in the read scope', async () => {
    const r = await api('GET', `/api/v1/projects/${proj}/daily-recap`, w.users.staffA)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.weeks.reduce((s: number, x: { reports: number }) => s + x.reports, 0)).toBe(3)
    const a1 = r.body.items.find((i: { code: string }) => i.code === 'A.1')
    expect(a1).toMatchObject({ realised: 100, pct: 100 })
    const staff = await api('GET', `/api/v1/daily-reports?project=${proj}`, w.users.staffA)
    expect(staff.body.items.length).toBe(3) // assigned project: all its reports
    const b = await api('GET', `/api/v1/daily-reports?project=${proj}`, w.users.staffB)
    expect(b.body.items).toEqual([])
  })

  it('Finance / Admin only read daily reports (owner 2026-10-10); Admin still edits the RAP (project planning parity)', async () => {
    for (const u of [w.users.admin, w.users.finance]) {
      const r = await api('POST', '/api/v1/daily-reports', u, { projectId: proj, reportDate: addDays(w.today, -2), notes: 'x' })
      expect(r.status, u.email).toBe(403)
      expect((await api('GET', `/api/v1/daily-reports?project=${proj}`, u)).body.items.length, u.email).toBe(3)
    }
    const me = await api('GET', '/api/v1/me', w.users.admin)
    expect(me.body.companies[0].capabilities).toMatchObject({ dailyReportCreate: false, progressReportCreate: true })
    const rap = await api('PATCH', `/api/v1/rap-items/${item['A.2']}`, w.users.admin, { description: 'Urugan pasir padat', reason: 'Perjelas uraian' })
    expect(rap.status, JSON.stringify(rap.body)).toBe(200)
  })
})

describe('offline sync (daily_report.upsert)', () => {
  it('applied once with the server copy; replay = duplicate', async () => {
    const p = await getTestPayload()
    const doc = await p.findByID({ collection: 'users', id: w.users.staffA.id, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })
    const t: TestUser = { ...w.users.staffA, keycloakSub: doc.keycloakSub as string }
    const token = await accessToken(t, ['pk-staff'])
    const device = await registerDevice(t, token)
    const now = Date.now()
    const clock = { device_time: new Date(now).toISOString(), elapsed_ms: 10_000_000, boot_id: 'boot-1', last_server_time: new Date(now - 600_000).toISOString(), last_server_elapsed_ms: 10_000_000 - 600_000 }
    const it1 = {
      client_uuid: randomUUID(),
      type: 'daily_report.upsert',
      company_id: await companyId(),
      schema_version: 1,
      offline: true,
      device_time: new Date(now - 300_000).toISOString(),
      elapsed_ms: 10_000_000 - 300_000,
      payload: { project_id: proj, report_date: addDays(w.today, -3), weather_morning: 'berawan', work: [{ rap_item_id: item['A.2'], qty: 12.5 }], manpower: [] },
    }
    const send = () => http('POST', '/api/v1/sync/batch', { headers: { Authorization: `Bearer ${token}`, 'X-Device-Id': device, 'X-App-Version': '1.0.0' }, json: { batch_id: randomUUID(), device_id: device, clock, items: [it1] } }) as Promise<{ status: number; body: any }> // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await send()
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.results[0], JSON.stringify(r.body.results[0])).toMatchObject({ status: 'applied', rev: 1 })
    expect(r.body.results[0].server_daily_report).toMatchObject({ client_uuid: it1.client_uuid, project_id: proj, work: [{ rap_item_id: item['A.2'], qty: 12.5 }] })
    expect(r.body.results[0].flags).toContain('OFFLINE')
    resetRateLimits()
    expect((await send()).body.results[0]).toMatchObject({ status: 'duplicate', original_status: 'applied' })
  })
})
