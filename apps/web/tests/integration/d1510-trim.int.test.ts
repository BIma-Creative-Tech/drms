import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { drizzle } from 'drizzle-orm/node-postgres'
import { PgDialect } from 'drizzle-orm/pg-core'
import { createLocalReq, type PayloadRequest } from 'payload'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { loadRequestPanel } from '@/admin/components/request/panel-data'
import { resetRateLimits } from '@/lib/rate-limit'
import { down, up } from '@/migrations/20261015_210000_d1510_approval_inflight_trim'
import type { Exec } from '@/reroute/db'
import { applyInflightTrim, planInflightTrim } from '@/reroute/trim-db'
import { payloadFinalizer } from '@/reroute/trim-finalize'
import { PM_LEGACY_DECIDED, TRIM_MIGRATION, TRIM_NOTE, type TrimResult } from '@/reroute/trim-plan'

import { companyId, getTestPayload, sqlAs } from './helpers'
import { api, draftBody, makeFlowUser, makeWorld, sysCreate, type FlowUser, type World } from './flow-world'

/**
 * d1510 in-flight trim (owner decision 2026-10-15, migration 20261015_210000) through the real DB + API: requests whose
 * snapshot still has an undecided Finance approval level — case 1 (Owner waiting, Finance after it: dropped; then the
 * Owner approves → straight into the Finance transfer queue), the same still waiting for the Direktur, case 2 (Finance
 * waiting, no Owner level → Owner level, Owners notified), case 3 (Owner approved, Finance waiting → "Disetujui"
 * through the app's finalisation, refused by the fund check → kept); a draft and an approved request untouched; the
 * read-only dry-run and the SQL preview agree; idempotent; down restores and is refused once a request moved.
 * The migration runs like `payload migrate`: ONE owner transaction, the Payload req bound to it. Fictional data only.
 */
let w: World
let drms: number
let principal: FlowUser
let ruleX: number
const req: Record<'A' | 'A2' | 'B' | 'C' | 'Dr' | 'Ap', number> = { A: 0, A2: 0, B: 0, C: 0, Dr: 0, Ap: 0 }
const before: Record<number, { snap: { steps: unknown[] }; status: string; level: number | null; hash: string | null; docNo: string | null; total: string }> = {}
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })
const OWNER_URL = () => process.env.PK_TEST_DATABASE_URL_OWNER

class Rollback extends Error {}

type MigrationArgs = { db: Exec; payload: Awaited<ReturnType<typeof getTestPayload>> | undefined; req: PayloadRequest | undefined }

/**
 * Like `payload migrate`: ONE owner connection + transaction, the Payload req bound to it (a session of the Payload db
 * adapter whose drizzle runs on that connection) — Local API calls of the migration join the same transaction.
 */
async function asOwnerPayload<T>(mode: 'commit' | 'rollback', fn: (args: MigrationArgs & { c: pg.Client }) => Promise<T>): Promise<T> {
  const payload = await getTestPayload()
  const adapter = payload.db as unknown as { schema: Record<string, unknown>; sessions: Record<string, unknown> }
  const c = new pg.Client({ connectionString: OWNER_URL() })
  await c.connect()
  const d = drizzle({ client: c, schema: adapter.schema } as never) as unknown as { transaction: <R>(f: (tx: Exec) => Promise<R>) => Promise<R> }
  const r = await createLocalReq({}, payload)
  const id = randomUUID()
  let out: T | undefined
  try {
    await d.transaction(async (tx) => {
      adapter.sessions[id] = { db: tx, resolve: async () => undefined, reject: async () => undefined }
      r.transactionID = id
      try {
        out = await fn({ db: tx, payload, req: r, c })
      } finally {
        delete adapter.sessions[id]
        delete r.transactionID
      }
      if (mode === 'rollback') throw new Rollback()
    })
  } catch (err) {
    if (!(err instanceof Rollback)) throw err
  } finally {
    await c.end()
  }
  return out as T
}

/** A plain owner transaction (no Payload) — the dry-run / the SQL preview. */
async function asOwner<T>(mode: 'rollback' | 'read-only', fn: (db: Exec, c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: OWNER_URL() })
  await c.connect()
  const dialect = new PgDialect()
  const db: Exec = {
    execute: async (q) => {
      const x = dialect.sqlToQuery(q as never)
      return c.query(x.sql, x.params as unknown[])
    },
  }
  try {
    await c.query(mode === 'read-only' ? 'BEGIN READ ONLY' : 'BEGIN')
    return await fn(db, c)
  } finally {
    await c.query('ROLLBACK').catch(() => undefined)
    await c.end()
  }
}

async function submitted(creator: FlowUser, body: Record<string, unknown>): Promise<number> {
  const c = await api('POST', E, creator, body, key())
  expect(c.status, JSON.stringify(c.body)).toBe(201)
  const s = await api('POST', `${E}/${c.body.id}/submit`, creator, {}, key())
  expect(s.status, JSON.stringify(s.body)).toBe(200)
  return c.body.id as number
}

const requestRow = async (id: number) =>
  (
    await sqlAs(
      'app',
      'SELECT status::text AS status, current_level::int AS level, approval_snapshot AS snap, content_hash AS hash, doc_no, grand_total::text AS total, approved_amount::text AS approved, approved_at FROM expense_requests WHERE id = $1',
      [id],
    )
  ).rows[0]
const roles = (snap: { steps: Array<{ level: number; approverRole: string }> }) => snap.steps.map((s) => `${s.level}:${s.approverRole}`)
const trimAudits = async () => Number((await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE new_value -> 'v' ->> 'migration' = $1", [TRIM_MIGRATION])).rows[0].n)
const inboxItem = async (u: FlowUser, id: number) => (await api('GET', '/api/v1/approvals/inbox', u)).body.items.find((i: { id: number }) => i.id === id)
const mine = (r: TrimResult) => r.plans.filter((p) => Object.values(req).includes(p.id))
const planOf = (r: TrimResult, id: number) => r.plans.find((p) => p.id === id)

beforeAll(async () => {
  w = await makeWorld('TRM') // world rules (priority 10): "Diketahui" Direktur → L1 Finance (≤ 10 jt)
  drms = await companyId()
  principal = await makeFlowUser(['pk-principal'], 'trm-principal', null)
  // the ADR 0013 + Owner shape (prod 0.11.0): "Diketahui" Direktur → L1 Owner → L2 Finance — scoped to the world project
  ruleX = await sysCreate('approval-rules', {
    company: drms,
    name: 'TRM uji — Direktur, Owner lalu Finance',
    docType: 'expense_request',
    requestType: 'any',
    acknowledge: 'required',
    acknowledgeBy: 'role',
    acknowledgeRole: 'pk-owner',
    minAmount: 0,
    priority: 5,
    project: w.project,
    active: true,
    steps: [
      { level: 1, approverRole: 'pk-principal' },
      { level: 2, approverRole: 'pk-finance' },
    ],
  })
  const ack = async (id: number) => expect((await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {}, key())).body.status).toBe('pending_approval')
  // A: Owner waiting (Finance after) · A2: still waiting for the Direktur · C: the Owner approved, Finance waiting
  req.A = await submitted(w.users.staffA, draftBody(w, { title: 'TRM A' }))
  await ack(req.A)
  req.A2 = await submitted(w.users.staffA, draftBody(w, { title: 'TRM A2' }))
  req.C = await submitted(w.users.staffA, draftBody(w, { title: 'TRM C' }))
  await ack(req.C)
  const own = await api('POST', `${E}/${req.C}/approve`, principal, {}, key())
  expect(own.body, JSON.stringify(own.body)).toMatchObject({ status: 'pending_approval', currentLevel: 2 })
  await sqlAs('owner', 'UPDATE approval_rules SET active = false WHERE id = $1', [ruleX])
  // B: ADR 0013 — Finance waiting, no Owner level · Ap: approved by Finance (untouched) · Dr: a draft (untouched)
  req.B = await submitted(w.users.staffA, draftBody(w, { title: 'TRM B' }))
  await ack(req.B)
  req.Ap = await submitted(w.users.staffA, draftBody(w, { title: 'TRM Ap' }))
  await ack(req.Ap)
  expect((await api('POST', `${E}/${req.Ap}/approve`, w.users.finance, {}, key())).body.status).toBe('approved')
  req.Dr = (await api('POST', E, w.users.staffA, draftBody(w, { title: 'TRM Dr' }), key())).body.id as number
  for (const id of Object.values(req)) {
    const r = await requestRow(id)
    before[id] = { snap: r.snap, status: r.status, level: r.level, hash: r.hash, docNo: r.doc_no, total: r.total }
  }
  expect([before[req.A]!.status, before[req.A2]!.status, before[req.B]!.status, before[req.C]!.status]).toEqual(['pending_approval', 'pending_ack', 'pending_approval', 'pending_approval'])
  expect((await inboxItem(w.users.finance, req.B))?.step).toBe('approve') // today: Finance approves B
}, 600_000)

beforeEach(() => resetRateLimits())

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

describe('d1510 trim: dry-run (read-only) and SQL preview', () => {
  let plan: TrimResult
  it('the TS dry-run lists every case, writes nothing', async () => {
    const audits = await trimAudits()
    plan = await asOwner('read-only', (db) => planInflightTrim(db))
    expect(planOf(plan, req.A)).toMatchObject({ kind: 'trim', dropped: [2], newStatus: 'pending_approval', newLevel: 1, waiting: 'Persetujuan Owner', pm: PM_LEGACY_DECIDED })
    expect(planOf(plan, req.A2)).toMatchObject({ kind: 'trim', newStatus: 'pending_ack', waiting: 'Diketahui Direktur' })
    expect(planOf(plan, req.B)).toMatchObject({ kind: 'owner', replaced: 1, newLevel: 1, waiting: 'Persetujuan Owner', pm: PM_LEGACY_DECIDED })
    expect(planOf(plan, req.C)).toMatchObject({ kind: 'final', newStatus: 'approved', newLevel: 1 })
    expect(planOf(plan, req.Ap)).toBeUndefined()
    expect(planOf(plan, req.Dr)).toBeUndefined()
    // skip = the requests 20261015_200000 re-routes first (dry-run before it ran)
    expect(planOf(await asOwner('read-only', (db) => planInflightTrim(db, { skip: new Set([req.A2]) })), req.A2)).toBeUndefined()
    expect(await trimAudits()).toBe(audits)
    for (const id of Object.values(req)) expect((await requestRow(id)).snap).toEqual(before[id]!.snap)
  })

  it('the SQL preview (psql) predicts the same outcome / new levels / waiting position', async () => {
    const text = readFileSync(path.join(__dirname, '../../src/reroute/preview-trim.sql'), 'utf8')
    const rows = (await asOwner('read-only', async (_db, c) => c.query(text))).rows as Array<Record<string, unknown>>
    const tag = { trim: 'POTONG', owner: 'OWNER', final: 'SETUJU', keep: 'TETAP' } as const
    for (const tp of mine(plan)) {
      const sq = rows.find((x) => Number(x.request_id) === tp.id)!
      expect(sq, `request ${tp.id}`).toBeDefined()
      expect(sq.prediksi).toBe(tag[tp.kind])
      expect([sq.status_baru, sq.menunggu, sq.level_baru_peran]).toEqual([tp.newStatus, tp.waiting, tp.newSnapshot!.steps.map((s) => s.approverRole).join(' → ')])
    }
    expect(rows.some((x) => [req.Ap, req.Dr].includes(Number(x.request_id)))).toBe(false)
  })
})

describe('migration 20261015_210000_d1510_approval_inflight_trim', () => {
  it('case 3 refused by the fund check (ADR 0029, rolled back here): kept and listed, nothing approved', async () => {
    await asOwnerPayload('rollback', async ({ db, req: r, c }) => {
      await c.query('UPDATE companies SET fund_check_enabled = true WHERE id = $1', [drms])
      await c.query('UPDATE cash_accounts SET active = false WHERE company_id = $1', [drms])
      const res = await applyInflightTrim(db, { finalizer: payloadFinalizer(r!) })
      expect(planOf(res, req.C)).toMatchObject({ kind: 'keep', reason: expect.stringContaining('cek dana') })
      expect((await c.query('SELECT status::text AS s, approval_snapshot AS snap FROM expense_requests WHERE id = $1', [req.C])).rows[0]).toEqual({ s: 'pending_approval', snap: before[req.C]!.snap })
      expect(planOf(res, req.A)).toMatchObject({ kind: 'trim' }) // the others still go
    })
  })

  it('without Payload (no finaliser) case 3 is kept; down (rolled back) restores the trimmed snapshots', async () => {
    await asOwnerPayload('rollback', async ({ db, c }) => {
      const res = await applyInflightTrim(db)
      expect(planOf(res, req.C)).toMatchObject({ kind: 'keep', reason: expect.stringContaining('payload migrate') })
      const q = async (id: number) => (await c.query('SELECT status::text AS status, current_level::int AS level, approval_snapshot AS snap FROM expense_requests WHERE id = $1', [id])).rows[0]
      expect(roles((await q(req.A)).snap)).toEqual(['1:pk-principal'])
      await down({ db, payload: undefined } as never)
      for (const id of [req.A, req.A2, req.B, req.C]) expect(await q(id)).toEqual({ status: before[id]!.status, level: before[id]!.level, snap: before[id]!.snap })
    })
    expect((await requestRow(req.A)).snap).toEqual(before[req.A]!.snap) // rolled back
  })

  it('up (like payload migrate): cases 1–3 applied, audit + stepper note + notifications, untouched rows, idempotent', async () => {
    const lastNotification = Number((await sqlAs('app', 'SELECT coalesce(max(id), 0)::int AS m FROM notifications')).rows[0].m)
    await asOwnerPayload('commit', ({ db, payload, req: r }) => up({ db, payload, req: r } as never))

    // case 1: the Finance level is gone, the Owner still waits; content, number and amounts unchanged
    const a = await requestRow(req.A)
    expect(a).toMatchObject({ status: 'pending_approval', level: 1, hash: before[req.A]!.hash, doc_no: before[req.A]!.docNo, total: before[req.A]!.total })
    expect(roles(a.snap)).toEqual(['1:pk-principal'])
    expect(a.snap.decisionRoles).not.toContain('pk-finance')
    const audit = (await sqlAs('app', "SELECT reason, old_value -> 'v' ->> 'alur' AS old, new_value -> 'v' ->> 'alur' AS neu, new_value -> 'v' ->> 'pm' AS pm FROM audit_logs WHERE doc_type = 'expense_request' AND doc_id = $1 AND field = 'approvalFlow'", [String(req.A)])).rows
    expect(audit).toEqual([{ reason: expect.stringContaining(TRIM_NOTE), old: 'Direktur (Diketahui) → Owner → Finance', neu: 'Direktur (Diketahui) → Owner', pm: PM_LEGACY_DECIDED }])
    const panel = (await loadRequestPanel(await getTestPayload(), { ...w.users.staffA, collection: 'users' } as never, req.A))!
    expect(panel.stepperNote).toBe(`${TRIM_NOTE} · ${PM_LEGACY_DECIDED}`)
    expect(panel.stepper.steps.map((s) => s.title)).not.toContain('Approval Finance')
    expect(panel.history.some((h) => h.field === 'Alur persetujuan' && h.reason?.includes('keputusan owner 2026-10-15'))).toBe(true)
    expect(roles((await requestRow(req.A2)).snap)).toEqual(['1:pk-principal'])
    expect((await requestRow(req.A2)).status).toBe('pending_ack')

    // case 2: Finance level → Owner level, the Owner is asked (in-app), Finance no longer
    const b = await requestRow(req.B)
    expect(b).toMatchObject({ status: 'pending_approval', level: 1 })
    expect(roles(b.snap)).toEqual(['1:pk-principal'])
    expect(await inboxItem(principal, req.B)).toMatchObject({ step: 'approve', stepLabel: 'Persetujuan Owner' })
    expect(await inboxItem(w.users.finance, req.B)).toBeUndefined()
    const sent = (await sqlAs('app', 'SELECT user_id::int AS u, doc_id, event, title FROM notifications WHERE id > $1 AND doc_id = ANY($2) ORDER BY id', [lastNotification, [String(req.B), String(req.C)]])).rows
    expect(sent).toContainEqual({ u: principal.id, doc_id: String(req.B), event: 'expense.pending_approval', title: `Persetujuan Owner: ${before[req.B]!.docNo}` })

    // case 3: "Disetujui" through the app's finalisation — approved amount / time, status audit, Finance transfer queue
    const c = await requestRow(req.C)
    expect(c).toMatchObject({ status: 'approved', level: 1 })
    expect(Number(c.approved)).toBe(Number(before[req.C]!.total))
    expect(c.approved_at).not.toBeNull()
    expect(roles(c.snap)).toEqual(['1:pk-principal'])
    const st = (await sqlAs('app', "SELECT status_from, status_to, reason FROM audit_logs WHERE doc_type = 'expense_request' AND doc_id = $1 AND action::text = 'status_change' ORDER BY id DESC LIMIT 1", [String(req.C)])).rows[0]
    expect(st).toMatchObject({ status_from: 'pending_approval', status_to: 'approved', reason: expect.stringContaining(TRIM_NOTE) })
    expect(sent.some((x) => x.doc_id === String(req.C) && x.event === 'expense.transfer_queue' && x.u === w.users.finance.id)).toBe(true)
    expect((await api('GET', '/api/v1/transfer-queue', w.users.finance)).body.items.find((i: { id: number }) => i.id === req.C)).toBeDefined()
    expect(Number((await sqlAs('app', "SELECT count(*)::int AS n FROM approvals WHERE request_id = $1 AND position::text = 'approval' AND decision::text = 'approved'", [req.C])).rows[0].n)).toBe(1) // no Finance approval

    // untouched: the approved request and the draft
    for (const id of [req.Ap, req.Dr]) expect(await requestRow(id)).toMatchObject({ snap: before[id]!.snap, status: before[id]!.status })

    // idempotent: a second run changes nothing
    const n = await trimAudits()
    await asOwnerPayload('commit', ({ db, payload, req: r }) => up({ db, payload, req: r } as never))
    expect(await trimAudits()).toBe(n)
    expect(mine(await asOwner('read-only', (db) => planInflightTrim(db)))).toEqual([])
  })

  it('case 1 then runs to the end: Finance cannot approve, the Owner approves → transfer queue; down is then refused', async () => {
    expect((await api('POST', `${E}/${req.A}/approve`, w.users.finance, {}, key())).status).toBe(403)
    const own = await api('POST', `${E}/${req.A}/approve`, principal, {}, key())
    expect(own.body, JSON.stringify(own.body)).toMatchObject({ status: 'approved' })
    expect((await api('GET', '/api/v1/transfer-queue', w.users.finance)).body.items.find((i: { id: number }) => i.id === req.A)).toBeDefined()
    const b = await api('POST', `${E}/${req.B}/approve`, principal, {}, key())
    expect(b.body, JSON.stringify(b.body)).toMatchObject({ status: 'approved' })
    await expect(asOwnerPayload('rollback', ({ db }) => down({ db, payload: undefined } as never))).rejects.toThrow(/DITOLAK/)
  })
})
