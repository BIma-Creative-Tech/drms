import { randomUUID } from 'node:crypto'

import { createLocalReq, docAccessOperation, type FlattenedField, type PayloadRequest, type Where } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { resetRateLimits } from '@/lib/rate-limit'

import { companyId, getTestPayload, withContext } from './helpers'
import { api, makeFlowUser, makeWorld, png, sysCreate, upload, type FlowUser, type World } from './flow-world'

/**
 * QA report 2026-10-08 — hak akses & UX (fix/qa-rbac-ux), DB-bound parts:
 * QA-20 (a) Direktur read-only on users, (b) PM read-only on projects with a 403 naming the fields,
 * (d) Admin reads budget-addenda / progress-reports; QA-28 empty scope = empty list (no 403);
 * QA-16 user pickers (PMs of the PT, shown by name); QA-21 per-PT code pre-check + Indonesian
 * ValidationError with labels; QA-31 proof editable on a manual cash entry, employee phone on create.
 */
let w: World
let today: string
const idem = () => ({ 'Idempotency-Key': randomUUID() })
type Body = { errors?: Array<{ message?: string; data?: { errors?: Array<{ path?: string; message?: string }> } }>; docs?: Array<Record<string, unknown>>; detail?: string }
const msg = (b: unknown) => JSON.stringify(b)

async function reqAs(user: FlowUser): Promise<PayloadRequest> {
  const p = await getTestPayload()
  const u = await withContext({ id: user.id, email: user.email, keycloakSub: '', groupAdmin: user.groupAdmin ?? false, collection: 'users' as const })
  return createLocalReq({ user: u as never }, p)
}

beforeAll(async () => {
  w = await makeWorld(`qx${Date.now() % 100000}`)
  resetRateLimits()
  today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(new Date())
})

describe('QA-20(a) Direktur is read-only on users', () => {
  it('Direktur: PATCH of another user → 403; doc permission update = false; own signature stays editable', async () => {
    const r = await api('PATCH', `/api/users/${w.users.staffA.id}`, w.users.owner, { name: 'Diubah Direktur' })
    expect(r.status, msg(r.body)).toBe(403)
    const perms = await docAccessOperation({ id: w.users.staffA.id, collection: (await getTestPayload()).collections.users, req: await reqAs(w.users.owner) } as never)
    expect(Boolean((perms as { update?: unknown }).update)).toBe(false)
    const sig = (await upload('/api/v1/media/signatures', w.users.owner, await png())).body as { id: number }
    const own = await api('PATCH', `/api/users/${w.users.owner.id}`, w.users.owner, { signature: sig.id })
    expect(own.status, msg(own.body)).toBe(200)
  })

  it('an Admin of the PT (not group admin) edits a user of that PT; the Direktur of that PT does not', async () => {
    const ptAdmin = await makeFlowUser(['pk-admin'], 'qx-pt-admin', null, { groupAdmin: false })
    const target = await makeFlowUser(['pk-staff'], 'qx-target', null)
    expect((await api('PATCH', `/api/users/${target.id}`, ptAdmin, { phone: '0811-1' })).status).toBe(200)
    expect((await api('PATCH', `/api/users/${target.id}`, w.users.owner, { phone: '0811-2' })).status).toBe(403)
  })
})

describe('QA-20(b) PM is read-only on projects — 403 naming the fields, never a silent 200', () => {
  it('PM PATCH name/address → 403 naming "Nama project", "Alamat"; budget/status → 403 naming them; nothing saved', async () => {
    const p = await getTestPayload()
    const before = await p.findByID({ collection: 'projects', id: w.project, depth: 0, overrideAccess: true /* SYSTEM-READ: assertion */ })
    const a = await api('PATCH', `/api/projects/${w.project}`, w.users.pm, { name: 'Diubah PM', address: 'Jl. Baru' })
    expect(a.status, msg(a.body)).toBe(403)
    expect(msg(a.body)).toMatch(/Nama project/)
    expect(msg(a.body)).toMatch(/Alamat/)
    const b = await api('PATCH', `/api/projects/${w.project}`, w.users.pm, { budget: 1, status: 'selesai' })
    expect(b.status, msg(b.body)).toBe(403)
    expect(msg(b.body)).toMatch(/RAB \(Rp\)/)
    expect(msg(b.body)).toMatch(/Status/)
    const after = await p.findByID({ collection: 'projects', id: w.project, depth: 0, overrideAccess: true /* SYSTEM-READ: assertion */ })
    expect({ name: after.name, budget: after.budget, status: after.status }).toEqual({ name: before.name, budget: before.budget, status: before.status })
  })

  it('Finance (reads all) is also refused with the field names; Direktur saves', async () => {
    const f = await api('PATCH', `/api/projects/${w.project}`, w.users.finance, { name: 'Diubah Finance' })
    expect(f.status).toBe(403)
    expect(msg(f.body)).toMatch(/Nama project/)
    const o = await api('PATCH', `/api/projects/${w.project}`, w.users.owner, { address: 'Jl. Direktur 1' })
    expect(o.status, msg(o.body)).toBe(200)
  })

  it('a caller who cannot read the project gets no field names (no existence leak)', async () => {
    const r = await api('PATCH', `/api/projects/${w.otherProject}`, w.users.pm, { name: 'x' })
    expect([403, 404]).toContain(r.status)
    expect(msg(r.body)).not.toMatch(/Nama project/)
  })

  it('PM has no update permission on the project document (admin form is read-only)', async () => {
    const perms = (await docAccessOperation({ id: w.project, collection: (await getTestPayload()).collections.projects, req: await reqAs(w.users.pm) } as never)) as { read?: unknown; update?: unknown }
    expect(Boolean(perms.read)).toBe(true)
    expect(Boolean(perms.update)).toBe(false)
  })
})

describe('QA-20(d) Admin reads budget-addenda and progress-reports', () => {
  it('GET → 200 (was 403); Staff still 403', async () => {
    for (const c of ['budget-addenda', 'progress-reports']) {
      expect((await api('GET', `/api/${c}?limit=1`, w.users.admin)).status, c).toBe(200)
      expect((await api('GET', `/api/${c}?limit=1`, w.users.staffA)).status, c).toBe(403)
    }
  })
})

describe('QA-28 nothing in scope → empty list, not 403', () => {
  it('staff without assignments: cost-centers / projects pickers answer 200 with no rows (GET and POST-override)', async () => {
    const lone = await makeFlowUser(['pk-staff'], 'qx-lone', await sysCreate('employees', { code: `QX-L${Date.now() % 10000}`, name: 'Lone' }))
    for (const c of ['cost-centers', 'projects']) {
      const r = await api('GET', `/api/${c}?limit=10&depth=0`, lone)
      expect(r.status, `${c} ${msg(r.body)}`).toBe(200)
      expect((r.body as Body).docs).toEqual([])
    }
    const o = await api('POST', '/api/cost-centers', lone, undefined, { 'X-Payload-HTTP-Method-Override': 'GET', 'Content-Type': 'application/x-www-form-urlencoded' })
    expect(o.status).toBe(200)
  })

  it('isolation unchanged: assigned staff sees only its cost center; PM without a team sees no project', async () => {
    const r = await api('GET', '/api/cost-centers?limit=50&depth=0', w.users.staffA)
    expect(((r.body as Body).docs ?? []).map((d) => d.id)).toEqual([w.costCenter])
    const pmAlone = await makeFlowUser(['pk-pm'], 'qx-pm-alone', null)
    const p = await api('GET', '/api/projects?limit=50&depth=0', pmAlone)
    expect(p.status).toBe(200)
    expect((p.body as Body).docs).toEqual([])
    expect((await api('PATCH', `/api/projects/${w.project}`, pmAlone, { name: 'x' })).status).toBe(403)
  })
})

describe('QA-16 user pickers: PMs of the PT, labelled by name', () => {
  const pickerOf = async (slug: 'projects' | 'cost-centers', name: string) => {
    const f = (await getTestPayload()).collections[slug].config.flattenedFields.find((x: FlattenedField) => x.name === name) as FlattenedField & { filterOptions: (a: unknown) => Promise<Where> }
    return f.filterOptions
  }

  it('projects.pm offers only ACTIVE pk-pm members of the project PT (cost-centers.manager: any active member)', async () => {
    const p = await getTestPayload()
    const inactivePm = await makeFlowUser(['pk-pm'], 'qx-inactive-pm', null)
    await p.update({ collection: 'users', id: inactivePm.id, data: { active: false, changeReason: 'uji QA-16' } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */, context: { skipKeycloakSync: true } })
    const where = await (await pickerOf('projects', 'pm'))({ data: { company: await companyId() }, req: await reqAs(w.users.owner) })
    const ids = (await p.find({ collection: 'users', where, depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ: assertion */ })).docs.map((d) => d.id)
    expect(ids).toEqual(expect.arrayContaining([w.users.pm.id, w.users.otherPm.id]))
    for (const no of [w.users.staffA.id, w.users.finance.id, w.users.owner.id, w.users.admin.id, inactivePm.id]) expect(ids).not.toContain(no)
    const mgr = await (await pickerOf('cost-centers', 'manager'))({ data: { company: await companyId() }, req: await reqAs(w.users.owner) })
    const mids = (await p.find({ collection: 'users', where: mgr, depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ: assertion */ })).docs.map((d) => d.id)
    expect(mids).toEqual(expect.arrayContaining([w.users.pm.id, w.users.staffA.id, w.users.finance.id]))
    expect(mids).not.toContain(inactivePm.id)
  })

  it('picker REST request (select/search on the title) returns "Nama · email" and finds by name', async () => {
    const q = new URLSearchParams({ 'select[displayName]': 'true', 'where[displayName][like]': w.users.pm.email.split('-')[0]!, limit: '10', depth: '0' })
    const r = await api('GET', `/api/users?${q}`, w.users.owner)
    expect(r.status, msg(r.body)).toBe(200)
    const pm = ((r.body as Body).docs ?? []).find((d) => d.id === w.users.pm.id)
    expect(pm?.displayName).toBe(`${pm?.name} · ${w.users.pm.email}`)
  })
})

describe('QA-21 Indonesian validation messages with field labels', () => {
  it('duplicate code in the same PT → 400 on path `code` with an Indonesian text (not "company_id, code")', async () => {
    const code = `QXDUP${Date.now() % 10000}`
    const first = await api('POST', '/api/expense-categories', w.users.admin, { code, name: 'Kategori QX' })
    expect(first.status, msg(first.body)).toBe(201)
    const dup = await api('POST', '/api/expense-categories', w.users.admin, { code, name: 'Kategori QX 2' })
    expect(dup.status).toBe(400)
    const inner = (dup.body as Body).errors?.[0]?.data?.errors ?? []
    expect(inner).toEqual([expect.objectContaining({ path: 'code', message: expect.stringMatching(/sudah dipakai di PT ini/) })])
    expect(msg(dup.body)).not.toMatch(/company_id/)
  })

  it('deactivate without reason → "Isian berikut tidak valid: Alasan perubahan" (was English + changeReason)', async () => {
    const v = (await api('POST', '/api/vendors', w.users.admin, { code: `QX-R${Date.now() % 10000}`, name: 'Vendor alasan' })).body as { doc: { id: number } }
    const r = await api('PATCH', `/api/vendors/${v.doc.id}`, w.users.admin, { active: false })
    expect(r.status).toBe(400)
    const top = (r.body as Body).errors?.[0]?.message ?? ''
    expect(top).not.toMatch(/The following field/)
    expect(top).toMatch(/Alasan perubahan/)
  })
})

describe('QA-31 kas edit: proof can be added/replaced; employee phone on create', () => {
  it('PATCH /api/v1/cash-entries/{id} with proofId → 200, proof set + audited; foreign upload refused', async () => {
    const p = await getTestPayload()
    const proofOf = async (id: number) => ((await p.findByID({ collection: 'cash-entries', id, depth: 0, overrideAccess: true /* SYSTEM-READ: assertion */ })) as { proof?: unknown }).proof ?? null
    const kk = (await api('POST', '/api/v1/cash-entries', w.users.finance, { direction: 'out', entryDate: today, cashAccountId: w.cashAccount, amount: 25_000, description: 'Parkir (tanpa bukti)', categoryId: w.cat.bbm }, idem())).body as { id: number }
    expect(await proofOf(kk.id)).toBeNull()
    const proof = (await upload('/api/v1/media/attachments', w.users.finance, await png())).body as { id: number }
    const e = await api('PATCH', `/api/v1/cash-entries/${kk.id}`, w.users.finance, { proofId: proof.id, reason: 'bukti susulan' }, idem())
    expect(e.status, msg(e.body)).toBe(200)
    expect(await proofOf(kk.id)).toBe(proof.id)
    const media = (await p.findByID({ collection: 'media-attachments', id: proof.id, depth: 0, overrideAccess: true /* SYSTEM-READ: assertion */ })) as { ownerDocType?: string; ownerDocId?: string }
    expect(media).toMatchObject({ ownerDocType: 'cash_entry', ownerDocId: String(kk.id) })
    const foreign = (await upload('/api/v1/media/attachments', w.users.finance2, await png())).body as { id: number }
    const f = await api('PATCH', `/api/v1/cash-entries/${kk.id}`, w.users.finance, { proofId: foreign.id, reason: 'ganti bukti' }, idem())
    expect(f.status).toBe(403)
    expect(await proofOf(kk.id)).toBe(proof.id)
    expect((await api('PATCH', `/api/v1/cash-entries/${kk.id}`, w.users.finance, { amount: 1, reason: 'ubah nominal' }, idem())).status).toBe(400)
  })

  it('employees.phone is readable on the create form for office roles (no document yet), not for staff', async () => {
    const field = (await getTestPayload()).collections.employees.config.flattenedFields.find((x: FlattenedField) => x.name === 'phone') as FlattenedField & { access: { read: (a: unknown) => boolean } }
    expect(field.access.read({ req: await reqAs(w.users.admin), doc: undefined })).toBe(true)
    expect(field.access.read({ req: await reqAs(w.users.staffA), doc: undefined })).toBe(false)
    // a document without its PT in the selection → fail closed
    expect(field.access.read({ req: await reqAs(w.users.pm), doc: { id: 999_999 } })).toBe(false)
  })
})
