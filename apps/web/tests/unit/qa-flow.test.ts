import { describe, expect, it } from 'vitest'

import { withCompanyContext } from '@/access/roles'
import { requesterOptions } from '@/collections/ExpenseRequests'
import { SYSTEM_CASH_IN_SOURCES } from '@/domain/company-defaults'
import { computeFlags, type FlagInput } from '@/domain/expense/flags'
import { FUTURE_RECEIPT_MESSAGE, validateReceipt } from '@/domain/expense/receipts'
import { allowedActions, type ActorContext } from '@/domain/expense/state'
import { orphanConfig, orphanCutoff, ORPHAN_COLLECTIONS, ORPHAN_MARK } from '@/domain/media-orphans'
import { eventsFor, PM_EVENTS } from '@/domain/notifications'

/** QA report 2026-10-08 "alur & nota" — pure parts (the DB-bound paths: tests/integration/qa-flow.int.test.ts). */

describe('QA-07 validateReceipt: future receipt date', () => {
  const base = { lineId: 'l1', vendorName: 'Toko', amount: 10_000, imageId: 1 }
  const errorsOf = (fn: () => void) => {
    try {
      fn()
      return null
    } catch (err) {
      return err as { status: number; message: string; data?: { errors?: Array<{ path: string; message: string }> } }
    }
  }
  it('today and earlier pass; tomorrow → 400 with the cash-module wording on receiptDate', () => {
    expect(errorsOf(() => validateReceipt({ ...base, receiptDate: '2026-10-08' }, true, '2026-10-08'))).toBeNull()
    expect(errorsOf(() => validateReceipt({ ...base, receiptDate: '2026-01-31' }, true, '2026-10-08'))).toBeNull()
    const e = errorsOf(() => validateReceipt({ ...base, receiptDate: '2026-10-09' }, true, '2026-10-08'))!
    expect(e.status).toBe(400)
    expect(e.message).toBe(`${FUTURE_RECEIPT_MESSAGE}.`)
    expect(e.data?.errors).toEqual([{ path: 'receiptDate', message: `${FUTURE_RECEIPT_MESSAGE} (hari ini 2026-10-08).` }])
  })
  it('format errors keep the generic message; an edit without a date is not date-checked', () => {
    const e = errorsOf(() => validateReceipt({ ...base, receiptDate: '2026-13-01' }, true, '2026-10-08'))!
    expect(e.message).toBe('Data nota tidak valid.')
    expect(errorsOf(() => validateReceipt({ amount: 5_000 }, false, '2026-10-08'))).toBeNull()
    expect(errorsOf(() => validateReceipt({ receiptDate: '2027-01-01' }, false, '2026-10-08'))?.status).toBe(400)
  })
})

describe('QA-08 computeFlags: duplicates inside the same request', () => {
  const input = (duplicates: FlagInput['duplicates']): FlagInput => ({
    type: 'reimburse',
    requestDate: '2026-10-08',
    lines: [
      { id: 'a', lineNo: 1, total: 100_000 },
      { id: 'b', lineNo: 2, total: 50_000 },
    ],
    receipts: [
      { id: 11, lineId: 'a', receiptDate: '2026-10-07', amount: 100_000 },
      { id: 12, lineId: 'b', receiptDate: '2026-10-07', amount: 50_000 },
      { id: 13, lineId: 'b', receiptDate: '2026-10-07', amount: 1 },
    ],
    categories: new Map(),
    uomNames: new Map(),
    duplicates,
    tolerance: 1000,
    maxAgeDays: 30,
  })
  it('same-request hit → one warning on the later receipt naming the first one\'s line', () => {
    const f = computeFlags(input([{ receiptId: 12, otherRequestId: 7, otherDocNo: 'X', via: 'image', otherReceiptId: 11 }])).filter((x) => x.kind === 'duplicate')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ receiptId: 12, lineNo: 2, level: 'warning', detail: { sameRequest: true, otherReceiptId: 11, otherLineNo: 1, via: 'image' } })
    expect(f[0]!.message).toBe('Nota ganda dalam pengajuan ini: sama dengan nota baris 1 (foto identik).')
    expect(f[0]!.relatedRequestId).toBeUndefined()
  })
  it('a receipt matching two earlier ones is flagged once; fields match wording; cross-request text unchanged', () => {
    const f = computeFlags(
      input([
        { receiptId: 13, otherRequestId: 7, otherDocNo: null, via: 'fields', otherReceiptId: 11 },
        { receiptId: 13, otherRequestId: 7, otherDocNo: null, via: 'fields', otherReceiptId: 12 },
        { receiptId: 11, otherRequestId: 9, otherDocNo: '5/PB-DRMS/01/X/2026', via: 'fields' },
      ]),
    ).filter((x) => x.kind === 'duplicate')
    expect(f).toHaveLength(2)
    expect(f.find((x) => x.receiptId === 13)!.message).toContain('nomor + toko sama')
    expect(f.find((x) => x.receiptId === 11)!.message).toBe('Nota sudah dipakai di pengajuan 5/PB-DRMS/01/X/2026 (nomor + toko + nominal sama).')
  })
})

describe('QA-18 eventsFor: team PM of the project', () => {
  const doc = (status: string, project: number | null = 5) => ({ id: 1, type: 'advance' as const, status: status as never, title: 't', project })
  const pm = (prev: string, status: string, project: number | null = 5) => eventsFor({ status: prev as never }, doc(status, project)).filter((e) => e.to === 'pm').map((e) => e.event)
  it('submit / reject / transfer / LPJ revision / completion; nothing else', () => {
    expect(pm('draft', 'pending_ack')).toEqual(['expense.team_submitted'])
    expect(pm('draft', 'pending_approval')).toEqual(['expense.team_submitted'])
    expect(pm('pending_approval', 'rejected')).toEqual(['expense.rejected'])
    expect(pm('approved', 'transferred')).toEqual(['expense.transferred'])
    expect(pm('lpj_submitted', 'lpj_revision')).toEqual(['expense.lpj_revision'])
    expect(pm('lpj_verified', 'completed')).toEqual(['expense.completed'])
    for (const [a, b] of [['pending_ack', 'pending_approval'], ['pending_approval', 'approved'], ['pending_ack', 'draft'], ['receipts_complete', 'lpj_submitted'], ['receipt_revision', 'pending_ack']]) expect(pm(a!, b!), `${a}→${b}`).toEqual([])
    expect(pm('draft', 'pending_ack', null)).toEqual([]) // cost center request: no team PM
    expect(eventsFor(null, doc('draft')).some((e) => e.to === 'pm')).toBe(false)
    expect([...PM_EVENTS].sort()).toEqual(['expense.completed', 'expense.lpj_revision', 'expense.rejected', 'expense.team_submitted', 'expense.transferred'])
  })
  it('the requester / Finance events are unchanged', () => {
    expect(eventsFor({ status: 'draft' }, doc('pending_ack')).filter((e) => e.to !== 'pm')).toEqual([
      { event: 'expense.pending_ack', to: 'ack' },
      { event: 'expense.submitted', to: 'people' },
    ])
  })
})

describe('QA-15 requesterOptions ("Diajukan Oleh" picker)', () => {
  const user = (roles: string[], employee: number | null, companies = [2]) => withCompanyContext({ id: 1 }, companies.map((c) => ({ company: c, roles: roles as never, employee })), null, false)
  it('Staff-only: own employee within the document PT', () => {
    expect(requesterOptions({ data: { company: 2 }, user: user(['pk-staff'], 44) as never })).toEqual({ and: [{ company: { equals: 2 } }, { id: { in: [44] } }] })
    expect(requesterOptions({ data: {}, user: user(['pk-staff'], 44) as never })).toEqual({ id: { in: [44] } })
    expect(requesterOptions({ data: { company: 2 }, user: user(['pk-staff'], null) as never })).toBe(false)
  })
  it('PM / Admin / Finance / Staff+PM: every employee of the PT', () => {
    for (const roles of [['pk-pm'], ['pk-admin'], ['pk-finance'], ['pk-staff', 'pk-pm']]) {
      expect(requesterOptions({ data: { company: 2 }, user: user(roles, 44) as never }), roles.join('+')).toEqual({ company: { equals: 2 } })
    }
  })
})

describe('QA-19 Finance may complete a transferred Reimburse (button source = allowedActions)', () => {
  const ctx = (roles: string[], own = false): ActorContext => ({ type: 'reimburse', status: 'transferred', roles: roles as never, isCreator: own, isRequester: false, hasDecision: true, isAcknowledger: false, matchesCurrentStep: false, alreadyDecided: false })
  it('Finance and the requester: complete; Direktur / Admin / PM: not', () => {
    expect(allowedActions(ctx(['pk-finance']))).toContain('complete')
    expect(allowedActions(ctx(['pk-staff'], true))).toContain('complete')
    for (const r of ['pk-owner', 'pk-admin', 'pk-pm']) expect(allowedActions(ctx([r]))).not.toContain('complete')
  })
})

describe('QA-11 system cash-in source + orphan cleanup config', () => {
  it('the LPJ source is a system default (code LPJ, "Pengembalian LPJ"); ADR 0028: + "Antar PT" (code ANTAR-PT)', () => {
    expect(SYSTEM_CASH_IN_SOURCES).toEqual([
      { code: 'LPJ', name: 'Pengembalian LPJ' },
      { code: 'ANTAR-PT', name: 'Antar PT' },
    ])
  })
  it('orphan cleanup: dry run by default, 7 days, 200 per run; env parsed; invalid → throws names only', () => {
    expect(orphanConfig({})).toEqual({ enabled: false, minAgeDays: 7, batch: 200 })
    expect(orphanConfig({ MEDIA_ORPHAN_PURGE_ENABLED: 'true', MEDIA_ORPHAN_MIN_AGE_DAYS: '14', MEDIA_ORPHAN_BATCH: '50' })).toEqual({ enabled: true, minAgeDays: 14, batch: 50 })
    expect(() => orphanConfig({ MEDIA_ORPHAN_PURGE_ENABLED: 'yes' })).toThrow(/MEDIA_ORPHAN_PURGE_ENABLED/)
    expect(() => orphanConfig({ MEDIA_ORPHAN_MIN_AGE_DAYS: '0' })).toThrow(/MEDIA_ORPHAN_MIN_AGE_DAYS/)
    expect(orphanCutoff(new Date('2026-10-08T00:00:00Z'), 7).toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(ORPHAN_COLLECTIONS.map((c) => c.slug)).toEqual(['media-attachments'])
    expect(ORPHAN_MARK.id).not.toMatch(/^\d+$/) // never a document id (owner_company stays NULL)
  })
})
