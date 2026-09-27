import type { SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { approversAssignable, buildSnapshot, matchesAcknowledger, resolveAckDelegation, type RuleInput } from '@/domain/expense/rules'
import { allowedActions, type ActorContext } from '@/domain/expense/state'
import { nextActor } from '@/domain/expense/timeline'
import { demoteOperationalClientErrors, isOperationalClientError, loggerOptions } from '@/lib/logger'

/** F2e (final UAT): acknowledger fallback rule, Finance self-involvement, log level, field visibility. */
describe('acknowledger fallback (option a) — exact rule', () => {
  const OWNER_A = 1
  const OWNER_B = 2
  const ADMIN = 3
  const PM = 4
  const base = { excluded: new Set([PM]), owners: [OWNER_A, OWNER_B], admins: [ADMIN], originalUserId: PM }

  it('approver = Owner role with two eligible Owners → either Owner may acknowledge (the other approves)', () => {
    expect(resolveAckDelegation({ ...base, approverPools: [[OWNER_A, OWNER_B]] })).toEqual({
      to: 'owner',
      userIds: [OWNER_A, OWNER_B],
      reason: 'PM/penanggung jawab adalah pemohon/pembuat (Q-07/Q-08)',
      originalUserId: PM,
    })
  })

  it('the only Owner who can approve is never the acknowledger; the other Owner is', () => {
    expect(resolveAckDelegation({ ...base, approverPools: [[OWNER_A]] })?.userIds).toEqual([OWNER_B])
  })

  it('single eligible Owner who is also the approver → Admin', () => {
    const r = resolveAckDelegation({ ...base, owners: [OWNER_A], approverPools: [[OWNER_A]] })
    expect(r).toMatchObject({ to: 'admin', userIds: [ADMIN] })
  })

  it('requesters/creator are never candidates (an Owner who is the requester is skipped)', () => {
    const r = resolveAckDelegation({ ...base, excluded: new Set([PM, OWNER_B]), approverPools: [[OWNER_A]] })
    expect(r).toMatchObject({ to: 'admin', userIds: [ADMIN] })
  })

  it('nobody qualifies → null (the 409 stays)', () => {
    expect(resolveAckDelegation({ ...base, owners: [OWNER_A], admins: [], approverPools: [[OWNER_A]] })).toBeNull()
    expect(resolveAckDelegation({ ...base, excluded: new Set([PM, ADMIN]), owners: [OWNER_A], approverPools: [[OWNER_A]] })).toBeNull()
  })

  it('missing PM → other reason text', () => {
    expect(resolveAckDelegation({ ...base, originalUserId: null, approverPools: [[OWNER_A, OWNER_B]] })?.reason).toBe('PM/penanggung jawab belum diatur (Q-07)')
  })

  it('multi-level: every level still needs a distinct person after the acknowledger', () => {
    expect(approversAssignable([[OWNER_A, OWNER_B], [OWNER_A, OWNER_B]], OWNER_A)).toBe(false)
    expect(approversAssignable([[OWNER_A, OWNER_B], [OWNER_A, OWNER_B]], ADMIN)).toBe(true)
    expect(approversAssignable([[OWNER_A], [OWNER_B]], ADMIN)).toBe(true)
    expect(approversAssignable([], OWNER_A)).toBe(true)
    // two Owner levels + two Owners: no Owner may acknowledge → Admin
    expect(resolveAckDelegation({ ...base, approverPools: [[OWNER_A, OWNER_B], [OWNER_A, OWNER_B]] })).toMatchObject({ to: 'admin', userIds: [ADMIN] })
  })

  const rule: RuleInput = { id: 9, name: 'r', docType: 'expense_request', requestType: 'any', minAmount: 0, acknowledge: 'required', acknowledgeBy: 'scope_manager', steps: [{ level: 1, approverRole: 'pk-owner' }] }

  it('snapshot + matching: only a listed delegate who still holds the tier role; not the skipped PM', () => {
    const snap = buildSnapshot(rule, null, { to: 'owner', userIds: [OWNER_B, OWNER_A], reason: 'x', originalUserId: PM })
    expect(snap).toMatchObject({ acknowledgerUserId: null, acknowledgeDelegatedTo: 'owner', acknowledgeDelegateUserIds: [OWNER_A, OWNER_B], acknowledgeOriginalUserId: PM })
    expect(matchesAcknowledger(snap, { id: OWNER_A, roles: ['pk-owner'] })).toBe(true)
    expect(matchesAcknowledger(snap, { id: OWNER_A, roles: ['pk-staff'] })).toBe(false) // role removed since submit
    expect(matchesAcknowledger(snap, { id: 99, roles: ['pk-owner'] })).toBe(false) // not a delegate
    expect(matchesAcknowledger(snap, { id: PM, roles: ['pk-pm'] })).toBe(false)
    // pre-F2e snapshots (no delegation fields) keep working
    const old = buildSnapshot(rule, PM)
    expect(old.acknowledgeDelegatedTo).toBeUndefined()
    expect(matchesAcknowledger(old, { id: PM, roles: ['pk-pm'] })).toBe(true)
  })

  it('timeline (legacy F2e snapshot): "Giliran: Direktur — Diketahui (dilimpahkan)"', () => {
    const snap = buildSnapshot(rule, null, { to: 'owner', userIds: [OWNER_A], reason: 'x', originalUserId: PM })
    expect(nextActor({ type: 'advance', status: 'pending_ack', currentLevel: 0, snapshot: snap, requesters: 'PM', names: {} })).toEqual({
      who: 'Direktur',
      what: 'Diketahui (dilimpahkan): tandai "Diketahui" (atau tolak)',
    })
    const admin = buildSnapshot(rule, null, { to: 'admin', userIds: [ADMIN], reason: 'x', originalUserId: PM })
    expect(nextActor({ type: 'advance', status: 'pending_ack', currentLevel: 0, snapshot: admin, requesters: 'PM', names: {} })?.who).toBe('Admin')
  })
})

describe('Finance self-involvement (receipt verification)', () => {
  const ctx = (over: Partial<ActorContext>): ActorContext => ({
    type: 'reimburse',
    status: 'approved',
    roles: ['pk-finance'],
    isCreator: false,
    isRequester: false,
    hasDecision: true,
    isAcknowledger: false,
    matchesCurrentStep: false,
    alreadyDecided: false,
    ...over,
  })
  const verification = ['receipt_verify', 'receipt_reject', 'verify_receipts', 'review_flag']

  it('Finance on someone else\'s request may verify; as creator or requester it may not', () => {
    expect(allowedActions(ctx({}))).toEqual(expect.arrayContaining(verification))
    for (const self of [{ isCreator: true }, { isRequester: true }]) {
      const acts = allowedActions(ctx(self))
      for (const a of verification) expect(acts, a).not.toContain(a)
      expect(allowedActions(ctx({ ...self, status: 'lpj_submitted', type: 'advance' }))).not.toContain('lpj_verify')
    }
  })
})

describe('log level: operational 4xx → warn, 5xx → error', () => {
  const calls: Array<[string, unknown[]]> = []
  const logger = { warn: (...a: unknown[]) => void calls.push(['warn', a]) }
  const error = function (this: unknown, ...a: unknown[]) {
    calls.push(['error', a])
  }
  const op = (status: number) => Object.assign(new Error('x'), { isOperational: true, status })

  it('classifies Payload/API errors', () => {
    expect(isOperationalClientError({ err: op(403) })).toBe(true)
    expect(isOperationalClientError(op(404))).toBe(true)
    expect(isOperationalClientError({ err: op(409) })).toBe(true)
    expect(isOperationalClientError({ err: op(500) })).toBe(false)
    expect(isOperationalClientError({ err: new Error('boom') })).toBe(false)
    expect(isOperationalClientError({ msg: 'plain' })).toBe(false)
  })

  it('logMethod hook re-emits 4xx at warn, keeps 5xx/other at error; is wired into the Payload logger options', () => {
    calls.length = 0
    demoteOperationalClientErrors.call(logger, [{ err: op(403) }], error, 50)
    demoteOperationalClientErrors.call(logger, [{ err: op(500) }], error, 50)
    demoteOperationalClientErrors.call(logger, [{ msg: 'v1 handler failed' }], error, 50)
    demoteOperationalClientErrors.call(logger, [{ err: op(404) }], error, 40) // already warn
    expect(calls.map((c) => c[0])).toEqual(['warn', 'error', 'error', 'error'])
    expect(loggerOptions({}).hooks?.logMethod).toBe(demoteOperationalClientErrors)
  })
})

describe('office-only fields hidden from staff (no 403 queries from the admin form)', () => {
  let config: SanitizedConfig
  beforeAll(async () => {
    process.env.PK_SKIP_ENV_CHECK = 'true'
    config = await (await import('@/payload.config')).default
  })
  type F = { name?: string; admin?: { condition?: (d: unknown, s: unknown, o: { user: unknown }) => boolean; components?: { Field?: unknown } } }
  const field = (slug: string, name: string) => (config.collections.find((c) => c.slug === slug)!.fields as F[]).find((f) => f.name === name)!
  const visible = (f: F, roles: string[]) => f.admin?.condition?.({}, {}, { user: { id: 1, roles } }) ?? true

  it('"Aturan approval" + snapshot only for roles that can read approval rules; vendor master not for staff', () => {
    for (const name of ['approvalRule', 'approvalSnapshot']) {
      const f = field('expense-requests', name)
      expect(visible(f, ['pk-staff']), name).toBe(false)
      expect(visible(f, ['pk-pm']), name).toBe(false)
      for (const r of ['pk-finance', 'pk-owner', 'pk-admin']) expect(visible(f, [r]), `${name} ${r}`).toBe(true)
    }
    expect(visible(field('receipts', 'vendor'), ['pk-staff'])).toBe(false)
    expect(visible(field('receipts', 'vendor'), ['pk-finance'])).toBe(true)
    expect(field('expense-requests', 'resubmitOf').admin?.components?.Field).toBe('@/admin/components/ResubmitOfField#ResubmitOfField')
  })
})
