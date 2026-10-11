import type { SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { isFiltered, listHref, matchesQuery, pageOfFind, paginate, parseListQuery, searchWhere } from '@/admin/list-query'
import { listSearchFieldsOf, searchableField } from '@/admin/list-search'
import { BookQuery, bookWhere, parseBookQuery } from '@/domain/cash/book'

/** DRMS 10/10 D8: search + filter + pagination on every table. */
describe('list query (URL state)', () => {
  it('parses q / hal / per and the declared filters; bad values → defaults', () => {
    expect(parseListQuery({ q: '  pb 12 ', hal: '3', per: '50', pt: '2', other: 'x' }, ['pt', 'jenis'])).toEqual({ q: 'pb 12', page: 3, per: 50, filters: { pt: '2', jenis: '' } })
    expect(parseListQuery({ hal: '0', per: '33' })).toMatchObject({ page: 1, per: 20 })
    expect(parseListQuery({ hal: 'abc', per: ['100', '20'] })).toMatchObject({ page: 1, per: 100 })
    expect(parseListQuery({ hal2: '4' }, [], { pageKey: 'hal2' }).page).toBe(4)
    expect(isFiltered(parseListQuery({ per: '50' }, ['pt']))).toBe(false)
    expect(isFiltered(parseListQuery({ pt: '1' }, ['pt']))).toBe(true)
  })
  it('matchesQuery: every word, case- and accent-insensitive, across fields', () => {
    expect(matchesQuery(['PB/LLAS/2610/0001', 'Beli semen', null], 'semen 0001')).toBe(true)
    expect(matchesQuery(['Café Ujung'], 'cafe')).toBe(true)
    expect(matchesQuery(['Beli semen'], 'semen pasir')).toBe(false)
    expect(matchesQuery([], '')).toBe(true)
  })
  it('paginate clamps and reports the range', () => {
    const all = Array.from({ length: 45 }, (_, i) => i + 1)
    expect(paginate(all, 2, 20)).toMatchObject({ items: all.slice(20, 40), page: 2, totalPages: 3, total: 45, from: 21, to: 40 })
    expect(paginate(all, 9, 20)).toMatchObject({ page: 3, from: 41, to: 45 })
    expect(paginate([], 1, 20)).toMatchObject({ items: [], totalPages: 1, from: 0, to: 0 })
    expect(pageOfFind({ docs: [1, 2], page: 2, totalDocs: 22, totalPages: 2, limit: 20 })).toMatchObject({ from: 21, to: 22, total: 22 })
  })
  it('listHref keeps other params, resets the page on a filter change, drops empties and hal=1', () => {
    const sp = { q: 'semen', hal: '3', pt: '2' }
    expect(listHref('/admin/persetujuan', sp, { hal: 4 })).toBe('/admin/persetujuan?q=semen&hal=4&pt=2')
    expect(listHref('/admin/persetujuan', sp, { pt: '1' })).toBe('/admin/persetujuan?q=semen&pt=1')
    expect(listHref('/admin/persetujuan', sp, { q: '' })).toBe('/admin/persetujuan?pt=2')
    expect(listHref('/admin/persetujuan', sp, { hal: 1 })).toBe('/admin/persetujuan?q=semen&pt=2')
    expect(listHref('/x', { hal2: '2', q: 'a' }, { hal2: 3 }, { pageKey: 'hal2' })).toBe('/x?hal2=3&q=a')
  })
  it('searchWhere: AND of words, OR of fields (Payload like)', () => {
    expect(searchWhere(['docNo', 'title'], ' semen  pasir ')).toEqual({ and: [{ or: [{ docNo: { like: 'semen' } }, { title: { like: 'semen' } }] }, { or: [{ docNo: { like: 'pasir' } }, { title: { like: 'pasir' } }] }] })
    expect(searchWhere(['docNo'], '  ')).toBeNull()
  })
})

describe('Buku kas: q + page size in the query, searched in the database', () => {
  it('q / per parsed (invalid per dropped), where has the text search', () => {
    const q = parseBookQuery({ q: ' KK-12 ', per: '100', hal: '2' })
    expect(q).toMatchObject({ q: 'KK-12', per: 100, hal: 2 })
    expect(parseBookQuery({ per: '7' }).per).toBeUndefined()
    expect(bookWhere(q)).toEqual({ and: [{ or: [{ entryNo: { like: 'KK-12' } }, { description: { like: 'KK-12' } }] }] })
    expect(BookQuery.shape.q).toBeDefined()
  })
})

describe('Payload lists: meaningful search fields on every collection', () => {
  let config: SanitizedConfig
  beforeAll(async () => {
    config = await (await import('@/payload.config')).default
  })
  it('every collection with text fields has listSearchableFields; generated ones are stored, readable text', () => {
    const missing: string[] = []
    for (const c of config.collections) {
      if (c.slug.startsWith('payload-') || c.upload) continue // uploads: Payload searches the file name
      const fields = c.admin?.listSearchableFields ?? []
      // generated lists (collections without their own) only hold stored, readable text fields
      const generated = listSearchFieldsOf(c as never)
      if (fields.join() === generated.join()) for (const f of fields) expect(searchableField(c as never, f), `${c.slug}.${f}`).toBe(true)
      if (!fields.length && generated.length) missing.push(c.slug)
    }
    expect(missing).toEqual([])
  })
  it('projects search code, name and address; masked bank numbers are never searchable', () => {
    const projects = config.collections.find((c) => c.slug === 'projects')!
    expect(projects.admin.listSearchableFields).toEqual(['code', 'name', 'address'])
    const acc = config.collections.find((c) => c.slug === 'employee-bank-accounts')!
    expect(acc.admin.listSearchableFields ?? []).not.toContain('accountNo')
  })
})
