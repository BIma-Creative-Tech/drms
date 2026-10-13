import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CollectionConfig, SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { COMPANY_LIST_FILTER } from '@/admin/company-list'
import { opensRow } from '@/admin/components/list/ClickableRow'
import { multiSummary } from '@/admin/components/list/MultiSelect'
import { pageSlice } from '@/admin/components/list/PagedBody'
import { allowedValues, filterValues, idValues, listHref, parseListQuery, spValues } from '@/admin/list-query'
import { buildPkListConfig, FILTER_TARGETS, type PkListConfig } from '@/admin/pk-list/config'
import { readableFields } from '@/admin/pk-list/data'
import { activeColumns, columnsPreference, companyScope, dateWhere, nextSort, nextVisible, parseLinkWhere, parsePkQuery, pkFiltered, pkWhere, toolbarQuery } from '@/admin/pk-list/query'
import { PK_LIST_VIEW, usesPkListView, withPkListView } from '@/admin/pk-list/wire'
import { ROW_ACTIONS_FIELD } from '@/admin/row-actions'
import { BUSINESS_DATE_FIELD } from '@/collections/fields-f2'

/**
 * DRMS 13/10 wave 2 — generic list view (Umum #3–#8, Persetujuan #2): multi-select URL state, URL ↔ where (the PT
 * scope can never be widened by the URL), column preferences, per-collection config and the central wiring.
 */

describe('multi-select URL values (list-query)', () => {
  it('comma list and repeated params give the same values; trimmed, de-duplicated, capped', () => {
    expect(spValues({ jenis: 'advance, reimburse,advance' }, 'jenis')).toEqual(['advance', 'reimburse'])
    expect(spValues({ jenis: ['advance', 'reimburse'] }, 'jenis')).toEqual(['advance', 'reimburse'])
    expect(spValues({}, 'jenis')).toEqual([])
    expect(spValues({ x: Array.from({ length: 80 }, (_, i) => String(i)).join(',') }, 'x')).toHaveLength(50)
  })
  it('parseListQuery keeps a multi filter comma-joined; helpers split and validate it', () => {
    const lq = parseListQuery({ pt: ['1', '3'], jenis: 'advance,bogus', langkah: '' }, ['pt', 'jenis', 'langkah'])
    expect(lq.filters).toEqual({ pt: '1,3', jenis: 'advance,bogus', langkah: '' })
    expect(filterValues(lq, 'pt')).toEqual(['1', '3'])
    expect(idValues({ filters: { pt: '1,0,x,3' } }, 'pt')).toEqual([1, 3])
    expect(allowedValues(lq, 'jenis', ['advance', 'reimburse'] as const)).toEqual(['advance'])
  })
  it('listHref keeps a repeated param as one comma value', () => {
    expect(listHref('/admin/persetujuan', { jenis: ['advance', 'reimburse'], hal: '2' }, { hal: 3 })).toBe('/admin/persetujuan?jenis=advance%2Creimburse&hal=3')
  })
  it('checklist button text, client-side page slices and row click rules', () => {
    const opts = [
      { value: 'a', label: 'Advance' },
      { value: 'r', label: 'Reimburse' },
    ]
    expect(multiSummary(opts, [])).toBe('Semua')
    expect(multiSummary(opts, [], 'Semua PT')).toBe('Semua PT')
    expect(multiSummary(opts, ['r'])).toBe('Reimburse')
    expect(multiSummary(opts, ['a', 'r'])).toBe('2 dipilih')
    const rows = Array.from({ length: 45 }, (_, i) => i)
    expect(pageSlice(rows, 2, 20)).toMatchObject({ page: 2, pages: 3, from: 21, to: 40 })
    expect(pageSlice(rows, 9, 20)).toMatchObject({ page: 3, from: 41, to: 45 })
    expect(pageSlice([], 1, 20)).toMatchObject({ pages: 1, from: 0, to: 0 })
    expect(typeof opensRow).toBe('function')
  })
})

/** A small collection exercising every filter kind. */
const things: CollectionConfig = {
  slug: 'things',
  fields: [
    { name: 'company', type: 'relationship', relationTo: 'companies' },
    { name: 'code', type: 'text' },
    { name: 'status', type: 'select', options: [{ label: 'Draf', value: 'draft' }, { label: 'Disetujui', value: 'approved' }, 'void'] },
    { type: 'row', fields: [{ name: 'project', type: 'relationship', relationTo: 'projects' }, { name: 'request', type: 'relationship', relationTo: 'expense-requests' }] },
    { name: 'docDate', type: 'text', label: 'Tanggal', admin: { components: { Field: BUSINESS_DATE_FIELD } } },
    { name: 'paidAt', type: 'date' },
    { name: 'active', type: 'checkbox' },
    { name: 'secretNote', type: 'text', admin: { hidden: true } },
    { name: 'payload', type: 'json' },
    { name: 'tags', type: 'select', hasMany: true, options: ['a', 'b'] },
    { name: ROW_ACTIONS_FIELD, type: 'ui', label: 'Aksi', admin: { disableListColumn: false, components: { Cell: 'x#Y' } } },
    { name: 'createdAt', type: 'date', admin: { hidden: true } },
  ],
  admin: { useAsTitle: 'code', defaultColumns: ['company', 'code', 'status', 'project', 'request', 'docDate', 'active', ROW_ACTIONS_FIELD], listSearchableFields: ['code'] },
}

describe('config builder (pk-list/config.ts)', () => {
  const cfg = buildPkListConfig(things)
  it('columns = Payload-offered fields (rows flattened, timestamps kept; hidden/json dropped); sortable = stored scalars', () => {
    const names = cfg.columns.map((c) => c.name)
    expect(names).toEqual(['id', 'company', 'code', 'status', 'project', 'request', 'docDate', 'paidAt', 'active', 'tags', ROW_ACTIONS_FIELD, 'createdAt'])
    expect(cfg.columns.find((c) => c.name === 'tags')!.sortable).toBe(false)
    expect(cfg.columns.find((c) => c.name === ROW_ACTIONS_FIELD)!.sortable).toBe(false)
    expect(cfg.columns.find((c) => c.name === 'status')!.sortable).toBe(true)
    expect(cfg.defaultColumns).toEqual(['company', 'code', 'status', 'project', 'request', 'docDate', 'active', ROW_ACTIONS_FIELD])
  })
  it('filters: select / master relationship / boolean of defaultColumns — never the PT (own filter) nor workflow documents', () => {
    expect(cfg.filters.map((f) => `${f.name}:${f.kind}`)).toEqual(['status:select', 'project:relationship', 'active:boolean'])
    expect(FILTER_TARGETS.has('expense-requests')).toBe(false)
    const status = cfg.filters[0]!
    expect(status.kind === 'select' && status.options.map((o) => o.value)).toEqual(['draft', 'approved', 'void'])
    expect(cfg.dates).toEqual([{ name: 'docDate', label: 'Tanggal', kind: 'business' }])
    expect(cfg.hasCompany).toBe(true)
    expect(cfg.searchFields).toEqual(['code'])
  })
})

describe('URL ↔ where (pk-list/query.ts)', () => {
  const cfg: PkListConfig = buildPkListConfig(things)
  it('multi values → where[field][in]; unknown options, non-id relationship values and bad dates are dropped', () => {
    const q = parsePkQuery({ 'f.status': 'draft,approved,hacked', 'f.project': '3,x,7', 'f.active': 'true', 'f.docDate.dari': '2026-10-01', 'f.docDate.sampai': '2026-02-30', q: ' semen ' }, cfg)
    expect(q.filters).toEqual({ status: ['draft', 'approved'], project: ['3', '7'], active: ['true'] })
    expect(q.dates).toEqual({ docDate: { from: '2026-10-01' } })
    expect(pkWhere(q, cfg, { selected: [1, 2] })).toEqual({
      and: [
        { and: [{ or: [{ code: { like: 'semen' } }] }] },
        { status: { in: ['draft', 'approved'] } },
        { project: { in: [3, 7] } },
        { active: { equals: true } },
        { docDate: { greater_than_equal: '2026-10-01' } },
      ],
    })
  })
  it('"Tidak" also matches unset checkboxes; both ticked = no filter', () => {
    expect(pkWhere(parsePkQuery({ 'f.active': 'false' }, cfg), cfg, { selected: null })).toEqual({ and: [{ or: [{ active: { equals: false } }, { active: { exists: false } }] }] })
    expect(pkWhere(parsePkQuery({ 'f.active': 'true,false' }, cfg), cfg, { selected: null })).toEqual({})
  })
  it('the PT scope can never be widened by the URL: ids outside the selection are dropped', () => {
    const q = parsePkQuery({ 'f.company': '2,9,abc' }, cfg)
    expect(q.companies).toEqual([2, 9])
    expect(companyScope(q.companies, [1, 2])).toEqual([2])
    expect(pkWhere(q, cfg, { selected: [1, 2] })).toEqual({ and: [{ company: { in: [2] } }] })
    // only foreign ids → no PT condition: the list stays inside the selection (access rules), never outside
    expect(pkWhere(parsePkQuery({ 'f.company': '9' }, cfg), cfg, { selected: [1, 2] })).toEqual({})
    expect(companyScope([1], null)).toEqual([])
  })
  it('timestamps compare against the company day (WITA), the "sampai" day included', () => {
    expect(dateWhere({ name: 'paidAt', label: 'x', kind: 'timestamp' }, { from: '2026-10-01', to: '2026-10-31' })).toEqual([
      { paidAt: { greater_than_equal: '2026-09-30T16:00:00.000Z' } },
      { paidAt: { less_than: '2026-10-31T16:00:00.000Z' } },
    ])
    expect(dateWhere({ name: 'docDate', label: 'x', kind: 'business' }, { to: '2026-10-31' })).toEqual([{ docDate: { less_than_equal: '2026-10-31' } }])
  })
  it('filters on fields the caller cannot read are ignored (field access)', () => {
    const q = parsePkQuery({ 'f.status': 'draft', q: 'x' }, cfg)
    expect(pkWhere(q, cfg, { selected: null, readable: (f) => f !== 'status' && f !== 'code' })).toEqual({})
  })
  it('page / per / sort: defaults on bad values; sort only on sortable columns', () => {
    expect(parsePkQuery({ hal: '3', per: '50', urut: '-code' }, cfg)).toMatchObject({ page: 3, per: 50, sort: '-code' })
    expect(parsePkQuery({ hal: '0', per: '7', urut: 'tags' }, cfg)).toMatchObject({ page: 1, per: 20, sort: undefined })
    expect(parsePkQuery({ urut: 'secretNote' }, cfg).sort).toBeUndefined()
    expect(nextSort(undefined, 'code')).toBe('code')
    expect(nextSort('code', 'code')).toBe('-code')
    expect(nextSort('-code', 'code')).toBe('code')
  })
  it('old where[…] deep links (dashboard tiles) are parsed and AND-ed', () => {
    const sp = { 'where[pm][exists]': 'false', 'where[or][0][status][equals]': 'draft', 'where[or][1][status][equals]': 'void', 'whereX': '1', 'where[a]]': 'x' }
    expect(parseLinkWhere(sp)).toEqual({ pm: { exists: 'false' }, or: [{ status: { equals: 'draft' } }, { status: { equals: 'void' } }] })
    const q = parsePkQuery({ 'where[pm][exists]': 'false' }, cfg)
    expect(pkFiltered(q)).toBe(true)
    expect(pkWhere(q, cfg, { selected: null })).toEqual({ and: [{ pm: { exists: 'false' } }] })
    expect(parseLinkWhere({ q: 'x' })).toBeNull()
  })
  it('toolbarQuery mirrors the parsed state in ListToolbar shape', () => {
    const q = parsePkQuery({ 'f.status': 'draft,void', 'f.docDate.sampai': '2026-10-31', 'f.company': '1' }, cfg)
    expect(toolbarQuery(q, cfg).filters).toMatchObject({ 'f.status': 'draft,void', 'f.project': '', 'f.docDate.dari': '', 'f.docDate.sampai': '2026-10-31', 'f.company': '1' })
  })
})

describe('column preferences ("Kolom ▾", Payload preference collection-<slug>)', () => {
  const cfg = buildPkListConfig(things)
  it('saved order and visibility; unknown / unreadable columns dropped; Aksi always last', () => {
    const pref = [
      { accessor: 'status', active: true },
      { accessor: 'gone', active: true },
      { accessor: 'code', active: true },
      { accessor: 'project', active: false },
      { accessor: ROW_ACTIONS_FIELD, active: false },
    ]
    expect(activeColumns(pref, cfg)).toEqual(['status', 'code', ROW_ACTIONS_FIELD])
    expect(activeColumns(pref, cfg, (n) => n !== 'status')).toEqual(['code', ROW_ACTIONS_FIELD])
  })
  it('no / broken preference → defaultColumns', () => {
    expect(activeColumns(undefined, cfg)).toEqual(cfg.defaultColumns)
    expect(activeColumns('junk', cfg)).toEqual(cfg.defaultColumns)
    expect(activeColumns([{ accessor: 'code', active: false }], cfg)).toEqual(cfg.defaultColumns)
  })
  it('saving lists every column (visible first, in order) — the same format as Payload and the MC4 migration', () => {
    expect(columnsPreference(['status', 'code', 'nope'], ['id', 'code', 'status', 'active'])).toEqual([
      { accessor: 'status', active: true },
      { accessor: 'code', active: true },
      { accessor: 'id', active: false },
      { accessor: 'active', active: false },
    ])
    expect(nextVisible(['status', 'code'], ['code', 'active', 'id'], ['id', 'code', 'status', 'active'])).toEqual(['code', 'id', 'active'])
  })
  it('field read access as Payload applies it: ui columns and id always, data fields only when granted', () => {
    const r = readableFields({ fields: things.fields } as never, { code: { read: true, create: true, update: true }, status: true } as never)
    expect([r('id'), r(ROW_ACTIONS_FIELD), r('code'), r('status'), r('project')]).toEqual([true, true, true, true, false])
    expect(readableFields({ fields: things.fields } as never, true)('project')).toBe(true)
  })
})

describe('wiring (pk-list/wire.ts)', () => {
  it('sets the list view, drops the single-choice PT chips, skips uploads and own list views; idempotent', () => {
    const per = { slug: 'x', fields: [], admin: { components: { beforeListTable: [COMPANY_LIST_FILTER, 'a#B'] } } } as unknown as CollectionConfig
    const media = { slug: 'm', fields: [], upload: true } as CollectionConfig
    const own = { slug: 'o', fields: [], admin: { components: { views: { list: { Component: 'my#List' } } } } } as CollectionConfig
    const [a, m, o] = withPkListView(withPkListView([per, media, own])) as [CollectionConfig, CollectionConfig, CollectionConfig]
    expect(a.admin?.components?.views?.list).toEqual({ Component: PK_LIST_VIEW })
    expect(a.admin?.components?.beforeListTable).toEqual(['a#B'])
    expect(m).toBe(media)
    expect(o).toBe(own)
    expect(usesPkListView(media)).toBe(false)
  })
})

describe('PkListView in the real config', () => {
  let config: SanitizedConfig
  beforeAll(async () => {
    process.env.PK_SKIP_ENV_CHECK = 'true'
    config = await (await import('@/payload.config')).default
  })
  it('every non-upload collection uses PkListView; media libraries keep Payload’s list; no bulk-edit chips left', () => {
    const app = config.collections.filter((c) => !c.slug.startsWith('payload-'))
    for (const c of app) expect(c.admin.components?.views?.list?.Component ?? null, c.slug).toBe(c.upload ? null : PK_LIST_VIEW)
    for (const c of app.filter((x) => !x.upload)) expect([c.admin.components?.beforeListTable].flat(), c.slug).not.toContain(COMPANY_LIST_FILTER)
  })
  it('key collections get the filters the client asked for (Pengajuan, Proyek, Pengguna, Karyawan, Vendor)', () => {
    const of = (slug: string) => buildPkListConfig(config.collections.find((c) => c.slug === slug)! as never)
    const er = of('expense-requests')
    expect(er.filters.map((f) => f.name)).toEqual(expect.arrayContaining(['status', 'type', 'project', 'urgencyLevel']))
    expect(er.dates.map((d) => `${d.name}:${d.kind}`)).toEqual(['requestDate:business'])
    expect(er.hasCompany).toBe(true)
    expect(er.columns.find((c) => c.name === 'updatedAt')).toBeTruthy() // Payload timestamps stay offered
    expect(of('projects').filters.map((f) => f.name)).toEqual(expect.arrayContaining(['status', 'client', 'pm']))
    expect(of('users').filters.map((f) => f.name)).toEqual(['active'])
    expect(of('users').hasCompany).toBe(false)
    expect(of('employees').filters.map((f) => f.name)).toEqual(expect.arrayContaining(['active']))
    expect(of('vendors').filters.map((f) => f.name)).toEqual(['active'])
    // every configured filter / date of every collection is a real, filterable field
    for (const c of config.collections.filter((x) => !x.upload && !x.slug.startsWith('payload-'))) {
      const cfg = buildPkListConfig(c as never)
      for (const f of cfg.filters) expect(['select', 'boolean', 'relationship'], `${c.slug}.${f.name}`).toContain(f.kind)
      for (const n of cfg.defaultColumns) expect(cfg.columns.map((x) => x.name), `${c.slug}.${n}`).toContain(n)
    }
  })
  it('the import map resolves the list view', () => {
    const map = readFileSync(join(process.cwd(), 'src/app/(payload)/admin/importMap.js'), 'utf8')
    expect(map).toContain(`"${PK_LIST_VIEW}"`)
  })
})
