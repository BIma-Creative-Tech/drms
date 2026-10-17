import { randomUUID } from 'node:crypto'

import React, { type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createLocalReq, type DocumentViewServerProps } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { actionBarProps } from '@/admin/components/request/action-bar'
import { loadRequestPanel } from '@/admin/components/request/panel-data'
import { RiwayatView } from '@/admin/views/RiwayatView'
import { addDays } from '@/domain/expense/types'
import { resetRateLimits } from '@/lib/rate-limit'

import { getTestPayload } from './helpers'
import { api, draftBody, makeWorld, png, upload, type FlowUser, type World } from './flow-world'

/**
 * DRMS 13/10 Persetujuan #12: POST /api/v1/expense-requests/:id/duplicate ("Duplikat" of the request page) through the
 * real API — a clean NEW Draft (same PT, project, title, requesters, account, lines; no number, approvals, transfers,
 * receipts, flags, attachments, "Nominal sesuai nota"), audited `duplicated_from` on the new draft; the caller must
 * read the source and hold a create role in its PT (Q-09 on-behalf rule unchanged); Payload's own duplicate is off.
 * Plus the request page's server parts (panel-data: stepper, change log, action bar) for the same request, and its
 * Riwayat page (UI feedback 17/10 #2: action-bar button → /riwayat → "← Kembali ke pengajuan"). Payload's Gutter /
 * DefaultTemplate are stubbed.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('@payloadcms/ui', () => ({ Gutter: ({ children }: { children: ReactNode }) => React.createElement('div', { 'data-gutter': '' }, children) }))
vi.mock('@payloadcms/next/templates', () => ({ DefaultTemplate: ({ children }: { children: ReactNode }) => children }))

let w: World
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })

beforeAll(async () => {
  w = await makeWorld('DUP', { rule: 'pm_direktur' })
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

async function ok(p: Promise<{ status: number; body: any }>, status = 200) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await p
  expect(r.status, JSON.stringify(r.body)).toBe(status)
  return r.body
}

/** A Pengajuan Baru approved (PM → Direktur), transferred, with one receipt and a draft attachment. */
async function transferredRequest(): Promise<{ id: number; docNo: string; lineIds: string[] }> {
  const att = (await ok(upload('/api/v1/media/attachments', w.users.staffA, await png()), 201)).id as number
  const c = await ok(api('POST', E, w.users.staffA, draftBody(w, { attachmentIds: [att], lines: [{ description: 'Semen', qty: 10, uomId: w.uom.l, unitPrice: 60_000, receiptAmount: 590_000, categoryId: w.cat.mat }] }), key()), 201)
  const id = c.id as number
  await ok(api('POST', `${E}/${id}/submit`, w.users.staffA, {}, key()))
  await ok(api('POST', `${E}/${id}/acknowledge`, w.users.pm, {}, key()))
  await ok(api('POST', `${E}/${id}/approve`, w.users.owner, {}, key()))
  const proof = (await ok(upload('/api/v1/media/transfer-proofs', w.users.finance, await png()), 201)).id as number
  await ok(api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `TRF-${id}`, proofMediaId: proof }, key()), 201)
  const img = (await ok(upload('/api/v1/media/receipts', w.users.staffA, await png()), 201)).id as number
  const lineIds = (c.lines as Array<{ id: string }>).map((l) => l.id)
  await ok(api('POST', `${E}/${id}/receipts`, w.users.staffA, { lineId: lineIds[0], receiptNo: `N-${id}`, vendorName: 'Toko Maju', receiptDate: addDays(new Date().toISOString().slice(0, 10), -1), amount: 590_000, imageId: img }, key()), 201)
  const d = await ok(api('GET', `${E}/${id}`, w.users.staffA))
  expect(d.status).toBe('transferred')
  return { id, docNo: d.docNo as string, lineIds }
}

const panel = async (user: FlowUser, id: number) => loadRequestPanel(await getTestPayload(), { ...user, collection: 'users' } as never, id)

/** The Riwayat document view of one expense request, rendered for `user`. */
async function riwayat(user: FlowUser, id: number): Promise<string> {
  const payload = await getTestPayload()
  const req = await createLocalReq({ user: { ...user, collection: 'users' } as never }, payload)
  const props = { initPageResult: { req, docID: id, collectionConfig: payload.collections['expense-requests'].config }, doc: { id } } as unknown as DocumentViewServerProps
  return renderToStaticMarkup(React.createElement(React.Fragment, null, await RiwayatView(props)))
}

describe('POST /expense-requests/:id/duplicate', () => {
  it('the requester gets a clean Draft of a transferred request (no number, approvals, transfers, receipts, flags, attachments)', async () => {
    const src = await transferredRequest()
    const r = await ok(api('POST', `${E}/${src.id}/duplicate`, w.users.staffA, {}, key()), 201)
    expect(r.id).not.toBe(src.id)
    expect(r).toMatchObject({ status: 'draft', docNo: null, type: 'advance', title: 'Pembelian material', projectId: w.project, approvalCycle: 0, currentLevel: null, approvedAmount: null, transferredTotal: 0, approvalRule: null, submittedAt: null, resubmitOfId: null, clientUuid: null, settlement: null, verifiedReceiptsTotal: null })
    expect(r.requesters.map((x: { id: number }) => x.id)).toEqual([w.emp.a])
    expect(r.bankAccountId).toBe(w.accA)
    expect(r.neededDate).toBeNull()
    expect(r.approvals).toEqual([])
    expect(r.transfers).toEqual([])
    expect(r.receipts).toEqual([])
    expect(r.flags).toEqual([])
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]).toMatchObject({ description: 'Semen', qty: 10, unitPrice: 60_000, total: 600_000, receiptAmount: null })
    expect(r.lines[0].id).not.toBe(src.lineIds[0])
    const raw = await (await getTestPayload()).findByID({ collection: 'expense-requests', id: r.id, depth: 0, overrideAccess: true /* SYSTEM-READ: assertions */ })
    expect(raw).toMatchObject({ createdBy: w.users.staffA.id, attachments: [], approvalSnapshot: null, g1Exception: null, contentHash: null })
    expect(raw.company).toBe((await (await getTestPayload()).findByID({ collection: 'expense-requests', id: src.id, depth: 0, overrideAccess: true /* SYSTEM-READ: assertions */ })).company)
    // audited on the new draft
    const audit = await (await getTestPayload()).find({ collection: 'audit-logs', where: { and: [{ docType: { equals: 'expense_request' } }, { docId: { equals: String(r.id) } }, { field: { equals: 'duplicated_from' } }] }, depth: 0, overrideAccess: true /* SYSTEM-READ: assertions */ })
    expect(audit.docs).toHaveLength(1)
    expect(audit.docs[0]).toMatchObject({ action: 'create', userId: w.users.staffA.id })
    // the copy is a normal draft: editable and sendable (gets its own number at submit)
    const sent = await ok(api('POST', `${E}/${r.id}/submit`, w.users.staffA, {}, key()))
    expect(sent.docNo).toBeTruthy()
    expect(sent.docNo).not.toBe(src.docNo)
  })

  it('Finance (on-behalf role) may duplicate a Staff request; the Direktur may not file for others (Q-09); no read → 404', async () => {
    const src = await transferredRequest()
    const fin = await ok(api('POST', `${E}/${src.id}/duplicate`, w.users.finance, {}, key()), 201)
    expect(fin.requesters.map((x: { id: number }) => x.id)).toEqual([w.emp.a])
    expect(fin.createdById).toBe(w.users.finance.id)
    expect((await api('POST', `${E}/${src.id}/duplicate`, w.users.owner, {}, key())).status).toBe(403)
    expect((await api('POST', `${E}/${src.id}/duplicate`, w.users.staffB, {}, key())).status).toBe(404)
    expect((await api('POST', `${E}/${src.id}/duplicate`, null, {}, key())).status).toBe(401)
  })

  it("Payload's built-in duplicate route is off for expense requests", async () => {
    const src = await transferredRequest()
    const r = await api('POST', `/api/expense-requests/${src.id}/duplicate`, w.users.staffA, {})
    expect([400, 404, 405]).toContain(r.status)
  })
})

describe('request page server parts (panel-data)', () => {
  it('stepper, change log and action bar of a transferred request', async () => {
    const src = await transferredRequest()
    const own = (await panel(w.users.staffA, src.id))!
    expect(own.stepper.steps.map((s) => `${s.key}:${s.state}`)).toEqual(['diajukan:done', 'diketahui:done', 'approval-1:done', 'transfer:done', 'lpj:current', 'settlement:pending', 'end:pending'])
    expect(own.history.length).toBeGreaterThan(3)
    expect(own.history.some((h) => h.change.includes('Draft → Menunggu persetujuan PM'))).toBe(true)
    expect(own.createdAt).toBeTruthy()
    expect(actionBarProps(own)).toMatchObject({ decision: null, canDuplicate: true, pdfs: [{ href: `/api/v1/expense-requests/${src.id}/pdf`, label: 'PDF Pengajuan Biaya' }] })
    const fin = actionBarProps((await panel(w.users.finance, src.id))!)
    expect(fin.pdfs).toHaveLength(2)
    expect(fin.canDuplicate).toBe(true) // Q-09: Finance files on behalf of the requesters
    // the Direktur reads it but may not file for the Staff (the endpoint answers 403) → no "Duplikat"
    expect(actionBarProps((await panel(w.users.owner, src.id))!).canDuplicate).toBe(false)
    expect(await panel(w.users.staffB, src.id)).toBeNull()
    // UI feedback 17/10 #2: "Riwayat" is an action-bar link for every reader
    expect(actionBarProps(own).historyHref).toBe(`/admin/collections/expense-requests/${src.id}/riwayat`)
    expect(fin.historyHref).toBe(own.historyHref)
  })

  it('UI feedback 17/10 #2 — Riwayat page: history rows + "← Kembali ke pengajuan"; no read → not found', async () => {
    const c = await ok(api('POST', E, w.users.staffA, draftBody(w), key()), 201)
    await ok(api('POST', `${E}/${c.id}/submit`, w.users.staffA, {}, key()))
    const html = await riwayat(w.users.staffA, c.id)
    expect(html).toContain(`href="/admin/collections/expense-requests/${c.id}" data-pk-link="back-to-request"`)
    expect(html).toContain('← Kembali ke pengajuan')
    expect(html.indexOf('back-to-request')).toBeLessThan(html.indexOf('>Riwayat</h2>'))
    expect(html).toContain('Riwayat dokumen')
    expect(html).not.toContain('Belum ada riwayat.')
    const other = await riwayat(w.users.staffB, c.id)
    expect(other).toContain('Dokumen tidak ditemukan.')
  })
})
