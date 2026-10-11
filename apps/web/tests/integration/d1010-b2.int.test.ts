import { randomUUID } from 'node:crypto'

import { PgDialect } from '@payloadcms/db-postgres/drizzle/pg-core'
import pg from 'pg'
import { beforeAll, describe, expect, it } from 'vitest'

import { SKIP_COMPANY_DEFAULTS } from '@/domain/company-defaults'
import { transferQueue } from '@/domain/expense/queues'
import { addDays } from '@/domain/expense/types'
import { DEFAULT_SEQUENCES, parseBusinessDate } from '@/domain/numbering'
import { allocateDocNo } from '@/domain/numbering-db'
import { resetRateLimits } from '@/lib/rate-limit'
import { down as pbDown, up as pbUp } from '@/migrations/20261012_300200_d1010_pb_monthly'

import { api, asUser, draftBody, makeWorld, png, upload, type FlowUser, type World } from './flow-world'
import { companyId, getTestPayload, sqlAs, sqlError } from './helpers'

/**
 * DRMS 10/10 Phase B-2: D3 computed line total + "Nominal sesuai nota" / "Selisih nota" flag (API, admin
 * REST, DB guard, transfer queue), point 13 LPJ photos (API, freeze, DB guard), PB numbering monthly per PT
 * (allocation + data migration). Fictional data.
 */
const E = '/api/v1/expense-requests'
let w: World

beforeAll(async () => {
  w = await makeWorld(`bw${Date.now() % 100000}`)
})

/** Runs a migration function like `payload migrate` does: one OWNER connection, one transaction. */
async function migrate(fn: typeof pbUp): Promise<Array<Record<string, unknown>>> {
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

const line = (over: Record<string, unknown> = {}) => ({ description: 'Penginapan', qty: 2, uomId: w.uom.kmr, unitPrice: 339_000, categoryId: w.cat.inap, ...over })

describe('D3: line total = qty × harga satuan (server-computed)', () => {
  let id = 0
  it('API: a client total is ignored; qty empty = 1; total-only (old APK) → unit price = total ÷ qty', async () => {
    resetRateLimits()
    const r = await api('POST', E, w.users.staffA, draftBody(w, { lines: [line({ total: 1 }), { description: 'Makan', total: 150_000, categoryId: w.cat.ksm }, line({ qty: null, uomId: null, unitPrice: 25_500 })] }))
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    id = r.body.id
    expect(r.body.lines.map((l: { unitPrice: number; total: number }) => [l.unitPrice, l.total])).toEqual([
      [339_000, 678_000],
      [150_000, 150_000],
      [25_500, 25_500],
    ])
    expect(r.body.grandTotal).toBe(853_500)
  })

  it('receiptAmount ≠ total → receiptMismatch + flag "Selisih nota" (receipt_amount_mismatch) with line no., total, nota, difference', async () => {
    const d = (await api('GET', `${E}/${id}`, w.users.staffA)).body
    const lines = d.lines.map((l: { id: string; description: string; qty: number | null; uom: { id: number } | null; unitPrice: number; category: { id: number } }) => ({
      id: l.id,
      description: l.description,
      qty: l.qty,
      uomId: l.uom?.id ?? null,
      unitPrice: l.unitPrice,
      categoryId: l.category.id,
    }))
    lines[0] = { ...lines[0], receiptAmount: 650_000 }
    lines[1] = { ...lines[1], receiptAmount: 150_000 }
    const u = await api('PATCH', `${E}/${id}`, w.users.staffA, { lines })
    expect(u.status, JSON.stringify(u.body)).toBe(200)
    expect(u.body.lines.map((l: { receiptAmount: number | null; receiptMismatch: boolean }) => [l.receiptAmount, l.receiptMismatch])).toEqual([
      [650_000, true],
      [150_000, false],
      [null, false],
    ])
    expect(u.body.grandTotal).toBe(853_500) // amounts stay on the computed totals
    const f = u.body.flags.filter((x: { kind: string }) => x.kind === 'receipt_amount_mismatch')
    expect(f).toEqual([expect.objectContaining({ kindLabel: 'Selisih nota', lineNo: 1, level: 'warning', status: 'open', message: 'Baris 1: total Rp 678.000, nominal nota Rp 650.000, selisih Rp 28.000 (nota lebih kecil).' })])
  })

  it('the flag follows the line: fixed nota → resolved; submit keeps the computed amounts; transfer queue shows "Selisih nota"', async () => {
    const d = (await api('GET', `${E}/${id}`, w.users.staffA)).body
    const lines = d.lines.map((l: { id: string; description: string; qty: number | null; uom: { id: number } | null; unitPrice: number; category: { id: number }; receiptAmount: number | null }) => ({
      id: l.id,
      description: l.description,
      qty: l.qty,
      uomId: l.uom?.id ?? null,
      unitPrice: l.unitPrice,
      categoryId: l.category.id,
      receiptAmount: l.receiptAmount,
    }))
    const fixed = await api('PATCH', `${E}/${id}`, w.users.staffA, { lines: lines.map((l: Record<string, unknown>, i: number) => (i === 0 ? { ...l, receiptAmount: 678_000 } : l)) })
    expect(fixed.body.flags.filter((x: { kind: string }) => x.kind === 'receipt_amount_mismatch')).toEqual([])
    const again = await api('PATCH', `${E}/${id}`, w.users.staffA, { lines: lines.map((l: Record<string, unknown>, i: number) => (i === 0 ? { ...l, receiptAmount: 677_500 } : l)) })
    expect(again.body.flags.filter((x: { kind: string }) => x.kind === 'receipt_amount_mismatch')).toEqual([expect.objectContaining({ level: 'info', lineNo: 1 })]) // Rp 500 ≤ tolerance
    expect((await api('POST', `${E}/${id}/submit`, w.users.staffA, {})).status).toBe(200)
    expect((await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {})).status).toBe(200)
    const ok = await api('POST', `${E}/${id}/approve`, w.users.finance, {})
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body).toMatchObject({ status: 'approved', approvedAmount: 853_500 })
    const q = await asUser(w.users.finance, (req) => transferQueue(req))
    expect(q.find((x) => x.id === id)!.flags).toMatchObject({ receiptMismatch: 1 })
    // the frozen content includes the receipt amount (DB: content hash)
    const err = await sqlError('app', `UPDATE expense_requests_lines SET receipt_amount = 1 WHERE _parent_id = ${id}`)
    expect(err?.code).toBe('42501')
  })

  it('incomplete line (no exact unit price) saves as draft but cannot be submitted', async () => {
    const r = await api('POST', E, w.users.staffA, draftBody(w, { lines: [{ description: 'BBM', qty: 24.8, uomId: w.uom.l, total: 250_000, categoryId: w.cat.mat }] }))
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body.lines[0]).toMatchObject({ unitPrice: null, total: 0 })
    const s = await api('POST', `${E}/${r.body.id}/submit`, w.users.staffA, {})
    expect(s.status).toBe(400)
    expect(JSON.stringify(s.body)).toMatch(/Harga satuan wajib diisi/)
  })

  it('admin form (Payload REST) gets the same rule; the DB refuses a total ≠ qty × unit price on editable content', async () => {
    const r = await api('POST', '/api/expense-requests', w.users.staffA, {
      type: 'advance',
      title: 'Form admin D3',
      project: w.project,
      bankAccount: w.accA,
      lines: [{ description: 'Pasir', qty: 3, uom: w.uom.l, unitPrice: 1_000, total: 5, receiptAmount: 2_500, category: w.cat.mat }],
    })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const rid = r.body.doc.id as number
    expect(r.body.doc.lines[0]).toMatchObject({ total: 3_000, receiptAmount: 2_500 })
    expect(r.body.doc.grandTotal).toBe(3_000)
    const bad = await sqlError('app', `UPDATE expense_requests_lines SET total = total + 1 WHERE _parent_id = ${rid}; UPDATE expense_requests SET grand_total = grand_total + 1 WHERE id = ${rid};`)
    expect(bad?.code).toBe('23514')
    expect(bad?.message).toMatch(/qty × unit price/)
    expect((await sqlError('app', `UPDATE expense_requests_lines SET receipt_amount = -1 WHERE _parent_id = ${rid}`))?.code).toBe('23514')
  })

  it('type label "Pengajuan Baru" for advance', async () => {
    const r = await api('GET', `${E}?limit=50`, w.users.staffA)
    expect(r.status).toBe(200)
    const item = r.body.items.find((x: { type: string }) => x.type === 'advance')
    expect(item?.typeLabel).toBe('Pengajuan Baru')
  })
})

// ---------------------------------------------------------------- point 13 LPJ photos

async function proof(): Promise<number> {
  const r = await upload('/api/v1/media/transfer-proofs', w.users.finance, await png())
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body.id
}

async function image(user: FlowUser = w.users.staffA): Promise<number> {
  const r = await upload('/api/v1/media/receipts', user, await png())
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body.id as number
}

describe('point 13: LPJ photos', () => {
  let id = 0
  let photos: number[] = []
  beforeAll(async () => {
    resetRateLimits()
    const c = await api('POST', E, w.users.staffA, draftBody(w))
    id = c.body.id
    expect((await api('POST', `${E}/${id}/submit`, w.users.staffA, {})).status).toBe(200)
    expect((await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {})).status).toBe(200)
    expect((await api('POST', `${E}/${id}/approve`, w.users.finance, {})).status).toBe(200)
    expect((await api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `B2-${id}`, proofMediaId: await proof() })).status).toBe(201)
    const lineId = c.body.lines[0].id as string
    const rc = await api('POST', `${E}/${id}/receipts`, w.users.staffA, { lineId, receiptNo: `B2-${randomUUID().slice(0, 6)}`, vendorName: 'Toko Uji', receiptDate: addDays(new Date().toISOString().slice(0, 10), -1), amount: 600_000, imageId: await image() })
    expect(rc.status, JSON.stringify(rc.body)).toBe(201)
    expect((await api('POST', `${E}/${id}/receipts-complete`, w.users.staffA, {})).status).toBe(200)
  })

  it('requester sets the photo set while the LPJ is Draft; others / foreign uploads / > 10 refused', async () => {
    photos = [await image(), await image()]
    expect((await api('PUT', `${E}/${id}/lpj/photos`, w.users.finance, { photos })).status).toBe(403)
    const foreign = await image(w.users.staffB)
    expect((await api('PUT', `${E}/${id}/lpj/photos`, w.users.staffA, { photos: [foreign] })).status).toBe(403)
    expect((await api('PUT', `${E}/${id}/lpj/photos`, w.users.staffA, { photos: Array.from({ length: 11 }, (_, i) => i + 1) })).status).toBe(400)
    const r = await api('PUT', `${E}/${id}/lpj/photos`, w.users.staffA, { photos })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.settlement.photos).toEqual(photos)
    // remove one, then the submit sends the final set
    expect((await api('PUT', `${E}/${id}/lpj/photos`, w.users.staffA, { photos: [photos[0]] })).body.settlement.photos).toEqual([photos[0]])
    const extra = await image()
    const s = await api('POST', `${E}/${id}/lpj/submit`, w.users.staffA, { usageNotes: 'Material dan foto lokasi.', photos: [photos[0], extra] })
    expect(s.status, JSON.stringify(s.body)).toBe(200)
    photos = [photos[0]!, extra]
    expect(s.body.settlement).toMatchObject({ status: 'submitted', photos })
  })

  it('Finance reads the photos (authorized media endpoint); the set is frozen after Kirim LPJ (service + DB)', async () => {
    const f = await api('GET', `/api/v1/media/receipts/${photos[0]}/file`, w.users.finance)
    expect(f.status).toBe(200)
    expect((await api('PUT', `${E}/${id}/lpj/photos`, w.users.staffA, { photos: [photos[0]] })).status).toBe(409)
    const sid = (await sqlAs('app', 'SELECT id FROM settlements WHERE request_id = $1', [id])).rows[0].id as number
    const err = await sqlError('app', `DELETE FROM settlements_rels WHERE parent_id = ${sid} AND path = 'photos' AND media_receipts_id = ${photos[1]}`)
    expect(err?.code).toBe('42501')
    // a revision re-opens the set
    const rv = await api('POST', `${E}/${id}/lpj/request-revision`, w.users.finance, { note: 'Tambah foto barang.' })
    expect(rv.status, JSON.stringify(rv.body)).toBe(200)
    const more = await api('PUT', `${E}/${id}/lpj/photos`, w.users.staffA, { photos: [...photos, await image()] })
    expect(more.status, JSON.stringify(more.body)).toBe(200)
    expect(more.body.settlement.photos).toHaveLength(3)
  })
})

// ---------------------------------------------------------------- PB numbering monthly per PT

describe('PB numbering: monthly reset from 1, independent per PT (owner 2026-10-11)', () => {
  it('two PTs get their own PB/<shortCode>/<YYMM>/0001 series; a new month starts at 0001 again', async () => {
    const p = await getTestPayload()
    const tag = randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, 'P')
    const pb = DEFAULT_SEQUENCES.find((s) => s.docType === 'expense_request')!
    const pts: Array<{ id: number; code: string }> = []
    for (const code of [`PA${tag}`, `PL${tag}`]) {
      const id = (await p.create({ collection: 'companies', data: { name: `PT Nomor ${code}`, shortCode: code, timezone: 'Asia/Makassar', active: false } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */, context: { [SKIP_COMPANY_DEFAULTS]: true } })).id as number
      await p.create({ collection: 'document-sequences', data: { ...pb, company: id, timezone: 'Asia/Makassar', active: true } as never, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
      pts.push({ id, code })
    }
    const next = (pt: { id: number }, date: string) => asUser(null, (req) => allocateDocNo(req, 'expense_request', { companyId: pt.id, date: parseBusinessDate(date) })).then((a) => a.docNo)
    const [a, b] = pts as [{ id: number; code: string }, { id: number; code: string }]
    expect(await next(a, '2034-01-05')).toBe(`PB/${a.code}/3401/0001`)
    expect(await next(a, '2034-01-20')).toBe(`PB/${a.code}/3401/0002`)
    expect(await next(b, '2034-01-21')).toBe(`PB/${b.code}/3401/0001`)
    expect(await next(a, '2034-02-01')).toBe(`PB/${a.code}/3402/0001`)
    expect(await next(b, '2034-02-02')).toBe(`PB/${b.code}/3402/0001`)
    // no PT code → no number (the code always comes from companies.shortCode)
    await p.update({ collection: 'companies', id: b.id, data: { shortCode: null } as never, overrideAccess: true /* SYSTEM-WRITE: fixture */ }).catch(() => null)
    const sc = (await sqlAs('app', 'SELECT short_code FROM companies WHERE id = $1', [b.id])).rows[0]?.short_code
    if (!sc) await expect(next(b, '2034-02-03')).rejects.toThrow(/Kode singkat PT/)
  })

  it('migration: default PB sequences move to monthly/1, the current month continues after its highest issued number; down restores', async () => {
    const p = await getTestPayload()
    const cid = await companyId()
    const seq = (await p.find({ collection: 'document-sequences', where: { and: [{ company: { equals: cid } }, { docType: { equals: 'expense_request' } }] }, limit: 1, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!
    const code = (await sqlAs('app', 'SELECT short_code FROM companies WHERE id = $1', [cid])).rows[0].short_code as string
    // state before the owner decision: never + 229, and an issued PB of the new shape in month 2035-03
    await sqlAs('owner', `UPDATE document_sequences SET pattern = 'PB/{COMPANY}/{YY}{MM}/{seq}', reset_policy = 'never', start_at = 229 WHERE id = ${Number(seq.id)}`)
    resetRateLimits()
    const draft = await api('POST', E, w.users.staffA, draftBody(w, { title: 'PB lama' }))
    await sqlAs('owner', `UPDATE expense_requests SET doc_no = 'PB/${code}/3503/0238' WHERE id = ${Number(draft.body.id)}`)
    const logs = await migrate(pbUp)
    expect(logs[0]!.movedSequences).toContain(`${cid}#${seq.id}`)
    const row = (await sqlAs('app', 'SELECT reset_policy::text AS r, start_at FROM document_sequences WHERE id = $1', [seq.id])).rows[0]
    expect(row).toEqual({ r: 'monthly', start_at: '1' })
    expect(await asUser(null, (req) => allocateDocNo(req, 'expense_request', { companyId: cid, date: parseBusinessDate('2035-03-31') })).then((a) => a.docNo)).toBe(`PB/${code}/3503/0239`)
    expect(await asUser(null, (req) => allocateDocNo(req, 'expense_request', { companyId: cid, date: parseBusinessDate('2035-04-01') })).then((a) => a.docNo)).toBe(`PB/${code}/3504/0001`)
    const audit = await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE doc_type = 'document_sequence' AND doc_id = $1 AND field = 'resetPolicy'", [String(seq.id)])
    expect(Number(audit.rows[0].n)).toBeGreaterThanOrEqual(1)
    await migrate(pbDown)
    expect((await sqlAs('app', 'SELECT reset_policy::text AS r, start_at FROM document_sequences WHERE id = $1', [seq.id])).rows[0]).toEqual({ r: 'never', start_at: '229' })
    await migrate(pbUp) // back to the shipped state for the following tests
    expect((await sqlAs('app', 'SELECT reset_policy::text AS r FROM document_sequences WHERE id = $1', [seq.id])).rows[0].r).toBe('monthly')
  })
})
