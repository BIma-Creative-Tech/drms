import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { allocateDocNo } from '@/domain/numbering-db'
import { DEFAULT_SEQUENCES, parseBusinessDate } from '@/domain/numbering'
import { withSystemTransaction } from '@/lib/system-tx'

import { companyId, getTestPayload, sqlAs, updateCompany } from './helpers'

/**
 * ADR 0007 §5 on the REQUEST transaction handle (getRequestTx = adapter.sessions[await
 * req.transactionID].db — internal Payload/Drizzle detail, pinned 3.90.1 → keep this test on every
 * Payload upgrade). F1 gate: 50 parallel submits → unique AND gapless; rollbacks burn no number.
 */
let cid = 0 // company #1 DRMS (ADR 0016: counters and sequences are per PT)
beforeAll(async () => {
  const p = await getTestPayload()
  cid = await companyId()
  await updateCompany({ shortCode: 'DRMS' })
  for (const s of DEFAULT_SEQUENCES) {
    // other suites share the DB (one reset per run) → only create what is missing, force ADR defaults
    const found = await p.find({ collection: 'document-sequences', where: { and: [{ company: { equals: cid } }, { docType: { equals: s.docType } }] }, overrideAccess: true /* SYSTEM-READ */ })
    const doc = found.docs[0]
    if (doc) await p.update({ collection: 'document-sequences', id: doc.id, data: { ...s, active: true, changeReason: 'test fixture' }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    else await p.create({ collection: 'document-sequences', data: { ...s, company: cid, timezone: 'Asia/Makassar' }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  }
})

/**
 * Test files share one DB (reset once per run) and the F2a flow tests also submit requests, so the
 * PB counter may already be in use when this file runs: expectations are relative to `base` —
 * which MUST be the configured startAt 229 when the counter row does not exist yet.
 */
let base = 229
beforeAll(async () => {
  const c = await sqlAs('app', "SELECT next_value FROM document_sequence_counters WHERE company_id = $1 AND doc_type = 'expense_request' AND period_key = 'ALL'", [cid])
  base = c.rows[0]?.next_value ?? 229
})

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

describe('document numbering (ADR 0007)', () => {
  it('first PB number continues the paper series: 229/PB-DRMS/23/IX/2026 (number_issued audited in the same tx)', async () => {
    const counter = await sqlAs('app', "SELECT count(*)::int AS n FROM document_sequence_counters WHERE company_id = $1 AND doc_type = 'expense_request'", [cid])
    if (counter.rows[0].n === 0) expect(base).toBe(229)
    const p = await getTestPayload()
    const res = await withSystemTransaction(p, null, async (req: PayloadRequest) => {
      const a = await allocateDocNo(req, 'expense_request', { companyId: cid, date: parseBusinessDate('2026-09-23'), docId: 'test-1' })
      const r = await (await import('@/lib/tx')).getRequestTx(req)
      const tx = (await r.execute((await import('@payloadcms/db-postgres')).sql`SELECT txid_current()::text AS tx`)) as unknown as { rows: Array<{ tx: string }> }
      return { a, tx: tx.rows[0]!.tx }
    })
    expect(res.a.docNo).toBe(`${base}/PB-DRMS/23/IX/2026`)
    const row = await sqlAs('app', "SELECT tx_id::text AS tx, doc_no FROM audit_logs WHERE action = 'number_issued' AND doc_id = 'test-1'")
    expect(row.rows[0]).toEqual({ tx: res.tx, doc_no: `${base}/PB-DRMS/23/IX/2026` })
  })

  it('a rolled-back allocation returns its number (no gap)', async () => {
    const p = await getTestPayload()
    await expect(
      withSystemTransaction(p, null, async (req) => {
        await allocateDocNo(req, 'expense_request', { companyId: cid, date: parseBusinessDate('2026-09-24') })
        throw new Error('simulated failure after allocation')
      }),
    ).rejects.toThrow('simulated failure')
    const next = await withSystemTransaction(p, null, (req) => allocateDocNo(req, 'expense_request', { companyId: cid, date: parseBusinessDate('2026-09-24') }))
    expect(next.docNo).toBe(`${base + 1}/PB-DRMS/24/IX/2026`)
  })

  it('50 parallel allocations (10 failing after allocation) → committed numbers unique and gapless', async () => {
    const p = await getTestPayload()
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) =>
        withSystemTransaction(p, null, async (req) => {
          const a = await allocateDocNo(req, 'expense_request', { companyId: cid, date: parseBusinessDate('2026-09-25') })
          await new Promise((r) => setTimeout(r, Math.random() * 20))
          if (i % 5 === 4) throw new Error('fail after allocation')
          return a.seq
        }),
      ),
    )
    const ok = results.filter((r): r is PromiseFulfilledResult<number> => r.status === 'fulfilled').map((r) => r.value)
    const failed = results.filter((r) => r.status === 'rejected')
    expect(failed.length).toBe(10)
    expect(failed.every((f) => (f as PromiseRejectedResult).reason.message === 'fail after allocation')).toBe(true)
    expect(ok.length).toBe(40)
    expect(new Set(ok).size).toBe(40)
    const sorted = [...ok].sort((a, b) => a - b)
    expect(sorted[0]).toBe(base + 2)
    expect(sorted[39]).toBe(base + 41) // gapless
    const c = await sqlAs('app', "SELECT next_value FROM document_sequence_counters WHERE company_id = $1 AND doc_type = 'expense_request' AND period_key = 'ALL'", [cid])
    expect(c.rows[0].next_value).toBe(base + 42)
  })

  it('50 purely parallel allocations all succeed, unique and gapless', async () => {
    const p = await getTestPayload()
    const seqs = await Promise.all(Array.from({ length: 50 }, () => withSystemTransaction(p, null, async (req) => (await allocateDocNo(req, 'expense_request', { companyId: cid, audit: false })).seq)))
    const sorted = [...seqs].sort((a, b) => a - b)
    expect(new Set(seqs).size).toBe(50)
    expect(sorted[49]! - sorted[0]!).toBe(49)
    expect(sorted[0]).toBe(base + 42)
  })

  it('monthly reset per period for TRF/KK', async () => {
    const p = await getTestPayload()
    // periods no other test file uses (the F2a flow tests post transfers in 2026)
    const a = await withSystemTransaction(p, null, (req) => allocateDocNo(req, 'transfer', { companyId: cid, date: parseBusinessDate('2031-09-30') }))
    const b = await withSystemTransaction(p, null, (req) => allocateDocNo(req, 'transfer', { companyId: cid, date: parseBusinessDate('2031-10-01') }))
    expect([a.docNo, b.docNo]).toEqual(['TRF/3109/0001', 'TRF/3110/0001'])
  })

  it('refuses to allocate outside a transaction', async () => {
    const p = await getTestPayload()
    const { createLocalReq } = await import('payload')
    const req = await createLocalReq({}, p)
    await expect(allocateDocNo(req, 'expense_request', { companyId: cid })).rejects.toThrow(/no active transaction/)
  })
})
