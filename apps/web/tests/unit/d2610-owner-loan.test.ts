import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ApprovalInbox, ActionEnum } from '@/api/v1/schemas-flow'
import { LoanSummary, ProjectLoanInstruct, ProjectLoanInstructionInfo } from '@/api/v1/schemas-loans'
import { awaitingLoanText, blockedDecisionText, effectiveAvailable, FUND_SHORTFALL_PB_DEFAULT, FUND_SHORTFALL_PB_EVENT, fundRoute, renderFundText } from '@/domain/fundcheck/rules'
import { instructAmountError, instructedLoanReason, LENDER_REASON_TEXTS, lenderCandidateReason, LOAN_SUBMITTER_ROLES, loanOriginLabel } from '@/domain/loans/rules'
import { LOAN_NOTIFICATION_DEFAULTS, renderLoanText } from '@/domain/loans/service'
import { migrations } from '@/migrations'

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

/** DRMS 26/10 #1 (ADR 0031 amendment 2026-10-26): the project's cash account only + "Instruksi pinjam antar proyek". */
describe('d2610 fund rule: a mapped project is checked against its cash account only', () => {
  it('the PT no longer covers a short account; per PT unchanged without one', () => {
    expect(effectiveAvailable(500, 10)).toBe(10)
    expect(effectiveAvailable(500, null)).toBe(500)
    expect(fundRoute(30, 500, 10)).toBe('short')
    expect(fundRoute(10, -50, 10)).toBe('pusat_biaya')
    expect(fundRoute(30, 500, null)).toBe('pt')
  })

  it('texts: the account, the way out, the waiting loan, the Owner notification', () => {
    expect(blockedDecisionText(20_000_000, 'Kas Contoh A')).toBe('Dana bebas akun kas Kas Contoh A tidak cukup — kurang Rp 20.000.000. Tolak, atau Owner menginstruksikan pinjaman antar proyek ke akun ini lalu menyetujui setelah Finance mentransfernya.')
    expect(awaitingLoanText('PJ/Q/2610/0001', 5_000, 'Kas A')).toBe('Dana bebas akun kas Kas A kurang Rp 5.000. Pinjaman PJ/Q/2610/0001 menunggu transfer Finance — setujui setelah transfer dieksekusi.')
    expect(FUND_SHORTFALL_PB_EVENT).toBe('expense.fund_shortfall_account')
    expect(renderFundText(FUND_SHORTFALL_PB_DEFAULT.title, { account: 'Kas A', docNo: 'PB/Q/1' })).toBe('Dana akun kas Kas A tidak cukup: PB/Q/1')
    expect(renderLoanText(LOAN_NOTIFICATION_DEFAULTS['project_loan.request_ready'].title, { requestNo: 'PB/Q/1' })).toBe('Pengajuan siap disetujui: PB/Q/1')
    expect(LOAN_NOTIFICATION_DEFAULTS['project_loan.owner_instructed'].body).toContain('{requestNo}')
  })
})

describe('d2610 instruction rules', () => {
  const base = { accountId: 7, accountActive: true, borrowerAccountId: 3, available: 50, minAmount: 20 }
  it('lender candidates: own active account ≠ borrower, dana bebas ≥ the shortfall', () => {
    expect(lenderCandidateReason(base)).toBeNull()
    expect(lenderCandidateReason({ ...base, accountId: null })).toBe('no_account')
    expect(lenderCandidateReason({ ...base, accountActive: false })).toBe('inactive_account')
    expect(lenderCandidateReason({ ...base, accountId: 3 })).toBe('same_account')
    expect(lenderCandidateReason({ ...base, available: 19 })).toBe('insufficient')
    expect(lenderCandidateReason({ ...base, available: 20 })).toBeNull()
    for (const t of Object.values(LENDER_REASON_TEXTS)) expect(t).toMatch(/\.$/)
  })

  it('amount: shortfall ≤ amount ≤ the lender dana bebas, whole Rupiah', () => {
    expect(instructAmountError(20, { min: 20, max: 50 })).toBeNull()
    expect(instructAmountError(50, { min: 20, max: 50 })).toBeNull()
    expect(instructAmountError(19, { min: 20, max: 50 })?.message).toBe('Nilai pinjaman minimal Rp 20 (kekurangan dana akun kas pengajuan).')
    expect(instructAmountError(51, { min: 20, max: 50 })?.message).toBe('Nilai pinjaman melebihi dana bebas akun kas pemberi (Rp 50).')
    expect(instructAmountError(1.5, { min: 1, max: 50 })?.path).toBe('amount')
    expect(instructAmountError(0, { min: 0, max: 50 })?.path).toBe('amount')
  })

  it('the loan: submitter role owner, "Instruksi Owner", the reason names the request', () => {
    expect(LOAN_SUBMITTER_ROLES).toContain('owner')
    expect(loanOriginLabel('manual', 'owner')).toBe('Instruksi Owner')
    expect(loanOriginLabel('manual', 'finance')).toBe('Diajukan Finance')
    expect(loanOriginLabel('transfer', 'owner')).toBe('Otomatis dari transfer')
    expect(instructedLoanReason('  Termin belum cair ', 'PB/Q/2610/0001')).toBe('Termin belum cair (instruksi Owner untuk pengajuan PB/Q/2610/0001)')
    expect(instructedLoanReason('x'.repeat(2000), 'PB/1')).toHaveLength(1000)
  })
})

describe('d2610 API contract', () => {
  it('action, inbox fields, loan link, the instruction bodies', () => {
    expect(ActionEnum.options).toContain('instruct_project_loan')
    const item = (ApprovalInbox.shape.items.element as unknown as { shape: Record<string, unknown> }).shape
    expect(item).toHaveProperty('instructProjectLoan')
    expect(item).toHaveProperty('projectLoanPending')
    expect(LoanSummary.shape).toHaveProperty('expenseRequest')
    expect(ProjectLoanInstruct.safeParse({ lenderProjectId: 3, amount: 1_000, reason: 'Termin belum cair' }).success).toBe(true)
    expect(ProjectLoanInstruct.safeParse({ lenderProjectId: 3, amount: 1_000, reason: 'x' }).success).toBe(false)
    expect(ProjectLoanInstruct.safeParse({ lenderProjectId: 3, amount: 1_000, reason: 'Termin', dueDate: '2026-11-25', extra: 1 }).success).toBe(false)
    const info = {
      requestId: 1,
      docNo: 'PB/Q/2610/0001',
      title: 'Material',
      companyId: 2,
      borrowerProject: { id: 5, code: 'Q-A', name: 'Proyek A' },
      borrowerAccount: { id: 3, name: 'Kas A', balance: 10, commitments: 0, available: 10 },
      needed: 30,
      shortfall: 20,
      minAmount: 20,
      loanDate: '2026-10-26',
      defaultDueDate: '2026-11-25',
      canInstruct: true,
      cannotReason: null,
      pendingLoan: null,
      candidates: [{ project: { id: 6, code: 'Q-B', name: 'Proyek B' }, account: { id: 7, name: 'Kas B' }, available: 100, eligible: true, reason: null, reasonText: null }],
    }
    expect(ProjectLoanInstructionInfo.safeParse(info).success).toBe(true)
    expect(ProjectLoanInstructionInfo.safeParse({ ...info, candidates: [{ ...info.candidates[0], reason: 'other' }] }).success).toBe(false)
  })

  it('openapi registers both paths', () => {
    const o = src('src/api/v1/openapi.ts')
    expect(o).toContain("path: '/expense-requests/{id}/project-loan-lenders'")
    expect(o).toContain("path: '/expense-requests/{id}/project-loan'")
    const e = src('src/api/v1/endpoints/expense-requests.ts')
    expect(e).toContain('projectLoanLendersEndpoint,\n  instructProjectLoanEndpoint,')
  })
})

describe('d2610 migrations', () => {
  it('three migrations in order (enum → schema → guard), after the 24/10 ones', () => {
    const names = migrations.map((m) => m.name)
    const i = names.indexOf('20261026_100000_d2610_owner_loan_enums')
    expect(i).toBeGreaterThan(names.indexOf('20261024_510000_d2410_delete_draft_invoice'))
    expect(names.slice(i, i + 3)).toEqual(['20261026_100000_d2610_owner_loan_enums', '20261026_100100_d2610_owner_loan_schema', '20261026_100200_d2610_owner_loan_guard'])
    expect([...names].sort()).toEqual(names)
  })

  it('snapshot: the FK column + index + enum value; previous enum values kept', () => {
    const dir = join(process.cwd(), 'src/migrations')
    const snap = JSON.parse(readFileSync(join(dir, '20261026_100100_d2610_owner_loan_schema.json'), 'utf8')) as { id: string; enums: Record<string, { values: string[] }>; tables: Record<string, { columns: Record<string, unknown>; indexes: Record<string, unknown>; foreignKeys: Record<string, unknown> }> }
    const prev = JSON.parse(readFileSync(join(dir, '20261024_400100_d2410_loan_schema.json'), 'utf8')) as typeof snap
    expect(snap.id).not.toBe(prev.id)
    const t = snap.tables['public.project_loans']!
    expect(t.columns).toHaveProperty('expense_request_id')
    expect(t.indexes).toHaveProperty('project_loans_expense_request_idx')
    expect(t.foreignKeys).toHaveProperty('project_loans_expense_request_id_expense_requests_id_fk')
    expect(snap.enums['public.enum_project_loans_submitter_role']!.values).toEqual(['pm', 'finance', 'owner'])
    for (const [k, e] of Object.entries(prev.enums)) for (const v of e.values) expect(snap.enums[k]?.values, `${k}.${v}`).toContain(v)
    const schema = src('src/migrations/20261026_100100_d2610_owner_loan_schema.ts')
    expect(schema).toContain('ADD COLUMN "expense_request_id" integer')
    expect(src('src/migrations/20261026_100000_d2610_owner_loan_enums.ts')).toContain(`ADD VALUE IF NOT EXISTS 'owner' AFTER 'finance'`)
  })

  it('guard: account-only fund rule, the instruction check, the guard keeps its prelude, lock order', () => {
    const g = src('src/migrations/20261026_100200_d2610_owner_loan_guard.ts')
    expect(g).toContain('ELSE pk_pb_balance(x.aid) - pk_pb_commitments(x.aid) END')
    expect(g).toContain('PERFORM pk_project_loan_instruction_check(NEW);')
    expect(g).toContain('sql.raw(withPrelude(LOANS_GUARD_NEW))')
    expect(g).toContain(`pg_advisory_xact_lock(hashtextextended('pk:fund:' || l.company_id::text, 0))`)
    expect(g).toContain("pk_protect_columns('expense_request_id')")
    expect(g).toContain("WHERE expense_request_id IS NOT NULL AND status = 'approved' AND disbursed_at IS NULL")
  })

  it('services: lock order request → fund lock; the lender re-checked at the execution', () => {
    const oi = src('src/domain/loans/owner-instruct.ts')
    expect(oi.indexOf('loadVisible(req, id, { lock: opts.lock })')).toBeLessThan(oi.indexOf('await lockFunds(req, [companyId!])'))
    const s = src('src/domain/loans/service.ts')
    expect(s).toContain('if (requestId !== undefined) await recheckInstructedLender(req, fresh)')
  })
})
