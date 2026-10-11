import { randomUUID } from 'node:crypto'

import { createLocalReq } from 'payload'
import { renderToString } from 'react-dom/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkflowPanel } from '@/admin/components/WorkflowPanel'
import { resetRateLimits } from '@/lib/rate-limit'

import { getTestPayload } from './helpers'
import { api, draftBody, makeFlowUser, makeWorld, sysCreate, type FlowUser, type World } from './flow-world'

/**
 * DRMS 10/10 Phase A (web expense request screens) through the real API / server rendering:
 * - 8e GET /api/v1/bank-account-preview: masked number for everyone who may see the request; the
 *   full number (reveal=1) only for creator/requesters and Finance/Direktur/Admin of the PT (dto
 *   maskAccountNo rule); other users / other PTs / foreign accounts → 404; the snapshot after submit.
 * - 9c/9d/9a the workflow panel: readable approval timeline, decision bar only for the decider whose
 *   turn it is (PM project → Direktur), one lines table "Rincian pengajuan" also for the requester.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

let w: World
let otherPtFinance: FlowUser
let otherPt = 0
const E = '/api/v1/expense-requests'
const P = '/api/v1/bank-account-preview'
const key = () => ({ 'Idempotency-Key': randomUUID() })

beforeAll(async () => {
  w = await makeWorld('DWF', { rule: 'pm_direktur' })
  // Finance of ANOTHER PT (ADR 0016 §5: no rights in the request's PT)
  otherPt = await sysCreate('companies', { name: 'PT Uji D1010', shortCode: `D1${Date.now() % 1000}`, timezone: 'Asia/Makassar' })
  otherPtFinance = await makeFlowUser(['pk-finance'], 'dwf-fin-other', null, { company: otherPt })
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  const p = await getTestPayload()
  // every other test file assumes the single-company default (same as mc-isolation)
  if (otherPt) await p.update({ collection: 'companies', id: otherPt, data: { active: false, changeReason: 'uji D1010 selesai' }, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
  await p.destroy()
})

async function draft(user: FlowUser = w.users.staffA, over: Record<string, unknown> = {}) {
  const r = await api('POST', E, user, draftBody(w, over), key())
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body.id as number
}

async function panelHtml(user: FlowUser, id: number): Promise<string> {
  const p = await getTestPayload()
  const req = await createLocalReq({ user: { ...user, collection: 'users' } as never }, p)
  const el = await WorkflowPanel({ req, id, operation: 'update' } as never)
  return el ? renderToString(el) : ''
}

const accNo = async (id: number) => (await (await getTestPayload()).findByID({ collection: 'employee-bank-accounts', id, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).accountNo as string

describe('8e bank account preview endpoint', () => {
  it('new form (no request): own account readable → masked, reveal gives the full number; a co-worker account → 404', async () => {
    const no = await accNo(w.accA)
    const r = await api('GET', `${P}?account=${w.accA}`, w.users.staffA)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body).toMatchObject({ source: 'account', accountHolder: 'DWF Staff A', accountNoMasked: `••••${no.slice(-4)}`, canReveal: true })
    expect(r.body.accountNo).toBeUndefined()
    expect(r.body.bankName).toBeTruthy()
    const full = await api('GET', `${P}?account=${w.accA}&reveal=1`, w.users.staffA)
    expect(full.body.accountNo).toBe(no)
    // Staff B may not read Staff A's account
    expect((await api('GET', `${P}?account=${w.accA}&reveal=1`, w.users.staffB)).status).toBe(404)
    expect((await api('GET', `${P}?account=${w.accA}`, otherPtFinance)).status).toBe(404)
    expect((await api('GET', P, w.users.staffA)).status).toBe(400)
    expect((await api('GET', `${P}?account=abc`, w.users.staffA)).status).toBe(400)
  })

  it('draft: the picked account of a requester; foreign account / foreign request → 404', async () => {
    const id = await draft()
    const r = await api('GET', `${P}?request=${id}&account=${w.accA}&reveal=1`, w.users.staffA)
    expect(r.status).toBe(200)
    expect(r.body.accountNo).toBe(await accNo(w.accA))
    // account of an employee who is not a requester and not readable by the caller
    expect((await api('GET', `${P}?request=${id}&account=${w.accB}`, w.users.staffA)).status).toBe(404)
    // request not visible to Staff B / Finance of another PT
    expect((await api('GET', `${P}?request=${id}&account=${w.accA}`, w.users.staffB)).status).toBe(404)
    expect((await api('GET', `${P}?request=${id}&account=${w.accA}`, otherPtFinance)).status).toBe(404)
  })

  it('after submit: the snapshot — full for requester and Finance, masked only for the PM project', async () => {
    const id = await draft()
    expect((await api('POST', `${E}/${id}/submit`, w.users.staffA, {}, key())).status).toBe(200)
    const no = await accNo(w.accA)
    const own = await api('GET', `${P}?request=${id}&reveal=1`, w.users.staffA)
    expect(own.body).toMatchObject({ source: 'snapshot', canReveal: true, accountNo: no })
    const fin = await api('GET', `${P}?request=${id}&reveal=1`, w.users.finance)
    expect(fin.body).toMatchObject({ source: 'snapshot', canReveal: true, accountNo: no })
    const pm = await api('GET', `${P}?request=${id}&reveal=1`, w.users.pm)
    expect(pm.status).toBe(200)
    expect(pm.body).toMatchObject({ source: 'snapshot', canReveal: false, accountNoMasked: `••••${no.slice(-4)}` })
    expect(pm.body.accountNo).toBeUndefined()
    // the picker value is ignored after submit (no probing of other accounts through a visible request)
    const probe = await api('GET', `${P}?request=${id}&account=${w.accB}&reveal=1`, w.users.pm)
    expect(probe.body.accountNoMasked).toBe(`••••${no.slice(-4)}`)
    expect((await api('GET', `${P}?request=${id}`, w.users.staffB)).status).toBe(404)
    expect((await api('GET', `${P}?request=${id}`, otherPtFinance)).status).toBe(404)
  })
})

describe('9a/9c/9d workflow panel', () => {
  it('PM sees the timeline + decision bar; the requester the table but no bar; after PM approval the Direktur gets the bar', async () => {
    const id = await draft()
    expect((await api('POST', `${E}/${id}/submit`, w.users.staffA, {}, key())).status).toBe(200)

    const pm = await panelHtml(w.users.pm, id)
    expect(pm).toContain('data-pk-approval-timeline')
    expect(pm).toContain('Persetujuan PM<')
    expect(pm).toMatch(/data-pk-step="diketahui" data-pk-step-state="current"/)
    expect(pm).toContain('data-pk-decision-bar')
    expect(pm).toContain('data-pk-action="acknowledge"')
    expect(pm).toContain('data-pk-action="reject"')
    expect(pm).not.toContain('direktur_via_pm')

    const own = await panelHtml(w.users.staffA, id)
    expect(own).toContain('Rincian pengajuan')
    expect(own).toContain('data-pk-section="review"')
    expect(own).not.toContain('data-pk-decision-bar')
    // the Direktur's turn has not come yet
    expect(await panelHtml(w.users.owner, id)).not.toContain('data-pk-decision-bar')

    expect((await api('POST', `${E}/${id}/acknowledge`, w.users.pm, {}, key())).status).toBe(200)
    const dir = await panelHtml(w.users.owner, id)
    expect(dir).toMatch(/data-pk-step="diketahui" data-pk-step-state="done"/)
    expect(dir).toMatch(/data-pk-step="approval-1" data-pk-step-state="current"/)
    expect(dir).toContain('data-pk-action="approve"')
    expect(dir).toContain('Persetujuan Direktur')
    expect(await panelHtml(w.users.pm, id)).not.toContain('data-pk-decision-bar')
  })
})
