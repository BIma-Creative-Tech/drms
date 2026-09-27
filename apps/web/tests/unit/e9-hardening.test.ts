import { describe, expect, it } from 'vitest'

import { requireAction } from '@/domain/expense/common'
import { allowedActions, assertTransition, mayPerform, targets, type ActorContext } from '@/domain/expense/state'
import { adminLoginRedirect } from '@/lib/admin-gate'
import { parseEnv, resolveFileSecrets } from '@/lib/env'
import {
  mediaSignature,
  parseSignedParams,
  SIGNED_URL_MAX_SKEW_S,
  SIGNED_URL_TTL_S,
  signedMediaPath,
  signingKeys,
  signMedia,
  verifyMedia,
  type SignedMediaTarget,
} from '@/lib/signed-url'

/** E9 hardening (plan fase1-golive §E9): signed media URLs, admin gate, 403-before-409, settlement reversal rules. */

const KEY_A = 'a'.repeat(40)
const KEY_B = 'b'.repeat(40)
const NOW = 1_790_000_000
const target: SignedMediaTarget = { collection: 'receipts', id: 42, variant: 'thumb', userId: 7 }

describe('signed media URLs (ADR 0004 §4)', () => {
  const keys = signingKeys({ MEDIA_URL_KEYS: KEY_A, PAYLOAD_SECRET: 'p'.repeat(40) })

  it('signs with exp = now + TTL (5 min) and verifies ok within the TTL', () => {
    const p = signMedia(target, keys, NOW)
    expect(p.exp).toBe(NOW + SIGNED_URL_TTL_S)
    expect(SIGNED_URL_TTL_S).toBe(300)
    expect(p.uid).toBe(7)
    expect(p.sig).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(verifyMedia(target, p, keys, NOW)).toBe('ok')
    expect(verifyMedia(target, p, keys, NOW + SIGNED_URL_TTL_S - 1)).toBe('ok')
  })

  it('expired → "expired" (endpoint answers 403 URL_EXPIRED)', () => {
    const p = signMedia(target, keys, NOW)
    expect(verifyMedia(target, p, keys, NOW + SIGNED_URL_TTL_S)).toBe('expired')
    expect(verifyMedia(target, p, keys, NOW + 3600)).toBe('expired')
  })

  it('any tampered part → "invalid": collection, id, variant, uid, exp, signature', () => {
    const p = signMedia(target, keys, NOW)
    expect(verifyMedia({ ...target, collection: 'transfer-proofs' }, p, keys, NOW)).toBe('invalid')
    expect(verifyMedia({ ...target, id: 43 }, p, keys, NOW)).toBe('invalid')
    expect(verifyMedia({ ...target, variant: null }, p, keys, NOW)).toBe('invalid')
    // the uid in the query must be the one signed (another user cannot reuse the URL as themselves)
    expect(verifyMedia({ ...target, userId: 8 }, { ...p, uid: 8 }, keys, NOW)).toBe('invalid')
    expect(verifyMedia(target, { ...p, uid: 8 }, keys, NOW)).toBe('invalid')
    expect(verifyMedia(target, { ...p, exp: p.exp + 60 }, keys, NOW)).toBe('invalid')
    const flipped = (p.sig[0] === 'A' ? 'B' : 'A') + p.sig.slice(1)
    expect(verifyMedia(target, { ...p, sig: flipped }, keys, NOW)).toBe('invalid')
  })

  it('a validly signed exp beyond TTL + skew is refused (never minted by us)', () => {
    const exp = NOW + SIGNED_URL_TTL_S + SIGNED_URL_MAX_SKEW_S + 1
    const sig = mediaSignature(keys[0]!, target, exp)
    expect(verifyMedia(target, { exp, uid: 7, sig }, keys, NOW)).toBe('invalid')
  })

  it('key rotation: first key signs, every listed key verifies; a removed key stops verifying', () => {
    const old = signingKeys({ MEDIA_URL_KEYS: KEY_A, PAYLOAD_SECRET: '' })
    const rotated = signingKeys({ MEDIA_URL_KEYS: `${KEY_B}, ${KEY_A}`, PAYLOAD_SECRET: '' })
    const onlyNew = signingKeys({ MEDIA_URL_KEYS: KEY_B, PAYLOAD_SECRET: '' })
    const p = signMedia(target, old, NOW)
    expect(verifyMedia(target, p, rotated, NOW)).toBe('ok')
    expect(verifyMedia(target, p, onlyNew, NOW)).toBe('invalid')
    expect(verifyMedia(target, signMedia(target, rotated, NOW), onlyNew, NOW)).toBe('ok')
  })

  it('without MEDIA_URL_KEYS the key is derived from PAYLOAD_SECRET (HKDF), never the secret itself', () => {
    const derived = signingKeys({ PAYLOAD_SECRET: 'p'.repeat(40) })
    expect(derived).toHaveLength(1)
    expect(derived[0]!.equals(Buffer.from('p'.repeat(40)))).toBe(false)
    expect(signingKeys({ PAYLOAD_SECRET: 'q'.repeat(40) })[0]!.equals(derived[0]!)).toBe(false)
    expect(() => signingKeys({ PAYLOAD_SECRET: '' })).toThrow(/no key/)
  })

  it('parses only complete, well-formed signed queries', () => {
    const p = signMedia(target, keys, NOW)
    const q = new URLSearchParams({ exp: String(p.exp), uid: '7', sig: p.sig })
    expect(parseSignedParams(q)).toEqual(p)
    const bads: Array<Record<string, string>> = [
      { exp: String(p.exp), uid: '7' },
      { exp: 'x', uid: '7', sig: p.sig },
      { exp: String(p.exp), uid: '0', sig: p.sig },
      { exp: String(p.exp), uid: '-1', sig: p.sig },
      { exp: String(p.exp), uid: '7', sig: `${p.sig}=` },
      { exp: String(p.exp), uid: '7', sig: 'short' },
    ]
    for (const bad of bads) {
      expect(parseSignedParams(new URLSearchParams(bad))).toBeNull()
    }
  })

  it('builds the relative file URL of the /api/v1 media endpoint', () => {
    const p = signMedia(target, keys, NOW)
    const url = signedMediaPath('/api', target, p)
    expect(url).toBe(`/api/v1/media/receipts/42/file?variant=thumb&exp=${p.exp}&uid=7&sig=${p.sig}`)
    expect(signedMediaPath('/api', { ...target, variant: null }, p)).not.toContain('variant')
  })

  it('env: MEDIA_URL_KEYS optional, each key ≥ 32 chars, readable from MEDIA_URL_KEYS_FILE', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://u:p@db:5432/pk',
      PAYLOAD_SECRET: 'x'.repeat(40),
      APP_URL: 'https://drms-kas.example.test',
      OIDC_ISSUER: 'https://auth.example.test/realms/drms',
      OIDC_WEB_CLIENT_ID: 'proyekkas-web',
      OIDC_WEB_CLIENT_SECRET: 's'.repeat(20),
      OIDC_MOBILE_CLIENT_ID: 'proyekkas-mobile',
    }
    expect(parseEnv(base).MEDIA_URL_KEYS).toBeUndefined()
    expect(parseEnv({ ...base, MEDIA_URL_KEYS: `${KEY_A},${KEY_B}` }).MEDIA_URL_KEYS).toBe(`${KEY_A},${KEY_B}`)
    expect(() => parseEnv({ ...base, MEDIA_URL_KEYS: `${KEY_A},short` })).toThrow(/MEDIA_URL_KEYS/)
    expect(resolveFileSecrets({ MEDIA_URL_KEYS_FILE: '/run/secrets/k' }, () => `${KEY_A}\n`).MEDIA_URL_KEYS).toBe(KEY_A)
  })
})

describe('/admin without session → 302 to login (E9)', () => {
  const gate = (pathname: string, cookieHeader: string | null = null, method = 'GET', search = '') =>
    adminLoginRedirect({ method, pathname, search, cookieHeader, insecureCookie: false })

  it('collection, view and root admin pages redirect to /admin/login with the target', () => {
    expect(gate('/admin/collections/expense-requests', null, 'GET', '?page=2')).toBe('/admin/login?redirect=%2Fadmin%2Fcollections%2Fexpense-requests%3Fpage%3D2')
    expect(gate('/admin')).toBe('/admin/login?redirect=%2Fadmin')
    expect(gate('/admin/kas')).toBe('/admin/login?redirect=%2Fadmin%2Fkas')
    expect(gate('/admin/collections/users', null, 'HEAD')).not.toBeNull()
  })

  it('a session cookie (secure name in prod) passes; the insecure name does not count in prod', () => {
    expect(gate('/admin/collections/users', '__Host-pk_session=abc')).toBeNull()
    expect(gate('/admin/collections/users', 'pk_session=abc')).not.toBeNull()
    expect(adminLoginRedirect({ method: 'GET', pathname: '/admin', search: '', cookieHeader: 'pk_session=abc', insecureCookie: true })).toBeNull()
  })

  it('login/logout helpers, non-admin paths and non-GET requests are not touched', () => {
    for (const p of ['/admin/login', '/admin/logout', '/admin/logout-inactivity', '/admin/forgot', '/admin/reset/x', '/admin/unauthorized', '/auth/login', '/', '/administrator', '/api/v1/health']) {
      expect(gate(p)).toBeNull()
    }
    expect(gate('/admin/collections/users', null, 'POST')).toBeNull()
  })

  it('never echoes a protocol-relative target', () => {
    expect(gate('//evil.example/admin')).toBeNull() // not an /admin path at all
  })
})

describe('403 before 409 (UAT 5.2)', () => {
  const ctx = (over: Partial<ActorContext>): ActorContext => ({
    type: 'advance',
    status: 'pending_ack',
    roles: ['pk-pm'],
    isCreator: false,
    isRequester: false,
    hasDecision: false,
    isAcknowledger: false,
    matchesCurrentStep: false,
    alreadyDecided: false,
    ...over,
  })
  const statusOf = (fn: () => void): number | undefined => {
    try {
      fn()
      return undefined
    } catch (err) {
      return (err as { status?: number }).status
    }
  }

  it('UAT 5.2: requester PM approving own request in "Menunggu Diketahui" → 403 (was 409)', () => {
    expect(statusOf(() => requireAction(ctx({ isRequester: true, isCreator: true }), 'approve'))).toBe(403)
  })

  it('PM monitoring a Direktur → Finance request: approve in any status → 403', () => {
    for (const status of ['pending_ack', 'pending_approval', 'approved', 'draft'] as const) {
      expect(statusOf(() => requireAction(ctx({ status, lacksDecisionRole: true }), 'approve'))).toBe(403)
    }
  })

  it('Staff attempting Finance actions on a request in the wrong status → 403, not 409', () => {
    for (const action of ['transfer', 'lpj_verify', 'settle', 'settle_reverse', 'verify_receipts'] as const) {
      expect(statusOf(() => requireAction(ctx({ roles: ['pk-staff'], status: 'draft' }), action))).toBe(403)
    }
  })

  it('an authorized caller learns the state conflict: Finance transfer on a draft → 409', () => {
    expect(statusOf(() => requireAction(ctx({ roles: ['pk-finance'], status: 'draft' }), 'transfer'))).toBe(409)
    expect(statusOf(() => requireAction(ctx({ roles: ['pk-finance'], status: 'lpj_verified' }), 'settle_reverse'))).toBe(409)
  })

  it('owner withdrawing/cancelling after a decision → 403 (unchanged: only office roles may then cancel); owner editing a submitted request → 409', () => {
    expect(statusOf(() => requireAction(ctx({ isCreator: true, status: 'pending_approval', hasDecision: true }), 'withdraw'))).toBe(403)
    expect(statusOf(() => requireAction(ctx({ isCreator: true, status: 'approved', hasDecision: true }), 'cancel'))).toBe(403)
    expect(statusOf(() => requireAction(ctx({ isCreator: true, status: 'pending_approval' }), 'edit'))).toBe(409)
  })

  it('not the caller’s turn (authorized role, wrong step) stays 403', () => {
    expect(statusOf(() => requireAction(ctx({ roles: ['pk-owner'], status: 'pending_approval', matchesCurrentStep: false }), 'approve'))).toBe(403)
  })

  it('mayPerform is status-independent and never wider than allowedActions for any status', () => {
    const statuses = ['draft', 'pending_ack', 'pending_approval', 'approved', 'transferred', 'completed', 'lpj_verified'] as const
    for (const roles of [['pk-staff'], ['pk-pm'], ['pk-finance'], ['pk-owner']] as const) {
      for (const own of [true, false]) {
        for (const status of statuses) {
          const c = ctx({ roles: [...roles], status, isCreator: own, isAcknowledger: true, matchesCurrentStep: true })
          for (const a of allowedActions(c)) expect(mayPerform(c, a)).toBe(true)
        }
      }
    }
  })
})

describe('settlement reversal state rules (E9)', () => {
  it('only an Uang Muka in "Selesai" can be reversed, back to "LPJ Terverifikasi"', () => {
    expect(targets('advance', 'completed', 'settle_reverse')).toEqual(['lpj_verified'])
    expect(targets('reimburse', 'completed', 'settle_reverse')).toEqual([])
    expect(targets('advance', 'lpj_verified', 'settle_reverse')).toEqual([])
    expect(() => assertTransition('advance', 'completed', 'settle_reverse', 'lpj_verified')).not.toThrow()
  })

  it('Finance only, never on its own request (G17 like settle)', () => {
    const base: ActorContext = {
      type: 'advance',
      status: 'completed',
      roles: ['pk-finance'],
      isCreator: false,
      isRequester: false,
      hasDecision: true,
      isAcknowledger: false,
      matchesCurrentStep: false,
      alreadyDecided: false,
    }
    expect(allowedActions(base)).toContain('settle_reverse')
    expect(allowedActions({ ...base, isRequester: true })).not.toContain('settle_reverse')
    expect(allowedActions({ ...base, roles: ['pk-owner'] })).not.toContain('settle_reverse')
    expect(allowedActions({ ...base, roles: ['pk-admin'] })).not.toContain('settle_reverse')
  })
})
