import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

import { PgDialect } from '@payloadcms/db-postgres/drizzle/pg-core'
import { createLocalReq } from 'payload'
import pg from 'pg'
import { renderToString } from 'react-dom/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkflowPanel } from '@/admin/components/WorkflowPanel'
import { SKIP_COMPANY_DEFAULTS } from '@/domain/company-defaults'
import { STAFF_SELF_ONLY_MESSAGE } from '@/domain/expense/drafts'
import { claimMedia } from '@/domain/expense/receipts'
import { addDays } from '@/domain/expense/types'
import { ORPHAN_MARK, purgeOrphanMedia } from '@/domain/media-orphans'
import { mediaPath } from '@/lib/media-files'
import { resetRateLimits } from '@/lib/rate-limit'
import { up as upLpjSource } from '@/migrations/20261008_120100_qa_flow_lpj_source'

import { api, asUser, draftBody, makeFlowUser, makeWorld, png, sysCreate, upload, type FlowUser, type World } from './flow-world'
import { addMembership, auditRows, companyId, getTestPayload, sqlAs, sqlError } from './helpers'

// ActionButton / ReasonAction (client components) refresh through the app router; not mounted in SSR tests.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

/**
 * QA report 2026-10-08 — "alur & nota" (QA-07, QA-08, QA-09, QA-11, QA-15, QA-18, QA-19, QA-27) through
 * /api/v1, the admin panel components and the DB guards.
 */
let w: World
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })
const todayIso = () => {
  const d = new Date(Date.now() + 8 * 3_600_000) // Asia/Makassar (UTC+8, no DST) = the test PT's timezone
  return d.toISOString().slice(0, 10)
}
const yesterday = () => addDays(todayIso(), -1)

beforeAll(async () => {
  w = await makeWorld('QF')
})
beforeEach(() => resetRateLimits())

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

async function ok(p: Promise<{ status: number; body: any }>, status = 200) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await p
  expect(r.status, JSON.stringify(r.body)).toBe(status)
  return r.body
}

async function receiptImage(user: FlowUser = w.users.staffA, bytes?: Buffer): Promise<number> {
  const img = await upload('/api/v1/media/receipts', user, bytes ?? (await png()))
  expect(img.status, JSON.stringify(img.body)).toBe(201)
  return img.body.id as number
}

async function addReceipt(id: number, lineId: string, amount: number, opts: { receiptNo?: string; vendorName?: string; bytes?: Buffer; date?: string } = {}) {
  return api(
    'POST',
    `${E}/${id}/receipts`,
    w.users.staffA,
    {
      lineId,
      receiptNo: opts.receiptNo ?? `QF-${id}-${randomUUID().slice(0, 6)}`,
      vendorName: opts.vendorName ?? 'Toko Bangunan Maju',
      receiptDate: opts.date ?? yesterday(),
      amount,
      imageId: await receiptImage(w.users.staffA, opts.bytes),
    },
    key(),
  )
}

async function transferProof(): Promise<number> {
  const r = await upload('/api/v1/media/transfer-proofs', w.users.finance, await png())
  expect(r.status).toBe(201)
  return r.body.id
}

/** Uang Muka 750.000 (600.000 + 150.000) → approved → transferred. */
async function transferredAdvance(body: Record<string, unknown> = {}) {
  const c = await ok(api('POST', E, w.users.staffA, draftBody(w, body), key()), 201)
  const id = c.id as number
  await ok(api('POST', `${E}/${id}/submit`, w.users.staffA, {}, key()))
  await ok(api('POST', `${E}/${id}/acknowledge`, w.users.owner, {}, key()))
  await ok(api('POST', `${E}/${id}/approve`, w.users.finance, {}, key()))
  await ok(api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `TRF-${id}`, proofMediaId: await transferProof() }, key()), 201)
  return { id, lineIds: (c.lines as Array<{ id: string }>).map((l) => l.id) }
}

/** LPJ submitted with the given receipt amounts (alternating lines). */
async function lpjSubmitted(amounts: number[]) {
  const t = await transferredAdvance()
  for (const [i, a] of amounts.entries()) await ok(addReceipt(t.id, t.lineIds[i % 2]!, a), 201)
  await ok(api('POST', `${E}/${t.id}/receipts-complete`, w.users.staffA, {}, key()))
  const s = await ok(api('POST', `${E}/${t.id}/lpj/submit`, w.users.staffA, { usageNotes: 'Material dan konsumsi tukang.' }, key()))
  return { ...t, detail: s }
}

async function panelHtml(user: FlowUser, id: number): Promise<string> {
  const p = await getTestPayload()
  const req = await createLocalReq({ user: { ...user, collection: 'users' } as never }, p)
  const el = await WorkflowPanel({ req, id, operation: 'update' } as never)
  return el ? renderToString(el) : ''
}

async function notifications(user: FlowUser, id: number): Promise<string[]> {
  const r = await sqlAs('app', 'SELECT event FROM notifications WHERE user_id = $1 AND doc_id = $2 ORDER BY id', [user.id, String(id)])
  return r.rows.map((x) => x.event as string)
}

/** Runs a migration function like `payload migrate` does: one OWNER connection, one transaction. */
async function migrate(fn: typeof upLpjSource): Promise<Array<Record<string, unknown>>> {
  const c = new pg.Client({ connectionString: process.env.PK_TEST_DATABASE_URL_OWNER })
  await c.connect()
  const dialect = new PgDialect()
  const logs: Array<Record<string, unknown>> = []
  const db = {
    execute: async (q: unknown) => {
      const x = dialect.sqlToQuery(q as never)
      return c.query(x.sql, x.params)
    },
  }
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

// ---------------------------------------------------------------- QA-07

describe('QA-07 — a receipt dated in the future is refused (400)', () => {
  it('add: tomorrow → 400 "Tanggal nota tidak boleh di masa depan" (no receipt); today → 201; edit to the future → 400', async () => {
    const d = await ok(api('POST', E, w.users.staffA, draftBody(w, { type: 'reimburse' }), key()), 201)
    const line = d.lines[0].id as string
    const bad = await addReceipt(d.id, line, 600_000, { date: addDays(todayIso(), 1) })
    expect(bad.status).toBe(400)
    expect(bad.body.detail ?? bad.body.message ?? JSON.stringify(bad.body)).toContain('Tanggal nota tidak boleh di masa depan')
    expect(JSON.stringify(bad.body)).toContain('receiptDate')
    expect(Number((await sqlAs('app', 'SELECT count(*)::int AS n FROM receipts WHERE request_id = $1', [d.id])).rows[0]?.n)).toBe(0)
    const good = await ok(addReceipt(d.id, line, 600_000, { date: todayIso() }), 201)
    const rid = good.receipts[0].id as number
    const edit = await api('PATCH', `${E}/${d.id}/receipts/${rid}`, w.users.staffA, { receiptDate: addDays(todayIso(), 30) }, key())
    expect(edit.status).toBe(400)
    expect(JSON.stringify(edit.body)).toContain('Tanggal nota tidak boleh di masa depan')
    // web form: the date input is capped at today (PT timezone) and the panel checks before the upload
    const html = await panelHtml(w.users.staffA, d.id)
    expect(html).toContain(`max="${todayIso()}"`)
  })
})

// ---------------------------------------------------------------- QA-08

describe('QA-08 — duplicates inside the same request are flagged (once per pair)', () => {
  it('same photo twice → one "Nota ganda dalam pengajuan ini" flag on the later receipt; removing the first resolves it', async () => {
    const d = await ok(api('POST', E, w.users.staffA, draftBody(w, { type: 'reimburse' }), key()), 201)
    const [l1, l2] = (d.lines as Array<{ id: string }>).map((l) => l.id)
    const bytes = await png(90_001)
    const first = await ok(addReceipt(d.id, l1!, 600_000, { bytes, receiptNo: 'QF-A-1' }), 201)
    const second = await ok(addReceipt(d.id, l2!, 150_000, { bytes, receiptNo: 'QF-A-2', vendorName: 'Warung Lain' }), 201)
    const r1 = first.receipts[0].id as number
    const r2 = (second.receipts as Array<{ id: number }>).find((r) => r.id !== r1)!.id
    const dup = (second.flags as Array<{ kind: string; receiptId: number | null; message: string; status: string }>).filter((f) => f.kind === 'duplicate')
    expect(dup).toHaveLength(1)
    expect(dup[0]).toMatchObject({ receiptId: r2, status: 'open' })
    expect(dup[0]!.message).toContain('Nota ganda dalam pengajuan ini')
    expect(dup[0]!.message).toContain('baris 1')
    expect(dup[0]!.message).toContain('foto identik')
    // flag_raised audited
    expect((await auditRows('expense_request', d.id)).some((r) => r.action === 'flag_raised' && r.field === 'duplicate')).toBe(true)
    // removing the first receipt of the pair resolves the flag
    const after = await ok(api('POST', `${E}/${d.id}/receipts/${r1}/remove`, w.users.staffA, { reason: 'foto dobel' }, key()))
    expect((after.flags as Array<{ kind: string }>).filter((f) => f.kind === 'duplicate')).toHaveLength(0)
  })

  it('same receipt number + vendor (other photo, other amount) → flag "nomor + toko sama"; another number → none', async () => {
    const d = await ok(api('POST', E, w.users.staffA, draftBody(w, { type: 'reimburse' }), key()), 201)
    const [l1, l2] = (d.lines as Array<{ id: string }>).map((l) => l.id)
    await ok(addReceipt(d.id, l1!, 600_000, { receiptNo: 'TX-0101.0001', vendorName: 'SPBU Kuala' }), 201)
    const x = await ok(addReceipt(d.id, l2!, 150_000, { receiptNo: 'tx01010001', vendorName: 'spbu  kuala' }), 201)
    const dup = (x.flags as Array<{ kind: string; message: string }>).filter((f) => f.kind === 'duplicate')
    expect(dup).toHaveLength(1)
    expect(dup[0]!.message).toContain('nomor + toko sama')
    const y = await ok(addReceipt(d.id, l2!, 1_000, { receiptNo: 'TX-9999', vendorName: 'SPBU Kuala' }), 201)
    expect((y.flags as Array<{ kind: string }>).filter((f) => f.kind === 'duplicate')).toHaveLength(1) // still only the first pair
  })

  it('across requests the amount still has to match (unchanged US-50 rule)', async () => {
    const a = await ok(api('POST', E, w.users.staffA, draftBody(w, { type: 'reimburse' }), key()), 201)
    const b = await ok(api('POST', E, w.users.staffA, draftBody(w, { type: 'reimburse' }), key()), 201)
    await ok(addReceipt(a.id, a.lines[0].id, 600_000, { receiptNo: 'QF-X-77', vendorName: 'Toko X' }), 201)
    const nb = await ok(addReceipt(b.id, b.lines[0].id, 500_000, { receiptNo: 'QF-X-77', vendorName: 'Toko X' }), 201)
    expect((nb.flags as Array<{ kind: string }>).filter((f) => f.kind === 'duplicate')).toHaveLength(0)
    const same = await ok(addReceipt(b.id, b.lines[1].id, 600_000, { receiptNo: 'QF-X-77', vendorName: 'Toko X' }), 201)
    const msgs = (same.flags as Array<{ kind: string; message: string }>).filter((f) => f.kind === 'duplicate').map((f) => f.message)
    expect(msgs.some((m) => m.includes(a.docNo ?? `#${a.id}`) || m.includes('pengajuan'))).toBe(true)
  })
})

// ---------------------------------------------------------------- QA-09

describe('QA-09 — LPJ summary and difference flags follow every receipt decision', () => {
  it('reject → receipts total / difference / amount flag recomputed at once (audited); verify-receipt back → counted again', async () => {
    // line 1: 600.000 (exact); line 2: 100.000 + 51.000 = 151.000 vs 150.000 → info flag (within tolerance)
    const t = await lpjSubmitted([600_000, 100_000, 51_000])
    expect(t.detail.settlement).toMatchObject({ status: 'submitted', receiptsTotal: 751_000, difference: -1_000 })
    const r51 = (t.detail.receipts as Array<{ id: number; amount: number }>).find((r) => r.amount === 51_000)!.id
    const rej = await ok(api('POST', `${E}/${t.id}/receipts/${r51}/reject`, w.users.finance, { reason: 'nota buram' }, key()))
    expect(rej.status).toBe('lpj_submitted')
    expect(rej.settlement).toMatchObject({ status: 'submitted', receiptsTotal: 700_000, difference: 50_000 })
    const amountFlags = (rej.flags as Array<{ kind: string; level: string; lineNo: number; status: string; message: string }>).filter((f) => f.kind === 'amount_diff' && f.status !== 'resolved')
    expect(amountFlags).toHaveLength(1)
    expect(amountFlags[0]).toMatchObject({ lineNo: 2, level: 'warning' })
    expect(amountFlags[0]!.message).toContain('Rp 50.000')
    const s = (await auditRows('settlement', rej.settlement.id)).filter((r) => r.action === 'update' && r.field === 'receiptsTotal')
    expect(s.length).toBeGreaterThanOrEqual(1)
    // the LPJ verification view reads the same columns
    const db = await sqlAs('app', 'SELECT receipts_total::int AS t, difference::int AS d FROM settlements WHERE request_id = $1', [t.id])
    expect(db.rows[0]).toEqual({ t: 700_000, d: 50_000 })
    // Finance changes its mind: valid again → counted again
    const back = await ok(api('POST', `${E}/${t.id}/receipts/${r51}/verify`, w.users.finance, {}, key()))
    expect(back.settlement).toMatchObject({ receiptsTotal: 751_000, difference: -1_000 })
  })

  it('remove during "LPJ Revisi" → totals follow; DB refuses inconsistent or out-of-window totals', async () => {
    const t = await lpjSubmitted([600_000, 150_000, 20_000])
    const extra = (t.detail.receipts as Array<{ id: number; amount: number }>).find((r) => r.amount === 20_000)!.id
    await ok(api('POST', `${E}/${t.id}/lpj/request-revision`, w.users.finance, { note: 'hapus nota 20.000' }, key()))
    const rm = await ok(api('POST', `${E}/${t.id}/receipts/${extra}/remove`, w.users.staffA, { reason: 'salah pengajuan' }, key()))
    expect(rm.settlement).toMatchObject({ status: 'revision', receiptsTotal: 750_000, difference: 0 })
    const sid = rm.settlement.id as number
    // DB guard (pk_settlements_guard): totals must equal Σ active receipts and transferred − total
    expect((await sqlError('app', 'UPDATE settlements SET receipts_total = receipts_total + 1 WHERE id = $1', [sid]))?.code).toBe('23514')
    expect((await sqlError('app', 'UPDATE settlements SET receipts_total = 1, difference = transferred_total - 1 WHERE id = $1', [sid]))?.code).toBe('23514')
    expect(await sqlError('app', 'UPDATE settlements SET receipts_total = 750000, difference = transferred_total - 750000 WHERE id = $1', [sid])).toBeNull()
    // resubmit + verify → verified: totals frozen outside the open window
    await ok(api('POST', `${E}/${t.id}/lpj/submit`, w.users.staffA, {}, key()))
    for (const r of (await ok(api('GET', `${E}/${t.id}`, w.users.finance))).receipts.filter((x: { status: string }) => x.status === 'pending')) {
      await ok(api('POST', `${E}/${t.id}/receipts/${r.id}/verify`, w.users.finance, {}, key()))
    }
    const v = await ok(api('POST', `${E}/${t.id}/lpj/verify`, w.users.finance, {}, key()))
    expect(v.status).toBe('completed') // difference 0
    expect((await sqlError('app', 'UPDATE settlements SET receipts_total = 1, difference = transferred_total - 1 WHERE id = $1', [sid]))?.code).toBe('42501')
  })
})

// ---------------------------------------------------------------- QA-27

describe('QA-27 — a receipt Finance marked valid is locked for the requester', () => {
  it('remove / edit of a valid receipt → 409 "Nota sudah divalidasi Finance"; pending ones stay removable; web hides the button', async () => {
    const t = await lpjSubmitted([600_000, 150_000])
    const [valid, pending] = (t.detail.receipts as Array<{ id: number }>).map((r) => r.id)
    await ok(api('POST', `${E}/${t.id}/receipts/${valid}/verify`, w.users.finance, {}, key()))
    await ok(api('POST', `${E}/${t.id}/lpj/request-revision`, w.users.finance, { note: 'perbaiki nota baris 2' }, key()))
    const rm = await api('POST', `${E}/${t.id}/receipts/${valid}/remove`, w.users.staffA, { reason: 'hapus' }, key())
    expect(rm.status).toBe(409)
    expect(JSON.stringify(rm.body)).toContain('Nota sudah divalidasi Finance')
    const ed = await api('PATCH', `${E}/${t.id}/receipts/${valid}`, w.users.staffA, { amount: 1 }, key())
    expect(ed.status).toBe(409)
    expect((await sqlAs('app', 'SELECT status::text AS s FROM receipts WHERE id = $1', [valid])).rows[0]?.s).toBe('valid')
    const html = await panelHtml(w.users.staffA, t.id)
    expect(html).not.toContain(`data-pk-action="remove-receipt-${valid}"`)
    expect(html).toContain(`data-pk-action="remove-receipt-${pending}"`)
    await ok(api('POST', `${E}/${t.id}/receipts/${pending}/remove`, w.users.staffA, { reason: 'ganti nota' }, key()))
  })
})

// ---------------------------------------------------------------- QA-19

describe('QA-19 — Finance confirms a Reimburse "selesai" in the web panel', () => {
  it('transferred Reimburse: Finance sees "Konfirmasi selesai" (Direktur does not) and completes it', async () => {
    const d = await ok(api('POST', E, w.users.staffA, draftBody(w, { type: 'reimburse' }), key()), 201)
    for (const [i, amount] of [600_000, 150_000].entries()) await ok(addReceipt(d.id, d.lines[i].id, amount), 201)
    await ok(api('POST', `${E}/${d.id}/submit`, w.users.staffA, {}, key()))
    await ok(api('POST', `${E}/${d.id}/acknowledge`, w.users.owner, {}, key()))
    const a = await ok(api('POST', `${E}/${d.id}/approve`, w.users.finance, {}, key()))
    for (const r of a.receipts) await ok(api('POST', `${E}/${d.id}/receipts/${r.id}/verify`, w.users.finance, {}, key()))
    for (const f of (await ok(api('GET', `${E}/${d.id}`, w.users.finance))).flags.filter((x: { status: string; level: string }) => x.status === 'open' && x.level === 'warning')) {
      await ok(api('POST', `${E}/${d.id}/flags/${f.id}/review`, w.users.finance, {}, key()))
    }
    await ok(api('POST', `${E}/${d.id}/verify-receipts`, w.users.finance, {}, key()))
    await ok(api('POST', `${E}/${d.id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `TRF-R-${d.id}`, proofMediaId: await transferProof() }, key()), 201)
    const fin = await panelHtml(w.users.finance, d.id)
    expect(fin).toContain('data-pk-finance-complete')
    expect(fin).toContain('data-pk-action="complete"')
    expect(fin).toContain('Konfirmasi selesai')
    expect(await panelHtml(w.users.owner, d.id)).not.toContain('data-pk-finance-complete')
    const req = await panelHtml(w.users.staffA, d.id)
    expect(req).not.toContain('data-pk-finance-complete')
    expect(req).toContain('data-pk-action="complete"') // requester keeps its own button
    expect((await api('POST', `${E}/${d.id}/complete`, w.users.owner, {}, key())).status).toBe(403)
    const c = await ok(api('POST', `${E}/${d.id}/complete`, w.users.finance, {}, key()))
    expect(c.status).toBe('completed')
  })
})

// ---------------------------------------------------------------- QA-15

describe('QA-15 — Staff requests for themselves only', () => {
  it('Staff: other / additional requesters → 403 (create + update); own only → 201', async () => {
    for (const requesterIds of [[w.emp.a, w.emp.b], [w.emp.b]]) {
      const r = await api('POST', E, w.users.staffA, draftBody(w, { requesterIds, bankAccountId: w.accA }), key())
      expect(r.status, JSON.stringify(requesterIds)).toBe(403)
      expect(JSON.stringify(r.body)).toContain('Staff hanya dapat mengajukan untuk dirinya sendiri')
    }
    const own = await ok(api('POST', E, w.users.staffA, draftBody(w), key()), 201)
    const up = await api('PATCH', `${E}/${own.id}`, w.users.staffA, { requesterIds: [w.emp.a, w.emp.b] }, key())
    expect(up.status).toBe(403)
    // the generic REST / admin form path enforces the same rule
    const rest = await api('PATCH', `/api/expense-requests/${own.id}`, w.users.staffA, { requesters: [w.emp.a, w.emp.b] })
    expect(rest.status).toBeGreaterThanOrEqual(400)
    expect((await sqlAs('app', "SELECT count(*)::int AS n FROM expense_requests_rels WHERE parent_id = $1 AND path = 'requesters'", [own.id])).rows[0]?.n).toBe(1)
  })

  it('PM may add co-requesters (Q-09), Admin/Finance may represent others (ADR 0013); a Staff requester cannot change them', async () => {
    const pm = await ok(api('POST', E, w.users.pm, draftBody(w, { requesterIds: [w.emp.pm, w.emp.a], bankAccountId: w.accA }), key()), 201)
    await ok(api('POST', E, w.users.admin, draftBody(w, { requesterIds: [w.emp.a, w.emp.b] }), key()), 201)
    // staff A is a co-requester of the PM's draft: may edit, but not widen the requesters
    expect((await api('PATCH', `${E}/${pm.id}`, w.users.staffA, { requesterIds: [w.emp.pm, w.emp.a, w.emp.b] }, key())).status).toBe(403)
    await ok(api('PATCH', `${E}/${pm.id}`, w.users.staffA, { title: 'Diubah staff' }, key()))
  })

  it('an older Staff draft that breaks the rule cannot be submitted (clear 403)', async () => {
    const d = await ok(api('POST', E, w.users.staffA, draftBody(w), key()), 201)
    // pre-QA-15 data: a second requester written before the rule existed
    await sqlAs('owner', "INSERT INTO expense_requests_rels (\"order\", parent_id, path, employees_id) VALUES (2, $1, 'requesters', $2)", [d.id, w.emp.b])
    const s = await api('POST', `${E}/${d.id}/submit`, w.users.staffA, {}, key())
    expect(s.status).toBe(403)
    expect(s.body.detail ?? JSON.stringify(s.body)).toContain(STAFF_SELF_ONLY_MESSAGE.slice(0, 40))
    expect((await sqlAs('app', 'SELECT status::text AS s FROM expense_requests WHERE id = $1', [d.id])).rows[0]?.s).toBe('draft')
  })
})

// ---------------------------------------------------------------- QA-18

describe('QA-18 — the team PM is notified (scope rule: PM role in the request PT)', () => {
  it('submitted, transferred, LPJ revision, completed → project PM + PM-assigned members with the PM role in that PT only', async () => {
    const p = await getTestPayload()
    // pmX: PM-assigned on the project but only Staff in DRMS (PM in another PT) → never notified
    // (inactive: the shared test DB keeps ONE active PT for the fixtures of later files)
    const other = (await p.create({ collection: 'companies', data: { name: 'PT QF Lain', shortCode: `QF${randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, 'Q')}`, timezone: 'Asia/Makassar', active: false } as never, depth: 0, overrideAccess: true, context: { [SKIP_COMPANY_DEFAULTS]: true } })).id as number
    const drms = await companyId()
    const empX = await sysCreate('employees', { code: `QF-X-${randomUUID().slice(0, 4)}`, name: 'QF PM lain', company: drms })
    const pmX = await makeFlowUser(['pk-staff'], 'qf-pmx', empX)
    await addMembership(pmX.id, other, ['pk-pm'], null)
    // pm2: PM role in DRMS, PM assignment on the project → notified like the project's PM
    const emp2 = await sysCreate('employees', { code: `QF-P2-${randomUUID().slice(0, 4)}`, name: 'QF PM dua', company: drms })
    const pm2 = await makeFlowUser(['pk-pm'], 'qf-pm2', emp2)
    for (const e of [empX, emp2]) await sysCreate('team-assignments', { employee: e, project: w.project, roleInProject: 'pm', company: drms })

    const t = await transferredAdvance()
    for (const u of [w.users.pm, pm2]) expect(await notifications(u, t.id)).toEqual(['expense.team_submitted', 'expense.transferred'])
    expect(await notifications(pmX, t.id)).toEqual([])
    expect(await notifications(w.users.otherPm, t.id)).toEqual([]) // PM of another project
    // LPJ revision + completion (difference 0)
    for (const [i, a] of [600_000, 150_000].entries()) await ok(addReceipt(t.id, t.lineIds[i]!, a), 201)
    await ok(api('POST', `${E}/${t.id}/receipts-complete`, w.users.staffA, {}, key()))
    await ok(api('POST', `${E}/${t.id}/lpj/submit`, w.users.staffA, { usageNotes: 'Material.' }, key()))
    await ok(api('POST', `${E}/${t.id}/lpj/request-revision`, w.users.finance, { note: 'lengkapi uraian' }, key()))
    await ok(api('POST', `${E}/${t.id}/lpj/submit`, w.users.staffA, { usageNotes: 'Material semen dan konsumsi.' }, key()))
    for (const r of (await ok(api('GET', `${E}/${t.id}`, w.users.finance))).receipts) await ok(api('POST', `${E}/${t.id}/receipts/${r.id}/verify`, w.users.finance, {}, key()))
    expect((await ok(api('POST', `${E}/${t.id}/lpj/verify`, w.users.finance, {}, key()))).status).toBe('completed')
    expect(await notifications(w.users.pm, t.id)).toEqual(['expense.team_submitted', 'expense.transferred', 'expense.lpj_revision', 'expense.completed'])
    expect(await notifications(pmX, t.id)).toEqual([])
    // the row carries the request's PT (in-app PT label / filter)
    const row = await sqlAs('app', 'SELECT company_id FROM notifications WHERE user_id = $1 AND doc_id = $2 LIMIT 1', [w.users.pm.id, String(t.id)])
    expect(row.rows[0]?.company_id).toBe(await companyId())
  })

  it('rejected → PM notified; a request on a cost center (no project) → no PM event; the acting PM is never notified', async () => {
    const d = await ok(api('POST', E, w.users.staffA, draftBody(w), key()), 201)
    await ok(api('POST', `${E}/${d.id}/submit`, w.users.staffA, {}, key()))
    await ok(api('POST', `${E}/${d.id}/reject`, w.users.owner, { reason: 'tidak sesuai RAB' }, key()))
    expect(await notifications(w.users.pm, d.id)).toEqual(['expense.team_submitted', 'expense.rejected'])
    const cc = await ok(api('POST', E, w.users.staffA, draftBody(w, { projectId: null, costCenterId: w.costCenter }), key()), 201)
    await ok(api('POST', `${E}/${cc.id}/submit`, w.users.staffA, {}, key()))
    expect((await notifications(w.users.pm, cc.id)).filter((e) => e === 'expense.team_submitted')).toEqual([])
    // the PM submits a request on its project (co-requester Staff A): no team copy to itself (actor + requester)
    const own = await ok(api('POST', E, w.users.pm, draftBody(w, { requesterIds: [w.emp.pm, w.emp.a], bankAccountId: w.accA }), key()), 201)
    await ok(api('POST', `${E}/${own.id}/submit`, w.users.pm, {}, key()))
    expect(await notifications(w.users.pm, own.id)).toEqual([])
    expect(await notifications(w.users.staffA, own.id)).toContain('expense.submitted')
  })
})

// ---------------------------------------------------------------- QA-11

describe('QA-11 — "Pengembalian LPJ" (LPJ) per PT, pre-check before the upload, orphan cleanup', () => {
  it('a PT created in the admin gets the LPJ source — with and without "Salin default"', async () => {
    const p = await getTestPayload()
    const tag = randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, 'Q')
    const groupAdmin = await makeFlowUser(['pk-admin'], 'qf-ga', null, { groupAdmin: true })
    const mk = async (code: string, copyDefaults: boolean) =>
      (await p.create({ collection: 'companies', data: { name: `PT QF ${code}`, shortCode: `Q${code}${tag}`, timezone: 'Asia/Makassar', active: false, copyDefaults } as never, depth: 0, user: groupAdmin, overrideAccess: false })).id as number
    for (const id of [await mk('C', true), await mk('B', false)]) {
      const r = await sqlAs('app', "SELECT name, active FROM cash_in_sources WHERE company_id = $1 AND code = 'LPJ'", [id])
      expect(r.rows, String(id)).toEqual([{ name: 'Pengembalian LPJ', active: true }])
      const a = await sqlAs('app', "SELECT count(DISTINCT doc_id)::int AS n FROM audit_logs WHERE doc_type = 'cash_in_source' AND action = 'create' AND company_id = $1", [id])
      expect(Number(a.rows[0]?.n)).toBe(1)
    }
  })

  it('migration 20261008_120100_qa_flow_lpj_source backfills every PT without it (audited, idempotent)', async () => {
    const p = await getTestPayload()
    const tag = randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, 'Q')
    const bare = (await p.create({ collection: 'companies', data: { name: 'PT QF Tanpa LPJ', shortCode: `QB${tag}`, timezone: 'Asia/Makassar', active: false } as never, depth: 0, overrideAccess: true, context: { [SKIP_COMPANY_DEFAULTS]: true } })).id as number
    expect((await sqlAs('app', "SELECT count(*)::int AS n FROM cash_in_sources WHERE company_id = $1 AND code = 'LPJ'", [bare])).rows[0]?.n).toBe(0)
    const drmsBefore = Number((await sqlAs('app', "SELECT count(*)::int AS n FROM cash_in_sources WHERE company_id = $1 AND code = 'LPJ'", [await companyId()])).rows[0]?.n)
    const logs = await migrate(upLpjSource)
    expect((logs[0]?.createdForCompanyIds as number[]) ?? []).toContain(bare)
    expect((await sqlAs('app', "SELECT name, active FROM cash_in_sources WHERE company_id = $1 AND code = 'LPJ'", [bare])).rows).toEqual([{ name: 'Pengembalian LPJ', active: true }])
    const audit = await sqlAs('app', "SELECT action, source, reason, new_value FROM audit_logs WHERE doc_type = 'cash_in_source' AND company_id = $1", [bare])
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]).toMatchObject({ action: 'create', source: 'system', new_value: { v: { code: 'LPJ', name: 'Pengembalian LPJ', active: true } } })
    expect(audit.rows[0]?.reason).toContain('QA-11')
    expect(Number((await sqlAs('app', "SELECT count(*)::int AS n FROM cash_in_sources WHERE company_id = $1 AND code = 'LPJ'", [await companyId()])).rows[0]?.n)).toBe(drmsBefore)
    const again = await migrate(upLpjSource)
    expect(again[0]?.createdForCompanyIds).toEqual([])
  })

  it('GET …/settle/precheck: missing source → 409 before any upload; ready → 200; non-Finance → 403; wrong status → 409', async () => {
    const t = await lpjSubmitted([600_000, 100_000])
    expect((await api('GET', `${E}/${t.id}/settle/precheck`, w.users.finance)).status).toBe(409) // LPJ not verified yet
    for (const r of t.detail.receipts) await ok(api('POST', `${E}/${t.id}/receipts/${r.id}/verify`, w.users.finance, {}, key()))
    await ok(api('POST', `${E}/${t.id}/lpj/verify`, w.users.finance, {}, key()))
    expect(await ok(api('GET', `${E}/${t.id}/settle/precheck`, w.users.finance))).toEqual({ ready: true, settlementType: 'refund', amount: 50_000 })
    expect((await api('GET', `${E}/${t.id}/settle/precheck`, w.users.staffA)).status).toBe(403)
    expect((await api('GET', `${E}/${t.id}/settle/precheck`, w.users.owner)).status).toBe(403)
    const drms = await companyId()
    const renamed = `LPJ-${randomUUID().slice(0, 4)}`
    await sqlAs('owner', "UPDATE cash_in_sources SET code = $2 WHERE company_id = $1 AND code = 'LPJ'", [drms, renamed])
    try {
      const pre = await api('GET', `${E}/${t.id}/settle/precheck`, w.users.finance)
      expect(pre.status).toBe(409)
      expect(JSON.stringify(pre.body)).toContain('Pengembalian LPJ')
      // the settle itself still refuses (nothing posted)
      expect((await api('POST', `${E}/${t.id}/settle`, w.users.finance, { cashAccountId: w.cashAccount }, key())).status).toBe(409)
    } finally {
      await sqlAs('owner', "UPDATE cash_in_sources SET code = 'LPJ' WHERE company_id = $1 AND code = $2", [drms, renamed])
    }
    const s = await ok(api('POST', `${E}/${t.id}/settle`, w.users.finance, { cashAccountId: w.cashAccount }, key()))
    expect(s.settlementType).toBe('refund')
  })

  it('orphan attachments: dry run counts only; enabled → tombstoned + file deleted + audited; referenced / claimed / fresh ones kept', async () => {
    const p = await getTestPayload()
    const orphan = (await ok(upload('/api/v1/media/attachments', w.users.finance, await png()), 201)).id as number
    const referenced = (await ok(upload('/api/v1/media/attachments', w.users.staffA, await png()), 201)).id as number
    await ok(api('POST', E, w.users.staffA, draftBody(w, { attachmentIds: [referenced] }), key()), 201)
    const fileOf = async (id: number) => {
      const m = (await p.findByID({ collection: 'media-attachments', id, depth: 0, overrideAccess: true /* SYSTEM-READ: assertion */ })) as unknown as { filename: string }
      return mediaPath(p, 'media-attachments', m.filename)!
    }
    const orphanFile = await fileOf(orphan)
    expect(existsSync(orphanFile)).toBe(true)
    const later = new Date(Date.now() + 8 * 86_400_000)
    // fresh uploads are never candidates
    const fresh = await purgeOrphanMedia(p, { config: { enabled: false, minAgeDays: 7, batch: 2000 } })
    const freshCount = fresh[0]!.candidates
    const dry = await purgeOrphanMedia(p, { now: later, config: { enabled: false, minAgeDays: 7, batch: 2000 } })
    expect(dry[0]).toMatchObject({ collection: 'media-attachments', dryRun: true, marked: 0, deleted: 0 })
    expect(dry[0]!.candidates).toBeGreaterThan(freshCount)
    expect(existsSync(orphanFile)).toBe(true)
    const run = await purgeOrphanMedia(p, { now: later, config: { enabled: true, minAgeDays: 7, batch: 2000 } })
    expect(run[0]).toMatchObject({ dryRun: false, failed: 0, remaining: 0 })
    expect(run[0]!.marked).toBeGreaterThanOrEqual(1)
    expect(existsSync(orphanFile)).toBe(false)
    const rows = await sqlAs('app', 'SELECT id, owner_doc_type, owner_doc_id FROM media_attachments WHERE id = ANY($1) ORDER BY id', [[orphan, referenced]])
    expect(rows.rows).toEqual([
      { id: orphan, owner_doc_type: ORPHAN_MARK.type, owner_doc_id: ORPHAN_MARK.id },
      { id: referenced, owner_doc_type: null, owner_doc_id: null },
    ])
    expect(existsSync(await fileOf(referenced))).toBe(true)
    const audit = await sqlAs('app', "SELECT action, source, new_value FROM audit_logs WHERE doc_type = 'media_attachments' AND doc_id = 'orphans' ORDER BY id DESC LIMIT 1")
    expect(audit.rows[0]).toMatchObject({ action: 'retention_purge', source: 'job' })
    expect((audit.rows[0]?.new_value as { v: { marked: number } }).v.marked).toBe(run[0]!.marked)
    // a tombstone can never be claimed by a document
    await expect(asUser(w.users.finance, (req) => claimMedia(req, 'media-attachments', orphan, 1, { ownerType: 'cash_entry' }))).rejects.toMatchObject({ status: 409 })
    expect((await sqlError('app', "UPDATE media_attachments SET owner_doc_type = 'cash_entry', owner_doc_id = '1' WHERE id = $1", [orphan]))?.code).toBe('42501')
    // second run: nothing left
    const again = await purgeOrphanMedia(p, { now: later, config: { enabled: true, minAgeDays: 7, batch: 2000 } })
    expect(again[0]).toMatchObject({ candidates: 0, marked: 0 })
  })
})
