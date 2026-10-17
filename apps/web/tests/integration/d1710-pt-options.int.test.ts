import { randomUUID } from 'node:crypto'

import { createLocalReq, type Payload, type PayloadRequest, type SanitizedCollectionConfig, type TypedUser, type Where } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { lineMasterOptions } from '@/admin/components/lines/line-form'
import { loadPkList } from '@/admin/pk-list/data'
import { relId } from '@/access/roles'

import { api, makeFlowUser, sysCreate, type FlowUser } from './flow-world'
import { addMembership, companyId, fixturePm, getTestPayload, withContext } from './helpers'

/**
 * DRMS UI feedback 17/10 #4 — "duplicate" options for a user of several PTs: the per-PT masters carry the same name in
 * every PT (Material ×2, Normal ×2 on prod). Against Postgres with a two-PT user and the same master in both PTs:
 * the line dialog offers only the request PT's categories, the Payload pickers narrow to the form's / parent's PT, and
 * the list filter labels carry the PT tag (only that PT's rows once the list is filtered to one PT). Fictional data.
 */
let p: Payload
let A = 0
let B = 0
let codeA = ''
let codeB = ''
let admin: FlowUser
let user: TypedUser
const tag = `PTO${randomUUID().slice(0, 6)}`
const cat: Record<'A' | 'B', number> = { A: 0, B: 0 }
let projectB = 0

const field = (slug: string, name: string) =>
  p.collections[slug as 'vehicles'].config.flattenedFields.find((f) => f.name === name) as unknown as { filterOptions: (a: unknown) => boolean | Where | Promise<boolean | Where> }

async function reqAs(u: TypedUser): Promise<PayloadRequest> {
  return createLocalReq({ user: { ...u, collection: 'users' } as never }, p)
}

beforeAll(async () => {
  p = await getTestPayload()
  A = await companyId()
  codeB = `PB${Date.now() % 1000}`
  B = await sysCreate('companies', { name: 'PT Uji Opsi Dua', shortCode: codeB, timezone: 'Asia/Makassar' })
  codeA = String((await p.findByID({ collection: 'companies', id: A, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).shortCode)
  admin = await makeFlowUser(['pk-admin'], 'pto-admin', null, { groupAdmin: false, signature: false })
  await addMembership(admin.id, B, ['pk-admin'])
  user = (await withContext(admin)) as unknown as TypedUser
  // the same masters in both PTs (as on prod: expense_categories "Material" ×2, urgency "Normal" ×2)
  cat.A = await sysCreate('expense-categories', { company: A, code: `${tag}M`, name: `${tag} Material` })
  cat.B = await sysCreate('expense-categories', { company: B, code: `${tag}M`, name: `${tag} Material` })
  for (const c of [A, B]) await sysCreate('urgency-levels', { company: c, code: `${tag}N`, name: `${tag} Normal`, rank: 5 })
  projectB = await sysCreate('projects', { company: B, pm: await fixturePm(B), code: `${tag}-PB`, name: `${tag} proyek B`, status: 'berjalan', budget: 0 })
})

afterAll(async () => {
  // every other test file assumes the single-company default
  if (B) await p.update({ collection: 'companies', id: B, data: { active: false, changeReason: 'uji opsi PT selesai' }, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
})

describe('line dialog (LinesTableField): Kategori of the request PT only', () => {
  it('the REST list of the dialog has the master of BOTH PTs; the dialog offers the form PT one only', async () => {
    const q = new URLSearchParams({ depth: '0', limit: '500', pagination: 'false', 'where[active][not_equals]': 'false', 'where[name][equals]': `${tag} Material`, sort: 'name' })
    const r = await api('GET', `/api/expense-categories?${q}`, admin)
    expect(r.status).toBe(200)
    const docs = (r.body as { docs: Array<{ id: number; name: string; company: unknown }> }).docs
    expect(docs.map((d) => d.id).sort((a, b) => a - b)).toEqual([cat.A, cat.B].sort((a, b) => a - b)) // "duplicate" names
    const masters = docs.map((d) => ({ id: d.id, label: d.name, companyId: relId(d.company) ?? null }))
    expect(lineMasterOptions(masters, A).map((o) => o.id)).toEqual([cat.A])
    expect(lineMasterOptions(masters, B).map((o) => o.id)).toEqual([cat.B])
    expect(lineMasterOptions(masters, null)).toEqual([]) // PT not chosen yet: the picker waits
  })
})

describe('Payload pickers narrow to the form / parent PT', () => {
  const ids = async (collection: 'expense-categories', where: boolean | Where) =>
    where === false ? [] : (await p.find({ collection, where: { and: [{ name: { equals: `${tag} Material` } }, ...(where === true ? [] : [where])] }, depth: 0, pagination: false, user, overrideAccess: false })).docs.map((d) => d.id)

  it('approval rule (chosen PT): the chosen PT category only; no PT chosen (two PTs selected) → none', async () => {
    const f = field('approval-rules', 'category').filterOptions
    expect(await ids('expense-categories', await f({ data: { company: A, minAmount: 0 }, user }))).toEqual([cat.A])
    expect(await f({ data: { minAmount: 0 }, user })).toBe(false)
    // PT switcher on B only → B's category without choosing
    const inB = (await withContext(admin, [B])) as unknown as TypedUser
    expect(await ids('expense-categories', await f({ data: { minAmount: 0 }, user: inB }))).toEqual([cat.B])
  })

  it('budget line (derived PT): the category of the chosen project PT; no project yet → none', async () => {
    const f = field('budget-lines', 'category').filterOptions
    const req = await reqAs(user)
    expect(await ids('expense-categories', await f({ data: { project: projectB, amount: 0 }, user, req }))).toEqual([cat.B])
    expect(await f({ data: { amount: 0 }, user, req })).toBe(false)
  })
})

describe('list filters (PkListView): PT tag on same-named options', () => {
  const load = (u: TypedUser, sp: Record<string, string>) => loadPkList({ payload: p, user: u, collection: p.collections['expense-requests'].config as unknown as SanitizedCollectionConfig, searchParams: sp })
  const normal = (labels: string[]) => labels.filter((l) => l.includes(`${tag} Normal`))

  it('two PTs selected: `[CODE] Normal` per PT', async () => {
    const d = await load(user, {})
    expect(normal(d.relOptions.urgencyLevel!.map((o) => o.label)).sort()).toEqual([`[${codeA}] ${tag} Normal`, `[${codeB}] ${tag} Normal`].sort())
  })

  it('list filtered to one PT → that PT options only, untagged; one PT selected → untagged', async () => {
    const d = await load(user, { 'f.company': String(B) })
    expect(normal(d.relOptions.urgencyLevel!.map((o) => o.label))).toEqual([`${tag} Normal`])
    const inA = (await withContext(admin, [A])) as unknown as TypedUser
    expect(normal((await load(inA, {})).relOptions.urgencyLevel!.map((o) => o.label))).toEqual([`${tag} Normal`])
  })
})
