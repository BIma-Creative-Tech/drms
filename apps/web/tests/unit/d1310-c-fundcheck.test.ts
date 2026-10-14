import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { withCompanyContext } from '@/access/roles'
import { decisionOf } from '@/admin/components/request/panel-data'
import { docHref } from '@/admin/doc-links'
import { capabilitiesOf, meCapabilities } from '@/api/v1/endpoints/me'
import { Capabilities } from '@/api/v1/schemas'
import { ActionEnum, ApprovalInbox, CashEntryIntercompany, FundCheck } from '@/api/v1/schemas-flow'
import { IcLoanCreate, IcLoanDisburse, IcLoanRepay, IcLoanVoidDisbursement } from '@/api/v1/schemas-icloans'
import { AUDIT_ACTIONS } from '@/audit/writer'
import { FUND_CHECK_FIELD } from '@/collections/Companies'
import { voidHint } from '@/domain/cash/book'
import { settingDefaults } from '@/domain/company-defaults'
import {
  blockedDecisionText,
  finalStepWaiting,
  FUND_INSUFFICIENT,
  FUND_SHORTFALL_DEFAULT,
  fundGap,
  fundInsufficientMessage,
  fundLockKey,
  isCommitted,
  panelApplies,
  renderFundText,
  requestCommitment,
} from '@/domain/fundcheck/rules'
import { enteredFinalStep } from '@/domain/fundcheck/service'
import {
  canMove,
  daysOverdue,
  dueDateError,
  IC_LOAN_DOC_TYPE,
  IC_LOAN_MOVES,
  IC_LOAN_NOTIFY_DEFAULTS,
  IC_LOAN_STATUS_LABELS,
  IC_LOAN_STATUSES,
  icLoanAllowedActions,
  isOverdue,
  legOf,
  LOAN_HAS_REPAYMENTS,
  LOAN_LENDER_INSUFFICIENT,
  LOAN_REPAYMENT_EXCEEDS_OUTSTANDING,
  LOAN_VOID_BORROWER_SHORTFALL_CONFIRM_REQUIRED,
  outstandingOf,
  plusDays,
  renderLoanText,
  statusAfterRepayments,
} from '@/domain/intercompany/loan-rules'
import { notificationHref } from '@/domain/notifications'
import { DEFAULT_SEQUENCES, DOC_TYPES, formatDocNo, parseBusinessDate } from '@/domain/numbering'
import { REMINDER_EVENTS, REMINDER_RULES, reminderSettingsOf } from '@/domain/reminders/rules'
import { REPORT_CODES } from '@/domain/reports/registry'
import { RENUMBER_GUARDED_FUNCTIONS, RENUMBER_NEUTRAL_FUNCTIONS } from '@/migrations/20261013_610000_d1310_renumber'

/**
 * ADR 0029 (DRMS 13/10 Phase C) "Cek dana di persetujuan Owner + Pinjaman antar-PT" — pure rules (gap, commitments,
 * final step, loan transitions / actions / overdue / legs), the API contract (409 codes, capabilities, panel, inbox
 * badge, counterpart of a loan entry), the per-PT switch (group admin, not copied), numbering PJA, reminders, report,
 * the decision bar, migrations (enum own transaction, guards pinned, snapshot complete) and the renumber lists.
 * Pure; fictional data only.
 */

let config: SanitizedConfig
beforeAll(async () => {
  process.env.PK_SKIP_ENV_CHECK = 'true'
  config = await (await import('@/payload.config')).default
})

describe('ADR 0029 §1 "Dana tersedia" arithmetic', () => {
  it('gap = max(0, needed − available); negative availability counts in full', () => {
    expect(fundGap(100, 120)).toBe(0)
    expect(fundGap(100, 100)).toBe(0)
    expect(fundGap(150, 100)).toBe(50)
    expect(fundGap(10, -40)).toBe(50)
  })

  it('commitments (owner "setuju" #1): advance approved; reimburse approved / receipt_revision / receipts_verified; approved − transferred, never negative', () => {
    expect(isCommitted('advance', 'approved')).toBe(true)
    expect(isCommitted('advance', 'transferred')).toBe(false)
    expect(isCommitted('advance', 'pending_approval')).toBe(false) // first approved, first served
    for (const s of ['approved', 'receipt_revision', 'receipts_verified']) expect(isCommitted('reimburse', s), s).toBe(true)
    expect(isCommitted('reimburse', 'transferred')).toBe(false)
    expect(requestCommitment({ type: 'advance', status: 'approved', approvedAmount: 5_000_000, transferredTotal: 0 })).toBe(5_000_000)
    expect(requestCommitment({ type: 'reimburse', status: 'receipts_verified', approvedAmount: 2_000_000, transferredTotal: 500_000 })).toBe(1_500_000)
    expect(requestCommitment({ type: 'advance', status: 'approved', approvedAmount: 1, transferredTotal: 5 })).toBe(0)
    expect(requestCommitment({ type: 'advance', status: 'completed', approvedAmount: 9, transferredTotal: 0 })).toBe(0)
  })

  it('the lock key is the one the DB trigger uses', () => {
    expect(fundLockKey(7)).toBe('pk:fund:7')
    const guard = readFileSync(join(__dirname, '../../src/migrations/20261015_100200_d1310_fundcheck_guard.ts'), 'utf8')
    expect(guard).toContain("hashtextextended('pk:fund:' || NEW.company_id::text, 0)")
  })

  it('409 message names the three figures; disabled-button text', () => {
    expect(FUND_INSUFFICIENT).toBe('FUND_INSUFFICIENT')
    const m = fundInsufficientMessage('LAS', { available: 70_000_000, needed: 100_000_000 })
    expect(m).toContain('PT LAS')
    expect(m).toContain('Rp 70.000.000')
    expect(m).toContain('Rp 100.000.000')
    expect(m).toContain('kurang Rp 30.000.000')
    expect(blockedDecisionText(30_000_000)).toBe('Dana PT tidak cukup — kurang Rp 30.000.000. Tolak, atau perintahkan pinjaman antar-PT.')
  })
})

describe('ADR 0029 §1 where the check runs', () => {
  it('final step: pending_approval at the last level, a final "Diketahui" (no level), the Owner\'s Draft at submit', () => {
    expect(finalStepWaiting({ status: 'pending_approval', currentLevel: 2, lastLevel: 2 })).toBe(true)
    expect(finalStepWaiting({ status: 'pending_approval', currentLevel: 1, lastLevel: 2 })).toBe(false) // Direktur step: read-only panel
    expect(finalStepWaiting({ status: 'pending_ack', currentLevel: 0, lastLevel: 0 })).toBe(true)
    expect(finalStepWaiting({ status: 'pending_ack', currentLevel: 0, lastLevel: 1 })).toBe(false)
    expect(finalStepWaiting({ status: 'draft', lastLevel: null, ownerDraft: true })).toBe(true)
    expect(finalStepWaiting({ status: 'draft', lastLevel: null })).toBe(false)
    expect(finalStepWaiting({ status: 'approved', lastLevel: 2 })).toBe(false) // Finance transfer: no new block
    expect(panelApplies({ status: 'pending_approval' })).toBe(true)
    expect(panelApplies({ status: 'approved' })).toBe(false)
    expect(panelApplies({ status: 'draft' })).toBe(false)
    expect(panelApplies({ status: 'draft', ownerDraft: true })).toBe(true)
  })

  it('the Owner notification fires when the request ENTERS its final step (once per cycle), never for a no-approval snapshot', () => {
    const snap = { steps: [{ level: 1, approverRole: 'pk-owner', approverUserId: null }, { level: 2, approverRole: 'pk-principal', approverUserId: null }] } as never
    expect(enteredFinalStep({ status: 'pending_approval', currentLevel: 1 }, { status: 'pending_approval', currentLevel: 2, approvalSnapshot: snap })).toBe(true)
    expect(enteredFinalStep({ status: 'pending_approval', currentLevel: 2 }, { status: 'pending_approval', currentLevel: 2, approvalSnapshot: snap })).toBe(false)
    expect(enteredFinalStep({ status: 'draft' }, { status: 'pending_approval', currentLevel: 1, approvalSnapshot: snap })).toBe(false)
    const one = { steps: [{ level: 1, approverRole: 'pk-principal', approverUserId: null }] } as never
    expect(enteredFinalStep({ status: 'draft' }, { status: 'pending_approval', currentLevel: 1, approvalSnapshot: one })).toBe(true)
    const ackOnly = { steps: [] } as never
    expect(enteredFinalStep({ status: 'draft' }, { status: 'pending_ack', currentLevel: 0, approvalSnapshot: ackOnly })).toBe(true)
    expect(enteredFinalStep({ status: 'draft' }, { status: 'pending_approval', currentLevel: 0, approvalSnapshot: { steps: [], selfApproval: 'principal_no_approval' } as never })).toBe(false)
  })

  it('notification texts (editable template, event expense.fund_shortfall)', () => {
    const t = renderFundText(FUND_SHORTFALL_DEFAULT.title, { company: 'LAS', docNo: 'PB/LAS/2610/0012' })
    expect(t).toBe('Dana PT LAS tidak cukup: PB/LAS/2610/0012')
    expect(renderFundText(FUND_SHORTFALL_DEFAULT.body, { needed: 'Rp 1', available: 'Rp 0', gap: 'Rp 1' })).toContain('Perintahkan pinjaman antar-PT atau tolak')
  })

  it('decision bar: "Setujui" blocked with the reason while the panel says so; Tolak stays', () => {
    const base = { allowedActions: ['approve', 'reject'], currentLevel: 2, status: 'pending_approval', docNo: 'PB/X/2610/0001', grandTotal: 10 } as never
    const snap = { steps: [{ level: 1, approverRole: 'pk-owner', approverUserId: null }, { level: 2, approverRole: 'pk-principal', approverUserId: null }], decisionRoles: ['pk-owner', 'pk-principal'] } as never
    expect(decisionOf(base, snap)?.blocked).toBeNull()
    const d = decisionOf({ ...(base as object), fundCheck: { blocked: true, blockedText: 'Dana PT tidak cukup — kurang Rp 5.' } } as never, snap)
    expect(d).toMatchObject({ step: 'approve', canReject: true, blocked: 'Dana PT tidak cukup — kurang Rp 5.' })
  })
})

describe('ADR 0029 §3 loan rules', () => {
  it('statuses + labels (§3.3) and the moves of pk_icl_guard', () => {
    expect(IC_LOAN_STATUSES).toEqual(['instructed', 'disbursed', 'partially_repaid', 'repaid', 'cancelled'])
    expect(IC_LOAN_STATUS_LABELS.instructed).toBe('Menunggu pencairan')
    expect(IC_LOAN_STATUS_LABELS.repaid).toBe('Lunas')
    expect(canMove('instructed', 'disbursed')).toBe(true)
    expect(canMove('instructed', 'cancelled')).toBe(true)
    expect(canMove('disbursed', 'cancelled')).toBe(false) // only an instruction is cancelled
    expect(canMove('disbursed', 'instructed')).toBe(true) // void of the disbursement
    expect(canMove('repaid', 'partially_repaid')).toBe(true) // void of a repayment
    expect(canMove('cancelled', 'cancelled')).toBe(false)
    expect(IC_LOAN_MOVES.cancelled).toEqual([])
    const guard = readFileSync(join(__dirname, '../../src/migrations/20261015_100200_d1310_fundcheck_guard.ts'), 'utf8')
    expect(guard).toContain("(OLD.status = 'instructed' AND NEW.status IN ('disbursed', 'cancelled'))")
    expect(guard).toContain("(OLD.status = 'disbursed' AND NEW.status IN ('instructed', 'partially_repaid', 'repaid'))")
  })

  it('repayments (owner "setuju" #6): partial allowed, status follows repaid_total; outstanding only once disbursed', () => {
    expect(statusAfterRepayments(100, 0)).toBe('disbursed')
    expect(statusAfterRepayments(100, 40)).toBe('partially_repaid')
    expect(statusAfterRepayments(100, 100)).toBe('repaid')
    expect(outstandingOf({ status: 'instructed', amount: 100, repaidTotal: 0 })).toBe(0)
    expect(outstandingOf({ status: 'partially_repaid', amount: 100, repaidTotal: 40 })).toBe(60)
    expect(outstandingOf({ status: 'cancelled', amount: 100, repaidTotal: 0 })).toBe(0)
  })

  it('due date: default + 30 days, never before the instruction; overdue derived (no interest)', () => {
    expect(plusDays('2026-10-15', 30)).toBe('2026-11-14')
    expect(plusDays('2026-12-15', 30)).toBe('2027-01-14')
    expect(dueDateError('2026-10-15', '2026-10-14')).toMatch(/sebelum/)
    expect(dueDateError('2026-10-15', '2026-10-15')).toBeNull()
    const l = { status: 'disbursed' as const, dueDate: '2026-10-10', amount: 100, repaidTotal: 0 }
    expect(isOverdue(l, '2026-10-10')).toBe(false)
    expect(isOverdue(l, '2026-10-11')).toBe(true)
    expect(daysOverdue(l, '2026-10-13')).toBe(3)
    expect(isOverdue({ ...l, repaidTotal: 100, status: 'repaid' }, '2026-12-01')).toBe(false)
    expect(isOverdue({ ...l, status: 'instructed' }, '2026-12-01')).toBe(false)
  })

  it('§4 actions: Owner cancels; lender Finance disburses (never the creator, G1) and voids it without repayments; borrower Finance repays', () => {
    const none = { owner: false, financeLender: false, financeBorrower: false, creator: false }
    expect(icLoanAllowedActions('instructed', 0, { ...none, owner: true, creator: true })).toEqual(['cancel'])
    expect(icLoanAllowedActions('instructed', 0, { ...none, financeLender: true })).toEqual(['disburse'])
    expect(icLoanAllowedActions('instructed', 0, { ...none, financeLender: true, creator: true })).toEqual([]) // G1
    expect(icLoanAllowedActions('disbursed', 0, { ...none, financeLender: true })).toEqual(['void_disbursement'])
    expect(icLoanAllowedActions('disbursed', 0, { ...none, financeBorrower: true })).toEqual(['repay'])
    expect(icLoanAllowedActions('partially_repaid', 10, { ...none, financeLender: true })).toEqual([]) // LOAN_HAS_REPAYMENTS
    expect(icLoanAllowedActions('partially_repaid', 10, { ...none, financeBorrower: true })).toEqual(['repay', 'void_repayment'])
    expect(icLoanAllowedActions('repaid', 100, { ...none, financeBorrower: true })).toEqual(['void_repayment'])
    expect(icLoanAllowedActions('cancelled', 0, { owner: true, financeLender: true, financeBorrower: true, creator: false })).toEqual([])
  })

  it('accounting legs (§3.9): KK of a disbursement = given, KM = received; repayment KK = repaid_out, KM = repaid_in', () => {
    expect(legOf('intercompany_loan_disbursement', 'source')).toBe('given')
    expect(legOf('intercompany_loan_disbursement', 'target')).toBe('received')
    expect(legOf('intercompany_loan_repayment', 'source')).toBe('repaid_out')
    expect(legOf('intercompany_loan_repayment', 'target')).toBe('repaid_in')
  })

  it('codes + notification texts (no number of the other PT in a cash description; the loan texts are fine)', () => {
    expect([LOAN_LENDER_INSUFFICIENT, LOAN_HAS_REPAYMENTS, LOAN_VOID_BORROWER_SHORTFALL_CONFIRM_REQUIRED, LOAN_REPAYMENT_EXCEEDS_OUTSTANDING]).toEqual([
      'LOAN_LENDER_INSUFFICIENT',
      'LOAN_HAS_REPAYMENTS',
      'LOAN_VOID_BORROWER_SHORTFALL_CONFIRM_REQUIRED',
      'LOAN_REPAYMENT_EXCEEDS_OUTSTANDING',
    ])
    expect(Object.keys(IC_LOAN_NOTIFY_DEFAULTS).sort()).toEqual(['icloan.cancelled', 'icloan.disbursed', 'icloan.disbursement_voided', 'icloan.instructed', 'icloan.lender_insufficient', 'icloan.overdue', 'icloan.repaid'])
    expect(renderLoanText(IC_LOAN_NOTIFY_DEFAULTS['icloan.disbursed'].body, { docNo: 'PJA/DRMS/2610/0001', amount: 'Rp 5', lender: 'DRMS', borrower: 'LAS', requests: ' PB/LAS/2610/0012 siap disetujui.' })).toBe(
      'Dana pinjaman PJA/DRMS/2610/0001 Rp 5 dari PT DRMS masuk di PT LAS. PB/LAS/2610/0012 siap disetujui.',
    )
  })

  it('PJA numbering: doc type intercompany_loan, PJA/{COMPANY}/{YY}{MM}/#### (lender PT), monthly', () => {
    expect(DOC_TYPES).toContain('intercompany_loan')
    expect(IC_LOAN_DOC_TYPE).toBe('intercompany_loan')
    const s = DEFAULT_SEQUENCES.find((x) => x.docType === 'intercompany_loan')!
    expect(s).toMatchObject({ docCode: 'PJA', pattern: 'PJA/{COMPANY}/{YY}{MM}/{seq}', resetPolicy: 'monthly', padding: 4, startAt: 1 })
    expect(formatDocNo({ ...s, timezone: 'Asia/Makassar' }, 1, parseBusinessDate('2026-10-15'), 'DRMS')).toBe('PJA/DRMS/2610/0001')
  })

  it('links: notification + report cells open the loan detail', () => {
    expect(notificationHref('intercompany_loan', '9')).toBe('/admin/pinjaman-antar-pt/detail/9')
    expect(docHref('intercompany_loan', 9)).toBe('/admin/pinjaman-antar-pt/detail/9')
    expect(REPORT_CODES).toContain('pinjaman-antar-pt')
  })

  it('reminder ic_loan_overdue: daily, per borrower PT (default on)', () => {
    expect(REMINDER_RULES).toContain('ic_loan_overdue')
    expect(REMINDER_EVENTS.ic_loan_overdue).toBe('icloan.overdue')
    expect(reminderSettingsOf({}, 'Asia/Makassar').icLoanOverdue.enabled).toBe(true)
    expect(reminderSettingsOf({ reminderIcLoanOverdueEnabled: false }, 'Asia/Makassar').icLoanOverdue.enabled).toBe(false)
  })

  it('Kas: a loan leg is voided through the loan, a PT grup KM through the transfer (ADR 0028 unchanged)', () => {
    expect(voidHint({ sourceType: 'intercompany', status: 'posted' }, { sourceDocType: 'intercompany_loan' })).toMatch(/pinjaman antar-PT/)
    expect(voidHint({ sourceType: 'intercompany', status: 'posted' })).toBe('Di-void lewat pembatalan transfer di PT pengirim')
    expect(voidHint({ sourceType: 'intercompany', status: 'posted' }, { sourceDocType: 'expense_request' })).toBe('Di-void lewat pembatalan transfer di PT pengirim')
  })
})

describe('ADR 0029 §6 API contract', () => {
  it('instruction body: amount > 0 integer ≤ Rp 1 T, reason 3–1000, due date optional (default + 30), linked requests', () => {
    expect(IcLoanCreate.safeParse({ borrowerCompanyId: 2, lenderCompanyId: 1, amount: 30_000_000, reason: 'Dana pengajuan PB tertahan', requestIds: [5] }).success).toBe(true)
    expect(IcLoanCreate.safeParse({ borrowerCompanyId: 2, lenderCompanyId: 1, amount: 0, reason: 'xx kurang' }).success).toBe(false)
    expect(IcLoanCreate.safeParse({ borrowerCompanyId: 2, lenderCompanyId: 1, amount: 1.5, reason: 'pecahan' }).success).toBe(false)
    expect(IcLoanCreate.safeParse({ borrowerCompanyId: 2, lenderCompanyId: 1, amount: 2_000_000_000_000, reason: 'terlalu besar' }).success).toBe(false)
    expect(IcLoanCreate.safeParse({ borrowerCompanyId: 2, lenderCompanyId: 1, amount: 10, reason: 'ab' }).success).toBe(false)
    expect(IcLoanCreate.safeParse({ borrowerCompanyId: 2, lenderCompanyId: 1, amount: 10, reason: 'abc', interest: 1 }).success).toBe(false) // strict: no interest field
  })

  it('movement bodies: proof + bank ref + time; repayment has an amount; void of a disbursement may confirm the borrower shortfall', () => {
    const m = { cashAccountId: 3, bankRef: 'REF-1', proofMediaId: 9, transferAt: '2026-10-15T10:30' }
    expect(IcLoanDisburse.safeParse(m).success).toBe(true)
    expect(IcLoanDisburse.safeParse({ ...m, amount: 5 }).success).toBe(false) // amount = the loan amount, not sent
    expect(IcLoanRepay.safeParse({ ...m, amount: 5 }).success).toBe(true)
    expect(IcLoanRepay.safeParse(m).success).toBe(false)
    expect(IcLoanVoidDisbursement.safeParse({ reason: 'salah rekening', confirmBorrowerShortfall: true }).success).toBe(true)
  })

  it('request detail: fundCheck panel, `instruct_loan` action, approval fund figures; inbox `fundShort`', () => {
    expect(ActionEnum.options).toContain('instruct_loan')
    expect(
      FundCheck.safeParse({
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
        accountCount: 2,
        excludedSiteAccounts: { count: 1, balance: 5 },
        waitingAtOwner: { count: 0, amount: 0 },
        commitmentItems: [{ kind: 'loan', id: 1, docNo: 'PJA/LAS/2610/0001', amount: 10, status: 'instructed' }],
        loans: [],
      }).success,
    ).toBe(true)
    const item = (ApprovalInbox.shape.items.element as unknown as { shape: Record<string, unknown> }).shape
    expect(item).toHaveProperty('fundShort')
    expect(CashEntryIntercompany.shape).toHaveProperty('sourceDocType')
    expect(CashEntryIntercompany.shape).toHaveProperty('loanLeg')
  })

  it('/me capabilities: Owner (stored) instructs, Finance (stored) disburses, fundCheckEnabled per PT', () => {
    const user = withCompanyContext(
      { id: 7 },
      [
        { company: 1, roles: ['pk-principal'], employee: null },
        { company: 2, roles: ['pk-finance'], employee: null },
      ],
      null,
      false,
    )
    const req = { user } as never
    const c1 = meCapabilities(req, ['pk-principal', 'pk-owner'], { company: 1, fundCheckEnabled: true })
    expect(c1).toMatchObject({ instructIntercompanyLoan: true, disburseIntercompanyLoan: false, fundCheckEnabled: true })
    const c2 = meCapabilities(req, ['pk-finance'], { company: 2 })
    expect(c2).toMatchObject({ instructIntercompanyLoan: false, disburseIntercompanyLoan: true, fundCheckEnabled: false })
    expect(Capabilities.safeParse(c2).success).toBe(true)
    expect(Capabilities.safeParse({ ...capabilitiesOf(['pk-finance']), intercompanyPayment: true }).success).toBe(false) // the new fields are required
  })
})

describe('ADR 0029 config + migrations', () => {
  it('companies.fundCheckEnabled: default OFF, group admin only, NOT a copied setting; reminder switch per PT', () => {
    expect(FUND_CHECK_FIELD).toMatchObject({ name: 'fundCheckEnabled', type: 'checkbox', defaultValue: false })
    const access = (FUND_CHECK_FIELD as { access: { update: (a: unknown) => boolean } }).access
    const req = (groupAdmin: boolean) => ({ req: { user: withCompanyContext({ id: 1 }, [{ company: 1, roles: ['pk-admin', 'pk-owner'], employee: null }], null, groupAdmin) } })
    expect(access.update(req(false))).toBe(false)
    expect(access.update(req(true))).toBe(true)
    const names = settingDefaults().map((s) => s.name)
    expect(names).not.toContain('fundCheckEnabled')
    expect(names).toContain('reminderIcLoanOverdueEnabled')
    const companies = config.collections.find((c) => c.slug === 'companies')!
    expect(companies.flattenedFields.find((f) => f.name === 'fundCheckEnabled')).toMatchObject({ type: 'checkbox', defaultValue: false })
    const approvals = config.collections.find((c) => c.slug === 'approvals')!
    for (const n of ['fundBalance', 'fundCommitments', 'fundAvailable']) expect(approvals.flattenedFields.find((f) => f.name === n), n).toMatchObject({ type: 'number' })
  })

  it('audit action fund_insufficient; doc type option intercompany_loan', () => {
    expect(AUDIT_ACTIONS).toContain('fund_insufficient')
    const seq = config.collections.find((c) => c.slug === 'document-sequences')!
    expect((seq.flattenedFields.find((f) => f.name === 'docType') as { options: Array<{ value: string }> }).options.map((o) => o.value)).toContain('intercompany_loan')
  })

  it('migrations: enums (own transaction) → schema → guard → data; guards pinned; snapshot carries the new columns and every enum value', () => {
    const dir = join(__dirname, '../../src/migrations')
    const index = readFileSync(join(dir, 'index.ts'), 'utf8')
    const order = ['20261014_100300_d1310_intercompany_data', '20261015_100000_d1310_fundcheck_enums', '20261015_100100_d1310_fundcheck_loans', '20261015_100200_d1310_fundcheck_guard', '20261015_100300_d1310_fundcheck_data'].map((n) => index.indexOf(`name: '${n}'`))
    expect(order.every((i) => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    const enums = readFileSync(join(dir, '20261015_100000_d1310_fundcheck_enums.ts'), 'utf8')
    expect(enums).toContain(`"enum_document_sequences_doc_type" ADD VALUE IF NOT EXISTS 'intercompany_loan'`)
    expect(enums).toContain(`"enum_audit_logs_action" ADD VALUE IF NOT EXISTS 'fund_insufficient'`)
    const schema = readFileSync(join(dir, '20261015_100100_d1310_fundcheck_loans.ts'), 'utf8')
    expect(schema).toContain('ADD COLUMN "fund_check_enabled" boolean DEFAULT false')
    expect(schema).toContain('CREATE UNIQUE INDEX "intercompany_loans_doc_no_uq" ON "intercompany_loans" ("lender_company_id", "doc_no")')
    expect(schema).toContain(`CREATE UNIQUE INDEX "intercompany_loan_transfers_one_disbursement" ON "intercompany_loan_transfers" ("loan_id") WHERE "kind" = 'disbursement' AND "status" = 'posted'`)
    const guard = readFileSync(join(dir, '20261015_100200_d1310_fundcheck_guard.ts'), 'utf8')
    for (const s of [
      'CREATE OR REPLACE FUNCTION pk_fund_balance(cid integer)',
      'a.active IS NOT FALSE AND a.site_id IS NULL',
      "WHEN (OLD.status IN ('pending_ack', 'pending_approval') AND NEW.status = 'approved')",
      "CHECK (source_doc_type IN ('expense_request', 'intercompany_loan_disbursement', 'intercompany_loan_repayment'))",
      'NEW.executed_by_id = l.created_by_id',
      "pk_icl_has_role(NEW.created_by_id, NEW.lender_company_id, 'pk-principal')",
      'DEFERRABLE INITIALLY DEFERRED',
      "'ic_loan_overdue'",
    ])
      expect(guard, s).toContain(s)
    const snap = JSON.parse(readFileSync(join(dir, '20261015_100100_d1310_fundcheck_loans.json'), 'utf8')) as { id: string; enums: Record<string, { values: string[] }>; tables: Record<string, { columns: Record<string, unknown> }> }
    const prev = JSON.parse(readFileSync(join(dir, '20261014_100100_d1310_intercompany.json'), 'utf8')) as typeof snap
    expect(snap.id).not.toBe(prev.id)
    expect(snap.tables['public.companies']!.columns).toHaveProperty('fund_check_enabled')
    expect(snap.tables['public.companies']!.columns).toHaveProperty('reminder_ic_loan_overdue_enabled')
    for (const c of ['fund_balance', 'fund_commitments', 'fund_available']) expect(snap.tables['public.approvals']!.columns).toHaveProperty(c)
    expect(snap.enums['public.enum_document_sequences_doc_type']!.values).toContain('intercompany_loan')
    expect(snap.enums['public.enum_audit_logs_action']!.values).toContain('fund_insufficient')
    // the new snapshot keeps every enum value of the previous one (ADR 0028: pt_grup, intercompany …)
    for (const [k, e] of Object.entries(prev.enums)) for (const v of e.values) expect(snap.enums[k]?.values, `${k}.${v}`).toContain(v)
    for (const t of Object.keys(prev.tables)) expect(snap.tables, t).toHaveProperty([t])
  })

  it('renumber: the backstop trigger function is neutral (fires only on a status change into approved)', () => {
    expect(RENUMBER_NEUTRAL_FUNCTIONS).toContain('pk_expense_fund_guard')
    expect(RENUMBER_GUARDED_FUNCTIONS as readonly string[]).not.toContain('pk_expense_fund_guard')
  })
})
