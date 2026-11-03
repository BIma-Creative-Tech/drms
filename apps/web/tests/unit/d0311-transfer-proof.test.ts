import { describe, expect, it } from 'vitest'

import type { Role } from '@/access/roles'
import { requireAction } from '@/domain/expense/common'
import { allowedActions, mayPerform, type ActorContext } from '@/domain/expense/state'
import type { RequestStatus } from '@/domain/expense/types'
import { historyEntry, proofFiles } from '@/domain/history-format'
import type { HistoryRow } from '@/domain/history'

/**
 * D0311 (user 2026-11-03) "Ganti bukti transfer", pure parts: the `transfer_proof_replace` action (Finance / Admin of
 * the PT, request "Selesai" only — "Sudah Ditransfer" keeps void + record again) and the old / new file links of the
 * history row.
 */
const ctx = (status: RequestStatus, roles: Role[], over: Partial<ActorContext> = {}): ActorContext => ({
  type: 'advance',
  status,
  roles,
  isCreator: false,
  isRequester: false,
  hasDecision: true,
  isAcknowledger: false,
  matchesCurrentStep: false,
  alreadyDecided: false,
  ...over,
})

const status = (fn: () => void): number | undefined => {
  try {
    fn()
    return undefined
  } catch (e) {
    return (e as { status?: number }).status
  }
}

describe('transfer_proof_replace action', () => {
  it('Finance and Admin of the PT on a completed request', () => {
    expect(allowedActions(ctx('completed', ['pk-finance']))).toContain('transfer_proof_replace')
    expect(allowedActions(ctx('completed', ['pk-admin']))).toContain('transfer_proof_replace')
    expect(allowedActions(ctx('completed', ['pk-finance'], { type: 'reimburse' }))).toContain('transfer_proof_replace')
    expect(allowedActions(ctx('completed', ['pk-finance'], { payeeType: 'vendor' }))).toContain('transfer_proof_replace')
  })

  it('also on a request the Finance user requested (file only, audited)', () => {
    expect(allowedActions(ctx('completed', ['pk-finance'], { isRequester: true, isCreator: true }))).toContain('transfer_proof_replace')
  })

  it('never for other roles', () => {
    for (const r of ['pk-owner', 'pk-pm', 'pk-staff', 'pk-principal', 'pk-operator'] as Role[]) {
      expect(allowedActions(ctx('completed', [r]))).not.toContain('transfer_proof_replace')
      expect(mayPerform(ctx('completed', [r]), 'transfer_proof_replace')).toBe(false)
    }
  })

  it('not before "Selesai": Sudah Ditransfer keeps the existing void flow', () => {
    for (const s of ['transferred', 'receipts_complete', 'lpj_submitted', 'lpj_verified', 'approved', 'cancelled'] as RequestStatus[]) {
      expect(allowedActions(ctx(s, ['pk-finance']))).not.toContain('transfer_proof_replace')
    }
  })

  it('requireAction: 403 for other roles, 409 for Finance / Admin before Selesai, ok on Selesai', () => {
    expect(status(() => requireAction(ctx('completed', ['pk-pm']), 'transfer_proof_replace'))).toBe(403)
    expect(status(() => requireAction(ctx('transferred', ['pk-finance']), 'transfer_proof_replace'))).toBe(409)
    expect(status(() => requireAction(ctx('lpj_verified', ['pk-admin']), 'transfer_proof_replace'))).toBe(409)
    expect(status(() => requireAction(ctx('completed', ['pk-admin']), 'transfer_proof_replace'))).toBeUndefined()
  })
})

const row = (over: Partial<HistoryRow>): HistoryRow => ({
  id: 1,
  serverTime: '2026-11-03T02:00:00.000Z',
  docType: 'transfer',
  docId: '61',
  docNo: 'TRF/DRMS/2611/0002',
  action: 'update',
  field: 'proof',
  lineNo: null,
  oldValue: 60,
  newValue: 68,
  statusFrom: null,
  statusTo: null,
  reason: 'salah upload',
  userId: 3,
  userName: 'Finance',
  userRoles: 'pk-finance',
  source: 'web',
  appVersion: null,
  deviceId: null,
  ...over,
})

describe('history: old / new proof links', () => {
  it('links both files of a transfer proof change', () => {
    expect(proofFiles(row({}))).toEqual([
      { label: 'Bukti lama', href: '/api/v1/media/transfer-proofs/60/file' },
      { label: 'Bukti baru', href: '/api/v1/media/transfer-proofs/68/file' },
    ])
    expect(historyEntry(row({}), 'Asia/Makassar').files).toHaveLength(2)
  })

  it('nothing for other rows or malformed values', () => {
    expect(proofFiles(row({ field: 'status' }))).toBeNull()
    expect(proofFiles(row({ docType: 'cash_entry' }))).toBeNull()
    expect(proofFiles(row({ oldValue: { x: 1 }, newValue: null }))).toBeNull()
    expect(historyEntry(row({ field: 'bankRef', oldValue: '0', newValue: '1' }), 'Asia/Makassar').files).toBeUndefined()
  })
})
