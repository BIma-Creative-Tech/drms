import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ReviewDetails } from '@/admin/components/ReviewDetails'
import { detail } from '@/domain/expense/dto'
import { approvedByCaller } from '@/domain/expense/transfers'
import { resetRateLimits } from '@/lib/rate-limit'

import { auditRows, getTestPayload, sqlAs } from './helpers'
import { api, asUser, draftBody, makeWorld, png, upload, type FlowUser, type Res, type World } from './flow-world'

/**
 * Sprint S3 track E — Fase 1 UAT gap fixes (docs/proyekkas/uat/fase1/README.md):
 * S-01 PM monitoring (dashboard), S-03 bank account default, S-04 notifications (submit / withdraw /
 * on behalf, approval email), S-05 review details + flag count, S-06 reject reason message, S-08 LPJ
 * flag review, S-24 logo size, S-26 resubmit copies receipts, S-29 "Anda juga yang menyetujui".
 */
let w: World
const E = '/api/v1/expense-requests'

async function must(r: Promise<Res>, status = 200): Promise<Res['body']> {
  const x = await r
  expect(x.status, JSON.stringify(x.body)).toBe(status)
  return x.body
}

async function settings(data: Record<string, unknown>) {
  const p = await getTestPayload()
  await p.updateGlobal({ slug: 'company-settings', data, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
}

async function notes(user: FlowUser, docId: number) {
  const r = await sqlAs('app', 'SELECT event FROM notifications WHERE user_id = $1 AND doc_id = $2 ORDER BY id', [user.id, String(docId)])
  return r.rows.map((x) => x.event as string)
}

async function emailJobs(userId: number, docNo: string) {
  const r = await sqlAs('app', `SELECT count(*)::int AS n FROM payload_jobs WHERE task_slug = 'sendEmail' AND (input->>'userId')::int = $1 AND input->>'subject' LIKE $2`, [userId, `%${docNo}%`])
  return r.rows[0].n as number
}

async function receiptImage(user: FlowUser) {
  resetRateLimits()
  return (await must(upload('/api/v1/media/receipts', user, await png()), 201)).id as number
}

beforeAll(async () => {
  w = await makeWorld('sxe') // letters only: the fixture vehicle plate uses the tag
})

afterAll(async () => {
  await settings({ notifyRequesterStatusEnabled: true, approvalEmailEnabled: false })
})

describe('S-04 notifications (US-05, US-41)', () => {
  it('created on behalf / submitted / withdrawn → the other requester; approval email to the Direktur when enabled', async () => {
    await settings({ notifyRequesterStatusEnabled: true, approvalEmailEnabled: true })
    const c = await must(api('POST', E, w.users.staffA, draftBody(w, { requesterIds: [w.emp.a, w.emp.b] })), 201)
    expect(await notes(w.users.staffB, c.id)).toEqual(['expense.created_on_behalf'])
    expect(await notes(w.users.staffA, c.id)).toEqual([]) // the actor is never notified of their own action
    const s = await must(api('POST', `${E}/${c.id}/submit`, w.users.staffA, {}))
    expect(await notes(w.users.staffB, c.id)).toEqual(['expense.created_on_behalf', 'expense.submitted'])
    expect(await notes(w.users.owner, c.id)).toEqual(['expense.pending_ack'])
    expect(await notes(w.users.pm, c.id)).toEqual([]) // ADR 0013: PM monitors, never asked
    expect(await emailJobs(w.users.owner.id, s.docNo)).toBe(1)
    expect(await emailJobs(w.users.staffB.id, s.docNo)).toBe(0) // email only to deciders
    await must(api('POST', `${E}/${c.id}/withdraw`, w.users.staffA, { reason: 'salah nominal' }))
    expect(await notes(w.users.staffB, c.id)).toEqual(['expense.created_on_behalf', 'expense.submitted', 'expense.withdrawn'])
  })

  it('toggles off: no requester events, no approval email (the decider keeps the in-app row)', async () => {
    await settings({ notifyRequesterStatusEnabled: false, approvalEmailEnabled: false })
    const c = await must(api('POST', E, w.users.staffA, draftBody(w, { requesterIds: [w.emp.a, w.emp.b] })), 201)
    const s = await must(api('POST', `${E}/${c.id}/submit`, w.users.staffA, {}))
    expect(await notes(w.users.staffB, c.id)).toEqual([])
    expect(await notes(w.users.owner, c.id)).toEqual(['expense.pending_ack'])
    expect(await emailJobs(w.users.owner.id, s.docNo)).toBe(0)
    await settings({ notifyRequesterStatusEnabled: true })
  })
})

describe('S-01 PM monitoring dashboard (US-17)', () => {
  it('teamWaiting lists team requests by who decides; waitingForMe stays 0', async () => {
    const c = await must(api('POST', E, w.users.staffA, draftBody(w, { title: 'S3e pantau PM' })), 201)
    await must(api('POST', `${E}/${c.id}/submit`, w.users.staffA, {}))
    let d = await must(api('GET', '/api/v1/dashboard/pm', w.users.pm))
    expect(d.waitingForMe).toBe(0)
    expect(d.teamWaiting.items.find((x: { id: number }) => x.id === c.id)).toMatchObject({ waitingFor: 'direktur', status: 'pending_ack', days: 0 })
    expect(d.teamWaiting.count).toBe(d.teamWaiting.direktur + d.teamWaiting.finance)
    await must(api('POST', `${E}/${c.id}/acknowledge`, w.users.owner, {}))
    d = await must(api('GET', '/api/v1/dashboard/pm', w.users.pm))
    expect(d.teamWaiting.items.find((x: { id: number }) => x.id === c.id)).toMatchObject({ waitingFor: 'finance' })
    const other = await must(api('GET', '/api/v1/dashboard/pm', w.users.otherPm))
    expect(other.teamWaiting.items.find((x: { id: number }) => x.id === c.id)).toBeUndefined() // team scope only
  })
})

describe('S-06 reject reason message', () => {
  it('reason < 3 characters → 400 with a specific detail', async () => {
    const c = await must(api('POST', E, w.users.staffA, draftBody(w)), 201)
    await must(api('POST', `${E}/${c.id}/submit`, w.users.staffA, {}))
    const r = await api('POST', `${E}/${c.id}/reject`, w.users.owner, { reason: 'ok' })
    expect(r.status).toBe(400)
    expect(r.body.detail).toBe('Alasan wajib diisi, minimal 3 karakter.')
    expect(r.body.errors).toEqual([{ path: 'reason', message: 'Alasan wajib diisi, minimal 3 karakter.' }])
  })
})

describe('S-03 bank account default in the admin form (US-44)', () => {
  it('empty account → default account of the first requester; explicit foreign account still refused', async () => {
    const lines = [{ description: 'Makan', total: 90_000, category: w.cat.ksm }]
    const r = await api('POST', '/api/expense-requests', w.users.staffA, { type: 'reimburse', title: 'S3e default rekening', project: w.project, lines })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const acc = r.body.doc.bankAccount
    expect(typeof acc === 'object' ? acc.id : acc).toBe(w.accA)
    const onBehalf = await api('POST', '/api/expense-requests', w.users.admin, { type: 'reimburse', title: 'S3e atas nama', costCenter: w.costCenter, requesters: [w.emp.b], lines })
    expect(onBehalf.status, JSON.stringify(onBehalf.body)).toBe(201)
    const accB = onBehalf.body.doc.bankAccount
    expect(typeof accB === 'object' ? accB.id : accB).toBe(w.accB)
    const bad = await api('POST', '/api/expense-requests', w.users.admin, { type: 'reimburse', title: 'S3e salah', costCenter: w.costCenter, requesters: [w.emp.b], bankAccount: w.accA, lines })
    expect(bad.status).toBe(400)
  })
})

describe('S-26 resubmit copies receipts (US-06) + S-05 review details / flag count', () => {
  it('rejected Reimburse → Ajukan ulang: active receipts copied to the new lines; the new draft can be submitted', async () => {
    const body = draftBody(w, { type: 'reimburse', title: 'S3e nota disalin', requesterIds: [w.emp.a] })
    const c = await must(api('POST', E, w.users.staffA, body), 201)
    const lineIds = c.lines.map((l: { id: string }) => l.id) as string[]
    await must(api('POST', `${E}/${c.id}/receipts`, w.users.staffA, { lineId: lineIds[0], receiptNo: `S3E-${c.id}-1`, vendorName: 'Toko Uji', receiptDate: '2026-09-20', amount: 600_000, imageId: await receiptImage(w.users.staffA) }), 201)
    const withGone = await must(api('POST', `${E}/${c.id}/receipts`, w.users.staffA, { lineId: lineIds[1], receiptNo: `S3E-${c.id}-X`, vendorName: 'Salah', receiptDate: '2026-09-20', amount: 1_000, imageId: await receiptImage(w.users.staffA) }), 201)
    const gone = withGone.receipts.find((r: { receiptNo: string }) => r.receiptNo === `S3E-${c.id}-X`)
    await must(api('POST', `${E}/${c.id}/receipts/${gone.id}/remove`, w.users.staffA, { reason: 'salah unggah' }))
    await must(api('POST', `${E}/${c.id}/receipts`, w.users.staffA, { lineId: lineIds[1], receiptNo: `S3E-${c.id}-2`, vendorName: 'Warung Uji', receiptDate: '2026-09-20', amount: 149_000, imageId: await receiptImage(w.users.staffA) }), 201)
    await must(api('POST', `${E}/${c.id}/submit`, w.users.staffA, {}))

    // S-05: the Direktur's review panel shows lines, receipt photos (authorized media path) and per-line flags.
    const d = await asUser(w.users.owner, (req) => detail(req, c.id))
    const html = renderToStaticMarkup(React.createElement(ReviewDetails, { d }))
    expect(html).toContain('/api/v1/media/receipts/')
    expect(html).toContain('data-pk-review-line="2"')
    expect(html).toMatch(/Selisih/) // Rp 1.000 difference on line 2 → info flag
    const open = d.flags.filter((f) => f.status === 'open').length
    expect(html).toContain(`data-pk-open-flags="${open}"`)
    expect(open).toBeGreaterThan(0)

    await must(api('POST', `${E}/${c.id}/acknowledge`, w.users.owner, {}))
    const rj = await must(api('POST', `${E}/${c.id}/reject`, w.users.finance, { reason: 'nota kurang jelas' }))
    const appr = rj.approvals.find((a: { position: string; decision: string }) => a.position === 'approval' && a.decision === 'rejected')
    expect(appr.openFlags).toBe(open) // S-05: stored count = open flags of both levels (what the UI shows)

    const rs = await must(api('POST', `${E}/${c.id}/resubmit`, w.users.staffA, {}), 201)
    const nd = await must(api('GET', `${E}/${rs.id}`, w.users.staffA))
    const newLines = nd.lines.map((l: { id: string }) => l.id)
    expect(nd.receipts.map((r: { lineId: string; amount: number; status: string; receiptNo: string }) => [newLines.indexOf(r.lineId), r.amount, r.status, r.receiptNo])).toEqual([
      [0, 600_000, 'pending', `S3E-${c.id}-1`],
      [1, 149_000, 'pending', `S3E-${c.id}-2`],
    ])
    expect(nd.receipts.every((r: { imageId: number | null }) => r.imageId !== null)).toBe(true)
    expect((await auditRows('expense_request', rs.id)).some((a) => a.field === 'receipts' && String(a.reason).includes('ajukan ulang'))).toBe(true)
    // the old (rejected) request is not a duplicate source; the new draft can be submitted with its copied receipts
    expect(nd.flags.filter((f: { kind: string; relatedRequestId: number | null }) => f.kind === 'duplicate' && f.relatedRequestId === c.id)).toEqual([])
    await must(api('POST', `${E}/${rs.id}/submit`, w.users.staffA, {}))
    // the receipt photo stays readable for the Direktur through the authorized media endpoint
    const img = await api('GET', `/api/v1/media/receipts/${nd.receipts[0].imageId}/file?variant=thumb`, w.users.owner)
    expect(img.status).toBe(200)
  })
})

describe('S-29 approve + transfer by the same Finance user (ADR 0013 O-2)', () => {
  it('approvedByCaller marks the requests the caller approved in the current cycle', async () => {
    const c = await must(api('POST', E, w.users.staffA, draftBody(w)), 201)
    await must(api('POST', `${E}/${c.id}/submit`, w.users.staffA, {}))
    await must(api('POST', `${E}/${c.id}/acknowledge`, w.users.owner, {}))
    await must(api('POST', `${E}/${c.id}/approve`, w.users.finance, {}))
    expect([...(await asUser(w.users.finance, (req) => approvedByCaller(req, [c.id])))]).toEqual([c.id])
    expect([...(await asUser(w.users.finance2, (req) => approvedByCaller(req, [c.id])))]).toEqual([])
  })
})

describe('S-08 LPJ flag review (US-21)', () => {
  it('Finance marks an LPJ flag "sudah diperiksa" while the LPJ waits for verification; audited', async () => {
    const c = await must(api('POST', E, w.users.staffA, draftBody(w)), 201)
    const lineIds = c.lines.map((l: { id: string }) => l.id) as string[]
    await must(api('POST', `${E}/${c.id}/submit`, w.users.staffA, {}))
    await must(api('POST', `${E}/${c.id}/acknowledge`, w.users.owner, {}))
    await must(api('POST', `${E}/${c.id}/approve`, w.users.finance, {}))
    resetRateLimits()
    const proof = (await must(upload('/api/v1/media/transfer-proofs', w.users.finance, await png()), 201)).id
    await must(api('POST', `${E}/${c.id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `S3E-${c.id}`, proofMediaId: proof }), 201)
    // receipt 90 days before the transfer → "Nota terlalu lama" warning
    await must(api('POST', `${E}/${c.id}/receipts`, w.users.staffA, { lineId: lineIds[0], receiptNo: `S3E-L-${c.id}`, vendorName: 'Toko Lama', receiptDate: '2026-05-01', amount: 600_000, imageId: await receiptImage(w.users.staffA) }), 201)
    await must(api('POST', `${E}/${c.id}/receipts`, w.users.staffA, { lineId: lineIds[1], receiptNo: `S3E-M-${c.id}`, vendorName: 'Warung', receiptDate: '2026-09-20', amount: 150_000, imageId: await receiptImage(w.users.staffA) }), 201)
    await must(api('POST', `${E}/${c.id}/receipts-complete`, w.users.staffA, {}))
    const l = await must(api('POST', `${E}/${c.id}/lpj/submit`, w.users.staffA, { usageNotes: 'Material dan konsumsi.' }))
    expect(l.status).toBe('lpj_submitted')
    const flag = l.flags.find((f: { kind: string; status: string }) => f.kind === 'date_too_old' && f.status === 'open')
    expect(flag).toBeTruthy()
    const fd = await must(api('GET', `${E}/${c.id}`, w.users.finance))
    expect(fd.allowedActions).toContain('review_flag')
    await must(api('POST', `${E}/${c.id}/flags/${flag.id}/review`, w.users.finance, { note: 'nota lama, sudah dikonfirmasi' }))
    expect((await api('POST', `${E}/${c.id}/flags/${flag.id}/review`, w.users.staffA, {})).status).toBe(403)
    const after = await must(api('GET', `${E}/${c.id}`, w.users.finance))
    expect(after.flags.find((f: { id: number }) => f.id === flag.id)).toMatchObject({ status: 'reviewed', reviewNote: 'nota lama, sudah dikonfirmasi' })
    expect((await auditRows('expense_request', c.id)).some((a) => a.action === 'flag_reviewed')).toBe(true)
  })
})

describe('S-24 company logo ≤ 1024 px (US-57)', () => {
  it('a 1500 px logo is stored at 1024 px', async () => {
    resetRateLimits()
    const logo = await sharp({ create: { width: 1500, height: 750, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer()
    const r = await upload('/api/media-company', w.users.admin, logo)
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect([r.body.doc.width, r.body.doc.height]).toEqual([1024, 512])
  })
})
