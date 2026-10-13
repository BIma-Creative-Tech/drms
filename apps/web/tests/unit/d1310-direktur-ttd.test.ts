import { describe, expect, it } from 'vitest'

import {
  COMPANY_SIGNATURE_SOURCE,
  decisionPositionOf,
  direkturLabel,
  direkturOf,
  isDirekturAckStep,
  isDirekturApprovalStep,
  isDirekturStep,
  representationApplies,
} from '@/domain/direktur-rules'
import { printedName } from '@/pdf/data'

/**
 * ADR 0025 (DRMS 13/10 A3): per-PT definitive Direktur signature — resolution rules (pure). The DB-bound part
 * (approval rows, PDF, history, media access) is covered by tests/integration/d1310-direktur-ttd.int.test.ts.
 */
const pmToDirektur = {
  acknowledge: 'required',
  acknowledgeBy: 'scope_manager',
  acknowledgeRole: null,
  acknowledgeDelegatedTo: null,
  steps: [{ level: 1, approverRole: 'pk-owner', approverUserId: null }],
}
const direkturToFinance = {
  acknowledge: 'required',
  acknowledgeBy: 'role',
  acknowledgeRole: 'pk-owner',
  acknowledgeDelegatedTo: null,
  steps: [{ level: 1, approverRole: 'pk-finance', approverUserId: null }],
}

describe('ADR 0025 Direktur step', () => {
  it('PM → Direktur: the PM "Diketahui" is personal, the Direktur level is a Direktur step', () => {
    expect(isDirekturAckStep(pmToDirektur)).toBe(false)
    expect(isDirekturApprovalStep(pmToDirektur, 1)).toBe(true)
    expect(isDirekturStep(pmToDirektur, 'diketahui', 0)).toBe(false)
    expect(isDirekturStep(pmToDirektur, 'approval', 1)).toBe(true)
  })

  it('Direktur → Finance (ADR 0013 / addendum): "Diketahui" by the Direktur role is, the Finance level is not', () => {
    expect(isDirekturAckStep(direkturToFinance)).toBe(true)
    expect(isDirekturApprovalStep(direkturToFinance, 1)).toBe(false)
  })

  it('F2e delegation: delegated to the Direktur tier counts, to the Admin tier does not', () => {
    expect(isDirekturAckStep({ ...pmToDirektur, acknowledgeDelegatedTo: 'owner' })).toBe(true)
    expect(isDirekturAckStep({ ...pmToDirektur, acknowledgeDelegatedTo: 'admin' })).toBe(false)
    expect(isDirekturAckStep({ ...direkturToFinance, acknowledge: 'none' })).toBe(false)
  })

  it('a step naming a user is personal even when that user is a Direktur', () => {
    const named = { ...pmToDirektur, steps: [{ level: 1, approverRole: 'pk-owner', approverUserId: 7 }] }
    expect(isDirekturApprovalStep(named, 1)).toBe(false)
    expect(isDirekturApprovalStep(pmToDirektur, 2)).toBe(false)
    expect(isDirekturApprovalStep(null, 1)).toBe(false)
  })

  it('decision position of the allowed actions (detail hint = decision bar order)', () => {
    expect(decisionPositionOf(['approve', 'reject'], 'pending_approval', 2)).toEqual({ position: 'approval', level: 2 })
    expect(decisionPositionOf(['acknowledge', 'reject'], 'pending_ack', 0)).toEqual({ position: 'diketahui', level: 0 })
    expect(decisionPositionOf(['reject'], 'pending_ack', null)).toEqual({ position: 'diketahui', level: 0 })
    expect(decisionPositionOf(['reject'], 'pending_approval', null)).toEqual({ position: 'approval', level: 1 })
    expect(decisionPositionOf(['edit'], 'draft', null)).toBeNull()
  })
})

describe('ADR 0025 PT configuration', () => {
  it('complete = name + signature; title optional; representatives de-duplicated', () => {
    expect(direkturOf(1, null)).toBeNull()
    expect(direkturOf(1, { name: '  ', signature: 5 })).toBeNull()
    expect(direkturOf(1, { name: 'Direktur Contoh', signature: null })).toBeNull()
    expect(direkturOf(1, { name: ' Direktur Contoh ', title: ' ', signature: { id: 5 }, representatives: [3, { id: 2 }, 3] })).toEqual({
      companyId: 1,
      name: 'Direktur Contoh',
      title: null,
      signatureId: 5,
      representatives: [2, 3],
    })
  })

  it('representation: only a designated representative, only on a Direktur step, only with a complete config', () => {
    const cfg = direkturOf(1, { name: 'Direktur Contoh', title: 'Direktur Utama', signature: 5, representatives: [3] })
    expect(representationApplies(cfg, 3, true)).toBe(true)
    expect(representationApplies(cfg, 3, false)).toBe(false) // e.g. the representative is also the PM / Finance step
    expect(representationApplies(cfg, 4, true)).toBe(false) // another Direktur of the PT signs personally
    expect(representationApplies(null, 3, true)).toBe(false) // PT without a definitive Direktur: unchanged
  })

  it('printed name: "Nama (Jabatan)" of the snapshot for a company signature, the stored name otherwise', () => {
    expect(direkturLabel('Direktur Contoh', 'Direktur Utama')).toBe('Direktur Contoh (Direktur Utama)')
    expect(direkturLabel('Direktur Contoh', null)).toBe('Direktur Contoh')
    expect(printedName({ actorName: 'Direktur Contoh', signatureSource: COMPANY_SIGNATURE_SOURCE, representedDirektur: { name: 'Direktur Contoh', title: 'Direktur Utama' } })).toBe(
      'Direktur Contoh (Direktur Utama)',
    )
    expect(printedName({ actorName: 'Budi Wakil', signatureSource: 'profile', representedDirektur: null })).toBe('Budi Wakil')
    expect(printedName(undefined)).toBe('')
  })
})
