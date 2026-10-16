import { describe, expect, it } from 'vitest'

import {
  COMPANY_SIGNATURE_SOURCE,
  decisionPositionOf,
  direkturLabel,
  direkturOf,
  holdsPositionAs,
  isDirekturAckStep,
  isDirekturApprovalStep,
  isDirekturStep,
  representationApplies,
} from '@/domain/direktur-rules'
import { approvalPrintedName, printedName } from '@/pdf/data'

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

describe('ADR 0025 × ADR 0026 (Owner level)', () => {
  const pmDirekturOwner = { ...pmToDirektur, steps: [{ level: 1, approverRole: 'pk-owner', approverUserId: null }, { level: 2, approverRole: 'pk-principal', approverUserId: null }] }

  it('the Owner level is never a Direktur step (signed personally, never with the PT signature)', () => {
    expect(isDirekturApprovalStep(pmDirekturOwner, 1)).toBe(true)
    expect(isDirekturApprovalStep(pmDirekturOwner, 2)).toBe(false)
    expect(isDirekturStep(pmDirekturOwner, 'approval', 2)).toBe(false)
  })

  it('PDF Approval box: the definitive Direktur keeps "Nama (Jabatan)", the Owner level carries its role', () => {
    const company = { actorName: 'Direktur Contoh', signatureSource: COMPANY_SIGNATURE_SOURCE, representedDirektur: { name: 'Direktur Contoh', title: 'Direktur Utama' } }
    expect(approvalPrintedName(company, 'pk-owner')).toBe('Direktur Contoh (Direktur Utama)')
    expect(approvalPrintedName({ ...company, representedDirektur: { name: 'Direktur Contoh', title: null } }, 'pk-owner')).toBe('Direktur Contoh (Direktur)')
    expect(approvalPrintedName({ actorName: 'Olivia Owner', signatureSource: 'profile', representedDirektur: null }, 'pk-principal')).toBe('Olivia Owner (Owner)')
    expect(approvalPrintedName({ actorName: 'Budi', signatureSource: 'profile', representedDirektur: null }, null)).toBe('Budi')
  })
})

describe('owner 2026-10-16: wakil PM + Direktur (holdsPositionAs)', () => {
  const pmRow = { actor: 7, position: 'diketahui', decision: 'acknowledged', signatureSource: 'profile' }
  const dirRow = { actor: 7, position: 'approval', decision: 'approved', signatureSource: COMPANY_SIGNATURE_SOURCE }

  it('a personal PM decision does not block the decision as the definitive Direktur (and the reverse)', () => {
    expect(holdsPositionAs([pmRow], 7, true)).toBe(false)
    expect(holdsPositionAs([dirRow], 7, false)).toBe(false)
  })

  it('two positions under the same identity stay refused (G1)', () => {
    expect(holdsPositionAs([pmRow], 7, false)).toBe(true)
    expect(holdsPositionAs([dirRow], 7, true)).toBe(true)
    expect(holdsPositionAs([{ ...pmRow, signatureSource: null }], 7, false)).toBe(true)
  })

  it('other users, signatures (Diajukan/Dibuat) and other positions never count', () => {
    expect(holdsPositionAs([pmRow, dirRow], 8, false)).toBe(false)
    expect(holdsPositionAs([{ ...pmRow, position: 'diajukan', decision: 'signed' }], 7, false)).toBe(false)
  })
})
