import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildOpenApiDocument } from '@/api/v1/openapi'
import { openapiDocument } from '@/api/v1/openapi.generated'
import { FundCheck } from '@/api/v1/schemas-flow'
import { IcLoanDetail, IcLoanQueue } from '@/api/v1/schemas-icloans'
import { IC_LOAN_STATUS_LABELS, IC_LOAN_STATUSES, icLoanDestination, icLoanStatusLabel, maskIcAccountNo, seesIcLoanDestination } from '@/domain/intercompany/loan-rules'

/**
 * ADR 0029 "Pinjaman antar-PT" — two API gaps closed for the APK (2026-10-15):
 *  1. `GET /intercompany-loans/{id}` carries `destination` (the borrower's designated receiving account, masked) with the
 *     queue item's shape, helper and readers (Finance of the lender while instructed), so a disbursement form opened from
 *     a notification needs no queue;
 *  2. `fundCheck.loans[]` carries `statusLabel` next to `status`, from `IC_LOAN_STATUS_LABELS` (the single source).
 */

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const withoutDescription = (o: Json): Json => {
  const c = JSON.parse(JSON.stringify(o)) as Json
  delete c.description
  return c
}

describe('fundCheck.loans[].statusLabel (gap 2)', () => {
  it('labels come from IC_LOAN_STATUS_LABELS; an unknown code stays as is', () => {
    for (const s of IC_LOAN_STATUSES) expect(icLoanStatusLabel(s)).toBe(IC_LOAN_STATUS_LABELS[s])
    expect(icLoanStatusLabel('instructed')).toBe('Menunggu pencairan')
    expect(icLoanStatusLabel('partially_repaid')).toBe('Sebagian dikembalikan')
    expect(icLoanStatusLabel('something_new')).toBe('something_new')
  })

  it('the FundCheck schema requires statusLabel on every linked loan', () => {
    const panel = {
      companyId: 2,
      company: { id: 2, shortCode: 'LAS', name: 'PT Contoh' },
      enabled: true,
      applies: true,
      status: 'insufficient',
      blocked: true,
      blockedText: 'x',
      balance: 120,
      commitments: 150,
      available: -30,
      needed: 50,
      gap: 80,
      route: 'short',
      routeText: null,
      pusatBiaya: null,
      accountCount: 2,
      excludedSiteAccounts: { count: 1, balance: 5 },
      waitingAtOwner: { count: 0, amount: 0 },
      commitmentItems: [],
    }
    const loan = { id: 7, docNo: 'PJA/LAS/2610/0001', status: 'instructed', amount: 10, lender: { id: 3, shortCode: 'LAS' } }
    expect(FundCheck.safeParse({ ...panel, loans: [{ ...loan, statusLabel: 'Menunggu pencairan' }] }).success).toBe(true)
    expect(FundCheck.safeParse({ ...panel, loans: [loan] }).success).toBe(false)
  })
})

describe('loan detail `destination` (gap 1)', () => {
  it('one helper for the queue item and the detail: bank, masked number, holder; none designated → null', () => {
    expect(icLoanDestination({ bankName: 'Mandiri', accountNo: '1234567890', accountHolder: 'PT Contoh Peminjam' })).toEqual({ bankName: 'Mandiri', accountNoMasked: '••••7890', accountHolder: 'PT Contoh Peminjam' })
    expect(icLoanDestination({ bankName: null, accountNo: null, accountHolder: 'Kas' })).toEqual({ bankName: null, accountNoMasked: null, accountHolder: 'Kas' })
    expect(icLoanDestination(null)).toBeNull()
    expect(maskIcAccountNo('987')).toBe('••••987')
    expect(maskIcAccountNo('')).toBeNull()
    expect(maskIcAccountNo(undefined)).toBeNull()
  })

  it('readers = the queue item\'s: Finance of the lender while the loan waits for its disbursement', () => {
    expect(seesIcLoanDestination('instructed', true)).toBe(true)
    expect(seesIcLoanDestination('instructed', false)).toBe(false) // Owner without Finance, Direktur, borrower's Finance
    for (const s of ['disbursed', 'partially_repaid', 'repaid', 'cancelled'] as const) expect(seesIcLoanDestination(s, true)).toBe(false)
  })

  it('the service builds both through the helper and the visibility rule (no second copy of the mask)', () => {
    const src = readFileSync(join(__dirname, '../../src/domain/intercompany/loans.ts'), 'utf8')
    expect(src.match(/icLoanDestination\(/g)?.length).toBe(2) // queue item + detail
    expect(src).toContain('seesIcLoanDestination(l.status, a.financeLender)')
    expect(src).not.toMatch(/••••/)
  })

  it('zod: the detail field is the queue item\'s shape (nullable, required)', () => {
    const detail = IcLoanDetail.shape.destination
    const queued = (IcLoanQueue.shape.items.element as unknown as typeof IcLoanDetail).shape.destination
    const v = { bankName: 'Mandiri', accountNoMasked: '••••7890', accountHolder: 'PT Contoh' }
    for (const s of [detail, queued]) {
      expect(s.safeParse(v).success).toBe(true)
      expect(s.safeParse(null).success).toBe(true)
      expect(s.safeParse({ bankName: null, accountNoMasked: null }).success).toBe(false)
    }
    expect(IcLoanDetail.shape.destination.safeParse(undefined).success).toBe(false) // always sent by this server
  })
})

describe('OpenAPI: built = committed for the changed parts (incl. the inline copies)', () => {
  const built = buildOpenApiDocument('0.0.0') as unknown as Json
  const committed = openapiDocument as unknown as Json
  const sc = built.components.schemas as Json

  it('IntercompanyLoanDetail.destination = the queue item\'s destination (only the description differs)', () => {
    const det = sc.IntercompanyLoanDetail
    expect(det.required).toContain('destination')
    expect(withoutDescription(det.properties.destination)).toEqual(withoutDescription(sc.IntercompanyLoanQueue.properties.items.items.properties.destination))
    expect(det.properties.destination.description).toContain('Finance of the LENDER')
    expect(committed.components.schemas.IntercompanyLoanDetail).toEqual(det)
    expect(committed.components.schemas.IntercompanyLoanQueue).toEqual(sc.IntercompanyLoanQueue)
    expect(committed.paths['/intercompany-loans/{id}']).toEqual(built.paths['/intercompany-loans/{id}'])
  })

  it('ExpenseRequestDetail.fundCheck.loans[] requires statusLabel', () => {
    const fc = sc.ExpenseRequestDetail.properties.fundCheck
    expect(fc.properties.loans.items.required).toEqual(['id', 'docNo', 'status', 'statusLabel', 'amount', 'lender'])
    expect(committed.components.schemas.ExpenseRequestDetail.properties.fundCheck).toEqual(fc)
    // the only copy of the panel in the document (a second inline copy would need the same field)
    expect(JSON.stringify(committed).split('Inter-PT loans instructed for this request (linked).').length).toBe(2)
  })
})
