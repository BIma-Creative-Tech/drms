import { sql } from '@payloadcms/db-postgres'
import { PgDialect } from 'drizzle-orm/pg-core'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resetRateLimits } from '@/lib/rate-limit'
import { up as migrationUp } from '@/migrations/20261012_100000_d1010_project_pm'

import { getTestPayload, sqlAs, sqlError } from './helpers'
import { api, makeWorld, sysCreate, type World } from './flow-world'

/**
 * DRMS 10/10 #5: Project Manager mandatory — REST / admin form / Local API refuse a project without a
 * PM ("Project Manager wajib diisi"), an update that does not send `pm` stays valid, and the DB column
 * is NOT NULL with ON DELETE RESTRICT when no legacy row lacks a PM (the migration skips otherwise).
 */
let w: World
const MSG = 'Project Manager wajib diisi'

beforeAll(async () => {
  w = await makeWorld(`dpm${Date.now() % 100000}`)
})

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

describe('validation (every write path)', () => {
  it('REST create without PM → 400 naming the field; with PM → 201', async () => {
    resetRateLimits()
    const bad = await api('POST', '/api/projects', w.users.owner, { code: 'D10-NOPM', name: 'Tanpa PM', status: 'berjalan' })
    expect(bad.status, JSON.stringify(bad.body)).toBe(400)
    expect(JSON.stringify(bad.body)).toContain(MSG)
    const ok = await api('POST', '/api/projects', w.users.owner, { code: 'D10-PM', name: 'Dengan PM', status: 'berjalan', pm: w.users.pm.id })
    expect(ok.status, JSON.stringify(ok.body)).toBe(201)
  })

  it('REST update clearing the PM → 400; an update without `pm` → 200 (PM untouched)', async () => {
    const cleared = await api('PATCH', `/api/projects/${w.project}`, w.users.owner, { pm: null })
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(400)
    expect(JSON.stringify(cleared.body)).toContain(MSG)
    const renamed = await api('PATCH', `/api/projects/${w.project}`, w.users.owner, { address: 'Jl. Uji PM 1' })
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200)
    expect((await sqlAs('app', 'SELECT pm_id FROM projects WHERE id = $1', [w.project])).rows[0].pm_id).toBe(w.users.pm.id)
  })

  it('Local API (seed / import / scripts) is held to the same rule', async () => {
    await expect(sysCreate('projects', { code: 'D10-SYS', name: 'Sistem tanpa PM', status: 'berjalan' })).rejects.toMatchObject({ status: 400 })
  })
})

describe('database', () => {
  it('pm_id NOT NULL, FK ON DELETE RESTRICT (fresh DB: no legacy rows)', async () => {
    const col = (await sqlAs('app', "SELECT is_nullable FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'pm_id'")).rows[0]
    expect(col.is_nullable).toBe('NO')
    const fk = (await sqlAs('owner', "SELECT confdeltype FROM pg_constraint WHERE conname = 'projects_pm_id_users_id_fk'")).rows[0]
    expect(fk.confdeltype).toBe('r')
    const e = await sqlError('app', 'UPDATE projects SET pm_id = NULL WHERE id = $1', [w.project])
    expect(e?.code).toBe('23502') // not_null_violation
  })

  it('migration: a legacy row without a PM → NOT NULL skipped (deploy never fails); none → applied', async () => {
    const c = new pg.Client({ connectionString: process.env.PK_TEST_DATABASE_URL_OWNER })
    await c.connect()
    const dialect = new PgDialect()
    const db = {
      execute: async (q: unknown) => {
        const x = dialect.sqlToQuery(q as never)
        return c.query(x.sql, x.params)
      },
    }
    const warn: unknown[] = []
    const payload = { logger: { warn: (m: unknown) => warn.push(m), info: () => undefined } }
    const nullable = async () => ((await db.execute(sql.raw("SELECT is_nullable AS v FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'pm_id'"))) as { rows: Array<{ v: string }> }).rows[0]!.v
    try {
      await c.query('BEGIN')
      await c.query('ALTER TABLE projects ALTER COLUMN pm_id DROP NOT NULL')
      await c.query('UPDATE projects SET pm_id = NULL WHERE id = $1', [w.otherProject])
      await migrationUp({ db, payload } as never)
      expect(await nullable()).toBe('YES')
      expect(JSON.stringify(warn)).toContain('1 project(s) without a PM')
      await c.query('UPDATE projects SET pm_id = $1 WHERE id = $2', [w.users.otherPm.id, w.otherProject])
      await migrationUp({ db, payload } as never)
      expect(await nullable()).toBe('NO')
    } finally {
      await c.query('ROLLBACK').catch(() => undefined)
      await c.end()
    }
  })
})
