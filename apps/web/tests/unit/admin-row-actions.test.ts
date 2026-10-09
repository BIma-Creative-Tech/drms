import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CollectionConfig, SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { companyFieldOf } from '@/admin/company-list'
import { rupiahText } from '@/admin/components/RupiahCell'
import { isRupiahField, RUPIAH_CELL } from '@/admin/display-cells'
import { canOnRow, DOCUMENT_COLLECTIONS, ROW_ACTIONS_CELL, ROW_ACTIONS_FIELD, rowActionOf, whereMatches, withRowActions } from '@/admin/row-actions'
import { migrations } from '@/migrations'
import { up } from '@/migrations/20261009_120000_list_row_actions_column'

/**
 * Row action column "Aksi" on every Payload list (src/admin/row-actions.ts, RowActionsCell): config
 * wrapper, label rules, import map and the saved-preferences migration.
 */

const base = (over: Partial<CollectionConfig> = {}): CollectionConfig => ({ slug: 'things', fields: [{ name: 'name', type: 'text' }], ...over })

describe('withRowActions', () => {
  it('appends a presentational ui column with the cell and puts it last in defaultColumns', () => {
    const c = withRowActions([base({ admin: { defaultColumns: ['name'] } })])[0]!
    const f = c.fields.at(-1) as { name: string; type: string; admin: { disableListColumn: boolean; components: { Cell: string } } }
    expect(f).toMatchObject({ name: ROW_ACTIONS_FIELD, type: 'ui', label: 'Aksi' })
    expect(f.admin.disableListColumn).toBe(false)
    expect(f.admin.components.Cell).toBe(ROW_ACTIONS_CELL)
    expect(c.admin?.defaultColumns).toEqual(['name', ROW_ACTIONS_FIELD])
  })

  it('is idempotent and leaves collections without defaultColumns without one', () => {
    const once = withRowActions([base({ admin: { defaultColumns: ['name'] } }), base({ slug: 'plain' })])
    const [a, b] = withRowActions(once) as [CollectionConfig, CollectionConfig]
    expect(a.fields.filter((f) => 'name' in f && f.name === ROW_ACTIONS_FIELD)).toHaveLength(1)
    expect(a.admin?.defaultColumns).toEqual(['name', ROW_ACTIONS_FIELD])
    expect(b.admin?.defaultColumns).toBeUndefined()
  })
})

describe('rowActionOf', () => {
  it('Ubah when the collection may be updated, Buka for workflow documents, otherwise Lihat', () => {
    expect(rowActionOf('projects', true)).toMatchObject({ kind: 'edit', label: 'Ubah', icon: 'edit' })
    expect(rowActionOf('expense-requests', false)).toMatchObject({ kind: 'open', label: 'Buka', icon: 'document' })
    expect(rowActionOf('audit-logs', false)).toMatchObject({ kind: 'view', label: 'Lihat', icon: 'eye' })
  })
})

describe('canOnRow — client permission (true | { permission, where }) against one list row', () => {
  const ptWhere = { permission: true, where: { company: { in: [1, 2] } } }
  // shape of ExpenseRequests update for a requester (src/access/policies.ts): own drafts in my PTs
  const draftWhere = {
    permission: true,
    where: { and: [{ status: { in: ['draft', 'receipt_revision'] } }, { or: [{ and: [{ company: { equals: 1 } }, { createdBy: { equals: 7 } }] }] }] },
  }
  it('true / permission without where → editable; false / missing → not', () => {
    expect(canOnRow(true, {})).toBe(true)
    expect(canOnRow({ permission: true }, {})).toBe(true)
    expect(canOnRow({ permission: false }, {})).toBe(false)
    expect(canOnRow(undefined, {})).toBe(false)
  })
  it('per-PT where: rows of my PTs (id or populated relation) yes, other PT no', () => {
    expect(canOnRow(ptWhere, { company: 2 })).toBe(true)
    expect(canOnRow(ptWhere, { company: { id: 1, name: 'DRMS' } })).toBe(true)
    expect(canOnRow(ptWhere, { company: 3 })).toBe(false)
    expect(canOnRow(ptWhere, {})).toBe(false)
  })
  it('status + owner where: only my own draft is editable', () => {
    expect(canOnRow(draftWhere, { status: 'draft', company: 1, createdBy: 7 })).toBe(true)
    expect(canOnRow(draftWhere, { status: 'submitted', company: 1, createdBy: 7 })).toBe(false)
    expect(canOnRow(draftWhere, { status: 'draft', company: 1, createdBy: { id: 8 } })).toBe(false)
  })
  it('unknown operators never claim an edit', () => {
    expect(whereMatches({ amount: { greater_than: 5 } }, { amount: 10 })).toBe(false)
    expect(whereMatches({ company: { not_in: [3] } }, { company: 1 })).toBe(true)
  })
})

describe('row actions in the real config', () => {
  let config: SanitizedConfig
  beforeAll(async () => {
    process.env.PK_SKIP_ENV_CHECK = 'true'
    config = await (await import('@/payload.config')).default
  })

  it('every collection has the column; with defaultColumns it is last (the PT column stays)', () => {
    // Payload's own collections (payload-kv, -preferences, -migrations, …) are added after the config's list
    for (const c of config.collections.filter((x) => !x.slug.startsWith('payload-'))) {
      const f = c.fields.find((x) => 'name' in x && x.name === ROW_ACTIONS_FIELD)
      expect(f?.type, c.slug).toBe('ui')
      const cols = c.admin.defaultColumns
      if (!cols) continue
      expect(cols.at(-1), c.slug).toBe(ROW_ACTIONS_FIELD)
      if (companyFieldOf(c as unknown as CollectionConfig)) expect(cols, c.slug).toContain('company')
    }
  })

  it('the workflow-document set names existing collections only', () => {
    const slugs = new Set<string>(config.collections.map((c) => c.slug))
    for (const s of DOCUMENT_COLLECTIONS) expect(slugs.has(s), s).toBe(true)
  })

  it('the import map resolves the cell', () => {
    const map = readFileSync(join(process.cwd(), 'src/app/(payload)/admin/importMap.js'), 'utf8')
    expect(map).toContain(`"${ROW_ACTIONS_CELL}"`)
  })
})

describe('migration 20261009_120000_list_row_actions_column', () => {
  it('is registered last and appends the column only to list preferences that do not name it', async () => {
    expect(migrations.at(-1)?.name).toBe('20261009_120000_list_row_actions_column')
    const seen: string[] = []
    const flat = (x: unknown): string => {
      if (x === null || x === undefined) return ''
      if (typeof x === 'string') return x
      if (typeof x !== 'object') return '?'
      const o = x as { queryChunks?: unknown[]; value?: unknown }
      if (Array.isArray(o.queryChunks)) return o.queryChunks.map(flat).join('')
      if (Array.isArray(o.value)) return o.value.map(flat).join('')
      return '?'
    }
    await up({ db: { execute: async (q: unknown) => void seen.push(flat(q)) } } as never)
    const update = seen.find((s) => s.includes('UPDATE "payload_preferences"')) ?? ''
    expect(seen[0]).toContain("current_user !~ '_owner$'")
    expect(update).toContain(`LIKE 'collection-%'`)
    expect(update).toContain(`jsonb_typeof(p."value" -> 'columns') = 'array'`)
    expect(update).toContain(`c ->> 'accessor' = 'rowActions'`)
    expect(update).toContain(`'accessor', 'rowActions', 'active', true`)
  })
})

describe('list display: Rupiah amounts and empty cells', () => {
  let config: SanitizedConfig
  beforeAll(async () => {
    process.env.PK_SKIP_ENV_CHECK = 'true'
    config = await (await import('@/payload.config')).default
  })

  it('formats amounts as Rupiah and empty values as a dash', () => {
    expect(rupiahText(1250000)).toBe('Rp 1.250.000')
    expect(rupiahText(-5000)).toBe('-Rp 5.000')
    expect(rupiahText('200000')).toBe('Rp 200.000')
    expect(rupiahText(null)).toBe('—')
    expect(rupiahText('')).toBe('—')
  })

  it('every "(Rp)" number field in the lists uses the Rupiah cell', () => {
    const cellOf = (slug: string, name: string) =>
      (config.collections.find((c) => c.slug === slug)!.flattenedFields.find((f) => f.name === name) as { admin?: { components?: { Cell?: unknown } } }).admin?.components?.Cell
    expect(cellOf('expense-requests', 'grandTotal')).toBe(RUPIAH_CELL)
    expect(cellOf('cash-entries', 'amount')).toBe(RUPIAH_CELL)
    expect(cellOf('settlements', 'difference')).toBe(RUPIAH_CELL)
    expect(isRupiahField({ name: 'pct', type: 'number', label: 'Bobot (%)' })).toBe(false)
  })

  it('empty list cells read "—" (Indonesian noLabel override)', () => {
    expect((config.i18n.translations as { id?: { general?: { noLabel?: string } } }).id?.general?.noLabel).toBe('—')
  })
})
