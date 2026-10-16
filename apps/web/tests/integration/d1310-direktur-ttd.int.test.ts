import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildApprovalTimeline } from '@/domain/expense/approval-timeline'
import { resetRateLimits } from '@/lib/rate-limit'
import { buildPdfData } from '@/pdf/data'

import { addMembership, companyId, getTestPayload, sqlAs, sqlError } from './helpers'
import { api, asUser, draftBody, makeFlowUser, makeWorld, png, uploadMedia, type FlowUser, type World } from './flow-world'

/**
 * ADR 0025 (DRMS 13/10 A3, owner): per-PT definitive Direktur signature. PT DRMS gets a definitive Direktur
 * (synthetic name, title, generated PNG) and designated representatives; a representative deciding a DIREKTUR
 * step signs with the PT signature and is SHOWN as that Direktur (approval row, PDF, timeline, history, API),
 * while the row keeps the real user. Personal signatures elsewhere: PT without configuration, a non-representative
 * Direktur, a representative on a non-Direktur step. Media access, DB guards and the snapshot are checked too.
 * The configuration is removed again in afterAll (other files share PT DRMS).
 */
const DIREKTUR = 'Direktur Definitif Uji'
const TITLE = 'Direktur Utama'
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })

let w: World // ADR 0021: PM project → Direktur
let old: World // ADR 0013: Direktur "Diketahui" → Finance
let drms: number
let rep2: FlowUser // Direktur + Finance, also a representative
let sig: number

beforeAll(async () => {
  w = await makeWorld('TTD', { rule: 'pm_direktur' })
  old = await makeWorld('TTO')
  drms = await companyId()
  rep2 = await makeFlowUser(['pk-owner', 'pk-finance'], 'TTD-rep2', null)
  sig = await uploadMedia('media-signatures', w.users.admin, await png(9001, 800, 300))
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  const p = await getTestPayload()
  await p.update({ collection: 'companies', id: drms, data: { direktur: { name: null, title: null, signature: null, representatives: [] } } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture cleanup */ })
  await p.destroy()
})

async function configure(user: FlowUser, direktur: Record<string, unknown>) {
  const p = await getTestPayload()
  return p.update({ collection: 'companies', id: drms, data: { direktur } as never, depth: 0, user, overrideAccess: false })
}

async function submitted(world: World = w): Promise<number> {
  const c = await api('POST', E, world.users.staffA, draftBody(world), key())
  expect(c.status, JSON.stringify(c.body)).toBe(201)
  const s = await api('POST', `${E}/${c.body.id}/submit`, world.users.staffA, {}, key())
  expect(s.status, JSON.stringify(s.body)).toBe(200)
  return c.body.id as number
}

async function pmApproved(): Promise<number> {
  const id = await submitted()
  const ack = await api('POST', `${E}/${id}/acknowledge`, w.users.pm, {}, key())
  expect(ack.status, JSON.stringify(ack.body)).toBe(200)
  return id
}

type Row = { position: string; level: number; actor_id: number; actor_name: string; decision: string; signature_id: number | null; signature_source: string; represented_direktur_name: string | null; represented_direktur_title: string | null }
const rows = async (id: number): Promise<Row[]> =>
  (
    await sqlAs(
      'app',
      `SELECT position::text, level, actor_id, actor_name, decision::text, signature_id, signature_source::text, represented_direktur_name, represented_direktur_title
         FROM approvals WHERE request_id = $1 AND position::text IN ('diketahui', 'approval') ORDER BY id`,
      [id],
    )
  ).rows as Row[]

describe('1. PT without a definitive Direktur: unchanged', () => {
  it('the Direktur approves with the profile signature under his own name', async () => {
    const id = await pmApproved()
    const d = await api('GET', `${E}/${id}`, w.users.owner)
    expect(d.body.direkturSignature).toBeNull()
    const ok = await api('POST', `${E}/${id}/approve`, w.users.owner, {}, key())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    const r = (await rows(id)).find((x) => x.position === 'approval')!
    expect(r).toMatchObject({ actor_id: w.users.owner.id, actor_name: 'TTD-owner', signature_source: 'profile', represented_direktur_name: null })
  })
})

describe('2. configuration (tab "Direktur definitif")', () => {
  it('only the Admin of the PT configures; complete config; only Direktur users as representatives; no profile signature', async () => {
    // a Direktur may update the PT, but not this group (field access) — silently kept
    await configure(w.users.owner2, { name: 'Bukan Direktur', title: null, signature: sig, representatives: [w.users.owner2.id] })
    expect(((await sqlAs('app', 'SELECT direktur_name FROM companies WHERE id = $1', [drms])).rows[0] as { direktur_name: string | null }).direktur_name).toBeNull()
    // representatives must hold the Direktur role in the PT
    await expect(configure(w.users.admin, { name: DIREKTUR, title: TITLE, signature: sig, representatives: [w.users.finance.id] })).rejects.toMatchObject({ status: 400 })
    // a user's profile signature never becomes the PT signature
    const profile = ((await sqlAs('app', 'SELECT signature_id FROM users WHERE id = $1', [w.users.owner.id])).rows[0] as { signature_id: number }).signature_id
    await expect(configure(w.users.admin, { name: DIREKTUR, title: TITLE, signature: profile, representatives: [w.users.owner.id] })).rejects.toMatchObject({ status: 400 })
    // incomplete (no name)
    await expect(configure(w.users.admin, { name: '', title: TITLE, signature: sig, representatives: [w.users.owner.id] })).rejects.toMatchObject({ status: 400 })

    await configure(w.users.admin, { name: DIREKTUR, title: TITLE, signature: sig, representatives: [w.users.owner.id, rep2.id] })
    const m = (await sqlAs('app', 'SELECT owner_doc_type, owner_doc_id FROM media_signatures WHERE id = $1', [sig])).rows[0]
    expect(m).toEqual({ owner_doc_type: 'company_direktur', owner_doc_id: String(drms) })
    // owner link immutable (DB)
    expect((await sqlError('app', "UPDATE media_signatures SET owner_doc_id = '999999' WHERE id = $1", [sig]))?.code).toBe('42501')
    // Staff of the PT do not read the group
    const p = await getTestPayload()
    const asStaff = (await p.findByID({ collection: 'companies', id: drms, depth: 0, user: w.users.staffA, overrideAccess: false })) as { direktur?: unknown }
    expect(asStaff.direktur ?? null).toBeNull()
  })
})

describe('3. representative on the Direktur step', () => {
  it('approve: PT signature + Direktur name on the row, PDF, timeline, history; the real user stays internal', async () => {
    const id = await pmApproved()
    // DTO hint for the APK decision sheet: only the representative, only on his Direktur step
    expect((await api('GET', `${E}/${id}`, w.users.owner)).body.direkturSignature).toEqual({ name: DIREKTUR, title: TITLE, signatureId: sig })
    expect((await api('GET', `${E}/${id}`, w.users.owner2)).body.direkturSignature).toBeNull()
    // a drawn signature of the representative is ignored — the server decides
    const drawn = await uploadMedia('media-signatures', w.users.owner, await png(9002, 800, 300))
    const ok = await api('POST', `${E}/${id}/approve`, w.users.owner, { signatureMediaId: drawn }, key())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    const [pmRow, dirRow] = await rows(id)
    expect(pmRow).toMatchObject({ position: 'diketahui', actor_id: w.users.pm.id, signature_source: 'profile', represented_direktur_name: null })
    expect(dirRow).toMatchObject({ position: 'approval', actor_id: w.users.owner.id, actor_name: DIREKTUR, signature_id: sig, signature_source: 'company', represented_direktur_name: DIREKTUR, represented_direktur_title: TITLE })
    const a = ok.body.approvals.find((x: { position: string }) => x.position === 'approval')
    expect(a).toMatchObject({ actorName: DIREKTUR, signatureSource: 'company', signatureId: sig })

    // PDF: the PT Direktur signature and name, no "via app" note
    const pdf = await asUser(w.users.finance, (req) => buildPdfData(req, id, { internal: false, printedBy: 'test' }))
    const box = pdf.signatures.find((s) => s.label === 'Approval')!
    expect(box.names).toBe(`${DIREKTUR} (${TITLE})`)
    expect(box.images).toHaveLength(1)
    expect(box.note).toBeUndefined()
    expect(JSON.stringify(pdf.signatures)).not.toContain('TTD-owner')

    // approval timeline / stepper (web = APK turn timeline): the Direktur's name
    const d = (await api('GET', `${E}/${id}`, w.users.staffA)).body
    const steps = buildApprovalTimeline({
      type: d.type,
      status: d.status,
      approvalCycle: d.approvalCycle,
      currentLevel: d.currentLevel,
      submittedAt: d.submittedAt,
      snapshot: d.approvalRule,
      approvals: d.approvals,
      transfers: d.transfers,
      requesters: 'TTD Staff A',
      createdBy: null,
      names: {},
    })
    expect(steps.find((s) => s.key === 'approval-1')).toMatchObject({ state: 'done', actor: DIREKTUR })

    // Log perubahan / API history: the decision and its status change show the Direktur, the user id stays
    const h = (await api('GET', `${E}/${id}/history`, w.users.staffA)).body.items as Array<{ action: string; statusTo: string | null; userId: number; userName: string | null }>
    expect(h.find((x) => x.action === 'approve')).toMatchObject({ userId: w.users.owner.id, userName: DIREKTUR })
    expect(h.find((x) => x.statusTo === 'approved')).toMatchObject({ userId: w.users.owner.id, userName: DIREKTUR })
    expect(h.some((x) => x.userName === 'TTD-owner')).toBe(false)
    // notifications never carry the representative's name
    const n = await sqlAs('app', 'SELECT title, body FROM notifications WHERE doc_type = $1 AND doc_id = $2', ['expense_request', String(id)])
    expect(JSON.stringify(n.rows)).not.toContain('TTD-owner')
  })

  it('reject at the Direktur step: the Direktur decides too', async () => {
    const id = await pmApproved()
    const r = await api('POST', `${E}/${id}/reject`, w.users.owner, { reason: 'Tidak sesuai anggaran' }, key())
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect((await rows(id)).find((x) => x.position === 'approval')).toMatchObject({ decision: 'rejected', actor_name: DIREKTUR, signature_source: 'company' })
  })

  it('a Direktur who is not a representative signs personally', async () => {
    const id = await pmApproved()
    const ok = await api('POST', `${E}/${id}/approve`, w.users.owner2, {}, key())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect((await rows(id)).find((x) => x.position === 'approval')).toMatchObject({ actor_id: w.users.owner2.id, actor_name: 'TTD-owner2', signature_source: 'profile', represented_direktur_name: null })
  })

  it('Direktur → Finance: "Diketahui" by a representative is the PT Direktur; the same kind of representative on the Finance level signs personally', async () => {
    const id = await submitted(old)
    expect((await api('GET', `${E}/${id}`, w.users.owner)).body.direkturSignature).toMatchObject({ name: DIREKTUR })
    const ack = await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {}, key())
    expect(ack.status, JSON.stringify(ack.body)).toBe(200)
    expect((await api('GET', `${E}/${id}`, rep2)).body.direkturSignature).toBeNull() // the Finance level is not a Direktur step
    const ok = await api('POST', `${E}/${id}/approve`, rep2, {}, key())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    const [dk, fin] = await rows(id)
    expect(dk).toMatchObject({ position: 'diketahui', actor_id: w.users.owner.id, actor_name: DIREKTUR, signature_source: 'company' })
    expect(fin).toMatchObject({ position: 'approval', actor_id: rep2.id, actor_name: 'TTD-rep2', signature_source: 'profile', represented_direktur_name: null })
  })
})

describe('4. security', () => {
  it('the PT signature file: office roles of the PT yes; Staff (even the requester) and PM no', async () => {
    const file = `/api/v1/media/signatures/${sig}/file`
    expect((await api('GET', file, w.users.owner)).status).toBe(200)
    expect((await api('GET', file, w.users.finance)).status).toBe(200)
    expect((await api('GET', file, w.users.staffA)).status).toBe(404) // requester of requests signed with it
    expect((await api('GET', file, w.users.pm)).status).toBe(404)
    const p = await getTestPayload()
    const list = await p.find({ collection: 'media-signatures', where: { id: { equals: sig } }, depth: 0, user: w.users.staffA, overrideAccess: false })
    expect(list.docs).toHaveLength(0)
  })

  it('DB: a company-signed row only by a designated representative with the PT signature; snapshot ⇔ source', async () => {
    const id = await pmApproved()
    const insert = (actor: number, source: string, name: string | null) =>
      sqlError(
        'app',
        `INSERT INTO approvals (doc_type, request_id, company_id, cycle, position, level, actor_id, actor_name, decision, signature_id, signature_source, represented_direktur_name, updated_at, created_at)
         VALUES ('expense_request', $1, $2, 99, 'approval', 1, $3, 'x', 'approved', $4, $5, $6, now(), now())`,
        [id, drms, actor, sig, source, name],
      )
    const notRep = await insert(w.users.owner2.id, 'company', DIREKTUR)
    expect(notRep?.code, notRep?.message).toBe('42501')
    expect(notRep?.message).toMatch(/designated representative/)
    expect((await insert(w.users.owner.id, 'profile', DIREKTUR))?.code).toBe('23514') // snapshot without company source
    expect((await insert(w.users.owner.id, 'company', 'Nama Lain'))?.code).toBe('42501') // not the PT's Direktur name
  })
})

describe('5. snapshot', () => {
  it('a later change of the PT Direktur never alters signed approvals or their PDF', async () => {
    const id = await pmApproved()
    expect((await api('POST', `${E}/${id}/approve`, w.users.owner, {}, key())).status).toBe(200)
    const before = await asUser(w.users.finance, (req) => buildPdfData(req, id, { internal: false, printedBy: 'test' }))
    const sig2 = await uploadMedia('media-signatures', w.users.admin, await png(9003, 800, 300))
    await configure(w.users.admin, { name: 'Direktur Pengganti Uji', title: 'Direktur', signature: sig2, representatives: [w.users.owner.id] })
    const after = await asUser(w.users.finance, (req) => buildPdfData(req, id, { internal: false, printedBy: 'test' }))
    expect(after.signatures.find((s) => s.label === 'Approval')).toEqual(before.signatures.find((s) => s.label === 'Approval'))
    expect((await rows(id)).find((x) => x.position === 'approval')).toMatchObject({ signature_id: sig, actor_name: DIREKTUR, represented_direktur_title: TITLE })
    // new decisions use the new data
    const id2 = await pmApproved()
    expect((await api('POST', `${E}/${id2}/approve`, w.users.owner, {}, key())).status).toBe(200)
    expect((await rows(id2)).find((x) => x.position === 'approval')).toMatchObject({ signature_id: sig2, actor_name: 'Direktur Pengganti Uji' })
  })
})

describe('6. owner 2026-10-16: wakil PM + Direktur — the PM project who is a representative decides both steps', () => {
  let wr: World // PM project → Direktur; its PM also holds the Direktur role in the PT
  let sig6: number
  const NAME6 = 'Direktur Wakil PM Uji'

  beforeAll(async () => {
    wr = await makeWorld('TTW', { rule: 'pm_direktur' })
    await addMembership(wr.users.pm.id, drms, ['pk-pm', 'pk-owner'], wr.emp.pm)
    sig6 = await uploadMedia('media-signatures', w.users.admin, await png(9006, 800, 300))
  })

  async function pmAcknowledged(): Promise<number> {
    const id = await submitted(wr)
    const ack = await api('POST', `${E}/${id}/acknowledge`, wr.users.pm, {}, key())
    expect(ack.status, JSON.stringify(ack.body)).toBe(200)
    return id
  }

  it('representative: PM step with the own signature, then the Direktur step as the definitive Direktur', async () => {
    await configure(w.users.admin, { name: NAME6, title: TITLE, signature: sig6, representatives: [w.users.owner.id, wr.users.pm.id] })
    const id = await pmAcknowledged()
    const d = (await api('GET', `${E}/${id}`, wr.users.pm)).body
    expect(d.allowedActions).toContain('approve')
    expect(d.direkturSignature).toEqual({ name: NAME6, title: TITLE, signatureId: sig6 })
    const ok = await api('POST', `${E}/${id}/approve`, wr.users.pm, {}, key())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    const [pmRow, dirRow] = await rows(id)
    expect(pmRow).toMatchObject({ position: 'diketahui', actor_id: wr.users.pm.id, signature_source: 'profile', represented_direktur_name: null })
    expect(dirRow).toMatchObject({ position: 'approval', actor_id: wr.users.pm.id, actor_name: NAME6, signature_id: sig6, signature_source: 'company', represented_direktur_name: NAME6 })
    const pdf = await asUser(w.users.finance, (req) => buildPdfData(req, id, { internal: false, printedBy: 'test' }))
    expect(pdf.signatures.find((s) => s.label === 'Approval')!.names).toBe(`${NAME6} (${TITLE})`)
  })

  it('reject at the Direktur step by the same representative: the definitive Direktur rejects', async () => {
    const id = await pmAcknowledged()
    const r = await api('POST', `${E}/${id}/reject`, wr.users.pm, { reason: 'Tidak sesuai anggaran' }, key())
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect((await rows(id)).find((x) => x.position === 'approval')).toMatchObject({ actor_id: wr.users.pm.id, decision: 'rejected', actor_name: NAME6, signature_source: 'company' })
  })

  it('a PM who holds the Direktur role but is NOT a representative still decides one position only (G1, app + DB)', async () => {
    await configure(w.users.admin, { name: NAME6, title: TITLE, signature: sig6, representatives: [w.users.owner.id] })
    const id = await pmAcknowledged()
    expect((await api('GET', `${E}/${id}`, wr.users.pm)).body.allowedActions).not.toContain('approve')
    expect((await api('POST', `${E}/${id}/approve`, wr.users.pm, {}, key())).status).toBe(403)
    // DB: a second personal decision position of the same user in the cycle
    const dup = await sqlError(
      'app',
      `INSERT INTO approvals (doc_type, request_id, company_id, cycle, position, level, actor_id, actor_name, decision, signature_source, updated_at, created_at)
       VALUES ('expense_request', $1, $2, 1, 'approval', 1, $3, 'x', 'approved', 'profile', now(), now())`,
      [id, drms, wr.users.pm.id],
    )
    expect(dup?.code, dup?.message).toBe('23505')
    const ok = await api('POST', `${E}/${id}/approve`, w.users.owner, {}, key())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
  })
})
