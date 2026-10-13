import { randomUUID } from 'node:crypto'

import type { Payload, SanitizedCollectionConfig, TypedUser } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadPkList } from '@/admin/pk-list/data'

import { makeFlowUser, sysCreate } from './flow-world'
import { addMembership, companyId, fixturePm, getTestPayload, withContext } from './helpers'

/**
 * DRMS 13/10 wave 2 — the data function of the generic list view (PkListView, Umum #3–#8) against Postgres:
 * multi-select `in` filters, pagination (+ clamp), sort, the PT filter (∩ the switcher selection, never wider)
 * and old where[…] deep links — every read `overrideAccess: false` with the request user. Fictional data only.
 * PTs: A = #1 DRMS, B = second PT of the user, C = a PT the user is not a member of.
 */
let p: Payload
let A = 0
let B = 0
let C = 0
let user: TypedUser
const tag = `W2L${randomUUID().slice(0, 6)}`
const coll = (slug: string) => p.collections[slug as 'vendors'].config as unknown as SanitizedCollectionConfig
const load = (u: TypedUser, slug: string, sp: Record<string, string>, columnsPref?: unknown) => loadPkList({ payload: p, user: u, collection: coll(slug), searchParams: sp, columnsPref })

beforeAll(async () => {
  p = await getTestPayload()
  A = await companyId()
  B = await sysCreate('companies', { name: 'PT Uji Daftar Dua', shortCode: `LB${Date.now() % 1000}`, timezone: 'Asia/Makassar' })
  C = await sysCreate('companies', { name: 'PT Uji Daftar Tiga', shortCode: `LC${Date.now() % 1000}`, timezone: 'Asia/Makassar' })
  const admin = await makeFlowUser(['pk-admin'], 'w2l-admin', null, { groupAdmin: false, signature: false })
  await addMembership(admin.id, B, ['pk-admin'])
  user = (await withContext(admin)) as unknown as TypedUser
  // A: 22 active + 1 inactive, B: 2 active, C (not the user's): 1
  for (let i = 1; i <= 22; i++) await sysCreate('vendors', { company: A, name: `${tag} A${String(i).padStart(2, '0')}`, active: true })
  await sysCreate('vendors', { company: A, name: `${tag} A-nonaktif`, active: false })
  for (const n of ['B1', 'B2']) await sysCreate('vendors', { company: B, name: `${tag} ${n}`, active: true })
  await sysCreate('vendors', { company: C, name: `${tag} C1`, active: true })
  const pm = await fixturePm(A)
  for (const [code, status] of [['P1', 'berjalan'], ['P2', 'ditunda'], ['P3', 'selesai']] as const) await sysCreate('projects', { company: A, pm, code: `${tag}-${code}`, name: `${tag} proyek ${code}`, status, budget: 0 })
})

afterAll(async () => {
  // every other test file assumes the single-company default
  for (const id of [B, C]) if (id) await p.update({ collection: 'companies', id, data: { active: false, changeReason: 'uji daftar selesai' }, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
})

describe('PkListView data (loadPkList)', () => {
  it('search + pagination: 20 per page, page 2 has the rest, a page beyond the end clamps; never rows of a foreign PT', async () => {
    const one = await load(user, 'vendors', { q: tag })
    expect(one.page).toMatchObject({ total: 25, totalPages: 2, page: 1, from: 1, to: 20 })
    expect(one.docs).toHaveLength(20)
    const two = await load(user, 'vendors', { q: tag, hal: '2' })
    expect(two.page).toMatchObject({ page: 2, from: 21, to: 25 })
    expect((await load(user, 'vendors', { q: tag, hal: '9' })).page).toMatchObject({ page: 2, to: 25 })
    expect((await load(user, 'vendors', { q: tag, per: '50' })).docs.map((d) => d.name)).not.toContain(`${tag} C1`)
  })

  it('multi-select filters → where[field][in]; booleans incl. unset; sort asc/desc', async () => {
    const yes = await load(user, 'vendors', { q: tag, 'f.active': 'true', per: '50' })
    expect(yes.page.total).toBe(24)
    const no = await load(user, 'vendors', { q: tag, 'f.active': 'false' })
    expect(no.docs.map((d) => d.name)).toEqual([`${tag} A-nonaktif`])
    // (collation-independent checks: the same prefix, then A… < B1 < B2)
    const asc = (await load(user, 'vendors', { q: tag, urut: 'name', per: '50' })).docs.map((d) => String(d.name))
    expect(asc.slice(-2)).toEqual([`${tag} B1`, `${tag} B2`])
    expect((await load(user, 'vendors', { q: tag, urut: '-name' })).docs.slice(0, 2).map((d) => d.name)).toEqual([`${tag} B2`, `${tag} B1`])
    // select filter with several values (projects.status)
    const pr = await load(user, 'projects', { q: tag, 'f.status': 'berjalan,selesai,bogus' })
    expect(pr.query.filters.status).toEqual(['berjalan', 'selesai'])
    expect(pr.docs.map((d) => d.code).sort()).toEqual([`${tag}-P1`, `${tag}-P3`])
    expect(Object.keys(pr.relOptions)).toEqual(expect.arrayContaining(['client', 'pm']))
  })

  it('PT filter: subset of the selection only — a foreign PT in the URL never widens the list', async () => {
    const both = await load(user, 'vendors', { q: tag, per: '50' })
    expect(both.companies?.map((c) => Number(c.value)).sort((a, b) => a - b)).toEqual([A, B].sort((a, b) => a - b))
    const onlyB = await load(user, 'vendors', { q: tag, 'f.company': String(B) })
    expect(onlyB.docs.map((d) => d.name).sort()).toEqual([`${tag} B1`, `${tag} B2`])
    const foreign = await load(user, 'vendors', { q: tag, 'f.company': String(C), per: '50' })
    expect(foreign.query.companies).toEqual([])
    expect(foreign.page.total).toBe(25)
    expect(foreign.docs.map((d) => d.name)).not.toContain(`${tag} C1`)
    // switcher narrowed to A: asking for B in the URL gives nothing of B
    const inA = (await withContext(user as never, [A])) as unknown as TypedUser
    const narrowed = await load(inA, 'vendors', { q: tag, 'f.company': String(B), per: '50' })
    expect(narrowed.companies).toBeNull() // one PT selected → no PT filter
    expect(narrowed.page.total).toBe(23)
    expect(narrowed.docs.some((d) => String(d.name).includes(' B'))).toBe(false)
  })

  it('old where[…] deep links still filter; saved columns are honoured with Aksi last', async () => {
    const link = await load(user, 'vendors', { q: tag, 'where[active][equals]': 'false' })
    expect(link.page.total).toBe(1)
    const cols = await load(user, 'vendors', { q: tag }, [{ accessor: 'name', active: true }, { accessor: 'company', active: false }])
    expect(cols.columns).toEqual(['name', 'rowActions'])
  })
})
