import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { resetRateLimits } from '@/lib/rate-limit'

import { api, makeFlowUser, type FlowUser } from './flow-world'
import { getTestPayload } from './helpers'

/**
 * User 2026-10-19 (APK ↔ web parity, phase 4 Laporan): GET /reports (the web /admin/laporan list of the caller's
 * roles) and the additive meta of GET /reports/{code} — filter form, letterhead, row count + export limits, row links.
 */
let finance: FlowUser
let staff: FlowUser

beforeAll(async () => {
  finance = await makeFlowUser(['pk-finance'], 'lap-finance', null, { signature: false })
  staff = await makeFlowUser(['pk-staff'], 'lap-staff', null, { signature: false })
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

describe('GET /api/v1/reports', () => {
  it('Finance: the office reports (no audit log in the list); Staff: none', async () => {
    const f = await api('GET', '/api/v1/reports', finance)
    expect(f.status, JSON.stringify(f.body)).toBe(200)
    const codes = f.body.items.map((i: { code: string }) => i.code)
    expect(codes).toEqual(expect.arrayContaining(['rekap-kas', 'buku-kas', 'rekap-pengajuan']))
    expect(codes).not.toContain('audit-log')
    expect(f.body.items.find((i: { code: string }) => i.code === 'rekap-kas')).toMatchObject({ title: expect.any(String), formats: expect.arrayContaining(['csv', 'pdf']) })
    const s = await api('GET', '/api/v1/reports', staff)
    expect(s.status).toBe(200)
    expect(s.body.items.map((i: { code: string }) => i.code)).not.toContain('rekap-kas')
  })

  it('401 without a session', async () => {
    expect((await api('GET', '/api/v1/reports', null)).status).toBe(401)
  })
})

describe('GET /api/v1/reports/{code} meta', () => {
  it('filters with values, letterhead, row count + limits, one rowLinks entry per row', async () => {
    const r = await api('GET', '/api/v1/reports/rekap-pengajuan', finance)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(Array.isArray(r.body.filters)).toBe(true)
    expect(r.body.filters.length).toBeGreaterThan(0)
    for (const f of r.body.filters) expect(['date', 'month', 'select', 'multiselect', 'text']).toContain(f.kind)
    expect(r.body.letterhead).toMatchObject({ kind: expect.stringMatching(/^(company|group)$/), name: expect.any(String) })
    expect(r.body.limits).toEqual({ xlsx: 10_000, pdf: 500 })
    expect(typeof r.body.rowCount).toBe('number')
    expect(r.body.main.rowLinks).toHaveLength(r.body.main.rows.length)
    expect(typeof r.body.description).toBe('string')
  })
})
