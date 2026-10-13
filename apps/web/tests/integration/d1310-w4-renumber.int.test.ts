import { createLocalReq, type Payload } from 'payload'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { postEntry, voidEntry } from '@/domain/cash/ledger'
import { historyRows } from '@/domain/history'
import { historyEntry } from '@/domain/history-format'
import { parseBusinessDate } from '@/domain/numbering'
import { allocateDocNo } from '@/domain/numbering-db'
import { withSystemTransaction } from '@/lib/system-tx'
import { RENUMBER_GUARDED_FUNCTIONS, RENUMBER_MARKER, RENUMBER_NEUTRAL_FUNCTIONS } from '@/migrations/20261013_610000_d1310_renumber'
import { applyRenumber, dryRun, RenumberRefused, verifyRenumber, type Scope } from '@/renumber/db'

import { sysCreate } from './flow-world'
import { getTestPayload, makeUser, sqlAs, sqlError } from './helpers'

/**
 * DRMS 13/10 Wave 4 (Umum #1) — the ONE-TIME renumbering (ADR 0007 amendment 2026-10-13) against Postgres, with the
 * real guards: dry-run writes nothing; apply (owner, one transaction) renumbers per PT × type × month in created_at
 * order, rewrites the derived text, audits every change, resets the counters (next document = n + 1), fixes the KM
 * pattern without the PT code; a second run is refused; afterwards an ordinary number change is still refused (also
 * with the session flag but without a registered run). Two fresh fictional PTs: A (in scope) and B (out of scope —
 * the same legacy KM string must stay untouched there). Months 2030-03/04 are used by no other file.
 */
let p: Payload
let A = 0
let B = 0
let codeA = ''
let codeB = ''
let owner: pg.Client
let app: pg.Client
const scopeA = (): Scope => ({ codes: [codeA] })
const ids = { ra: 0, rb: 0, rc: 0, rd: 0, km1: 0, km2: 0, kk1: 0, kk2: 0, kmB: 0, kkB: 0, notif: 0, flag: 0 }
const old = { ra: '', rb: '', rc: '', rd: '' }

async function insertRequest(company: number, docNo: string, date: string, createdAt: string, title: string): Promise<number> {
  // a CANCELLED request (locked status: the guard refuses any content / number change) inserted as the owner, with the
  // content hash its (empty) lines have — the number came from the paper series / an earlier pattern
  const r = await sqlAs(
    'owner',
    `WITH n AS (SELECT nextval(pg_get_serial_sequence('expense_requests', 'id'))::int AS id)
     INSERT INTO expense_requests (id, company_id, type, status, title, doc_no, request_date, content_hash, created_at, updated_at)
     SELECT n.id, $1, 'advance', 'cancelled', $2, $3, $4, pk_expense_content_hash(n.id), $5::timestamptz, $5::timestamptz FROM n RETURNING id`,
    [company, title, docNo, date, createdAt],
  )
  return r.rows[0].id as number
}

const post = (input: Parameters<typeof postEntry>[1]) => withSystemTransaction(p, null, (req) => postEntry(req, input))
const entryNo = async (id: number) => (await sqlAs('app', 'SELECT entry_no, description FROM cash_entries WHERE id = $1', [id])).rows[0] as { entry_no: string; description: string | null }
const docNo = async (id: number) => (await sqlAs('app', 'SELECT doc_no FROM expense_requests WHERE id = $1', [id])).rows[0].doc_no as string

/** Everything of PT A the renumbering may touch (+ B's rows), to prove a run that must not write wrote nothing. */
async function snapshot() {
  const q = async (sqlText: string, params: unknown[] = []) => (await sqlAs('owner', sqlText, params)).rows
  return {
    requests: await q('SELECT id, doc_no, updated_at FROM expense_requests WHERE company_id = ANY($1) ORDER BY id', [[A, B]]),
    cash: await q('SELECT id, entry_no, description, updated_at FROM cash_entries WHERE company_id = ANY($1) ORDER BY id', [[A, B]]),
    sequences: await q('SELECT id, pattern, padding, reset_policy, start_at FROM document_sequences WHERE company_id = ANY($1) ORDER BY id', [[A, B]]),
    counters: await q('SELECT company_id, doc_type, period_key, next_value FROM document_sequence_counters WHERE company_id = ANY($1) ORDER BY 1, 2, 3', [[A, B]]),
    notifications: await q('SELECT id, doc_no, title, body FROM notifications WHERE company_id = ANY($1) ORDER BY id', [[A, B]]),
    flags: await q('SELECT id, message, detail FROM receipt_flags WHERE company_id = ANY($1) ORDER BY id', [[A, B]]),
    audit: await q("SELECT count(*)::int AS n FROM audit_logs WHERE company_id = ANY($1) AND action::text IN ('renumbered', 'update')", [[A, B]]),
    runs: await q('SELECT count(*)::int AS n FROM document_renumber_runs WHERE company_id = ANY($1)', [[A, B]]),
  }
}

beforeAll(async () => {
  p = await getTestPayload()
  const n = Date.now() % 1000
  codeA = `RNA${n}`
  codeB = `RNB${n}`
  A = await sysCreate('companies', { name: 'PT Uji Nomor Ulang A', shortCode: codeA, timezone: 'Asia/Makassar' })
  B = await sysCreate('companies', { name: 'PT Uji Nomor Ulang B', shortCode: codeB, timezone: 'Asia/Makassar' })
  // sequences: PB / KK with the PT code; KM still on the legacy custom pattern WITHOUT it (the prod finding)
  for (const c of [A, B]) {
    await sqlAs('owner', "UPDATE document_sequences SET pattern = 'PB/{COMPANY}/{YY}{MM}/{seq}', padding = 4, reset_policy = 'monthly', start_at = 1 WHERE company_id = $1 AND doc_type = 'expense_request'", [c])
    await sqlAs('owner', "UPDATE document_sequences SET pattern = 'KM/{YY}{MM}/{seq}', padding = 4, reset_policy = 'monthly', start_at = 1 WHERE company_id = $1 AND doc_type = 'cash_in'", [c])
    await sqlAs('owner', "UPDATE document_sequences SET pattern = 'KK/{COMPANY}/{YY}{MM}/{seq}', padding = 4, reset_policy = 'monthly', start_at = 1 WHERE company_id = $1 AND doc_type = 'cash_out'", [c])
  }
  const accA = await sysCreate('cash-accounts', { company: A, name: 'Kas Uji Nomor A', kind: 'bank', openingBalance: 50_000_000 })
  const accB = await sysCreate('cash-accounts', { company: B, name: 'Kas Uji Nomor B', kind: 'bank', openingBalance: 50_000_000 })

  // ---- PT A: PB numbers out of created_at order (a swap) + the old paper series
  old.ra = `PB/${codeA}/3003/0002`
  old.rb = `PB/${codeA}/3003/0001`
  old.rc = `229/PB-${codeA}/03/III/2030`
  old.rd = `230/PB-${codeA}/02/IV/2030`
  ids.ra = await insertRequest(A, old.ra, '2030-03-01', '2030-03-01T01:00:00Z', 'Semen')
  ids.rb = await insertRequest(A, old.rb, '2030-03-02', '2030-03-02T01:00:00Z', 'Pasir')
  ids.rc = await insertRequest(A, old.rc, '2030-03-03', '2030-03-03T01:00:00Z', 'Besi')
  ids.rd = await insertRequest(A, old.rd, '2030-04-02', '2030-04-02T01:00:00Z', 'Cat')
  await sqlAs(
    'owner',
    `INSERT INTO document_sequence_counters (company_id, doc_type, period_key, next_value) VALUES
       ($1, 'expense_request', 'ALL', 232), ($1, 'expense_request', '2030-03', 3), ($1, 'expense_request', '2030-05', 4)`,
    [A],
  )

  // ---- PT A cash (real postings → legacy KM numbers, a KK quoting PB numbers, a reversal quoting a KM number)
  ids.km1 = (await post({ direction: 'in', entryDate: '2030-03-20', cashAccountId: accA, amount: 100_000, description: 'Setoran modal', sourceType: 'manual' })).id
  ids.km2 = (await post({ direction: 'in', entryDate: '2030-03-05', cashAccountId: accA, amount: 200_000, description: 'Setoran kedua', sourceType: 'manual' })).id
  ids.kk1 = (await post({ direction: 'out', entryDate: '2030-03-10', cashAccountId: accA, amount: 50_000, description: `Bayar ${old.ra} dan ${old.rc}`, sourceType: 'manual' })).id
  ids.kk2 = (await withSystemTransaction(p, null, (req) => voidEntry(req, ids.km2, 'salah input'))).reversal.id
  await sqlAs('owner', "UPDATE document_sequence_counters SET next_value = 9 WHERE company_id = $1 AND doc_type = 'cash_out' AND period_key = '2030-03'", [A]) // a gap
  const userA = await makeUser(['pk-finance'], { company: A, label: 'renum-a' })
  ids.notif = (
    await sqlAs(
      'app',
      `INSERT INTO notifications (user_id, company_id, event, title, body, doc_type, doc_id, doc_no) VALUES ($1, $2, 'expense.approved', $3, $4, 'expense_request', $5, $6) RETURNING id`,
      [userA.id, A, `Disetujui: ${old.rb}`, `Pengajuan "Pasir" disetujui (lihat juga ${old.ra}).`, String(ids.rb), old.rb],
    )
  ).rows[0].id
  ids.flag = (
    await sqlAs(
      'owner',
      `INSERT INTO receipt_flags (company_id, request_id, key, kind, level, message, detail, related_request_id) VALUES ($1, $2, 'dup:renum', 'duplicate', 'warning', $3, $4::jsonb, $5) RETURNING id`,
      [A, ids.rc, `Nota sudah dipakai di pengajuan ${old.ra} (foto identik).`, JSON.stringify({ otherRequestId: ids.ra, otherDocNo: old.ra, via: 'image' }), ids.ra],
    )
  ).rows[0].id

  // ---- PT B (out of scope): the SAME legacy KM string and a description quoting it
  ids.kmB = (await post({ direction: 'in', entryDate: '2030-03-20', cashAccountId: accB, amount: 100_000, description: 'Setoran B', sourceType: 'manual' })).id
  ids.kkB = (await post({ direction: 'out', entryDate: '2030-03-21', cashAccountId: accB, amount: 10_000, description: 'Lihat KM/3003/0001', sourceType: 'manual' })).id

  owner = new pg.Client({ connectionString: process.env.PK_TEST_DATABASE_URL_OWNER })
  app = new pg.Client({ connectionString: process.env.PK_TEST_DATABASE_URL })
  await owner.connect()
  await app.connect()
})

afterAll(async () => {
  await owner?.end()
  await app?.end()
  // every other test file assumes the single-company default
  for (const id of [A, B]) if (id) await p.update({ collection: 'companies', id, data: { active: false, changeReason: 'uji penomoran ulang selesai' } as never, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
})

describe('fixture (the starting point)', () => {
  it('legacy numbers as issued: KM without PT code, the same KM string in PT B, reversal KK', async () => {
    expect((await entryNo(ids.km1)).entry_no).toBe('KM/3003/0001')
    expect((await entryNo(ids.km2)).entry_no).toBe('KM/3003/0002')
    expect((await entryNo(ids.kmB)).entry_no).toBe('KM/3003/0001')
    expect(await entryNo(ids.kk2)).toEqual({ entry_no: `KK/${codeA}/3003/0002`, description: 'Jurnal balik KM/3003/0002: salah input' })
  })
})

describe('mechanism (migration 20261013_610000)', () => {
  it('every guard carries the prelude; every other UPDATE trigger function of the renumbered tables is known as neutral', async () => {
    const r = await sqlAs(
      'owner',
      `SELECT DISTINCT p.proname, pg_get_functiondef(p.oid) AS def
         FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_proc p ON p.oid = g.tgfoid
        WHERE NOT g.tgisinternal AND (g.tgtype & 16) <> 0
          AND c.relname = ANY($1)`,
      [['expense_requests', 'transfers', 'settlements', 'cash_entries', 'progress_reports', 'budget_addenda', 'service_reports', 'daily_reports', 'project_loans', 'notifications', 'receipt_flags', 'document_sequence_counters']],
    )
    const fns = r.rows as Array<{ proname: string; def: string }>
    const unknown = fns.filter((f) => !(RENUMBER_GUARDED_FUNCTIONS as readonly string[]).includes(f.proname) && !(RENUMBER_NEUTRAL_FUNCTIONS as readonly string[]).includes(f.proname)).map((f) => f.proname)
    expect(unknown).toEqual([])
    const missing = fns.filter((f) => (RENUMBER_GUARDED_FUNCTIONS as readonly string[]).includes(f.proname) && !f.def.includes(RENUMBER_MARKER)).map((f) => f.proname)
    expect(missing).toEqual([])
  })

  it('the app role cannot open the bypass: no INSERT on document_renumber_runs; the flag alone changes nothing', async () => {
    expect((await sqlError('app', "INSERT INTO document_renumber_runs (company_id, tx_id, status, operator, plan_sha256) VALUES (1, txid_current(), 'running', 'x', repeat('a', 64))"))?.code).toBe('42501')
    const e = await sqlError('app', `BEGIN; SET LOCAL pk.renumber = 'on'; UPDATE expense_requests SET doc_no = 'X' WHERE id = ${ids.ra}; COMMIT;`)
    expect(e?.code).toBe('42501')
    const e2 = await sqlError('owner', `BEGIN; SET LOCAL pk.renumber = 'on'; UPDATE cash_entries SET entry_no = 'X' WHERE id = ${ids.km1}; COMMIT;`)
    expect(e2?.code).toBe('42501')
  })
})

describe('dry-run (no writes)', () => {
  it('full mapping per PT × type × month in created_at order, derived text, counters, KM pattern fix — and nothing written', async () => {
    const before = await snapshot()
    const r = await dryRun(owner, scopeA())
    expect(r.plan.errors).toEqual([])
    expect(r.alreadyApplied).toEqual([])
    const map = new Map(r.plan.items.map((i) => [`${i.table}:${i.id}`, i.newNo]))
    expect(map.get(`expense_requests:${ids.ra}`)).toBe(`PB/${codeA}/3003/0001`)
    expect(map.get(`expense_requests:${ids.rb}`)).toBe(`PB/${codeA}/3003/0002`)
    expect(map.get(`expense_requests:${ids.rc}`)).toBe(`PB/${codeA}/3003/0003`)
    expect(map.get(`expense_requests:${ids.rd}`)).toBe(`PB/${codeA}/3004/0001`)
    expect(map.get(`cash_entries:${ids.km1}`)).toBe(`KM/${codeA}/3003/0001`)
    expect(map.get(`cash_entries:${ids.km2}`)).toBe(`KM/${codeA}/3003/0002`)
    expect(map.get(`cash_entries:${ids.kk1}`)).toBe(`KK/${codeA}/3003/0001`)
    expect(map.has(`cash_entries:${ids.kmB}`)).toBe(false) // PT B is out of scope
    expect(r.plan.patternFixes.map((f) => [f.companyId, f.docType, f.to.pattern])).toContainEqual([A, 'cash_in', 'KM/{COMPANY}/{YY}{MM}/{seq}'])
    expect(r.text.map((t) => [t.table, t.id, t.column])).toEqual(
      expect.arrayContaining([
        ['cash_entries', ids.kk1, 'description'],
        ['cash_entries', ids.kk2, 'description'],
        ['notifications', ids.notif, 'doc_no'],
        ['notifications', ids.notif, 'title'],
        ['notifications', ids.notif, 'body'],
        ['receipt_flags', ids.flag, 'message'],
        ['receipt_flags', ids.flag, 'detail'],
      ]),
    )
    expect(await snapshot()).toEqual(before)
  })
})

describe('apply (one transaction, owner)', () => {
  it('refuses the app role, and a plan that differs from the reviewed sha256 — nothing changed', async () => {
    const before = await snapshot()
    await expect(applyRenumber(app, { scope: scopeA(), operator: 'uji' })).rejects.toMatchObject({ code: 'not_owner' })
    await expect(applyRenumber(owner, { scope: scopeA(), operator: 'uji', expectSha256: '0'.repeat(64) })).rejects.toBeInstanceOf(RenumberRefused)
    expect(await snapshot()).toEqual(before)
  })

  let txId = ''
  it('renumbers, rewrites derived text, audits each change in the same transaction, resets counters, fixes KM', async () => {
    const reviewed = await dryRun(owner, scopeA())
    const res = await applyRenumber(owner, { scope: scopeA(), operator: 'Lead uji', expectSha256: reviewed.plan.sha256 })
    txId = res.txId
    expect(res.plan.sha256).toBe(reviewed.plan.sha256)

    // numbers (the swap ra/rb went through the temporary phase)
    expect(await docNo(ids.ra)).toBe(`PB/${codeA}/3003/0001`)
    expect(await docNo(ids.rb)).toBe(`PB/${codeA}/3003/0002`)
    expect(await docNo(ids.rc)).toBe(`PB/${codeA}/3003/0003`)
    expect(await docNo(ids.rd)).toBe(`PB/${codeA}/3004/0001`)
    expect((await entryNo(ids.km1)).entry_no).toBe(`KM/${codeA}/3003/0001`)
    expect((await entryNo(ids.km2)).entry_no).toBe(`KM/${codeA}/3003/0002`)

    // derived text
    expect((await entryNo(ids.kk1)).description).toBe(`Bayar PB/${codeA}/3003/0001 dan PB/${codeA}/3003/0003`)
    expect((await entryNo(ids.kk2)).description).toBe(`Jurnal balik KM/${codeA}/3003/0002: salah input`)
    const nt = (await sqlAs('app', 'SELECT doc_no, title, body FROM notifications WHERE id = $1', [ids.notif])).rows[0]
    expect(nt).toEqual({ doc_no: `PB/${codeA}/3003/0002`, title: `Disetujui: PB/${codeA}/3003/0002`, body: `Pengajuan "Pasir" disetujui (lihat juga PB/${codeA}/3003/0001).` })
    const fl = (await sqlAs('app', 'SELECT message, detail FROM receipt_flags WHERE id = $1', [ids.flag])).rows[0]
    expect(fl.message).toBe(`Nota sudah dipakai di pengajuan PB/${codeA}/3003/0001 (foto identik).`)
    expect(fl.detail).toEqual({ otherRequestId: ids.ra, otherDocNo: `PB/${codeA}/3003/0001`, via: 'image' })

    // PT B untouched (same legacy string, out of scope)
    expect(await entryNo(ids.kmB)).toEqual({ entry_no: 'KM/3003/0001', description: 'Setoran B' })
    expect((await entryNo(ids.kkB)).description).toBe('Lihat KM/3003/0001')
    expect((await sqlAs('app', "SELECT pattern FROM document_sequences WHERE company_id = $1 AND doc_type = 'cash_in'", [B])).rows[0].pattern).toBe('KM/{YY}{MM}/{seq}')

    // KM pattern carries the PT code now (audited)
    expect((await sqlAs('app', "SELECT pattern FROM document_sequences WHERE company_id = $1 AND doc_type = 'cash_in'", [A])).rows[0].pattern).toBe('KM/{COMPANY}/{YY}{MM}/{seq}')
    const patAudit = await sqlAs('app', "SELECT tx_id::text AS tx FROM audit_logs WHERE doc_type = 'document_sequence' AND field = 'pattern' AND company_id = $1 AND action = 'update'", [A])
    expect(patAudit.rows.map((x) => x.tx)).toContain(txId)

    // one `renumbered` row per changed document, all in the run's transaction
    const au = await sqlAs('app', "SELECT doc_type, doc_id, field, old_value, new_value, tx_id::text AS tx, source FROM audit_logs WHERE action = 'renumbered' AND company_id = $1 ORDER BY id", [A])
    const numberRows = au.rows.filter((x) => x.field === 'docNo' || x.field === 'entryNo')
    expect(numberRows).toHaveLength(6) // 4 PB + 2 KM (the KK numbers were already right)
    expect(new Set(au.rows.map((x) => x.tx))).toEqual(new Set([txId]))
    expect(numberRows.find((x) => x.doc_id === String(ids.rc))).toMatchObject({ doc_type: 'expense_request', field: 'docNo', old_value: { v: old.rc }, new_value: { v: `PB/${codeA}/3003/0003` }, source: 'system' })
    expect(au.rows.filter((x) => x.field === 'description').map((x) => x.doc_id).sort()).toEqual([String(ids.kk1), String(ids.kk2)].sort())

    // counters: last number + 1 (down from 9 / 3 → 4 …), an emptied month back to 1, the legacy ALL key untouched
    const cs = await sqlAs('app', 'SELECT doc_type, period_key, next_value FROM document_sequence_counters WHERE company_id = $1 ORDER BY 1, 2', [A])
    expect(cs.rows).toEqual(
      expect.arrayContaining([
        { doc_type: 'expense_request', period_key: '2030-03', next_value: 4 },
        { doc_type: 'expense_request', period_key: '2030-04', next_value: 2 },
        { doc_type: 'expense_request', period_key: '2030-05', next_value: 1 },
        { doc_type: 'expense_request', period_key: 'ALL', next_value: 232 },
        { doc_type: 'cash_in', period_key: '2030-03', next_value: 3 },
        { doc_type: 'cash_out', period_key: '2030-03', next_value: 3 },
      ]),
    )
    const run = (await sqlAs('app', 'SELECT status, tx_id::text AS tx, documents, changed, operator FROM document_renumber_runs WHERE company_id = $1', [A])).rows
    expect(run).toEqual([{ status: 'applied', tx: txId, documents: 8, changed: 6, operator: 'Lead uji' }])
  })

  it('verification passes: no duplicates, counters, audit count, guards active and still refusing an ordinary change', async () => {
    const v = await verifyRenumber(owner, scopeA())
    expect(v.checks.filter((c) => !c.ok)).toEqual([])
    expect(v.ok).toBe(true)
  })

  it('the guards are back: ordinary number changes refused (app and owner, with or without the flag); counters only up', async () => {
    expect((await sqlError('app', `UPDATE expense_requests SET doc_no = 'PB/X/1' WHERE id = ${ids.ra}`))?.code).toBe('42501')
    expect((await sqlError('app', `UPDATE cash_entries SET entry_no = 'KM/X/1' WHERE id = ${ids.km1}`))?.code).toBe('42501')
    expect((await sqlError('app', `UPDATE notifications SET title = 'x' WHERE id = ${ids.notif}`))?.code).toBe('42501')
    expect((await sqlError('owner', `BEGIN; SET LOCAL pk.renumber = 'on'; UPDATE expense_requests SET doc_no = 'PB/X/1' WHERE id = ${ids.rb}; COMMIT;`))?.code).toBe('42501')
    expect((await sqlError('app', `UPDATE document_sequence_counters SET next_value = 1 WHERE company_id = ${A} AND doc_type = 'expense_request' AND period_key = '2030-03'`))?.message).toContain('may only increase')
  })

  it('the next new document continues at n + 1 (PB; KM with the PT code now; KK after the closed gap)', async () => {
    const pb = await withSystemTransaction(p, null, (req) => allocateDocNo(req, 'expense_request', { companyId: A, date: parseBusinessDate('2030-03-28'), audit: false }))
    expect(pb.docNo).toBe(`PB/${codeA}/3003/0004`)
    const acc = (await sqlAs('app', 'SELECT id FROM cash_accounts WHERE company_id = $1', [A])).rows[0].id as number
    const km = await post({ direction: 'in', entryDate: '2030-03-28', cashAccountId: acc, amount: 1_000, description: 'baru', sourceType: 'manual' })
    expect(km.entryNo).toBe(`KM/${codeA}/3003/0003`)
    const kk = await post({ direction: 'out', entryDate: '2030-03-28', cashAccountId: acc, amount: 1_000, description: 'baru', sourceType: 'manual' })
    expect(kk.entryNo).toBe(`KK/${codeA}/3003/0003`) // the counter was 9 (a gap) → back to last + 1
  })

  it('idempotent: a second apply is refused and changes nothing; the dry-run shows it as done with nothing left to change', async () => {
    const before = await snapshot()
    const err = await applyRenumber(owner, { scope: scopeA(), operator: 'Lead uji' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RenumberRefused)
    expect((err as RenumberRefused).code).toBe('already_applied')
    expect(await snapshot()).toEqual(before)
    const again = await dryRun(owner, scopeA())
    expect(again.alreadyApplied.map((a) => a.companyId)).toEqual([A])
    expect(again.plan.summary.changed).toBe(0)
  })

  it('"Log perubahan" shows the renumbering: "Nomor diubah: lama → baru"', async () => {
    const req = await createLocalReq({}, p)
    const rows = await historyRows(req, [{ docType: 'expense_request', ids: [String(ids.rc)] }], undefined, A)
    const entries = rows.filter((r) => r.action === 'renumbered').map((r) => historyEntry(r, 'Asia/Makassar'))
    expect(entries).toHaveLength(1)
    expect(`${entries[0]!.field}: ${entries[0]!.change}`).toBe(`Nomor diubah: ${old.rc} → PB/${codeA}/3003/0003`)
    expect(entries[0]!.action).toBe('nomor diubah')
  })
})
