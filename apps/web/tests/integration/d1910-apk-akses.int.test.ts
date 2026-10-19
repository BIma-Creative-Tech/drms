import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { resetRateLimits } from '@/lib/rate-limit'

import { api, makeFlowUser, type FlowUser } from './flow-world'
import { getTestPayload } from './helpers'

/**
 * User 2026-10-19 (APK ↔ web parity, phase 6): GET /attendance/schedule (web "Jadwal & hari libur"), PATCH
 * /attendance/default-schedule, GET /company-memberships/matrix (web "Akses PT"), GET /user-onboarding (new-user form),
 * the Absensi / Pengguna collections in /data (work-schedules writable). Fictional data only.
 */
let admin: FlowUser
let staff: FlowUser
const idem = () => ({ 'Idempotency-Key': randomUUID() })
const tag = `APK6-${Date.now() % 100000}`

beforeAll(async () => {
  admin = await makeFlowUser(['pk-admin'], 'p6-admin', null, { signature: false })
  staff = await makeFlowUser(['pk-staff'], 'p6-staff', null, { signature: false, groupAdmin: false })
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

describe('GET /api/v1/attendance/schedule', () => {
  it('Admin: the web page data; Staff: 403; bad tahun: 400', async () => {
    const r = await api('GET', '/api/v1/attendance/schedule?tahun=2026', admin)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body).toMatchObject({ year: '2026', canWrite: true, canCreate: true, companyId: expect.any(Number), defaultRadius: expect.any(Number) })
    for (const k of ['schedules', 'holidays', 'costCenters', 'employees']) expect(Array.isArray(r.body[k])).toBe(true)
    expect((await api('GET', '/api/v1/attendance/schedule', staff)).status).toBe(403)
    expect((await api('GET', '/api/v1/attendance/schedule?tahun=26', admin)).status).toBe(400)
  })

  it('a work schedule created through /data shows up (days 1–6 by default), then becomes the PT default', async () => {
    const c = await api('POST', '/api/v1/data/work-schedules', admin, { data: { name: `${tag} pagi`, startTime: '08:00', endTime: '16:00' } }, idem())
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    const id = c.body.id as number
    const r = await api('GET', '/api/v1/attendance/schedule', admin)
    const s = (r.body.schedules as Array<{ id: number; days: number[]; tol: number }>).find((x) => x.id === id)
    expect(s).toMatchObject({ days: [1, 2, 3, 4, 5, 6], tol: 15 })
    const d = await api('PATCH', '/api/v1/attendance/default-schedule', admin, { companyId: r.body.companyId, scheduleId: id }, idem())
    expect(d.status, JSON.stringify(d.body)).toBe(200)
    expect(d.body).toMatchObject({ defaultScheduleId: id })
    expect((await api('GET', '/api/v1/attendance/schedule', admin)).body.defaultScheduleId).toBe(id)
  })

  it('holidays list + holiday create through /data (Admin)', async () => {
    const h = await api('POST', '/api/v1/data/holidays', admin, { data: { date: '2031-08-17', name: `${tag} HUT RI` } }, idem())
    expect(h.status, JSON.stringify(h.body)).toBe(201)
    const r = await api('GET', '/api/v1/attendance/schedule?tahun=2031', admin)
    expect(r.body.holidays).toEqual(expect.arrayContaining([expect.objectContaining({ date: '2031-08-17', name: `${tag} HUT RI` })]))
    const list = await api('GET', '/api/v1/data/holidays?q=APK6', admin)
    expect(list.status).toBe(200)
    expect(list.body.items.length).toBeGreaterThan(0)
  })
})

describe('GET /api/v1/company-memberships/matrix', () => {
  it('Admin: columns, users page, cells, roles, warnings; non-admin 403', async () => {
    const r = await api('GET', '/api/v1/company-memberships/matrix?q=p6-', admin)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.viewer).toMatchObject({ groupAdmin: true })
    expect(r.body.companies.length).toBeGreaterThan(0)
    expect(r.body.users.items.map((u: { id: number }) => u.id)).toEqual(expect.arrayContaining([admin.id, staff.id]))
    expect(r.body.cells.some((c: { user: number; roles: string[] }) => c.user === staff.id && c.roles.includes('pk-staff'))).toBe(true)
    expect(r.body.roles.map((x: { value: string }) => x.value)).toContain('pk-principal')
    expect(r.body.reasonMin).toBe(3)
    expect(Array.isArray(r.body.warnings)).toBe(true)
    expect((await api('GET', '/api/v1/company-memberships/matrix', staff)).status).toBe(403)
  })

  it('batch save accepts pk-operator ("Opr" of the matrix; was a 400)', async () => {
    const m = await api('GET', '/api/v1/company-memberships/matrix?q=p6-', admin)
    const cell = m.body.cells.find((c: { user: number }) => c.user === staff.id)
    const r = await api('POST', '/api/v1/company-memberships/batch', admin, { reason: 'uji peran operator', items: [{ user: staff.id, company: cell.company, roles: ['pk-staff', 'pk-operator'] }] }, idem())
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const after = await api('GET', '/api/v1/company-memberships/matrix?q=p6-', admin)
    expect(after.body.cells.find((c: { user: number }) => c.user === staff.id).roles).toEqual(['pk-operator', 'pk-staff'])
  })
})

describe('GET /api/v1/user-onboarding (new-user form)', () => {
  it('Admin: the form with no user; Staff: 403', async () => {
    const r = await api('GET', '/api/v1/user-onboarding', admin)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.user).toBeNull()
    expect((await api('GET', '/api/v1/user-onboarding', staff)).status).toBe(403)
  })
})

describe('/data lists of phase 6', () => {
  it('employees + devices list for the Admin; web-sessions not writable', async () => {
    expect((await api('GET', '/api/v1/data/employees', admin)).status).toBe(200)
    expect((await api('GET', '/api/v1/data/devices', admin)).status).toBe(200)
    expect((await api('GET', '/api/v1/data/web-sessions/form', admin)).status).toBe(404)
  })
})
