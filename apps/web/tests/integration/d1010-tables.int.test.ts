import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { cashBookPage, parseBookQuery } from '@/domain/cash/book'
import { resetRateLimits } from '@/lib/rate-limit'

import { api, asUser, png, upload } from './flow-world'
import { makeFr1World, type Fr1World } from './fr1-world'
import { getTestPayload, updateCompany } from './helpers'

/**
 * DRMS 10/10 D8: text search of the list endpoints / views — `q` on /api/v1/service-reports and
 * /api/v1/aftersales-activities (every word must match; still inside the caller's read scope) and the
 * cash book (`q` over number + description, page size). Fictional data only.
 */
let w: Fr1World

beforeAll(async () => {
  w = await makeFr1World('dtbl')
  await updateCompany({ fieldReportsEnabled: true })
})
beforeEach(() => resetRateLimits())
afterAll(async () => {
  await updateCompany({ fieldReportsEnabled: false })
  await (await getTestPayload()).destroy()
})

describe('/api/v1 list endpoints: q', () => {
  it('service reports: q narrows by action / complaint text, combined with the other filters', async () => {
    const a = await api('POST', '/api/v1/service-reports', w.users.staffA, { projectId: w.kontrak, unitId: w.ex01, serviceType: 'inspeksi', complaint: 'Rem blong', action: 'Ganti kampas rem', unitStatusAfter: 'siap' })
    expect(a.status, JSON.stringify(a.body)).toBe(201)
    const b = await api('POST', '/api/v1/service-reports', w.users.staffA, { projectId: w.kontrak, unitId: w.ex01, serviceType: 'inspeksi', action: 'Cek oli mesin', unitStatusAfter: 'siap' })
    expect(b.status, JSON.stringify(b.body)).toBe(201)
    const ids = async (qs: string) => ((await api('GET', `/api/v1/service-reports?project=${w.kontrak}${qs}`, w.users.staffA)).body.items as Array<{ id: number }>).map((x) => x.id)
    expect(await ids('&q=kampas')).toEqual([a.body.id])
    expect(await ids('&q=REM%20ganti')).toEqual([a.body.id])
    expect(await ids('&q=oli')).toEqual([b.body.id])
    expect(await ids('&q=tidak-ada')).toEqual([])
    expect((await ids('')).length).toBeGreaterThanOrEqual(2)
    expect((await api('GET', `/api/v1/service-reports?q=${'x'.repeat(101)}`, w.users.staffA)).status).toBe(400)
  })

  it('aftersales activities: q over notes / receiver', async () => {
    const a = await api('POST', '/api/v1/aftersales-activities', w.users.staffA, { projectId: w.aftersales, clientId: w.client, kind: 'kunjungan', notes: 'Tawarkan filter hidrolik' })
    expect(a.status, JSON.stringify(a.body)).toBe(201)
    const r = await api('GET', `/api/v1/aftersales-activities?project=${w.aftersales}&q=hidrolik`, w.users.staffA)
    expect(r.status).toBe(200)
    expect((r.body.items as Array<{ id: number }>).map((x) => x.id)).toEqual([a.body.id])
  })
})

describe('Buku kas: q + page size', () => {
  it('q matches the number or the description (every word); per limits the page', async () => {
    const today = await asUser(w.users.finance, async (req) => (await import('@/domain/expense/common')).today(req))
    const proofId = (await upload('/api/v1/media/attachments', w.users.finance, await png())).body.id
    const km = await api('POST', '/api/v1/cash-entries', w.users.finance, { direction: 'in', entryDate: today, cashAccountId: w.cashAccount, amount: 1_250_000, description: 'Setoran kas cabang Sampit (fiktif)', cashInSourceId: w.cashInSource, projectId: w.project, proofId }, { 'Idempotency-Key': randomUUID() })
    expect(km.status, JSON.stringify(km.body)).toBe(201)
    const no = (await asUser(w.users.finance, (req) => cashBookPage(req, parseBookQuery({ q: 'sampit cabang' })))).rows.map((r) => r.entryNo)
    expect(no).toEqual([km.body.entryNo])
    const byNo = await asUser(w.users.finance, (req) => cashBookPage(req, parseBookQuery({ q: km.body.entryNo })))
    expect(byNo.rows.map((r) => r.entryNo)).toEqual([km.body.entryNo])
    const none = await asUser(w.users.finance, (req) => cashBookPage(req, parseBookQuery({ q: 'zzz-tidak-ada-zzz' })))
    expect(none.totalDocs).toBe(0)
    const paged = await asUser(w.users.finance, (req) => cashBookPage(req, parseBookQuery({ per: '20' })))
    expect(paged.rows.length).toBeLessThanOrEqual(20)
  })
})
