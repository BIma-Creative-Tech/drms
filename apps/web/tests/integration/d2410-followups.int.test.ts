import { PgDialect } from 'drizzle-orm/pg-core'
import pg from 'pg'
import { describe, expect, it } from 'vitest'

import { down as siteAccountsDown, up as siteAccountsUp } from '@/migrations/20261024_500000_d2410_site_accounts_fund'

import { sqlAs } from './helpers'
import { sysCreate } from './flow-world'

/**
 * DRMS 24/10 follow-ups after the five d2410 merges (user decisions), through the real DB:
 * A. funds without the site exclusion — migration 20261024_500000 clears every legacy site flag of a cash account
 *    (audited, NOTICE, idempotent, reversible) and `pk_fund_balance` counts every active account of the PT.
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
    const tag = `FUA${Date.now() % 1e6}`
    const company = await sysCreate('companies', { name: `PT Contoh Dana ${tag}`, shortCode: tag, timezone: 'Asia/Makassar' })
    const site = await sysCreate('sites', { company, code: `${tag}S`, name: 'Site Contoh' })
    await sysCreate('cash-accounts', { company, name: 'Kas Kantor Pusat', kind: 'cash', openingBalance: 100_000_000, openingBalanceDate: '2020-01-01' })
    // a legacy flag (hidden column since ADR 0032) written after the migration ran in global setup
    const flagged = await sysCreate('cash-accounts', { company, name: 'Kas kecil site', kind: 'cash', openingBalance: 40_000_000, openingBalanceDate: '2020-01-01', site })
    expect((await sqlAs('owner', 'SELECT site_id FROM cash_accounts WHERE id = $1', [flagged])).rows[0].site_id).toBe(site)
    const balance = async () => Number((await sqlAs('owner', 'SELECT pk_fund_balance($1)::bigint AS b', [company])).rows[0].b)
    // the function was patched by the migration already: the flagged account counts
    expect(await balance()).toBe(140_000_000)

    await siteUp()
    expect((await sqlAs('owner', 'SELECT site_id FROM cash_accounts WHERE id = $1', [flagged])).rows[0].site_id).toBeNull()
    const audit = (await sqlAs('owner', "SELECT action::text AS action, field, source::text AS source, old_value, new_value, company_id FROM audit_logs WHERE doc_type = 'cash_account' AND doc_id = $1 AND new_value -> 'v' ->> 'migration' = $2", [String(flagged), NAME])).rows
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ action: 'update', field: 'site', source: 'system', company_id: company, old_value: { v: { siteId: site } }, new_value: { v: { siteId: null } } })
    expect(await balance()).toBe(140_000_000)

    await siteUp() // idempotent: nothing flagged any more, functions already patched
    expect((await sqlAs('owner', "SELECT count(*)::int AS n FROM audit_logs WHERE doc_type = 'cash_account' AND doc_id = $1 AND new_value -> 'v' ->> 'migration' = $2", [String(flagged), NAME])).rows[0].n).toBe(1)

    await siteDown()
    expect((await sqlAs('owner', 'SELECT site_id FROM cash_accounts WHERE id = $1', [flagged])).rows[0].site_id).toBe(site)
    expect(await balance()).toBe(100_000_000) // the old filter is back
    const def = (await sqlAs('owner', "SELECT pg_get_functiondef('pk_icl_transfer_guard'::regproc) AS d")).rows[0].d as string
    expect(def).toContain('a.site_id IS NULL')

    await siteUp() // the state the other files see
    expect(await balance()).toBe(140_000_000)
    expect(((await sqlAs('owner', "SELECT pg_get_functiondef('pk_icl_transfer_guard'::regproc) AS d")).rows[0].d as string).includes('site_id')).toBe(false)
  })
})
