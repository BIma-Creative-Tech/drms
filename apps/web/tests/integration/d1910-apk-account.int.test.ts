import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { setKeycloakAdmin, type OtpCredential } from '@/auth/keycloak-admin'
import { resetRateLimits } from '@/lib/rate-limit'

import { api, makeFlowUser, png, uploadMedia, type FlowUser } from './flow-world'
import { auditRows, getTestPayload, sqlAs } from './helpers'

/**
 * User 2026-10-19 (APK ↔ web parity, phase 2): GET /me/account, PUT /me/signature, GET /me/security — the APK
 * "Profil & tanda tangan" and "Keamanan akun". The signature rules are the web's (F2c selfProfileGuard): own
 * upload only, audited by the users collection. 2FA is read-only here (Keycloak Admin API mocked).
 */
const creds = new Map<string, OtpCredential[]>()
let adminDown = false
let staff: FlowUser
let other: FlowUser

const subOf = async (uid: number) => (await sqlAs('owner', 'SELECT keycloak_sub AS s FROM users WHERE id = $1', [uid])).rows[0].s as string

beforeAll(async () => {
  setKeycloakAdmin(
    new Proxy({} as never, {
      get: (_t, prop) => {
        if (prop === 'listUserCredentials')
          return async (id: string) => {
            if (adminDown) throw new Error('kc down')
            return creds.get(id) ?? []
          }
        return async () => undefined
      },
    }),
  )
  staff = await makeFlowUser(['pk-staff'], 'acct-staff', null, { signature: false })
  other = await makeFlowUser(['pk-staff'], 'acct-other', null, { signature: false })
})

beforeEach(() => {
  resetRateLimits()
  adminDown = false
})

afterAll(async () => {
  setKeycloakAdmin(undefined)
  await (await getTestPayload()).destroy()
})

describe('GET /api/v1/me/account', () => {
  it('own row: name/email/phone read-only, no signature yet', async () => {
    const r = await api('GET', '/api/v1/me/account', staff)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body).toMatchObject({ id: staff.id, email: staff.email, name: 'acct-staff', phone: null, signature: null, editable: ['signature'] })
    expect(typeof r.body.displayName).toBe('string')
  })

  it('401 without a session', async () => {
    expect((await api('GET', '/api/v1/me/account', null)).status).toBe(401)
  })
})

describe('PUT /api/v1/me/signature', () => {
  it('own upload → set, shown in /me/account, audited; null removes it', async () => {
    const id = await uploadMedia('media-signatures', staff, await png(undefined, 600, 200))
    const r = await api('PUT', '/api/v1/me/signature', staff, { signatureMediaId: id })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.signature).toMatchObject({ id })
    expect((await api('GET', '/api/v1/me/account', staff)).body.signature?.id).toBe(id)
    expect((await auditRows('user', staff.id)).some((a) => a.field === 'signature')).toBe(true)

    const cleared = await api('PUT', '/api/v1/me/signature', staff, { signatureMediaId: null })
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200)
    expect(cleared.body.signature).toBeNull()
  })

  it('someone else\'s image → 403 with the guard message; unchanged', async () => {
    const foreign = await uploadMedia('media-signatures', other, await png(undefined, 600, 200))
    const r = await api('PUT', '/api/v1/me/signature', staff, { signatureMediaId: foreign })
    expect(r.status).toBe(403)
    expect(r.body.detail).toContain('Tanda tangan harus gambar yang Anda unggah sendiri')
    expect((await api('GET', '/api/v1/me/account', staff)).body.signature).toBeNull()
  })

  it('400 on extra fields (strict body: no name/email change through here)', async () => {
    expect((await api('PUT', '/api/v1/me/signature', staff, { signatureMediaId: null, name: 'x' })).status).toBe(400)
  })
})

describe('GET /api/v1/me/security', () => {
  it('inactive → active (own credentials only) → unknown when Keycloak is down; manageUrl = web page', async () => {
    const r0 = await api('GET', '/api/v1/me/security', staff)
    expect(r0.status, JSON.stringify(r0.body)).toBe(200)
    expect(r0.body.twoFactor).toEqual({ state: 'inactive', authenticators: [] })
    expect(String(r0.body.manageUrl)).toMatch(/\/admin\/keamanan-akun$/)

    creds.set(await subOf(staff.id), [{ id: 'cred-0001-aaaa', type: 'otp', userLabel: 'HP pribadi', createdDate: Date.UTC(2026, 9, 1) }])
    const r1 = await api('GET', '/api/v1/me/security', staff)
    expect(r1.body.twoFactor).toEqual({ state: 'active', authenticators: [{ id: 'cred-0001-aaaa', label: 'HP pribadi', createdAt: '2026-10-01T00:00:00.000Z' }] })
    expect((await api('GET', '/api/v1/me/security', other)).body.twoFactor.state).toBe('inactive')

    adminDown = true
    expect((await api('GET', '/api/v1/me/security', staff)).body.twoFactor).toEqual({ state: 'unknown', authenticators: [] })
  })
})
