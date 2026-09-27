import { randomUUID } from 'node:crypto'

import { createLocalReq } from 'payload'
import { renderToString } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { ResubmitOfField } from '@/admin/components/ResubmitOfField'
import { WorkflowPanel } from '@/admin/components/WorkflowPanel'
import { addDays } from '@/domain/expense/types'
import { buildPdfData } from '@/pdf/data'

import { auditRows, getTestPayload, sqlAs, sqlError } from './helpers'
import { api, asUser, draftBody, makeFlowUser, makeWorld, png, sysCreate, upload, type FlowUser, type World } from './flow-world'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

/**
 * F2e — final-UAT fixes:
 * 1. "Diketahui Oleh" fallback (user decision option a) — since E1 (ADR 0013) only for LEGACY
 *    snapshots: a delegated pre-E1 request still completes (G1 negatives, audit, timeline, PDF).
 * 2. "Pengajuan ulang dari" shows the old request's NUMBER + title (panel banner + form field).
 * 5. Finance cannot verify receipts / review flags on its own request (domain 403 + audited
 *    denied attempt + DB trigger).
 */
let w: World
let accPm: number
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })
const yesterday = () => addDays(new Date().toISOString().slice(0, 10), -1)

beforeAll(async () => {
  w = await makeWorld('FE')
  // The world's PM is also the MANAGER of the world's cost center (Q-07 acknowledger) → a request
  // with the PM as "Diajukan Oleh" on that cost center is the UAT case.
  const bank = (await sqlAs('app', "SELECT id FROM banks WHERE code = 'MANDIRI'")).rows[0].id as number
  accPm = await sysCreate('employee-bank-accounts', { employee: w.emp.pm, bank, accountNo: `8${Date.now() % 1e9}3`, accountHolder: 'FE PM', isDefault: true })
})

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

/** Draft by `creator` (Admin/Finance, Q-09) for the PM as requester on a cost center; submitted. */
async function pmRequest(creator: FlowUser, costCenterId: number, submitStatus = 200) {
  const d = await api('POST', E, creator, draftBody(w, { projectId: undefined, costCenterId, requesterIds: [w.emp.pm], bankAccountId: accPm }), key())
  expect(d.status, JSON.stringify(d.body)).toBe(201)
  const s = await api('POST', `${E}/${d.body.id}/submit`, creator, {}, key())
  expect(s.status, JSON.stringify(s.body)).toBe(submitStatus)
  return { id: d.body.id as number, submit: s }
}

async function panelHtml(user: FlowUser, id: number): Promise<string> {
  const req = await createLocalReq({ user: { ...user, collection: 'users' } as never }, await getTestPayload())
  const el = await WorkflowPanel({ req, id, operation: 'update' } as never)
  return el ? renderToString(el) : ''
}

describe('F2e acknowledger delegation — LEGACY snapshots only (ADR 0013 supersedes it for new requests)', () => {
  it('a pre-E1 request whose "Diketahui" was delegated to the Owner (PM = requester) still completes: delegate acknowledges, another Owner approves, PDF "(dilimpahkan)"', async () => {
    // Submitted before E1: the PM (requester) on his cost center → "Diketahui" delegated to the Owners.
    const { id } = await pmRequest(w.users.admin, w.costCenter)
    expect((await api('POST', `${E}/${id}/withdraw`, w.users.admin, { reason: 'simulasi pra-E1' }, key())).status).toBe(200)
    const legacy = {
      ruleId: 1,
      ruleName: 'Default — Owner (semua nominal)',
      acknowledge: 'required',
      acknowledgeBy: 'scope_manager',
      acknowledgerUserId: null,
      acknowledgeRole: null,
      signDiajukan: 'required',
      signDibuat: 'required',
      steps: [{ level: 1, approverRole: 'pk-owner', approverUserId: null }],
      acknowledgeDelegatedTo: 'owner',
      acknowledgeDelegationReason: 'PM/penanggung jawab adalah pemohon/pembuat (Q-07/Q-08)',
      acknowledgeDelegateUserIds: [w.users.owner.id, w.users.owner2.id],
      acknowledgeOriginalUserId: w.users.pm.id,
    }
    await sqlAs('app', "UPDATE expense_requests SET status = 'pending_ack', current_level = 0, approval_snapshot = $2::jsonb WHERE id = $1", [id, JSON.stringify(legacy)])

    // timeline: "Giliran: Direktur — Diketahui (dilimpahkan)" (pk-owner is labelled Direktur since E1)
    const html = await panelHtml(w.users.admin, id)
    expect(html.replace(/<!-- -->/g, '')).toMatch(/Giliran: <strong>Direktur<\/strong> — Diketahui \(dilimpahkan\)/)

    // G1: the PM (requester) may not acknowledge — 403 and an audited denied attempt
    const denied = await api('POST', `${E}/${id}/acknowledge`, w.users.pm, {}, key())
    expect(denied.status).toBe(403)
    expect((await auditRows('expense_request', id)).some((r) => r.action === 'access_denied' && r.field === 'acknowledge' && r.user_id === String(w.users.pm.id))).toBe(true)
    expect((await api('POST', `${E}/${id}/acknowledge`, w.users.admin, {}, key())).status).toBe(403) // creator
    expect((await api('POST', `${E}/${id}/acknowledge`, w.users.finance, {}, key())).status).toBe(403) // not a delegate

    const ack = await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {}, key())
    expect(ack.status, JSON.stringify(ack.body)).toBe(200)
    expect(ack.body).toMatchObject({ status: 'pending_approval', currentLevel: 1 })
    const ackAudit = (await auditRows('expense_request', id)).find((r) => r.action === 'acknowledge')
    expect(ackAudit?.new_value?.v).toMatchObject({ delegatedTo: 'owner' })
    expect(ackAudit?.reason).toMatch(/dilimpahkan ke Direktur/)

    // the acknowledging Owner cannot also approve (G1 one position per person); another Owner can
    expect((await api('POST', `${E}/${id}/approve`, w.users.owner, {}, key())).status).toBe(403)
    const ok = await api('POST', `${E}/${id}/approve`, w.users.owner2, {}, key())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.status).toBe('approved')

    const pdf = await asUser(w.users.owner, (req) => buildPdfData(req, id, { internal: false, printedBy: 'test' }))
    const box = pdf.signatures.find((s) => s.label === 'Diketahui Oleh')
    const ackName = ack.body.approvals.find((a: { position: string }) => a.position === 'diketahui').actorName as string
    expect(box?.names).toBe(`${ackName} (dilimpahkan)`)
  })

  it('new requests: PM as requester no longer triggers a delegation — the Direktur approves as for everyone', async () => {
    const { submit } = await pmRequest(w.users.admin, w.costCenter)
    expect(submit.body.status).toBe('pending_ack')
    expect(submit.body.approvalRule).toMatchObject({ acknowledgeBy: 'role', acknowledgeRole: 'pk-owner', acknowledgeDelegatedTo: null, skipped: [] })
    expect((await auditRows('expense_request', submit.body.id)).some((r) => r.action === 'acknowledge_delegated')).toBe(false)
  })
})

describe('F2e "Pengajuan ulang dari" shows the old number', () => {
  it('resubmitted draft: panel banner and form field show "<docNo> — <title>" of the rejected request', async () => {
    const d = await api('POST', E, w.users.staffA, draftBody(w, { title: 'Material gudang FE' }), key())
    const id = d.body.id as number
    const s = await api('POST', `${E}/${id}/submit`, w.users.staffA, {}, key())
    const docNo = s.body.docNo as string
    expect(docNo).toMatch(/\/PB-DRMS\//)
    expect((await api('POST', `${E}/${id}/reject`, w.users.owner, { reason: 'Lengkapi rincian material' }, key())).status).toBe(200)
    const r = await api('POST', `${E}/${id}/resubmit`, w.users.staffA, {}, key())
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body.resubmitOf).toEqual({ id, docNo, title: 'Material gudang FE' })
    const html = (await panelHtml(w.users.staffA, r.body.id)).replace(/<!-- -->/g, '')
    expect(html).toContain(`data-pk-resubmit-of="${id}"`)
    expect(html).toContain(`Pengajuan ulang dari <a href="/admin/collections/expense-requests/${id}"><strong>${docNo}</strong></a> — Material gudang FE`)
    const req = await createLocalReq({ user: { ...w.users.staffA, collection: 'users' } as never }, await getTestPayload())
    const field = await ResubmitOfField({ req, data: { resubmitOf: id } } as never)
    expect(renderToString(field!)).toContain(`${docNo} — Material gudang FE`)
    // a viewer without read access sees only the id
    const other = await createLocalReq({ user: { ...w.users.staffB, collection: 'users' } as never }, await getTestPayload())
    expect(renderToString((await ResubmitOfField({ req: other, data: { resubmitOf: id } } as never))!)).not.toContain(docNo)
  })
})

describe('F2e Finance self-involvement guard on receipt verification (Reimburse)', () => {
  it('Finance who created the request cannot mark valid / reject / review flags / verify all (403, audited); another Finance can; DB refuses self-verification', async () => {
    const creatorFinance = w.users.finance
    const otherFinance = await makeFlowUser(['pk-finance'], 'FE-finance3', null)
    const d = await api('POST', E, creatorFinance, draftBody(w, { type: 'reimburse' }), key()) // on behalf of Staff A (Q-09)
    expect(d.status, JSON.stringify(d.body)).toBe(201)
    const id = d.body.id as number
    for (const [i, amount] of [600_000, 140_000].entries()) {
      const img = await upload('/api/v1/media/receipts', creatorFinance, await png())
      const rc = await api('POST', `${E}/${id}/receipts`, creatorFinance, { lineId: d.body.lines[i].id, receiptNo: `FE-${id}-${i}`, vendorName: `Toko FE ${i}`, receiptDate: yesterday(), amount, imageId: img.body.id }, key())
      expect(rc.status, JSON.stringify(rc.body)).toBe(201)
    }
    expect((await api('POST', `${E}/${id}/submit`, creatorFinance, {}, key())).status).toBe(200)
    expect((await api('POST', `${E}/${id}/acknowledge`, w.users.owner, {}, key())).status).toBe(200)
    const a = await api('POST', `${E}/${id}/approve`, w.users.finance2, {}, key()) // the creator (Finance) never approves (G1)
    expect(a.body.status).toBe('approved')
    const receipt = a.body.receipts[0] as { id: number }
    const flag = (a.body.flags as Array<{ id: number; status: string; level: string }>).find((f) => f.status === 'open')!

    const self = await api('GET', `${E}/${id}`, creatorFinance)
    expect(self.body.allowedActions).not.toEqual(expect.arrayContaining(['receipt_verify']))
    for (const [path, body] of [
      [`receipts/${receipt.id}/verify`, {}],
      [`receipts/${receipt.id}/reject`, { reason: 'Tidak sah' }],
      [`flags/${flag.id}/review`, {}],
      ['verify-receipts', {}],
    ] as const) {
      const r = await api('POST', `${E}/${id}/${path}`, creatorFinance, body, key())
      expect(r.status, path).toBe(403)
      expect(JSON.stringify(r.body)).toMatch(/Finance tidak dapat/)
    }
    const denied = (await auditRows('expense_request', id)).filter((r) => r.action === 'access_denied')
    expect(denied.map((r) => r.field).sort()).toEqual(['receipt_reject', 'receipt_verify', 'review_flag', 'verify_receipts'])
    expect(denied.every((r) => r.user_id === String(creatorFinance.id))).toBe(true)
    // nothing changed
    const after = await api('GET', `${E}/${id}`, otherFinance)
    expect(after.body.status).toBe('approved')
    expect(after.body.receipts.every((x: { status: string }) => x.status === 'pending')).toBe(true)
    expect(after.body.allowedActions).toEqual(expect.arrayContaining(['receipt_verify', 'receipt_reject', 'verify_receipts', 'review_flag']))

    // DB level (app role, raw SQL): the creator / a requester cannot be the verifier or reviewer
    const e1 = await sqlError('app', "UPDATE receipts SET status = 'valid', verified_by_id = $1 WHERE id = $2", [creatorFinance.id, receipt.id])
    expect(e1?.code).toBe('42501')
    const e2 = await sqlError('app', "UPDATE receipts SET status = 'valid', verified_by_id = $1 WHERE id = $2", [w.users.staffA.id, receipt.id])
    expect(e2?.code).toBe('42501')
    const e3 = await sqlError('app', "UPDATE receipt_flags SET status = 'reviewed', reviewed_by_id = $1 WHERE id = $2", [creatorFinance.id, flag.id])
    expect(e3?.code).toBe('42501')

    // another Finance verifies normally
    expect((await api('POST', `${E}/${id}/receipts/${receipt.id}/verify`, otherFinance, {}, key())).status).toBe(200)
    expect((await api('POST', `${E}/${id}/flags/${flag.id}/review`, otherFinance, { note: 'ok' }, key())).status).toBe(200)
  })
})
