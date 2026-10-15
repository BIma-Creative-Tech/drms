import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { PgDialect } from 'drizzle-orm/pg-core'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { loadRequestPanel } from '@/admin/components/request/panel-data'
import { DIREKTUR_RULE_NAME, OWNER_RULE_NAME } from '@/seed/data'
import { resetRateLimits } from '@/lib/rate-limit'
import { down, up } from '@/migrations/20261015_200000_d1510_approval_reroute'
import { planReroute, type Exec } from '@/reroute/db'
import { canonicalJson, MIGRATION, REROUTE_NOTE, RULE_RENAMES, type ReroutePlan } from '@/reroute/plan'

import { companyId, getTestPayload, sqlAs } from './helpers'
import { ADR0013_FALLBACK_RULE, api, draftBody, makeFlowUser, makeWorld, sysCreate, type FlowUser, type World } from './flow-world'

/**
 * d1510 — owner decision 2026-10-15 through the real DB + API: the old default rules (ADR 0013 + Owner shape, and the
 * pre-Owner inactive example) of a PT are aligned to PM project → Direktur → Owner; requests still waiting for the
 * Direktur's "Diketahui" are re-routed to exactly the snapshot a submit produces today (a twin request submitted after
 * the migration has the same snapshot), the G1 skip of the PM step and the requester-role rules apply, a request the
 * Direktur already decided is untouched; audit + notification of the new first approver; the read-only dry-run and the
 * SQL preview agree with the migration; idempotent; down restores and is refused once a request moved. The PM then
 * approves, the Direktur, the Owner → Finance transfer queue. Fictional data only.
 */
let w: World
let drms: number
let principal: FlowUser
let dirReq: FlowUser
let ownReq: FlowUser
let accPm: number
let accDir: number
let accOwn: number
let dirEmp: number
let ownEmp: number
let defRule: number
let exRule: number
let customRule: number
const req: Record<'A' | 'B' | 'C' | 'D' | 'E', number> = { A: 0, B: 0, C: 0, D: 0, E: 0 }
const before: Record<number, { snap: unknown; status: string; rule: number; hash: string | null; docNo: string; total: string }> = {}
const E = '/api/v1/expense-requests'
const OLD_DEFAULT = RULE_RENAMES[0]!.from
const OLD_EXAMPLE = RULE_RENAMES[1]!.from
const key = () => ({ 'Idempotency-Key': randomUUID() })

/** Runs `fn` on ONE owner connection (like `payload migrate`) in a transaction — committed, rolled back or read-only. */
async function asOwner<T>(mode: 'commit' | 'rollback' | 'read-only', fn: (db: Exec, c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: process.env.PK_TEST_DATABASE_URL_OWNER })
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
    const r = await fn(db, c)
    await c.query(mode === 'commit' ? 'COMMIT' : 'ROLLBACK')
    return r
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
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
  (await sqlAs('app', 'SELECT status::text AS status, current_level::int AS level, approval_rule_id AS rule, approval_snapshot AS snap, content_hash AS hash, doc_no, grand_total::text AS total FROM expense_requests WHERE id = $1', [id])).rows[0]
const ruleRow = async (id: number) =>
  (
    await sqlAs(
      'app',
      `SELECT r.name, r.active, r.acknowledge::text AS ack, r.acknowledge_by::text AS ack_by, r.acknowledge_role::text AS ack_role,
              coalesce((SELECT array_agg(s.approver_role::text ORDER BY s.level) FROM approval_rules_steps s WHERE s._parent_id = r.id), '{}') AS steps
         FROM approval_rules r WHERE r.id = $1`,
      [id],
    )
  ).rows[0]
const migrationAudit = async () => Number((await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE new_value -> 'v' ->> 'migration' = $1", [MIGRATION])).rows[0].n)
const inboxItem = async (u: FlowUser, id: number) => (await api('GET', '/api/v1/approvals/inbox', u)).body.items.find((i: { id: number }) => i.id === id)

beforeAll(async () => {
  w = await makeWorld('RRT')
  drms = await companyId()
  // the world's own rules (priority 10, scoped) would win — this file drives requests through "the old default"
  await sqlAs('app', "UPDATE approval_rules SET active = false WHERE name LIKE 'RRT rule %'")
  const bank = (await sqlAs('app', "SELECT id FROM banks WHERE code = 'MANDIRI'")).rows[0].id as number
  principal = await makeFlowUser(['pk-principal'], 'rrt-principal', null)
  dirEmp = await sysCreate('employees', { code: 'RRT-DIR', name: 'RRT Direktur Pemohon' })
  dirReq = await makeFlowUser(['pk-owner'], 'rrt-dir-req', dirEmp)
  ownEmp = await sysCreate('employees', { code: 'RRT-OWN', name: 'RRT Owner Pemohon' })
  ownReq = await makeFlowUser(['pk-principal'], 'rrt-own-req', ownEmp)
  accPm = await sysCreate('employee-bank-accounts', { employee: w.emp.pm, bank, accountNo: `6${Date.now() % 1e9}1`, accountHolder: 'RRT PM', isDefault: true, verificationStatus: 'verified' })
  accDir = await sysCreate('employee-bank-accounts', { employee: dirEmp, bank, accountNo: `6${Date.now() % 1e9}2`, accountHolder: 'RRT Direktur', isDefault: true, verificationStatus: 'verified' })
  accOwn = await sysCreate('employee-bank-accounts', { employee: ownEmp, bank, accountNo: `6${Date.now() % 1e9}3`, accountHolder: 'RRT Owner', isDefault: true, verificationStatus: 'verified' })

  // prod as of 0.11.0: the old default (ADR 0013 + Owner: Direktur "Diketahui" → Owner → Finance) and the inactive
  // pre-Owner example — here scoped to the world project so no other test file is affected
  const base = { company: drms, docType: 'expense_request', requestType: 'any', acknowledge: 'required', acknowledgeBy: 'role', acknowledgeRole: 'pk-owner' }
  defRule = await sysCreate('approval-rules', { ...base, name: OLD_DEFAULT, minAmount: 0, priority: 15, project: w.project, active: true, steps: [{ level: 1, approverRole: 'pk-principal' }, { level: 2, approverRole: 'pk-finance' }] })
  exRule = await sysCreate('approval-rules', { ...base, name: OLD_EXAMPLE, minAmount: 10_000_001, priority: 14, project: w.project, active: false, steps: [{ level: 1, approverRole: 'pk-finance' }] })
  // an Admin changed this one (two Finance levels): left alone
  customRule = await sysCreate('approval-rules', { ...base, name: OLD_DEFAULT, minAmount: 0, priority: 15, project: w.otherProject, active: false, steps: [{ level: 1, approverRole: 'pk-finance' }, { level: 2, approverRole: 'pk-finance' }] })

  // A: Staff request · B: the PM's own request · C: Staff request the Direktur already approved ("Diketahui")
  req.A = await submitted(w.users.staffA, draftBody(w, { title: 'RRT A' }))
  req.B = await submitted(w.users.pm, draftBody(w, { requesterIds: [w.emp.pm], bankAccountId: accPm, title: 'RRT B' }))
  req.C = await submitted(w.users.staffA, draftBody(w, { title: 'RRT C' }))
  const ack = await api('POST', `${E}/${req.C}/acknowledge`, w.users.owner, {}, key())
  expect(ack.body.status, JSON.stringify(ack.body)).toBe('pending_approval')
  // D / E: a Direktur's / the Owner's own request submitted while their rules did not exist yet (before 0.10 / 0.11)
  const off = (await sqlAs('owner', 'UPDATE approval_rules SET active = false WHERE company_id = $1 AND name = ANY($2) AND active RETURNING id', [drms, [DIREKTUR_RULE_NAME, OWNER_RULE_NAME]])).rows.map((r) => r.id as number)
  try {
    req.D = await submitted(dirReq, draftBody(w, { requesterIds: [dirEmp], bankAccountId: accDir, title: 'RRT D' }))
    req.E = await submitted(ownReq, draftBody(w, { requesterIds: [ownEmp], bankAccountId: accOwn, title: 'RRT E' }))
  } finally {
    await sqlAs('owner', 'UPDATE approval_rules SET active = true WHERE id = ANY($1)', [off])
  }
  for (const id of Object.values(req)) {
    const r = await requestRow(id)
    expect(r.rule, `request ${id}`).toBe(defRule)
    before[id] = { snap: r.snap, status: r.status, rule: r.rule, hash: r.hash, docNo: r.doc_no, total: r.total }
  }
  for (const id of [req.A, req.B, req.D, req.E]) expect(before[id]!.status).toBe('pending_ack')
}, 600_000)

beforeEach(() => resetRateLimits())

afterAll(async () => {
  // the renamed rules carry the seed names in DRMS — rename + deactivate them so later files never meet two of a name
  await sqlAs('owner', "UPDATE approval_rules SET active = false, name = 'RRT uji d1510 #' || id::text WHERE id = ANY($1)", [[defRule, exRule, customRule]])
  await (await getTestPayload()).destroy()
})

describe('d1510 dry-run (read-only) and SQL preview', () => {
  let plan: ReroutePlan
  it('the TS dry-run lists the rule alignment and the re-route, writes nothing', async () => {
    const audits = await migrationAudit()
    plan = await asOwner('read-only', (db) => planReroute(db))
    const rule = (id: number) => plan.rules.find((r) => r.rule.id === id)
    expect(rule(defRule)).toMatchObject({ action: 'align', shape: 'adr0013_owner', to: RULE_RENAMES[0]!.to })
    expect(rule(exRule)).toMatchObject({ action: 'align', shape: 'adr0013', to: RULE_RENAMES[1]!.to })
    expect(rule(customRule)).toMatchObject({ action: 'skip' })
    expect(plan.warnings.some((x) => x.includes(ADR0013_FALLBACK_RULE))).toBe(true) // an Admin's own rule: reported only
    const p = (id: number) => plan.requests.find((r) => r.id === id)
    expect(p(req.A)).toMatchObject({ action: 'reroute', newRuleId: defRule, newStatus: 'pending_ack', firstStep: expect.stringMatching(/^Persetujuan PM \(/) })
    expect(p(req.B)).toMatchObject({ action: 'reroute', newRuleId: defRule, newStatus: 'pending_approval', newLevel: 1, firstStep: 'Persetujuan Direktur' })
    expect(p(req.C)).toBeUndefined() // past the Direktur: not even a candidate
    expect(p(req.D)).toMatchObject({ action: 'reroute', newRuleName: DIREKTUR_RULE_NAME, newStatus: 'pending_approval', firstStep: 'Persetujuan Owner' })
    expect(p(req.E)).toMatchObject({ action: 'keep', reason: expect.stringContaining('keputusan manual') })
    expect(await migrationAudit()).toBe(audits)
    for (const id of Object.values(req)) expect((await requestRow(id)).snap).toEqual(before[id]!.snap)
  })

  it('the SQL preview (psql) predicts the same rule / status / first approver', async () => {
    const text = readFileSync(path.join(__dirname, '../../src/reroute/preview.sql'), 'utf8')
    const [rules, requests] = (await asOwner('read-only', async (_db, c) => c.query(text))) as unknown as Array<{ rows: Array<Record<string, unknown>> }>
    const r = (id: number) => rules!.rows.find((x) => Number(x.rule_id) === id)
    expect(r(defRule)).toMatchObject({ prediksi: 'UBAH', nama_baru: RULE_RENAMES[0]!.to })
    expect(r(exRule)).toMatchObject({ prediksi: 'UBAH' })
    expect(r(customRule)!.prediksi).toMatch(/^TETAP/)
    for (const tp of plan.requests.filter((x) => Object.values(req).includes(x.id))) {
      const sq = requests!.rows.find((x) => Number(x.request_id) === tp.id)!
      expect(sq, `request ${tp.id}`).toBeDefined()
      expect(sq.prediksi).toBe(tp.action === 'reroute' ? 'ALIH' : 'TETAP')
      if (tp.action === 'reroute') {
        expect([Number(sq.rule_id_baru), sq.status_baru, sq.menunggu]).toEqual([tp.newRuleId, tp.newStatus, tp.firstStep])
      }
    }
  })
})

describe('migration 20261015_200000_d1510_approval_reroute', () => {
  it('up: rules aligned (ids kept, audited); requests re-routed to the snapshot of a fresh submit; C untouched; notifications; idempotent', async () => {
    const lastNotification = Number((await sqlAs('app', 'SELECT coalesce(max(id), 0)::int AS m FROM notifications')).rows[0].m)
    await asOwner('commit', (db) => up({ db, payload: undefined } as never))

    expect(await ruleRow(defRule)).toMatchObject({ name: RULE_RENAMES[0]!.to, active: true, ack: 'required', ack_by: 'scope_manager', ack_role: null, steps: ['pk-owner', 'pk-principal'] })
    expect(await ruleRow(exRule)).toMatchObject({ name: RULE_RENAMES[1]!.to, active: false, ack_by: 'scope_manager', steps: ['pk-owner', 'pk-principal'] })
    expect(await ruleRow(customRule)).toMatchObject({ name: OLD_DEFAULT, ack_by: 'role', steps: ['pk-finance', 'pk-finance'] })
    const ruleAudit = (await sqlAs('app', "SELECT source::text AS source, reason, old_value -> 'v' ->> 'name' AS old FROM audit_logs WHERE doc_type = 'approval_rule' AND doc_id = $1 AND field = 'steps' ORDER BY id DESC LIMIT 1", [String(defRule)])).rows[0]
    expect(ruleAudit).toMatchObject({ source: 'system', old: OLD_DEFAULT, reason: expect.stringContaining('keputusan owner 2026-10-15') })

    // A: waits for the PM project — exactly the snapshot of the same request submitted today
    const a = await requestRow(req.A)
    expect(a).toMatchObject({ status: 'pending_ack', level: 0, rule: defRule, hash: before[req.A]!.hash, doc_no: before[req.A]!.docNo, total: before[req.A]!.total })
    const twin = await submitted(w.users.staffA, draftBody(w, { title: 'RRT A' }))
    expect(canonicalJson(a.snap)).toBe(canonicalJson((await requestRow(twin)).snap))
    expect(a.snap).toMatchObject({ acknowledgeBy: 'scope_manager', acknowledgerUserId: w.users.pm.id, steps: [{ approverRole: 'pk-owner' }, { approverRole: 'pk-principal' }] })
    const detail = (await api('GET', `${E}/${req.A}`, w.users.staffA)).body
    expect(detail.statusLabel).toBe('Menunggu persetujuan PM')
    expect(await inboxItem(w.users.pm, req.A)).toMatchObject({ step: 'acknowledge', stepLabel: 'Persetujuan PM' })
    expect(await inboxItem(w.users.owner, req.A)).toBeUndefined() // the Direktur is no longer asked first
    const audit = (await sqlAs('app', "SELECT reason, old_value -> 'v' ->> 'alur' AS old, new_value -> 'v' ->> 'alur' AS neu FROM audit_logs WHERE doc_type = 'expense_request' AND doc_id = $1 AND field = 'approvalFlow'", [String(req.A)])).rows
    expect(audit).toEqual([{ reason: expect.stringContaining(REROUTE_NOTE), old: 'Direktur (Diketahui) → Owner → Finance', neu: expect.stringMatching(/^PM project \(.+\) → Direktur → Owner$/) }])
    const panel = (await loadRequestPanel(await getTestPayload(), { ...w.users.staffA, collection: 'users' } as never, req.A))!
    expect(panel.stepperNote).toBe(REROUTE_NOTE)
    expect(panel.stepper.steps.slice(1, 4).map((s) => `${s.title}:${s.state}`)).toEqual(['Persetujuan PM:current', 'Persetujuan Direktur:pending', 'Persetujuan Owner:pending'])
    expect(panel.history.some((h) => h.field === 'Alur persetujuan' && h.reason?.includes('keputusan owner 2026-10-15'))).toBe(true)

    // B: the PM is the requester → his step is skipped as at submit → waits for the Direktur
    const b = await requestRow(req.B)
    expect(b).toMatchObject({ status: 'pending_approval', level: 1, rule: defRule })
    expect(b.snap).toMatchObject({ acknowledge: 'none', skipped: [{ position: 'diketahui', userId: w.users.pm.id }] })
    expect((await sqlAs('app', "SELECT action::text AS a FROM audit_logs WHERE doc_type = 'expense_request' AND doc_id = $1 AND action::text IN ('approval_skipped', 'status_change') AND source::text = 'system' ORDER BY id", [String(req.B)])).rows.map((r) => r.a)).toEqual([
      'status_change',
      'approval_skipped',
    ])
    expect(await inboxItem(w.users.owner, req.B)).toMatchObject({ step: 'approve', stepLabel: 'Persetujuan Direktur' })

    // D: a Direktur's own request → "Pengajuan Direktur" (the Owner decides) · E: the Owner's own → kept · C untouched
    const d = await requestRow(req.D)
    expect(d).toMatchObject({ status: 'pending_approval', level: 1 })
    expect(d.snap).toMatchObject({ ruleName: DIREKTUR_RULE_NAME, steps: [{ level: 1, approverRole: 'pk-principal' }] })
    expect(await inboxItem(principal, req.D)).toMatchObject({ stepLabel: 'Persetujuan Owner' })
    for (const id of [req.C, req.E]) expect(await requestRow(id)).toMatchObject({ snap: before[id]!.snap, status: before[id]!.status, rule: defRule })

    // the notification a submit sends to the new first approver
    const sent = (await sqlAs('app', 'SELECT user_id::int AS u, doc_id, event, title FROM notifications WHERE id > $1 AND doc_id = ANY($2) ORDER BY id', [lastNotification, [String(req.A), String(req.B), String(req.D)]])).rows
    expect(sent).toContainEqual({ u: w.users.pm.id, doc_id: String(req.A), event: 'expense.pending_ack', title: `Persetujuan PM: ${before[req.A]!.docNo}` })
    expect(sent.filter((x) => x.doc_id === String(req.B)).map((x) => x.u)).toContain(w.users.owner.id)
    expect(sent.filter((x) => x.doc_id === String(req.B)).map((x) => x.u)).not.toContain(w.users.pm.id)
    expect(sent).toContainEqual({ u: principal.id, doc_id: String(req.D), event: 'expense.pending_approval', title: `Persetujuan Owner: ${before[req.D]!.docNo}` })

    // idempotent: a second run changes nothing
    const n = await migrationAudit()
    await asOwner('commit', (db) => up({ db, payload: undefined } as never))
    expect(await migrationAudit()).toBe(n)
    const again = await asOwner('read-only', (db) => planReroute(db))
    expect(again.rules.filter((r) => [defRule, exRule].includes(r.rule.id))).toEqual([])
    expect(again.requests.filter((r) => Object.values(req).includes(r.id))).toEqual([])
  })

  it('down (rolled back here) restores the old rules and snapshots', async () => {
    await asOwner('rollback', async (db, c) => {
      await down({ db, payload: undefined } as never)
      const q = async (id: number) => (await c.query('SELECT status::text AS status, approval_rule_id AS rule, approval_snapshot AS snap FROM expense_requests WHERE id = $1', [id])).rows[0]
      for (const id of [req.A, req.B, req.D]) expect(await q(id)).toEqual({ status: 'pending_ack', rule: defRule, snap: before[id]!.snap })
      const rr = (await c.query("SELECT r.name, r.acknowledge_by::text AS ack_by, (SELECT array_agg(s.approver_role::text ORDER BY s.level) FROM approval_rules_steps s WHERE s._parent_id = r.id) AS steps FROM approval_rules r WHERE r.id = ANY($1) ORDER BY r.id", [[defRule, exRule]])).rows
      expect(rr).toEqual([
        { name: OLD_DEFAULT, ack_by: 'role', steps: ['pk-principal', 'pk-finance'] },
        { name: OLD_EXAMPLE, ack_by: 'role', steps: ['pk-finance'] },
      ])
    })
    expect((await requestRow(req.A)).status).toBe('pending_ack') // rolled back: still re-routed
    expect((await ruleRow(defRule)).name).toBe(RULE_RENAMES[0]!.to)
  })

  it('the re-routed request runs the new flow: PM → Direktur → Owner → Finance transfer queue; down is then refused', async () => {
    const pm = await api('POST', `${E}/${req.A}/acknowledge`, w.users.pm, {}, key())
    expect(pm.body, JSON.stringify(pm.body)).toMatchObject({ status: 'pending_approval', currentLevel: 1, statusLabel: 'Menunggu persetujuan Direktur' })
    expect((await api('POST', `${E}/${req.A}/approve`, principal, {}, key())).status).toBe(403) // level 1 is the Direktur's
    const dir = await api('POST', `${E}/${req.A}/approve`, w.users.owner, {}, key())
    expect(dir.body, JSON.stringify(dir.body)).toMatchObject({ status: 'pending_approval', currentLevel: 2, statusLabel: 'Menunggu persetujuan Owner' })
    expect((await api('POST', `${E}/${req.A}/approve`, w.users.finance, {}, key())).status).toBe(403) // Finance only transfers
    const own = await api('POST', `${E}/${req.A}/approve`, principal, {}, key())
    expect(own.body, JSON.stringify(own.body)).toMatchObject({ status: 'approved' })
    expect((await api('GET', '/api/v1/transfer-queue', w.users.finance)).body.items.find((i: { id: number }) => i.id === req.A)).toBeDefined()

    await expect(asOwner('rollback', (db) => down({ db, payload: undefined } as never))).rejects.toThrow(/DITOLAK/)
  })
})
