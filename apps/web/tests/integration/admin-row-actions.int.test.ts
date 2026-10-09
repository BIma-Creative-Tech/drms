import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { up } from '@/migrations/20261009_120000_list_row_actions_column'

import { sqlAs } from './helpers'

/**
 * Row action column "Aksi" (src/admin/row-actions.ts): saved list-column preferences that predate the column
 * get it appended once by migration 20261009_120000_list_row_actions_column, run here as the owner role on the
 * migrated database. Preferences that already name the column (shown or hidden) and non-list rows are untouched.
 */
type Prefs = { columns?: Array<{ accessor: string; active: boolean }>; fields?: unknown }

describe('migration 20261009_120000 — saved list columns get the Aksi column once', () => {
  it('appends rowActions only where the saved columns never named it; idempotent', async () => {
    const ins = async (key: string, value: unknown) => Number((await sqlAs('owner', 'INSERT INTO payload_preferences (key, value) VALUES ($1, $2::jsonb) RETURNING id', [key, JSON.stringify(value)])).rows[0]?.id)
    const old = await ins('collection-projects', { columns: [{ accessor: 'company', active: true }, { accessor: 'name', active: true }] })
    const hidden = await ins('collection-vendors', { columns: [{ accessor: 'name', active: true }, { accessor: 'rowActions', active: false }] })
    const doc = await ins('collection-projects-1', { fields: { stages: { collapsed: [] } } })
    const other = await ins('nav', { groups: {} })
    const dialect = new PgDialect()
    const db = { execute: async (q: unknown) => { const x = dialect.sqlToQuery(q as never); return sqlAs('owner', x.sql, x.params) } }
    await up({ db } as never)
    await up({ db } as never)
    const val = async (id: number) => (await sqlAs('owner', 'SELECT value FROM payload_preferences WHERE id = $1', [id])).rows[0]?.value as Prefs
    expect((await val(old)).columns).toEqual([{ accessor: 'company', active: true }, { accessor: 'name', active: true }, { accessor: 'rowActions', active: true }])
    expect((await val(hidden)).columns).toEqual([{ accessor: 'name', active: true }, { accessor: 'rowActions', active: false }])
    expect(await val(doc)).toEqual({ fields: { stages: { collapsed: [] } } })
    expect(await val(other)).toEqual({ groups: {} })
    await sqlAs('owner', 'DELETE FROM payload_preferences WHERE id = ANY($1::int[])', [[old, hidden, doc, other]])
  })

  it('refuses to run as a role other than the owner', async () => {
    const dialect = new PgDialect()
    const db = { execute: async (q: unknown) => { const x = dialect.sqlToQuery(q as never); return sqlAs('app', x.sql, x.params) } }
    await expect(up({ db } as never)).rejects.toThrow(/_owner role/)
  })
})
