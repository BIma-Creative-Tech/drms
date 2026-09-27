import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mayCorrect, recapEmployees } from '@/domain/attendance/web'
import { purgeExpiredSelfies } from '@/domain/attendance/retention'
import { runDailyReminders } from '@/domain/reminders/service'
import { addDays } from '@/domain/expense/types'
import { mediaPath } from '@/lib/media-files'

import { getTestPayload, sqlAs, sqlError } from './helpers'
import { api, asUser, draftBody, makeFlowUser, makeWorld, png, sysCreate, upload, uploadMedia, type FlowUser, type World } from './flow-world'

/**
 * S2 web B (plan fase1-golive E6 retensi selfie + E7 pengingat terjadwal + E6 web authz):
 * - selfie retention with a FAKE CLOCK: dry run while the switch is off, deletion of files older than
 *   the retention period in batches, attendance rows untouched, tombstone + audit, idempotent;
 * - daily reminders with a FAKE CLOCK: each rule gives exactly one notification per recipient per day
 *   (budget: per threshold), inactive users and archived projects get nothing, email queued only when
 *   enabled, before-hour / disabled / already-ran decisions;
 * - authz negatives of the masters edited from the new admin pages (Payload REST) and helpers.
 * All names, amounts and coordinates are fictional.
 */
let w: World
const E = '/api/v1/expense-requests'
const TZ = 'Asia/Makassar'
let today: string
let settingsBefore: Record<string, unknown>

const atWita = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+08:00`)

async function jpeg(seed: number): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 500, channels: 3, background: { r: seed % 255, g: (seed * 7) % 255, b: 90 } } }).jpeg().toBuffer()
}

async function setSettings(data: Record<string, unknown>) {
  const p = await getTestPayload()
  await p.updateGlobal({ slug: 'company-settings', data: data as never, overrideAccess: true /* SYSTEM-WRITE: test settings */ })
}

beforeAll(async () => {
  w = await makeWorld('sbw')
  today = (await sqlAs('app', `SELECT to_char(now() AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS d`)).rows[0].d as string
  const p = await getTestPayload()
  settingsBefore = (await p.findGlobal({ slug: 'company-settings', depth: 0, overrideAccess: true /* SYSTEM-READ: test */ })) as unknown as Record<string, unknown>
})

afterAll(async () => {
  await setSettings({
    selfieRetentionDeleteEnabled: false,
    selfieRetentionBatch: 200,
    remindersEnabled: true,
    reminderHour: 7,
    reminderEmailEnabled: false,
    lpjDueDays: (settingsBefore?.lpjDueDays as number) ?? 7,
    lateReportDays: (settingsBefore?.lateReportDays as number) ?? 3,
  })
})

// ================================================================ selfie retention (Q-33)

describe('selfie retention job (fake clock)', () => {
  const selfies: number[] = []
  let faceRef: number
  let attIn: number

  beforeAll(async () => {
    for (let i = 0; i < 12; i++) selfies.push(await uploadMedia('media-selfies', w.users.staffA, await jpeg(i + 1), 'image/jpeg'))
    faceRef = await uploadMedia('media-selfies', w.users.admin, await jpeg(99), 'image/jpeg')
    const p = await getTestPayload()
    await p.update({ collection: 'employees', id: w.emp.b, data: { faceRefPhoto: faceRef }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    const r = await sqlAs(
      'app',
      `INSERT INTO attendances (employee_id, user_id, kind, project_id, local_date, attendance_time, received_at, time_trust, offline, lat, lng, distance_m, selfie_id, client_uuid, source, updated_at, created_at)
       VALUES ($1, $2, 'check_in', $3, $4, $5, now(), 'server', false, -2.21, 113.91, 10, $6, $7, 'self', now(), now()) RETURNING id`,
      [w.emp.a, w.users.staffA.id, w.project, today, atWita(today, '08:00').toISOString(), selfies[0], randomUUID()],
    )
    attIn = r.rows[0].id as number
  })

  const fileOf = async (id: number) => {
    const p = await getTestPayload()
    const doc = (await p.findByID({ collection: 'media-selfies', id, depth: 0, overrideAccess: true /* SYSTEM-READ: test */ })) as { filename?: string }
    return mediaPath(p, 'media-selfies', doc.filename)!
  }

  it('switch OFF (default) = dry run: counts, deletes nothing', async () => {
    await setSettings({ selfieRetentionDeleteEnabled: false })
    const p = await getTestPayload()
    const now = new Date(Date.now() + 400 * 86_400_000) // ≈ 13 months later
    const r = await purgeExpiredSelfies(p, { now })
    expect(r).toMatchObject({ dryRun: true, deleted: 0, months: 12 })
    expect(r.candidates).toBeGreaterThanOrEqual(12)
    expect(existsSync(await fileOf(selfies[0]!))).toBe(true)
    // "today" is inside the retention period → not a candidate
    expect((await purgeExpiredSelfies(p, { now: new Date() })).candidates).toBe(0)
  })

  it('switch ON: deletes files older than the period in batches, keeps attendance rows, tombstone + audit, idempotent', async () => {
    await setSettings({ selfieRetentionDeleteEnabled: true, selfieRetentionBatch: 10 })
    const p = await getTestPayload()
    const now = new Date(Date.now() + 400 * 86_400_000)
    const first = await purgeExpiredSelfies(p, { now })
    expect(first).toMatchObject({ dryRun: false, deleted: 10, failed: 0 })
    expect(first.remaining).toBe(first.candidates - 10)
    let rest = first.remaining
    let guard = 0
    while (rest > 0 && guard++ < 50) rest = (await purgeExpiredSelfies(p, { now })).remaining
    expect(rest).toBe(0)
    for (const id of selfies) expect(existsSync(await fileOf(id))).toBe(false)
    const rows = await sqlAs('app', 'SELECT id, removed_at FROM media_selfies WHERE id = ANY($1::int[])', [[...selfies, faceRef]])
    for (const r of rows.rows) {
      if (Number(r.id) === faceRef) expect(r.removed_at).toBeNull()
      else expect(r.removed_at).not.toBeNull()
    }
    // face reference photo is never a candidate
    expect(existsSync(await fileOf(faceRef))).toBe(true)
    // attendance row untouched (append-only), selfie endpoint 404 with the retention message
    const att = (await sqlAs('app', 'SELECT selfie_id, lat, distance_m FROM attendances WHERE id = $1', [attIn])).rows[0]
    expect(att).toMatchObject({ selfie_id: selfies[0] })
    expect(Number(att.distance_m)).toBe(10)
    const view = await api('GET', `/api/v1/attendance/${attIn}/selfie`, w.users.finance)
    expect(view.status).toBe(404)
    // audit: one retention_purge row per run, counts only, source job
    const audit = await sqlAs('app', "SELECT new_value, source, user_id FROM audit_logs WHERE action = 'retention_purge' ORDER BY id")
    expect(audit.rows.length).toBeGreaterThanOrEqual(2)
    expect(audit.rows[0]).toMatchObject({ source: 'job', user_id: null, new_value: { v: expect.objectContaining({ months: 12, deleted: 10, batch: 10 }) } })
    expect(JSON.stringify(audit.rows[0].new_value)).not.toMatch(/filename|jpg/)
    // idempotent: nothing left
    expect(await purgeExpiredSelfies(p, { now })).toMatchObject({ candidates: 0, deleted: 0 })
  })

  it('DB guards: removed_at cannot be cleared; the job task runs through the queue', async () => {
    expect(await sqlError('app', 'UPDATE media_selfies SET removed_at = NULL WHERE id = $1', [selfies[1]])).toMatchObject({ code: '42501' })
    const p = await getTestPayload()
    await setSettings({ selfieRetentionDeleteEnabled: false })
    const job = await p.jobs.queue({ task: 'selfieRetention', input: {} })
    await p.jobs.runByID({ id: job.id })
    const done = await p.findByID({ collection: 'payload-jobs', id: job.id, depth: 0, overrideAccess: true /* SYSTEM-READ: test */ })
    expect(done).toMatchObject({ completedAt: expect.any(String), hasError: false })
  })
})

// ================================================================ E7 reminders

async function proof(): Promise<number> {
  const r = await upload('/api/v1/media/transfer-proofs', w.users.finance, await png())
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body.id
}

type Notif = { user_id: number; event: string; doc_id: string; title: string }
async function notifs(event: string, docId: string | number): Promise<Notif[]> {
  const r = await sqlAs('app', 'SELECT user_id, event, doc_id, title FROM notifications WHERE event = $1 AND doc_id = $2 ORDER BY id', [event, String(docId)])
  return r.rows.map((x) => ({ ...x, user_id: Number(x.user_id) })) as Notif[]
}
const users = (n: Notif[]) => n.map((x) => x.user_id).sort((a, b) => a - b)

describe('E7 daily reminders (fake clock)', () => {
  let advance: number
  let reimburse: number
  let offOwner: FlowUser
  let archived: number

  beforeAll(async () => {
    const p = await getTestPayload()
    await setSettings({ remindersEnabled: true, reminderHour: 7, reminderEmailEnabled: false, lpjDueDays: 7, lateReportDays: 3, reminderRevisionDays: 3, budgetWarnPct: 85, budgetOverPct: 100 })
    // An inactive Direktur never gets anything.
    offOwner = await makeFlowUser(['pk-owner'], 's2b-owner-off', null)
    await sqlAs('app', 'UPDATE users SET active = false WHERE id = $1', [offOwner.id])
    // Archived project with an old start: no late-progress reminder.
    archived = await sysCreate('projects', { code: 's2b-ARC', name: 's2b Arsip', pm: w.users.pm.id, budget: 1_000_000, status: 'berjalan' })
    await p.update({ collection: 'projects', id: archived, data: { status: 'arsip' }, overrideAccess: true /* SYSTEM-WRITE: fixture */, context: { auditReason: 'uji arsip' } })

    // (b) Uang Muka transferred 10 days ago, no LPJ.
    const c = await api('POST', E, w.users.staffA, draftBody(w))
    advance = c.body.id
    for (const [path, u] of [
      ['submit', w.users.staffA],
      ['acknowledge', w.users.owner],
      ['approve', w.users.finance],
    ] as const)
      expect((await api('POST', `${E}/${advance}/${path}`, u, {})).status).toBe(200)
    const t = await api('POST', `${E}/${advance}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `S2B-${advance}`, proofMediaId: await proof(), transferDate: addDays(today, -10) })
    expect(t.status, JSON.stringify(t.body)).toBe(201)

    // (c) Reimburse sent back for receipt revision today.
    const r = await api('POST', E, w.users.staffB, draftBody(w, { type: 'reimburse', requesterIds: [w.emp.b], bankAccountId: w.accB, lines: [{ description: 'Makan', total: 150_000, categoryId: w.cat.ksm }] }))
    reimburse = r.body.id
    const img = await upload('/api/v1/media/receipts', w.users.staffB, await png())
    expect(
      (await api('POST', `${E}/${reimburse}/receipts`, w.users.staffB, { lineId: r.body.lines[0].id, receiptNo: `S2B-N-${reimburse}`, vendorName: 'Warung Contoh', receiptDate: addDays(today, -1), amount: 150_000, imageId: img.body.id })).status,
    ).toBe(201)
    expect((await api('POST', `${E}/${reimburse}/submit`, w.users.staffB, {})).status).toBe(200)
    expect((await api('POST', `${E}/${reimburse}/acknowledge`, w.users.owner, {})).status).toBe(200)
    expect((await api('POST', `${E}/${reimburse}/approve`, w.users.finance, {})).status).toBe(200)
    const d = (await api('GET', `${E}/${reimburse}`, w.users.finance)).body
    const rj = await api('POST', `${E}/${reimburse}/receipts/${d.receipts[0].id}/reject`, w.users.finance, { reason: 'nota buram' })
    expect(rj.body.status).toBe('receipt_revision')
  })

  const owners = async () => (await sqlAs('app', "SELECT DISTINCT u.id FROM users u JOIN users_roles r ON r.parent_id = u.id WHERE r.value = 'pk-owner' AND coalesce(u.active, true) ORDER BY u.id")).rows.map((x) => Number(x.id))
  const finance = async () => (await sqlAs('app', "SELECT DISTINCT u.id FROM users u JOIN users_roles r ON r.parent_id = u.id WHERE r.value = 'pk-finance' AND coalesce(u.active, true) ORDER BY u.id")).rows.map((x) => Number(x.id))

  it('before the configured hour / disabled → nothing', async () => {
    const p = await getTestPayload()
    expect((await runDailyReminders(p, { now: atWita(addDays(today, 4), '06:59') })).status).toBe('before_hour')
    await setSettings({ remindersEnabled: false })
    expect((await runDailyReminders(p, { now: atWita(addDays(today, 4), '08:00') })).status).toBe('disabled')
    await setSettings({ remindersEnabled: true })
    expect(await notifs('progress.late_report', w.project)).toEqual([])
  })

  it('day +1: revision (1 day) and late progress (1 day) are not due yet; LPJ overdue is', async () => {
    const p = await getTestPayload()
    const r = await runDailyReminders(p, { now: atWita(addDays(today, 1), '07:05') })
    expect(r.status).toBe('run')
    expect(await notifs('reminder.revision_pending', reimburse)).toEqual([])
    expect(await notifs('progress.late_report', w.project)).toEqual([])
    const lpj = await notifs('reminder.lpj_overdue', advance)
    expect(users(lpj)).toEqual([...new Set([w.users.staffA.id, ...(await finance())])].sort((a, b) => a - b))
    expect(lpj[0]!.title).toMatch(/^LPJ terlambat: \d+\/PB-/)
    // same day again: the run marker stops the tick
    expect((await runDailyReminders(p, { now: atWita(addDays(today, 1), '09:05') })).status).toBe('already_ran')
  })

  it('day +4: exactly one notification per recipient per rule; inactive users and archived projects get nothing; forced re-run adds nothing', async () => {
    const p = await getTestPayload()
    const now = atWita(addDays(today, 4), '07:30')
    const r = await runDailyReminders(p, { now })
    expect(r.status).toBe('run')
    const late = await notifs('progress.late_report', w.project)
    expect(users(late)).toEqual([...new Set([w.users.pm.id, ...(await owners())])].sort((a, b) => a - b))
    expect(users(late)).not.toContain(offOwner.id)
    expect(await notifs('progress.late_report', archived)).toEqual([])
    const rev = await notifs('reminder.revision_pending', reimburse)
    expect(users(rev)).toEqual([w.users.staffB.id])
    expect(rev[0]!.title).toMatch(/^Revisi menunggu:/)
    const lpj = await notifs('reminder.lpj_overdue', advance)
    expect(lpj.filter((x) => x.user_id === w.users.staffA.id)).toHaveLength(2) // day +1 and day +4, one each
    // forced re-run on the same day: deliveries are de-duplicated
    const again = await runDailyReminders(p, { now, force: true })
    expect(again.status).toBe('run')
    expect(await notifs('progress.late_report', w.project)).toHaveLength(late.length)
    expect(await notifs('reminder.revision_pending', reimburse)).toHaveLength(1)
    const dup = await sqlAs('app', "SELECT user_id, count(*)::int AS n FROM notifications WHERE event = 'reminder.lpj_overdue' AND doc_id = $1 GROUP BY user_id HAVING count(*) > 2", [String(advance)])
    expect(dup.rows).toEqual([])
    expect(await notifs('reminder.lpj_overdue', advance)).not.toContainEqual(expect.objectContaining({ user_id: offOwner.id }))
  })

  it('budget threshold: once per threshold per project (not per day), Direktur + Finance + PM; email only when enabled', async () => {
    const p = await getTestPayload()
    const committed = Number((await sqlAs('app', "SELECT coalesce(sum(grand_total), 0) AS s FROM expense_requests WHERE project_id = $1 AND status::text NOT IN ('draft','rejected','cancelled','pending_ack','pending_approval')", [w.project])).rows[0].s)
    expect(committed).toBeGreaterThan(0)
    const budgetFor = (pct: number) => Math.floor((committed * 100) / pct)
    await p.update({ collection: 'projects', id: w.project, data: { budget: budgetFor(90) }, overrideAccess: true /* SYSTEM-WRITE: fixture RAB */, context: { auditReason: 'uji ambang anggaran' } })
    await setSettings({ reminderEmailEnabled: true, reminderLateProgressEnabled: false, reminderLpjOverdueEnabled: false, reminderRevisionEnabled: false })
    const jobsBefore = Number((await sqlAs('app', "SELECT count(*)::int AS n FROM payload_jobs WHERE task_slug = 'sendEmail'")).rows[0].n)
    await runDailyReminders(p, { now: atWita(addDays(today, 5), '08:00') })
    const b1 = await notifs('reminder.budget_threshold', w.project)
    const expected = [...new Set([w.users.pm.id, ...(await owners()), ...(await finance())])].sort((a, b) => a - b)
    expect(users(b1)).toEqual(expected)
    expect(b1[0]!.title).toMatch(/≥ 85%/)
    const jobs = await sqlAs('app', "SELECT input FROM payload_jobs WHERE task_slug = 'sendEmail' ORDER BY id")
    expect(jobs.rows.length - jobsBefore).toBe(expected.length)
    expect(jobs.rows.at(-1)!.input).toMatchObject({ subject: expect.stringMatching(/Anggaran/) })
    expect(JSON.stringify(jobs.rows.at(-1)!.input)).not.toMatch(/@/) // user id only, no address
    // next day, same level → nothing new
    await runDailyReminders(p, { now: atWita(addDays(today, 6), '08:00') })
    expect(await notifs('reminder.budget_threshold', w.project)).toHaveLength(expected.length)
    // RAB lowered → commitment ≥ 100% → one more (the 100% threshold)
    await p.update({ collection: 'projects', id: w.project, data: { budget: budgetFor(110) }, overrideAccess: true /* SYSTEM-WRITE: fixture RAB */, context: { auditReason: 'uji ambang anggaran' } })
    await runDailyReminders(p, { now: atWita(addDays(today, 7), '08:00') })
    const b2 = await notifs('reminder.budget_threshold', w.project)
    expect(b2).toHaveLength(expected.length * 2)
    expect(b2.at(-1)!.title).toMatch(/≥ 100%/)
    await setSettings({ reminderEmailEnabled: false, reminderLateProgressEnabled: true, reminderLpjOverdueEnabled: true, reminderRevisionEnabled: true })
  })

  it('reminder tables are append-only for the app role; settings are range-checked', async () => {
    expect(await sqlError('app', 'UPDATE reminder_deliveries SET period_key = period_key')).toMatchObject({ code: '42501' })
    expect(await sqlError('app', 'DELETE FROM reminder_deliveries')).toMatchObject({ code: '42501' })
    expect(await sqlError('app', 'UPDATE company_settings SET reminder_hour = 24')).toMatchObject({ code: '23514' })
    const p = await getTestPayload()
    await expect(p.updateGlobal({ slug: 'company-settings', data: { reminderHour: 25 } as never, overrideAccess: true /* SYSTEM-WRITE: test */ })).rejects.toThrow()
  })
})

// ================================================================ E6 web authz (masters + helpers)

describe('E6 web: masters edited from /admin/absensi/jadwal keep collection access', () => {
  it('PM / Finance / Staff cannot change geofence, schedules or holidays; Admin can (audited)', async () => {
    const body = { lat: -2.5, lng: 114.2, radiusM: 150 }
    for (const u of [w.users.pm, w.users.finance, w.users.staffA]) {
      const r = await api('PATCH', `/api/cost-centers/${w.costCenter}?depth=0`, u, body)
      expect([403, 404], `${u.email} ${r.status}`).toContain(r.status)
    }
    const ok = await api('PATCH', `/api/cost-centers/${w.costCenter}?depth=0`, w.users.admin, body)
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    const audit = await sqlAs('app', "SELECT field FROM audit_logs WHERE doc_type = 'cost_center' AND doc_id = $1 AND action = 'update' ORDER BY id", [String(w.costCenter)])
    expect(audit.rows.map((x) => x.field)).toEqual(expect.arrayContaining(['lat', 'lng', 'radiusM']))

    expect((await api('POST', '/api/holidays?depth=0', w.users.finance, { date: '2031-01-02', name: 's2b libur uji' })).status).toBe(403)
    expect((await api('POST', '/api/holidays?depth=0', w.users.admin, { date: '2031-01-02', name: 's2b libur uji' })).status).toBe(201)
    expect((await api('PATCH', `/api/employees/${w.emp.a}?depth=0`, w.users.pm, { workSchedule: null })).status).toBe(403)
    expect((await api('POST', '/api/globals/company-settings?depth=0', w.users.pm, { defaultWorkSchedule: null })).status).toBe(403)
  })

  it('helpers: nobody corrects own attendance; a PM lists only team members', async () => {
    const own = await asUser(w.users.pm, async (req) => mayCorrect(req, { kind: 'team', projects: [w.project], costCenters: [] }, w.emp.pm))
    expect(own).toBe(false)
    const other = await asUser(w.users.pm, async (req) => mayCorrect(req, { kind: 'team', projects: [w.project], costCenters: [] }, w.emp.a))
    expect(other).toBe(true)
    expect(await asUser(w.users.finance, async (req) => mayCorrect(req, { kind: 'all' }, w.emp.a))).toBe(false)
    const list = await asUser(w.users.otherPm, (req) => recapEmployees(req, { kind: 'team', projects: [w.otherProject], costCenters: [] }, `${today.slice(0, 7)}-01`, today))
    expect(list.map((x) => x.id)).not.toContain(w.emp.a)
    // Staff: correction endpoint is closed; others' selfies stay hidden (404, no existence leak)
    const staffCorrect = await api('POST', `/api/v1/attendance/1/correct`, w.users.staffB, { new_time: new Date().toISOString(), reason: 'uji staff' })
    expect(staffCorrect.status).toBe(403)
  })
})
