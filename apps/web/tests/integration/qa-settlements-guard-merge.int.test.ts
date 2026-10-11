import { randomUUID } from 'node:crypto'

import { sql } from '@payloadcms/db-postgres'
import { PgDialect } from 'drizzle-orm/pg-core'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { addDays } from '@/domain/expense/types'
import { resetRateLimits } from '@/lib/rate-limit'
import { down as mergeDown, up as mergeUp } from '@/migrations/20261009_090000_qa_settlements_guard_merge'

import { api, draftBody, makeWorld, png, upload, type World } from './flow-world'
import { getTestPayload, sqlAs, sqlError } from './helpers'

/**
 * Release 0.6.2: `pk_settlements_guard` is replaced by two QA branches — 20261008_090000_qa_finance_integrity
 * (QA-06 / ADR 0019 shortfall re-approval state) and 20261008_120000_qa_flow_lpj_totals (QA-09 provisional
 * totals of an open LPJ). The later one dropped the shortfall rules; 20261009_090000_qa_settlements_guard_merge
 * installs the union. Both behaviours are proven here on the migrated database, through /api/v1 and SQL as the
 * app role, plus the migration's down (restores the 120000 body) → up round trip.
 */
let w: World
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })
const today = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10) // Asia/Makassar

beforeAll(async () => {
  w = await makeWorld('QM')
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

async function receipt(id: number, lineId: string, amount: number) {
  const img = await upload('/api/v1/media/receipts', w.users.staffA, await png())
  expect(img.status).toBe(201)
  const body = { lineId, receiptNo: `QM-${id}-${randomUUID().slice(0, 6)}`, vendorName: 'Toko Bangunan Maju', receiptDate: addDays(today(), -1), amount, imageId: img.body.id }
  return ok(api('POST', `${E}/${id}/receipts`, w.users.staffA, body, key()), 201)
}

async function proof(): Promise<number> {
  const r = await upload('/api/v1/media/transfer-proofs', w.users.finance, await png())
  expect(r.status).toBe(201)
  return r.body.id
}

/** Pengajuan Baru 750.000 (600.000 + 150.000) → approved → transferred → receipts → LPJ submitted. */
async function submittedLpj(amounts: [number, number]) {
  const c = await ok(api('POST', E, w.users.staffA, draftBody(w), key()), 201)
  const id = c.id as number
  await ok(api('POST', `${E}/${id}/submit`, w.users.staffA, {}, key()))
  await ok(api('POST', `${E}/${id}/acknowledge`, w.users.owner, {}, key()))
  await ok(api('POST', `${E}/${id}/approve`, w.users.finance, {}, key()))
  await ok(api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `QM-${id}`, proofMediaId: await proof() }, key()), 201)
  const lines = (c.lines as Array<{ id: string }>).map((l) => l.id)
  await receipt(id, lines[0]!, amounts[0])
  await receipt(id, lines[1]!, amounts[1])
  await ok(api('POST', `${E}/${id}/receipts-complete`, w.users.staffA, {}, key()))
  const d = await ok(api('POST', `${E}/${id}/lpj/submit`, w.users.staffA, { usageNotes: 'Material naik harga.' }, key()))
  return { id, sid: d.settlement.id as number, receipts: d.receipts as Array<{ id: number; amount: number }> }
}

async function guardSource(run: (q: string) => Promise<{ rows: Array<{ src: string }> }>): Promise<string> {
  return (await run("SELECT prosrc AS src FROM pg_proc WHERE proname = 'pk_settlements_guard'")).rows[0]!.src
}

const QA09 = 'provisional totals must equal the active receipts'
const QA06 = 'shortfall approval % → % not allowed'

describe('pk_settlements_guard after the 0.6.2 merge: QA-09 provisional totals AND QA-06 shortfall re-approval', () => {
  it('the installed body carries both rule sets', async () => {
    const src = await guardSource((q) => sqlAs('owner', q) as never)
    expect(src).toContain(QA09)
    expect(src).toContain(QA06)
    expect(src).toContain('shortfall approval amount/rule/note are fixed per cycle')
  })

  it('QA-09: an open LPJ follows a rejected receipt; the DB accepts only consistent totals, and only while open', async () => {
    const t = await submittedLpj([600_000, 250_000])
    const r250 = t.receipts.find((r) => r.amount === 250_000)!.id
    const rej = await ok(api('POST', `${E}/${t.id}/receipts/${r250}/reject`, w.users.finance, { reason: 'nota buram' }, key()))
    expect(rej.settlement).toMatchObject({ status: 'submitted', receiptsTotal: 600_000, difference: 150_000 })
    expect((await sqlError('app', 'UPDATE settlements SET receipts_total = receipts_total + 1 WHERE id = $1', [t.sid]))?.code).toBe('23514')
    expect(await sqlError('app', 'UPDATE settlements SET receipts_total = 600000, difference = transferred_total - 600000 WHERE id = $1', [t.sid])).toBeNull()
    // the shortfall columns are not part of an open LPJ
    expect((await sqlError('app', "UPDATE settlements SET shortfall_approval_note = 'x' WHERE id = $1", [t.sid]))?.code).toBe('42501')
  })

  it('QA-06: a verified shortfall above the tolerance goes through re-approval; the DB enforces the state graph', async () => {
    // 600.000 + 250.000 = 850.000 vs approved 750.000 + 10 % → above the tolerance
    const t = await submittedLpj([600_000, 250_000])
    for (const r of t.receipts) await ok(api('POST', `${E}/${t.id}/receipts/${r.id}/verify`, w.users.finance, {}, key()))
    const v = await ok(api('POST', `${E}/${t.id}/lpj/verify`, w.users.finance, {}, key()))
    expect(v.settlement).toMatchObject({ status: 'verified', settlementType: 'shortfall', difference: -100_000 })
    // verified: the provisional totals are frozen (QA-09 window closed)
    expect((await sqlError('app', 'UPDATE settlements SET receipts_total = 1, difference = transferred_total - 1 WHERE id = $1', [t.sid]))?.code).toBe('42501')
    // the shortfall approval columns change while verified (would be 42501 "columns outside" with the 120000 body)
    const r = await ok(api('POST', `${E}/${t.id}/lpj/shortfall-approval`, w.users.finance, { note: 'Harga material naik' }, key()))
    expect(r.settlement.shortfallApproval).toMatchObject({ status: 'pending_ack', cycle: 1, amount: 850_000 })
    // QA-06 rules proper: a rejection needs a reason (23514), amount fixed within a cycle, no cycle jump
    expect((await sqlError('app', "UPDATE settlements SET shortfall_approval_status = 'rejected' WHERE id = $1", [t.sid]))?.code).toBe('23514')
    const amt = await sqlError('app', "UPDATE settlements SET shortfall_approval_status = 'pending_approval', shortfall_approval_amount = 1 WHERE id = $1", [t.sid])
    expect(amt?.code).toBe('42501')
    expect(amt?.message).toMatch(/fixed per cycle/)
    const jump = await sqlError('app', 'UPDATE settlements SET shortfall_approval_cycle = 5 WHERE id = $1', [t.sid])
    expect(jump?.message).toMatch(/shortfall approval pending_ack → pending_ack not allowed/)
    await ok(api('POST', `${E}/${t.id}/lpj/shortfall-approval/acknowledge`, w.users.owner, {}, key()))
    const b = await ok(api('POST', `${E}/${t.id}/lpj/shortfall-approval/approve`, w.users.finance, {}, key()))
    expect(b.settlement.shortfallApproval).toMatchObject({ status: 'approved', settleAllowed: true })
    const s = await ok(api('POST', `${E}/${t.id}/settle`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `QMS-${t.id}`, proofMediaId: await proof() }, key()))
    expect(s).toMatchObject({ settlementType: 'shortfall', amount: 100_000 })
  })
})

describe('migration 20261009_090000_qa_settlements_guard_merge', () => {
  it('down restores the 20261008_120000 body (QA-09 only); up installs the union again; up is re-runnable', async () => {
    const c = new pg.Client({ connectionString: process.env.PK_TEST_DATABASE_URL_OWNER })
    await c.connect()
    const dialect = new PgDialect()
    const db = {
      execute: async (q: unknown) => {
        const x = dialect.sqlToQuery(q as never)
        return c.query(x.sql, x.params)
      },
    }
    const run = (q: string) => db.execute(sql.raw(q)) as Promise<{ rows: Array<{ src: string }> }>
    try {
      await c.query('BEGIN')
      await mergeDown({ db } as never)
      const before = await guardSource(run)
      expect(before).toContain(QA09)
      expect(before).not.toContain(QA06)
      await mergeUp({ db } as never)
      await mergeUp({ db } as never)
      const after = await guardSource(run)
      expect(after).toContain(QA09)
      expect(after).toContain(QA06)
    } finally {
      await c.query('ROLLBACK').catch(() => undefined)
      await c.end()
    }
  })
})
