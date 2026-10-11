import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { PgDialect } from '@payloadcms/db-postgres/drizzle/pg-core'
import pg from 'pg'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resetAppConfigCache } from '@/api/v1/endpoints/app'
import { stampAttendanceSelfie } from '@/domain/attendance/stamp'
import { transferQueue } from '@/domain/expense/queues'
import { allocateDocNo } from '@/domain/numbering-db'
import { parseBusinessDate } from '@/domain/numbering'
import { mediaPath } from '@/lib/media-files'
import { resetRateLimits } from '@/lib/rate-limit'
import { isoDateInTz } from '@/lib/time'
import { up as dataUp } from '@/migrations/20261012_200100_d1010_data'

import { api, asUser, draftBody, makeWorld, upload, type FlowUser, type World } from './flow-world'
import { companyId, getTestPayload, sqlAs, sqlError, updateCompany } from './helpers'

/**
 * DRMS 10/10 Phase B (server): D5 numbering with the PT short code (+ data migration), item 11 transfer
 * date-time / approvedAt / SLA (queue, report, access), D7 selfie stamp by the worker job. Fictional data.
 */
const E = '/api/v1/expense-requests'
const FIXTURE = readFileSync(fileURLToPath(new URL('../fixtures/selfie-720x960.jpg', import.meta.url)))
const TZ = 'Asia/Makassar'
let w: World
let cid = 0

/** "YYYY-MM-DDTHH:MM" wall clock in the PT zone, `minutesAgo` before now. */
function wallClock(minutesAgo: number): string {
  const d = new Date(Date.now() - minutesAgo * 60_000)
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d)
  const g = (t: string) => p.find((x) => x.type === t)!.value
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`
}

async function proof(user: FlowUser): Promise<number> {
  const bytes = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 200, g: 200, b: 200 } } }).png().toBuffer()
  const r = await upload('/api/v1/media/transfer-proofs', user, bytes, 'image/png')
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body.id as number
}

/** Draft → submit → Direktur "Diketahui" → Finance approval = "Disetujui (Antri Transfer)". */
async function approvedRequest(title: string): Promise<number> {
  resetRateLimits()
  const d = await api('POST', E, w.users.staffA, draftBody(w, { title }))
  expect(d.status, JSON.stringify(d.body)).toBe(201)
  const id = d.body.id as number
  expect((await api('POST', `${E}/${id}/submit`, w.users.staffA, {})).status).toBe(200)
  expect((await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {})).status).toBe(200)
  const ok = await api('POST', `${E}/${id}/approve`, w.users.finance, {})
  expect(ok.status, JSON.stringify(ok.body)).toBe(200)
  return id
}

/** Moves a request's approval time back (owner, guard off for this statement — fixture only). */
async function backdateApproval(id: number, hours: number) {
  await sqlAs(
    'owner',
    `ALTER TABLE expense_requests DISABLE TRIGGER expense_requests_guard;
     UPDATE expense_requests SET approved_at = approved_at - interval '${Math.trunc(hours)} hours' WHERE id = ${Math.trunc(id)};
     SET CONSTRAINTS ALL IMMEDIATE;
     ALTER TABLE expense_requests ENABLE TRIGGER expense_requests_guard;`,
  )
}

/** Runs a migration function like `payload migrate` does: one OWNER connection, one transaction. */
async function migrate(fn: typeof dataUp): Promise<Array<Record<string, unknown>>> {
  const c = new pg.Client({ connectionString: process.env.PK_TEST_DATABASE_URL_OWNER })
  await c.connect()
  const dialect = new PgDialect()
  const logs: Array<Record<string, unknown>> = []
  const db = { execute: async (q: unknown) => {
    const x = dialect.sqlToQuery(q as never)
    return c.query(x.sql, x.params)
  } }
  try {
    await c.query('BEGIN')
    await fn({ db, payload: { logger: { info: (o: Record<string, unknown>) => logs.push(o) } } } as never)
    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK')
    throw e
  } finally {
    await c.end()
  }
  return logs
}

beforeAll(async () => {
  w = await makeWorld(`dk${Date.now() % 100000}`)
  cid = await companyId()
})

afterAll(async () => {
  await updateCompany({ transferSlaHours: 24, syncAttendanceEnabled: false })
  resetAppConfigCache()
})

describe('item 11: approvedAt + transfer date-time', () => {
  let id = 0
  it('final approval stores approvedAt (server time); the DB refuses any other change of it', async () => {
    const before = Date.now()
    id = await approvedRequest('SLA satu')
    const d = (await api('GET', `${E}/${id}`, w.users.finance)).body
    expect(new Date(d.approvedAt).getTime()).toBeGreaterThanOrEqual(before - 1000)
    expect(new Date(d.approvedAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000)
    const err = await sqlError('app', `UPDATE expense_requests SET approved_at = now() - interval '1 day' WHERE id = ${id}`)
    expect(err?.code).toBe('42501')
  })

  it('transferAt: future → 400, date mismatch → 400, wall clock in the PT zone → transfer_at + transfer_date (PT date)', async () => {
    const pf = await proof(w.users.finance)
    const base = { cashAccountId: w.cashAccount, bankRef: 'SLA-1', proofMediaId: pf }
    const future = await api('POST', `${E}/${id}/transfer`, w.users.finance, { ...base, transferAt: wallClock(-60) })
    expect(future.status, JSON.stringify(future.body)).toBe(400)
    expect(JSON.stringify(future.body)).toMatch(/masa depan/)
    const at = wallClock(30)
    const mismatch = await api('POST', `${E}/${id}/transfer`, w.users.finance, { ...base, transferAt: at, transferDate: '2020-01-01' })
    expect(mismatch.status).toBe(400)
    const garbage = await api('POST', `${E}/${id}/transfer`, w.users.finance, { ...base, transferAt: 'kemarin' })
    expect(garbage.status).toBe(400)
    const ok = await api('POST', `${E}/${id}/transfer`, w.users.finance, { ...base, transferAt: at })
    expect(ok.status, JSON.stringify(ok.body)).toBe(201)
    expect(ok.body.transferDocNo).toMatch(/^TRF\/DRMS\/\d{4}\/\d{4}$/)
    const row = (await sqlAs('app', 'SELECT transfer_at, transfer_date FROM transfers WHERE id = $1', [ok.body.transferId])).rows[0]
    const expected = new Date(`${at}:00+08:00`)
    expect(new Date(row.transfer_at).toISOString()).toBe(expected.toISOString())
    expect(row.transfer_date).toBe(isoDateInTz(expected, TZ))
    const t = ok.body.request.transfers[0]
    expect(t.transferAt).toBe(expected.toISOString())
  })

  it('old client (transferDate only) still works; the transfer has no time ("jam tidak diketahui")', async () => {
    const id2 = await approvedRequest('SLA lama')
    const today = isoDateInTz(new Date(), TZ)
    const r = await api('POST', `${E}/${id2}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: 'SLA-OLD', proofMediaId: await proof(w.users.finance), transferDate: today })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const row = (await sqlAs('app', 'SELECT transfer_at, transfer_date FROM transfers WHERE id = $1', [r.body.transferId])).rows[0]
    expect(row).toEqual({ transfer_at: null, transfer_date: today })
  })
})

describe('item 11: SLA in the queue and the report', () => {
  let late = 0
  let fresh = 0
  beforeAll(async () => {
    late = await approvedRequest('SLA terlambat')
    fresh = await approvedRequest('SLA baru')
    await backdateApproval(late, 30)
  })

  it('transfer queue: age since approval vs the PT SLA (default 24 h)', async () => {
    const items = await asUser(w.users.finance, (req) => transferQueue(req))
    const a = items.find((i) => i.id === late)!
    const b = items.find((i) => i.id === fresh)!
    expect(a.sla).toMatchObject({ slaHours: 24, over: true })
    expect(a.sla.ageHours!).toBeGreaterThan(29)
    expect(b.sla).toMatchObject({ slaHours: 24, over: false })
    await updateCompany({ transferSlaHours: 48 })
    const again = await asUser(w.users.finance, (req) => transferQueue(req))
    expect(again.find((i) => i.id === late)!.sla).toMatchObject({ slaHours: 48, over: false })
    await updateCompany({ transferSlaHours: 24 })
  })

  it('report "SLA transfer": Finance/Direktur only; late transfer listed with a link; month summary', async () => {
    const r = await api('POST', `${E}/${late}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: 'SLA-LATE', proofMediaId: await proof(w.users.finance), transferAt: wallClock(5) })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    for (const u of [w.users.staffA, w.users.pm, w.users.admin]) expect((await api('GET', '/api/v1/reports/sla-transfer', u)).status).toBe(403)
    const rep = await api('GET', '/api/v1/reports/sla-transfer', w.users.owner)
    expect(rep.status, JSON.stringify(rep.body)).toBe(200)
    const lateNo = (await api('GET', `${E}/${late}`, w.users.finance)).body.docNo as string
    const lateTable = rep.body.extra.find((t: { key: string }) => t.key === 'terlambat')
    expect(lateTable.rows.map((r: { pengajuan: string }) => r.pengajuan)).toContain(lateNo)
    expect(lateTable.rows.find((r: { pengajuan: string }) => r.pengajuan === lateNo).transfer).toBe(r.body.transferDocNo)
    expect(rep.body.main.totals.terlambat).toBeGreaterThanOrEqual(1)
    expect(rep.body.main.rows.length).toBeGreaterThanOrEqual(1)
    // links of the late rows (screen + exports): rows carry href to the request
    const { slaTransferReport } = await import('@/domain/reports/sla-report')
    const res = await asUser(w.users.finance, async (req) => slaTransferReport.run(req, await slaTransferReport.scope!(req), new URLSearchParams(), { limit: 100 }))
    expect(res.extra[0]!.rows.find((x) => x.cells.pengajuan === lateNo)!.href).toBe(`/admin/collections/expense-requests/${late}`)
    const csv = await api('GET', '/api/v1/reports/sla-transfer/csv', w.users.finance)
    expect(csv.status).toBe(200)
  })
})

describe('D5 numbering', () => {
  it('a mid-month pattern switch continues the same counter; new numbers carry the PT code', async () => {
    const p = await getTestPayload()
    const seq = (await p.find({ collection: 'document-sequences', where: { and: [{ company: { equals: cid } }, { docType: { equals: 'transfer' } }] }, limit: 1, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!
    const set = (pattern: string) => p.update({ collection: 'document-sequences', id: seq.id, data: { pattern, changeReason: 'uji D5' } as never, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    await set('TRF/{YY}{MM}/{seq}')
    const a = await asUser(null, (req) => allocateDocNo(req, 'transfer', { companyId: cid, date: parseBusinessDate('2033-03-10') }))
    await set('TRF/{COMPANY}/{YY}{MM}/{seq}')
    const b = await asUser(null, (req) => allocateDocNo(req, 'transfer', { companyId: cid, date: parseBusinessDate('2033-03-20') }))
    expect([a.docNo, b.docNo]).toEqual(['TRF/3303/0001', 'TRF/DRMS/3303/0002'])
  })

  it('an empty PT short code cannot exist (DB check + collection validation), so {COMPANY} is never blank', async () => {
    const err = await sqlError('owner', `UPDATE companies SET short_code = '' WHERE id = ${cid}`)
    expect(err?.code).toBe('23514')
  })

  it('data migration: only rows on the OLD default move (audited); customised patterns stay and are logged; idempotent', async () => {
    const rows = (await sqlAs('owner', "SELECT id, doc_type::text AS t FROM document_sequences WHERE company_id = $1 AND doc_type IN ('cash_in', 'progress_report')", [cid])).rows
    const km = rows.find((r) => r.t === 'cash_in')!.id
    const lp = rows.find((r) => r.t === 'progress_report')!.id
    await sqlAs('owner', "UPDATE document_sequences SET pattern = 'KM/{YY}{MM}/{seq}', padding = 4 WHERE id = $1", [km])
    await sqlAs('owner', "UPDATE document_sequences SET pattern = 'LAP-{YYYY}-{seq}', reset_policy = 'yearly' WHERE id = $1", [lp])
    try {
      const logs = await migrate(dataUp)
      const now = (await sqlAs('owner', 'SELECT id, pattern FROM document_sequences WHERE id = ANY($1) ORDER BY id', [[km, lp]])).rows
      expect(now.find((r) => r.id === km)!.pattern).toBe('KM/{COMPANY}/{YY}{MM}/{seq}')
      expect(now.find((r) => r.id === lp)!.pattern).toBe('LAP-{YYYY}-{seq}')
      const audit = (await sqlAs('owner', "SELECT old_value, new_value, source FROM audit_logs WHERE doc_type = 'document_sequence' AND doc_id = $1 AND field = 'pattern' AND reason LIKE 'D5 %' ORDER BY id DESC LIMIT 1", [String(km)])).rows[0]
      expect(audit.source).toBe('system')
      expect(JSON.stringify(audit.new_value)).toContain('KM/{COMPANY}/{YY}{MM}/{seq}')
      const log = logs.find((l) => String(l.msg).includes('d1010_data'))!
      expect((log.customisedKept as string[]).some((x) => x.includes('LAP-{YYYY}-{seq}'))).toBe(true)
      expect((log.movedSequences as string[]).some((x) => x.endsWith(`#${km}`))).toBe(true)
      const again = await migrate(dataUp)
      expect((again.find((l) => String(l.msg).includes('d1010_data'))!.movedSequences as string[]).length).toBe(0)
    } finally {
      await sqlAs('owner', "UPDATE document_sequences SET pattern = 'LP/{COMPANY}/{YY}{MM}/{seq}', reset_policy = 'monthly' WHERE id = $1", [lp])
    }
  })

  it('data migration backfills approvedAt from the last decision of the current cycle', async () => {
    const id = await approvedRequest('Backfill')
    const decided = (await sqlAs('owner', "SELECT max(decided_at) AS at FROM approvals WHERE request_id = $1 AND decision IN ('approved', 'acknowledged')", [id])).rows[0].at
    await sqlAs('owner', `ALTER TABLE expense_requests DISABLE TRIGGER expense_requests_guard; UPDATE expense_requests SET approved_at = NULL WHERE id = ${id}; SET CONSTRAINTS ALL IMMEDIATE; ALTER TABLE expense_requests ENABLE TRIGGER expense_requests_guard;`)
    await migrate(dataUp)
    const row = (await sqlAs('owner', 'SELECT approved_at FROM expense_requests WHERE id = $1', [id])).rows[0]
    expect(new Date(row.approved_at).toISOString()).toBe(new Date(decided).toISOString())
    // the guard is back on after the migration
    expect((await sqlError('app', `UPDATE expense_requests SET approved_at = now() WHERE id = ${id}`))?.code).toBe('42501')
  })
})

describe('D7: selfie stamped once by the worker job', () => {
  const SITE = { lat: -2.31, lng: 113.81 }
  it('web check-in queues stampSelfie; the job burns the band (same size, ≤ 150 KB) once; stamped_at is write-once', async () => {
    const p = await getTestPayload()
    await updateCompany({ syncAttendanceEnabled: true })
    resetAppConfigCache()
    await p.update({ collection: 'projects', id: w.project, data: { lat: SITE.lat, lng: SITE.lng, radiusM: 100 }, overrideAccess: true /* SYSTEM-WRITE: fixture geofence */ })
    resetRateLimits()
    const up = await upload('/api/v1/media/selfies', w.users.staffB, FIXTURE, 'image/jpeg')
    expect(up.status, JSON.stringify(up.body)).toBe(201)
    const selfieId = up.body.id as number
    const r = await api('POST', '/api/v1/attendance/check-in', w.users.staffB, { project_id: w.project, lat: SITE.lat, lng: SITE.lng, accuracy_m: 8, selfie_media_id: selfieId })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const attendanceId = r.body.id as number
    const job = (await sqlAs('app', "SELECT input FROM payload_jobs WHERE task_slug = 'stampSelfie' AND (input->>'attendanceId')::int = $1", [attendanceId])).rows
    expect(job).toHaveLength(1)

    const media = (await sqlAs('app', 'SELECT filename, width, height FROM media_selfies WHERE id = $1', [selfieId])).rows[0]
    const file = mediaPath(p, 'media-selfies', media.filename)!
    const before = readFileSync(file)
    const res = await stampAttendanceSelfie(p, attendanceId)
    expect(res.status).toBe('stamped')
    const after = readFileSync(file)
    expect(after.equals(before)).toBe(false)
    const meta = await sharp(after).metadata()
    expect([meta.width, meta.height]).toEqual([Number(media.width), Number(media.height)])
    expect(statSync(file).size).toBeLessThanOrEqual(150 * 1024)
    const row = (await sqlAs('app', 'SELECT stamped_at, filesize FROM media_selfies WHERE id = $1', [selfieId])).rows[0]
    expect(row.stamped_at).not.toBeNull()
    expect(Number(row.filesize)).toBe(after.length)

    // idempotent: a second run (retry / duplicate job) changes nothing
    expect((await stampAttendanceSelfie(p, attendanceId)).status).toBe('already')
    expect(readFileSync(file).equals(after)).toBe(true)
    // DB: stamped_at is write-once
    expect((await sqlError('app', `UPDATE media_selfies SET stamped_at = now() WHERE id = ${selfieId}`))?.code).toBe('42501')
    // the queued job runs the same code path (worker)
    const jobId = (await sqlAs('app', "SELECT id FROM payload_jobs WHERE task_slug = 'stampSelfie' AND (input->>'attendanceId')::int = $1", [attendanceId])).rows[0].id
    await p.jobs.runByID({ id: jobId })
    const done = (await sqlAs('app', 'SELECT completed_at, has_error FROM payload_jobs WHERE id = $1', [jobId])).rows[0]
    expect(done.has_error).toBe(false)
    expect(done.completed_at).not.toBeNull()
  })
})
