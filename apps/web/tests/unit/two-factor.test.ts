import { describe, expect, it } from 'vitest'

import { createHttpKeycloakAdmin, toOtpCredentials } from '@/auth/keycloak-admin'

/** ADR 0017 (optional self-service 2FA): the Admin API status call returns OTP METADATA only. */
describe('keycloak admin: listUserCredentials (2FA status)', () => {
  const uid = '0b6a1c1e-1111-4222-8333-444455556666'
  const rep = [
    { id: 'pw-1', type: 'password', createdDate: 1, credentialData: '{"hashIterations":5}' },
    { id: 'otp-1111-aaaa', type: 'otp', userLabel: 'HP pribadi', createdDate: 1790000000000, credentialData: '{"subType":"totp","digits":6}', secretData: 'SHOULD-NEVER-LEAK' },
    { id: 'otp-2222-bbbb', type: 'otp', userLabel: '   ', createdDate: 'x' },
    { id: 7, type: 'otp' },
    null,
  ]

  it('GET /admin/realms/<realm>/users/<id>/credentials, keeps only otp and only id/label/created', async () => {
    const calls: string[] = []
    const f = (async (input: string | URL | Request) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/protocol/openid-connect/token')) return Response.json({ access_token: 't', expires_in: 300 })
      if (url.endsWith(`/users/${uid}/credentials`)) return Response.json(rep)
      return new Response(null, { status: 500 })
    }) as typeof fetch
    const kc = createHttpKeycloakAdmin({ baseUrl: 'https://kc.test', realm: 'drms', clientId: 'c', clientSecret: 'x'.repeat(20), fetchImpl: f })
    const list = await kc.listUserCredentials(uid)
    expect(calls.at(-1)).toBe(`https://kc.test/admin/realms/drms/users/${uid}/credentials`)
    expect(list).toEqual([
      { id: 'otp-1111-aaaa', type: 'otp', userLabel: 'HP pribadi', createdDate: 1790000000000 },
      { id: 'otp-2222-bbbb', type: 'otp', userLabel: null, createdDate: null },
    ])
    expect(JSON.stringify(list)).not.toMatch(/SHOULD-NEVER-LEAK|credentialData|digits/)
  })

  it('refuses unsafe user ids and surfaces 403 (service account without view-users) as an error', async () => {
    const f = (async (input: string | URL | Request) =>
      String(input).endsWith('/token') ? Response.json({ access_token: 't', expires_in: 300 }) : new Response(null, { status: 403 })) as typeof fetch
    const kc = createHttpKeycloakAdmin({ baseUrl: 'https://kc.test', realm: 'drms', clientId: 'c', clientSecret: 'x'.repeat(20), fetchImpl: f })
    await expect(kc.listUserCredentials('../x')).rejects.toThrow(/unsafe/)
    await expect(kc.listUserCredentials(uid)).rejects.toMatchObject({ status: 403 })
  })

  it('toOtpCredentials tolerates non-arrays', () => {
    expect(toOtpCredentials({})).toEqual([])
    expect(toOtpCredentials(undefined)).toEqual([])
  })
})
