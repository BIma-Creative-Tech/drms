import { randomUUID } from 'node:crypto'

import { PgDialect } from '@payloadcms/db-postgres/drizzle/pg-core'
import type { CollectionSlug } from 'payload'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { writeAudit } from '@/audit/writer'
import { resetRateLimits } from '@/lib/rate-limit'
import { down, up } from '@/migrations/20261003_090000_mc4_audit_company_backfill'
import { DEFAULT_SEED_DATA } from '@/seed/data'
import { seed } from '@/seed/seed'

import { api, asUser, makeFlowUser, sysCreate, uploadMedia, type FlowUser, type Res } from './flow-world'
import { addMembership, companyId, getTestPayload, installFakeKeycloak, sqlAs, sqlError } from './helpers'

/**
 * UAT defect MC4-04 (case AUD-02, staging 2026-10-02): audit rows written BEFORE the QA-MC4-03 writer fix carry
 * no PT, and untagged rows are readable only by group admins and the Admin / Direktur of every PT. With a second
 * PT, "Rina" (Direktur of A + Finance of B) lost the audit trail of A's older documents. Migration
 * `20261003_090000_mc4_audit_company_backfill` tags them with their document's PT.
 *
 * The historic rows are inserted as the OWNER with `company_id` NULL — exactly what the old writer stored — and
 * marked with a unique `request_id`. PTs: A = #1 DRMS, B = fictional "PT Contoh Audit" (CAU), deactivated in
 * afterAll.
 */
let A = 0
let B = 0
const X: Record<string, number> = {}
let docNoA = ''
let rina: FlowUser
let ownerB: FlowUser
const TAG = `mc4-04-${randomUUID().slice(0, 8)}`

const call = async (method: string, path: string, user: FlowUser, body?: unknown, headers: Record<string, string> = {}): Promise<Res> => {
  resetRateLimits()
  return api(method, path, user, body, headers)
}
const key = () => ({ 'Idempotency-Key': randomUUID() })

/** Runs a migration function like `payload migrate` does: one OWNER connection, one transaction. */
async function migrate(fn: typeof up | typeof down): Promise<Array<Record<string, unknown>>> {
  const c = new pg.Client({ connectionString: process.env.PK_TEST_DATABASE_URL_OWNER })
  await c.connect()
  const dialect = new PgDialect()
  const logs: Array<Record<string, unknown>> = []
  const db = { execute: async (q: unknown) => { const x = dialect.sqlToQuery(q as never); return c.query(x.sql, x.params) } }
  const payload = { logger: { info: (o: Record<string, unknown>) => logs.push(o) } }
  try {
    await c.query('BEGIN')
    await fn({ db, payload } as never)
    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK')
    throw e
  } finally {
    await c.end()
  }
  return logs
}

type Hist = { docType: string; docId: string | null; docNo?: string; action?: string; newValue?: unknown; expect: 'A' | 'B' | null; label: string }
const HIST: Hist[] = []
const tagOf = (h: Hist) => (h.expect === 'A' ? A : h.expect === 'B' ? B : null)

async function insertHistoric(): Promise<void> {
  for (const h of HIST) {
    await sqlAs(
      'owner',
      `INSERT INTO audit_logs (event_id, tx_id, request_id, doc_type, doc_id, doc_no, action, field, new_value, source)
       VALUES ($1, txid_current(), $2, $3, $4, $5, $6, $7, $8, 'web')`,
      [randomUUID(), TAG, h.docType, h.docId, h.docNo ?? null, h.action ?? 'update', h.label, JSON.stringify({ v: h.newValue ?? h.label })],
    )
  }
}
const ours = async () =>
  (await sqlAs('owner', 'SELECT id, field, company_id FROM audit_logs WHERE request_id = $1 ORDER BY id', [TAG])).rows as Array<{ id: number; field: string; company_id: number | null }>
const restCount = async (u: FlowUser): Promise<number> => {
  const r = await call('GET', `/api/audit-logs?limit=0&depth=0&where[requestId][equals]=${TAG}`, u)
  expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200)
  return Number(r.body.totalDocs)
}
const maintenanceRows = async () => Number((await sqlAs('owner', "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'schema_maintenance' AND field = 'company'")).rows[0]?.n)
const checksum = async () => String((await sqlAs('owner', "SELECT md5(string_agg(id::text || ':' || coalesce(company_id::text, '-'), ',' ORDER BY id)) AS h FROM audit_logs")).rows[0]?.h)

beforeAll(async () => {
  const p = await getTestPayload()
  installFakeKeycloak()
  const { uoms, banks, ...drms } = DEFAULT_SEED_DATA
  await seed(p, { uoms, banks, companies: [drms, { ...drms, company: { name: 'PT Contoh Audit', shortCode: 'CAU', timezone: 'Asia/Makassar' }, vehicles: [] }] })
  A = await companyId()
  B = await companyId('CAU')
  await p.update({ collection: 'companies', id: B, data: { active: true, changeReason: 'uji MC4-04' } as never, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  const inPt = async (company: number, collection: CollectionSlug, where: Record<string, unknown>) =>
    (await p.find({ collection, where: { and: [{ company: { equals: company } }, where] } as never, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number
  const bank = (await p.find({ collection: 'banks', where: { code: { equals: 'MANDIRI' } }, limit: 1, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number

  // a submitted request of PT A (doc number for the number_issued fallback)
  X.empA = await sysCreate('employees', { company: A, code: 'AUD-A1', name: 'Staff Audit A' })
  X.projectA = await sysCreate('projects', { company: A, code: 'AUD-PA', name: 'Proyek Audit A', budget: 10_000_000, status: 'berjalan' })
  X.teamA = await sysCreate('team-assignments', { employee: X.empA, project: X.projectA, roleInProject: 'staff' })
  X.accA = await sysCreate('employee-bank-accounts', { employee: X.empA, bank, accountNo: `95${Date.now() % 1e8}`, accountHolder: 'Staff Audit A', isDefault: true })
  X.catA = await inPt(A, 'expense-categories', { code: { equals: 'MAT' } })
  X.seqA = await inPt(A, 'document-sequences', { docType: { equals: 'expense_request' } })
  X.ruleA = await inPt(A, 'approval-rules', { docType: { equals: 'expense_request' } })
  X.projectB = await sysCreate('projects', { company: B, code: 'AUD-PB', name: 'Proyek Audit B', budget: 10_000_000, status: 'berjalan' })
  // Rina: Direktur of A + Finance of B (no office role in EVERY PT → no untagged rows); a B-only Direktur.
  // Rina is also the "Diketahui" Direktur of the request
  rina = await makeFlowUser(['pk-owner'], 'aud-rina', null, { company: A, signature: false, groupAdmin: false })
  await addMembership(rina.id, B, ['pk-finance'])
  ownerB = await makeFlowUser(['pk-owner'], 'aud-owner-b', null, { company: B, signature: false, groupAdmin: false })
  await makeFlowUser(['pk-finance'], 'aud-fin-a', null, { company: A, signature: false }) // approval level 1 holder
  const staffA = await makeFlowUser(['pk-staff'], 'aud-staff-a', X.empA, { company: A })
  const d = await call('POST', '/api/v1/expense-requests', staffA, { type: 'advance', title: 'Riwayat lama PT A', projectId: X.projectA, requesterIds: [X.empA], bankAccountId: X.accA, neededDate: '2026-10-30', lines: [{ description: 'Material', total: 1_234_000, categoryId: X.catA }] }, key())
  expect(d.status, JSON.stringify(d.body).slice(0, 300)).toBe(201)
  X.reqA = d.body.id as number
  const sub = await call('POST', `/api/v1/expense-requests/${X.reqA}/submit`, staffA, {}, key())
  expect(sub.status, JSON.stringify(sub.body).slice(0, 300)).toBe(200)
  docNoA = String((await sqlAs('owner', 'SELECT doc_no FROM expense_requests WHERE id = $1', [X.reqA])).rows[0]?.doc_no)
  X.mediaA = await uploadMedia('media-receipts', staffA)
  await sqlAs('owner', "UPDATE media_receipts SET owner_doc_type = 'expense_request', owner_doc_id = $1 WHERE id = $2", [String(X.reqA), X.mediaA])


  HIST.push(
    { docType: 'expense_request', docId: String(X.reqA), expect: 'A', label: 'request line (old writer)' },
    { docType: 'expense_request', docId: String(X.reqA), action: 'export', expect: 'A', label: 'pdf export' },
    { docType: 'expense_request', docId: null, docNo: docNoA, action: 'number_issued', expect: 'A', label: 'number without doc id' },
    { docType: 'project', docId: String(X.projectA), expect: 'A', label: 'project master' },
    { docType: 'employee', docId: String(X.empA), expect: 'A', label: 'employee' },
    { docType: 'employee_bank_account', docId: String(X.accA), expect: 'A', label: 'bank account' },
    { docType: 'team_assignment', docId: String(X.teamA), expect: 'A', label: 'team assignment' },
    { docType: 'document_sequence', docId: String(X.seqA), expect: 'A', label: 'sequence (import cut-over)' },
    { docType: 'approval_rule', docId: String(X.ruleA), expect: 'A', label: 'approval rule (E1 migration)' },
    { docType: 'company', docId: String(A), expect: 'A', label: 'the PT itself' },
    { docType: 'media_receipts', docId: String(X.mediaA), action: 'create', expect: 'A', label: 'receipt photo' },
    { docType: 'project', docId: String(X.projectB), expect: 'B', label: 'project of B' },
    { docType: 'expense_request', docId: '999999999', expect: null, label: 'document gone' },
    { docType: 'expense_request', docId: 'abc', expect: null, label: 'non-numeric id' },
    { docType: 'transfer', docId: null, docNo: `NOPE/${TAG}`, action: 'number_issued', expect: null, label: 'unknown number' },
    { docType: 'expense_request', docId: String(X.reqA), action: 'flag_raised', newValue: { level: 'warning', relatedCompanyId: B }, expect: null, label: 'cross-PT duplicate flag (untagged on purpose)' },
    { docType: 'user', docId: String(rina.id), expect: null, label: 'app-wide: user' },
    { docType: 'report', docId: 'audit-log', action: 'export', expect: null, label: 'app-wide: report export' },
  )
  await insertHistoric()
})

afterAll(async () => {
  const p = await getTestPayload()
  if (B) await p.update({ collection: 'companies', id: B, data: { active: false, changeReason: 'uji MC4-04 selesai' } as never, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
  await p.destroy()
})

describe('UAT MC4-04 / AUD-02: historic audit rows get the PT of their document', () => {
  it('before the backfill: Rina (Direktur A + Finance B) cannot read the historic rows of A (the defect)', async () => {
    expect((await ours()).every((r) => r.company_id === null)).toBe(true)
    expect(await restCount(rina)).toBe(0)
    expect(await restCount(ownerB)).toBe(0)
  })

  it('the migration tags every per-PT doc type from its document and leaves gone / app-wide / on-purpose rows NULL', async () => {
    const before = await maintenanceRows()
    const logs = await migrate(up)
    const rows = await ours()
    expect(rows.map((r) => [r.field, r.company_id])).toEqual(HIST.map((h) => [h.label, tagOf(h)]))
    expect(await maintenanceRows()).toBe(before + 1)
    const log = logs.find((l) => String(l.msg).includes('audit rows tagged'))!
    expect(log).toBeTruthy()
    for (const d of ['expense_request', 'project', 'employee', 'employee_bank_account', 'team_assignment', 'document_sequence', 'approval_rule', 'company', 'media_receipts']) {
      expect((log.tagged as Record<string, number>)[d], d).toBeGreaterThan(0)
    }
    expect((log.leftNullPerPtDocType as Record<string, number>).expense_request).toBeGreaterThanOrEqual(3)
    expect((log.leftNullAppWide as Record<string, number>).user).toBeGreaterThanOrEqual(1)
  })

  it('after the backfill: Rina reads the rows of A (and of B as Finance B); a B-only Direktur reads only the B row', async () => {
    const tagged = HIST.filter((h) => h.expect !== null)
    expect(await restCount(rina)).toBe(tagged.length)
    expect(await restCount(ownerB)).toBe(tagged.filter((h) => h.expect === 'B').length)
    const r = await call('GET', `/api/audit-logs?limit=0&depth=0&where[requestId][equals]=${TAG}&where[docType][equals]=expense_request&where[docId][equals]=${X.reqA}`, ownerB)
    expect(r.body.totalDocs).toBe(0)
  })

  it('append-only stays intact: the trigger is enabled again, UPDATE / DELETE still rejected for the owner', async () => {
    const t = (await sqlAs('owner', "SELECT tgenabled FROM pg_trigger WHERE tgname = 'audit_logs_no_update' AND tgrelid = 'audit_logs'::regclass")).rows[0]
    expect(t?.tgenabled).toBe('O')
    const id = (await ours())[0]!.id
    expect((await sqlError('owner', 'UPDATE audit_logs SET company_id = NULL WHERE id = $1', [id]))?.code).toBe('42501')
    expect((await sqlError('owner', 'DELETE FROM audit_logs WHERE id = $1', [id]))?.code).toBe('42501')
    expect((await sqlError('app', 'UPDATE audit_logs SET reason = $2 WHERE id = $1', [id, 'x']))?.code).toBe('42501')
  })

  it('idempotent: a re-run changes nothing and writes no second maintenance row', async () => {
    const [sum, n] = [await checksum(), await maintenanceRows()]
    const logs = await migrate(up)
    expect(await checksum()).toBe(sum)
    expect(await maintenanceRows()).toBe(n)
    expect(logs[0]?.tagged).toEqual({})
  })

  it('down is a no-op (tags kept); up after down changes nothing', async () => {
    const sum = await checksum()
    await migrate(down)
    expect(await checksum()).toBe(sum)
    expect((await ours()).filter((r) => r.company_id !== null).length).toBe(HIST.filter((h) => h.expect !== null).length)
    await migrate(up)
    expect(await checksum()).toBe(sum)
  })

  it('the current writer derives the PT of masters, sequences and media too (no new untagged rows)', async () => {
    const rid = `${TAG}-writer`
    await asUser(null, async (req) => {
      req.context.pkRequestId = rid
      await writeAudit(req, [
        { action: 'update', docType: 'document_sequence', docId: String(X.seqA), field: 'nextValue' },
        { action: 'update', docType: 'approval_rule', docId: String(X.ruleA), field: 'active' },
        { action: 'view_sensitive', docType: 'media_receipts', docId: String(X.mediaA), field: 'file' },
        { action: 'update', docType: 'project', docId: String(X.projectB), field: 'name' },
        { action: 'update', docType: 'user', docId: String(rina.id), field: 'name' },
      ])
    })
    const rows = (await sqlAs('owner', 'SELECT doc_type, company_id FROM audit_logs WHERE request_id = $1 ORDER BY id', [rid])).rows
    expect(rows.map((r) => [r.doc_type, r.company_id])).toEqual([
      ['document_sequence', A],
      ['approval_rule', A],
      ['media_receipts', A],
      ['project', B],
      ['user', null],
    ])
  })
})
