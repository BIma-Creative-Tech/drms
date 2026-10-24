import { randomUUID } from 'node:crypto'

import { PgDialect } from 'drizzle-orm/pg-core'
import pg from 'pg'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { resetRateLimits } from '@/lib/rate-limit'

import { down as siteAccountsDown, up as siteAccountsUp } from '@/migrations/20261024_500000_d2410_site_accounts_fund'

import { getTestPayload, sqlAs } from './helpers'
import { api, draftBody, makeWorld, sysCreate, type World } from './flow-world'

/**
 * DRMS 24/10 follow-ups after the five d2410 merges (user decisions), through the real DB:
 * A. funds without the site exclusion — migration 20261024_500000 clears every legacy site flag of a cash account
 *    (audited, NOTICE, idempotent, reversible) and `pk_fund_balance` counts every active account of the PT.
 * B. "Hapus draft" — the creator / requester soft-deletes an undecided Draft (never submitted or withdrawn before a
 *    decision): POST /expense-requests/{id}/delete-draft, reason optional, audited, number kept, gone from the lists;
 *    others 403 / 404, a request in the flow or decided 409.
 * Names and codes are fictional.
 */

/** `payload migrate` style: one owner connection + transaction (drizzle SQL rendered by the pg dialect), committed. */
async function asOwner(fn: (db: { execute: (q: unknown) => Promise<unknown> }) => Promise<void>): Promise<void> {
  const c = new pg.Client({ connectionString: process.env.PK_TEST_DATABASE_URL_OWNER })
  await c.connect()
  const dialect = new PgDialect()
  const db = {
    execute: async (q: unknown) => {
      const x = dialect.sqlToQuery(q as never)
      return c.query(x.sql, x.params as unknown[])
    },
  }
  try {
    await c.query('BEGIN')
    await fn(db)
    await c.query('COMMIT')
  } catch (err) {
    await c.query('ROLLBACK')
    throw err
  } finally {
    await c.end()
  }
}
const siteUp = () => asOwner((db) => siteAccountsUp({ db, payload: undefined } as never))
const siteDown = () => asOwner((db) => siteAccountsDown({ db, payload: undefined } as never))
const NAME = '20261024_500000_d2410_site_accounts_fund'

describe('A. site-flagged cash accounts count in the funds (migration 20261024_500000)', () => {
  it('clears the flag (audited, source system), counts the account in pk_fund_balance; idempotent; down restores', async () => {
    // own PT, deactivated at the end (every other file assumes the single-company default: "PT wajib dipilih")
    const tag = `FUA${Date.now() % 1e6}`
    const company = await sysCreate('companies', { name: `PT Contoh Dana ${tag}`, shortCode: tag, timezone: 'Asia/Makassar' })
    try {
      await siteFlow(company, tag)
    } finally {
      await (await getTestPayload()).update({ collection: 'companies', id: company, data: { active: false, changeReason: 'uji dana tanpa site selesai' } as never, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
    }
  })
})

async function siteFlow(company: number, tag: string) {
  const site = await sysCreate('sites', { company, code: `${tag}S`, name: 'Site Contoh' })
  const balance = async () => Number((await sqlAs('owner', 'SELECT pk_fund_balance($1)::bigint AS b', [company])).rows[0].b)
  const before = await balance()
  // a legacy flag (hidden column since ADR 0032) written after the migration ran in global setup
  const flagged = await sysCreate('cash-accounts', { company, name: `Kas kecil site ${tag}`, kind: 'cash', openingBalance: 40_000_000, openingBalanceDate: '2020-01-01', site })
  expect((await sqlAs('owner', 'SELECT site_id FROM cash_accounts WHERE id = $1', [flagged])).rows[0].site_id).toBe(site)
  // the function was patched by the migration already: the flagged account counts
  expect(await balance()).toBe(before + 40_000_000)

  await siteUp()
  expect((await sqlAs('owner', 'SELECT site_id FROM cash_accounts WHERE id = $1', [flagged])).rows[0].site_id).toBeNull()
  const audit = (await sqlAs('owner', "SELECT action::text AS action, field, source::text AS source, old_value, new_value, company_id FROM audit_logs WHERE doc_type = 'cash_account' AND doc_id = $1 AND new_value -> 'v' ->> 'migration' = $2", [String(flagged), NAME])).rows
  expect(audit).toHaveLength(1)
  expect(audit[0]).toMatchObject({ action: 'update', field: 'site', source: 'system', company_id: company, old_value: { v: { siteId: site } }, new_value: { v: { siteId: null } } })
  expect(await balance()).toBe(before + 40_000_000)

  await siteUp() // idempotent: nothing flagged any more, functions already patched
  expect((await sqlAs('owner', "SELECT count(*)::int AS n FROM audit_logs WHERE doc_type = 'cash_account' AND doc_id = $1 AND new_value -> 'v' ->> 'migration' = $2", [String(flagged), NAME])).rows[0].n).toBe(1)

  const up1 = await balance()
  await siteDown()
  expect((await sqlAs('owner', 'SELECT site_id FROM cash_accounts WHERE id = $1', [flagged])).rows[0].site_id).toBe(site)
  expect(up1 - (await balance())).toBeGreaterThanOrEqual(40_000_000) // the old filter is back (this account at least)
  const def = (await sqlAs('owner', "SELECT pg_get_functiondef('pk_icl_transfer_guard'::regproc) AS d")).rows[0].d as string
  expect(def).toContain('a.site_id IS NULL')

  await siteUp() // the state the other files see
  expect(await balance()).toBe(up1)
  expect(((await sqlAs('owner', "SELECT pg_get_functiondef('pk_icl_transfer_guard'::regproc) AS d")).rows[0].d as string).includes('site_id')).toBe(false)
}

describe('B. "Hapus draft" (POST /expense-requests/{id}/delete-draft)', () => {
  const E = '/api/v1/expense-requests'
  const key = () => ({ 'Idempotency-Key': randomUUID() })
  let w: World
  beforeAll(async () => {
    w = await makeWorld(`fub${Date.now() % 100000}`)
  })
  beforeEach(() => resetRateLimits())

  it('a withdrawn (numbered) undecided draft: requester deletes it (reason optional), number kept, gone from lists; others refused', async () => {
    const c = await api('POST', E, w.users.staffA, draftBody(w))
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    const id = c.body.id as number
    expect(c.body.allowedActions).toContain('delete_draft')
    const sub = await api('POST', `${E}/${id}/submit`, w.users.staffA, {}, key())
    expect(sub.status, JSON.stringify(sub.body)).toBe(200)
    const docNo = sub.body.docNo as string
    expect(docNo).toBeTruthy()
    expect(sub.body.allowedActions).not.toContain('delete_draft')
    expect((await api('POST', `${E}/${id}/delete-draft`, w.users.staffA, {}, key())).status).toBe(409) // in the flow
    expect((await api('POST', `${E}/${id}/withdraw`, w.users.staffA, { reason: 'perlu revisi' }, key())).status).toBe(200)
    const d = await api('GET', `${E}/${id}`, w.users.staffA)
    expect(d.body.allowedActions).toContain('delete_draft')
    expect((await api('POST', `${E}/${id}/delete-draft`, w.users.staffB, {}, key())).status).toBe(404) // not visible
    expect((await api('POST', `${E}/${id}/delete-draft`, w.users.finance, {}, key())).status).toBe(403) // reads it, not his
    const r = await api('POST', `${E}/${id}/delete-draft`, w.users.staffA, { reason: 'tidak jadi dibeli' }, key())
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const row = (await sqlAs('app', 'SELECT status::text AS s, is_deleted AS del, doc_no, delete_reason, deleted_by_id FROM expense_requests WHERE id = $1', [id])).rows[0]
    expect(row).toEqual({ s: 'draft', del: true, doc_no: docNo, delete_reason: 'tidak jadi dibeli', deleted_by_id: w.users.staffA.id })
    const audit = (await sqlAs('owner', "SELECT action::text AS action, reason FROM audit_logs WHERE doc_type = 'expense_request' AND doc_id = $1 AND action = 'soft_delete'", [String(id)])).rows
    expect(audit).toEqual([{ action: 'soft_delete', reason: 'tidak jadi dibeli' }])
    const mine = await api('GET', `${E}?scope=mine&limit=100`, w.users.staffA)
    expect(mine.body.items.some((i: { id: number }) => i.id === id)).toBe(false)
    expect((await api('POST', `${E}/${id}/submit`, w.users.staffA, {}, key())).status).toBe(409)
    expect((await api('POST', `${E}/${id}/delete-draft`, w.users.staffA, {}, key())).status).toBe(409) // already deleted
  })

  it('a never-submitted draft without a reason → default reason; a decided request never offers it', async () => {
    const c = await api('POST', E, w.users.staffA, draftBody(w))
    const id = c.body.id as number
    const r = await api('POST', `${E}/${id}/delete-draft`, w.users.staffA, {}, key())
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect((await sqlAs('app', 'SELECT delete_reason AS r FROM expense_requests WHERE id = $1', [id])).rows[0].r).toBe('Draft dihapus oleh pemohon')
    // decided (rejected by the Direktur at "Diketahui"): never "Hapus draft", the requester gets 409
    const c2 = await api('POST', E, w.users.staffA, draftBody(w))
    const id2 = c2.body.id as number
    expect((await api('POST', `${E}/${id2}/submit`, w.users.staffA, {}, key())).status).toBe(200)
    const rj = await api('POST', `${E}/${id2}/reject`, w.users.owner, { reason: 'tidak sesuai RAP' }, key())
    expect(rj.status, JSON.stringify(rj.body)).toBe(200)
    const rej = await api('GET', `${E}/${id2}`, w.users.staffA)
    expect(rej.body.allowedActions).not.toContain('delete_draft')
    expect((await api('POST', `${E}/${id2}/delete-draft`, w.users.staffA, {}, key())).status).toBe(409)
  })
})
