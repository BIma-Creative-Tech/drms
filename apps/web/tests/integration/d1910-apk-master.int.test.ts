import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { resetRateLimits } from '@/lib/rate-limit'

import { api, makeFlowUser, png, uploadMedia, type FlowUser } from './flow-world'
import { auditRows, getTestPayload } from './helpers'

/**
 * User 2026-10-19 (APK ↔ web parity, phase 7): Master Data / Pengaturan through the generic /data form, media lists +
 * file info, the company-settings global (GET|PATCH /data-globals), the audit-log view row (K-16) and the reports index
 * flag. Fictional data only.
 */
let admin: FlowUser
let staff: FlowUser
const idem = () => ({ 'Idempotency-Key': randomUUID() })
const tag = `APK7-${Date.now() % 100000}`

beforeAll(async () => {
  admin = await makeFlowUser(['pk-admin'], 'p7-admin', null, { signature: false })
  staff = await makeFlowUser(['pk-staff'], 'p7-staff', null, { signature: false, groupAdmin: false })
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

describe('Master Data through /data', () => {
  it('Admin creates a bank; Staff: no create', async () => {
    const f = await api('GET', '/api/v1/data/banks/form', admin)
    expect(f.status, JSON.stringify(f.body)).toBe(200)
    expect(f.body).toMatchObject({ canCreate: true, supported: true })
    const c = await api('POST', '/api/v1/data/banks', admin, { data: { code: tag.slice(-8), name: `${tag} Bank Uji` } }, idem())
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    expect(c.body.title).toBe(`${tag} Bank Uji`)
    expect((await api('GET', '/api/v1/data/banks/form', staff)).body.canCreate).toBe(false)
    expect((await api('POST', '/api/v1/data/banks', staff, { data: { code: 'X1', name: 'x' } }, idem())).status).toBe(403)
  })

  it('vendors are read-only here (the Vendor page /vendor-form edits them)', async () => {
    expect((await api('GET', '/api/v1/data/vendors', admin)).status).toBe(200)
    expect((await api('GET', '/api/v1/data/vendors/form', admin)).status).toBe(404)
  })
})

describe('Persetujuan › Data persetujuan', () => {
  it('approvals list is readable through /data (read-only: form 404)', async () => {
    const l = await api('GET', '/api/v1/data/approvals', admin)
    expect(l.status, JSON.stringify(l.body)).toBe(200)
    expect(l.body.collection).toBe('approvals')
    expect((await api('GET', '/api/v1/data/approvals/form', admin)).status).toBe(404)
  })
})

describe('Media lists', () => {
  it('own upload: list thumb + detail file (v1 file endpoint)', async () => {
    const id = await uploadMedia('media-attachments', admin, await png())
    const l = await api('GET', '/api/v1/data/media-attachments?limit=50', admin)
    expect(l.status, JSON.stringify(l.body)).toBe(200)
    const item = l.body.items.find((i: { id: number }) => i.id === id)
    expect(item.thumb).toMatch(new RegExp(`^/api/v1/media/attachments/${id}/file`))
    const d = await api('GET', `/api/v1/data/media-attachments/${id}`, admin)
    expect(d.body.file).toMatchObject({ url: `/api/v1/media/attachments/${id}/file`, mimeType: expect.stringMatching(/^image\//) })
    expect((await api('GET', '/api/v1/data/media-attachments/form', admin)).status).toBe(404)
  })
})

describe('Setting aplikasi (company-settings global)', () => {
  it('group admin: form + patch (audited); Staff reads, cannot update', async () => {
    const f = await api('GET', '/api/v1/data-globals/company-settings/form', admin)
    expect(f.status, JSON.stringify(f.body)).toBe(200)
    expect(f.body.canUpdate).toBe(true)
    expect(f.body.fields.map((x: { key: string }) => x.key)).toEqual(expect.arrayContaining(['groupName', 'minAppVersion', 'imageTargets.jpegQuality']))
    expect(f.body.skipped).toContain('groupLogo')
    const before = String(f.body.fields.find((x: { key: string }) => x.key === 'groupName').value ?? '')
    const p = await api('PATCH', '/api/v1/data-globals/company-settings', admin, { data: { groupName: `${tag} Grup` } }, idem())
    expect(p.status, JSON.stringify(p.body)).toBe(200)
    expect(p.body.fields.find((x: { key: string }) => x.key === 'groupName').value).toBe(`${tag} Grup`)
    expect((await auditRows('company_settings', 'company-settings')).some((a) => a.field === 'groupName')).toBe(true)
    await api('PATCH', '/api/v1/data-globals/company-settings', admin, { data: { groupName: before || null } }, idem())

    expect((await api('GET', '/api/v1/data-globals/company-settings', staff)).status).toBe(200)
    expect((await api('GET', '/api/v1/data-globals/company-settings/form', staff)).body.canUpdate).toBe(false)
    expect((await api('PATCH', '/api/v1/data-globals/company-settings', staff, { data: { groupName: 'x' } }, idem())).status).toBe(403)
    expect((await api('GET', '/api/v1/data-globals/other', admin)).status).toBe(404)
  })
})

describe('Audit Log', () => {
  it('reports index flags it; opening it writes the K-16 view row', async () => {
    expect((await api('GET', '/api/v1/reports', admin)).body.auditLog).toBe(true)
    expect((await api('GET', '/api/v1/reports', staff)).body.auditLog).toBe(false)
    const n = (await auditRows('audit_log', 'view')).length
    const r = await api('GET', '/api/v1/reports/audit-log', admin)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect((await auditRows('audit_log', 'view')).length).toBe(n + 1)
  })
})
