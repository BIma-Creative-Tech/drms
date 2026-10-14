import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { rolesIn, rolesOf, withCompanyContext, type Role } from '@/access/roles'
import { previewQuery } from '@/admin/components/bank-preview-query'
import { intercompanyOptionLabel, payeesQuery } from '@/admin/components/intercompany-payee'
import { ExpenseRequestCreate, IntercompanyPayeesQuery, PayeeTypeEnum, CashSourceTypeEnum } from '@/api/v1/schemas-flow'
import { SyncDraftUpsertPayload } from '@/api/v1/schemas-sync'
import { Capabilities, MASTER_TYPES } from '@/api/v1/schemas'
import { capabilitiesOf, meCapabilities } from '@/api/v1/endpoints/me'
import { directPayee, employeePayee, intercompanyPayee, isIntercompanyForm, vendorPayee } from '@/collections/expense-request-form'
import { vendorCostCenterAccess } from '@/collections/ExpenseRequests'
import { bookWhere, canEdit, canVoid, parseBookQuery, voidHint } from '@/domain/cash/book'
import { SYSTEM_CASH_IN_SOURCES } from '@/domain/company-defaults'
import type { TimelineSnapshot } from '@/domain/expense/approval-timeline'
import type { RequestDoc } from '@/domain/expense/common'
import { INTERCOMPANY_PAYMENT_ROLES, payeeFilerRoles, VENDOR_PAYMENT_ROLES, vendorData, vendorOfDoc } from '@/domain/expense/drafts'
import { duplicateDraftInput } from '@/domain/expense/duplicate'
import { buildRequestStepper, INTERCOMPANY_END_NOTE, type StepperInput } from '@/domain/expense/request-stepper'
import { payeeCondition, ruleMatches, selectRule, type RuleInput } from '@/domain/expense/rules'
import { allowedActions, targets, type ActorContext } from '@/domain/expense/state'
import { nextActor, timeline, VENDOR_STATUS_PATH } from '@/domain/expense/timeline'
import { INTERCOMPANY_PAYMENT_LABEL, isDirectPayment, PAYEE_TYPE_LABELS, PAYEE_TYPES, payeeOf, requestKindLabel, VENDOR_FORBIDDEN_STATUSES } from '@/domain/expense/types'
import { INTERCOMPANY_CASH_IN_SOURCE, INTERCOMPANY_LINK_DOC_TYPE, maskAccount } from '@/domain/intercompany/service'
import { eventsFor, notificationHref } from '@/domain/notifications'
import { RENUMBER_GUARDED_FUNCTIONS, RENUMBER_NEUTRAL_FUNCTIONS } from '@/migrations/20261013_610000_d1310_renumber'
import { INTERCOMPANY_FINANCE_RULE, INTERCOMPANY_SOURCE } from '@/migrations/20261014_100300_d1310_intercompany_data'
import { DEFAULT_APPROVAL_RULES, DIREKTUR_RULE_NAME, INTERCOMPANY_FINANCE_RULE_NAME, VENDOR_FINANCE_RULE_NAME } from '@/seed/data'

/**
 * ADR 0028 (DRMS 13/10 Phase B) "Pembayaran antar-PT" (payee type PT grup): vocabulary, state machine (no LPJ path),
 * rule engine (Finance → seeded rule, Direktur → "Pengajuan Direktur"), filer roles (owner 2026-10-14: Finance, PM,
 * Direktur), notification fix after a voided transfer, stepper / timeline, form conditions, Kas rules, API contract,
 * migrations, config. Pure; fictional data only.
 */

let config: SanitizedConfig
beforeAll(async () => {
  process.env.PK_SKIP_ENV_CHECK = 'true'
  config = await (await import('@/payload.config')).default
})

const ctx = (over: Partial<ActorContext> = {}): ActorContext => ({
  type: 'advance',
  payeeType: 'pt_grup',
  status: 'approved',
  roles: ['pk-finance'] as Role[],
  isCreator: false,
  isRequester: false,
  hasDecision: true,
  isAcknowledger: false,
  matchesCurrentStep: false,
  alreadyDecided: false,
  ...over,
})

describe('ADR 0028 vocabulary', () => {
  it('payee type pt_grup ("PT grup"), kind label "Pembayaran antar-PT", a payment without LPJ', () => {
    expect(PAYEE_TYPES).toEqual(['karyawan', 'vendor', 'pt_grup'])
    expect(PAYEE_TYPE_LABELS.pt_grup).toBe('PT grup')
    expect(payeeOf('pt_grup')).toBe('pt_grup')
    expect(payeeOf('vendor')).toBe('vendor')
    expect(payeeOf('PT_GRUP')).toBe('karyawan')
    expect(isDirectPayment('pt_grup')).toBe(true)
    expect(isDirectPayment('vendor')).toBe(true)
    expect(isDirectPayment('karyawan')).toBe(false)
    expect(isDirectPayment(undefined)).toBe(false)
    expect(INTERCOMPANY_PAYMENT_LABEL).toBe('Pembayaran antar-PT')
    expect(requestKindLabel('advance', 'pt_grup')).toBe('Pembayaran antar-PT')
    expect(requestKindLabel('reimburse', 'pt_grup')).toBe('Pembayaran antar-PT')
  })

  it('masked account and payee directory option label', () => {
    expect(maskAccount('1234567890')).toBe('••••7890')
    expect(maskAccount(null)).toBe('')
    expect(intercompanyOptionLabel({ companyId: 2, shortCode: 'LAS', name: 'PT Contoh Las', bankName: 'Bank Mandiri', accountNoMasked: '••••7890', accountHolder: 'PT Contoh Las' })).toBe('LAS — PT Contoh Las · Bank Mandiri ••••7890 a.n. PT Contoh Las')
    expect(intercompanyOptionLabel({ companyId: 2, shortCode: 'LAS', name: 'PT Contoh Las', bankName: null, accountNoMasked: '', accountHolder: '' })).toBe('LAS — PT Contoh Las')
    expect(payeesQuery(3)).toBe('/api/v1/intercompany/payees?company=3')
    expect(INTERCOMPANY_LINK_DOC_TYPE).toBe('intercompany_link')
  })
})

describe('ADR 0028 state machine: the transfer completes a PT grup payment, no LPJ path', () => {
  it('transfer approved → completed; void completed → approved', () => {
    expect(targets('advance', 'approved', 'transfer', 'pt_grup')).toEqual(['completed'])
    expect(targets('advance', 'completed', 'transfer_void', 'pt_grup')).toEqual(['approved'])
    expect(targets('advance', 'completed', 'settle_reverse', 'pt_grup')).toEqual([])
    for (const a of ['receipts_complete', 'lpj_submit', 'lpj_request_revision', 'lpj_verify', 'settle'] as const) {
      for (const from of VENDOR_FORBIDDEN_STATUSES) expect(targets('advance', from, a, 'pt_grup'), `${a} from ${from}`).toEqual([])
    }
  })

  it('Finance transfers and voids; the filer never gets LPJ actions', () => {
    expect(allowedActions(ctx())).toContain('transfer')
    expect(allowedActions(ctx({ status: 'completed' }))).toContain('transfer_void')
    expect(allowedActions(ctx({ status: 'completed' }))).not.toContain('settle_reverse')
    expect(allowedActions(ctx({ status: 'completed', roles: ['pk-pm'] as Role[], isCreator: true, isRequester: true }))).toEqual([])
  })
})

describe('ADR 0028 filer roles (owner decision 2026-10-14)', () => {
  it('PT grup: Finance, PM and Direktur — never Staff, Admin or Owner (pk-principal) alone; vendor stays Finance + PM', () => {
    expect([...INTERCOMPANY_PAYMENT_ROLES].sort()).toEqual(['pk-finance', 'pk-owner', 'pk-pm'])
    for (const r of ['pk-staff', 'pk-admin', 'pk-principal', 'pk-operator'] as const) expect(INTERCOMPANY_PAYMENT_ROLES).not.toContain(r)
    expect(payeeFilerRoles('pt_grup')).toBe(INTERCOMPANY_PAYMENT_ROLES)
    expect(payeeFilerRoles('vendor')).toBe(VENDOR_PAYMENT_ROLES)
    expect([...VENDOR_PAYMENT_ROLES].sort()).toEqual(['pk-finance', 'pk-pm'])
  })
})

describe('ADR 0028 rule engine: "Jenis penerima" PT grup', () => {
  const base: RuleInput = { id: 1, name: 'Default', docType: 'expense_request', requestType: 'any', minAmount: 0, maxAmount: null, priority: 100, acknowledge: 'required', acknowledgeBy: 'scope_manager', steps: [{ level: 1, approverRole: 'pk-owner' }, { level: 2, approverRole: 'pk-principal' }] }
  const direktur: RuleInput = { ...base, id: 2, name: DIREKTUR_RULE_NAME, priority: 10, requesterRoles: ['pk-owner'], acknowledge: 'none', acknowledgeBy: 'role', steps: [{ level: 1, approverRole: 'pk-principal' }] }
  const vendorFinance: RuleInput = { ...base, id: 3, name: VENDOR_FINANCE_RULE_NAME, priority: 20, payeeType: 'vendor', requesterRoles: ['pk-finance'], acknowledge: 'none', acknowledgeBy: 'role' }
  const icFinance: RuleInput = { ...base, id: 4, name: INTERCOMPANY_FINANCE_RULE_NAME, priority: 20, payeeType: 'pt_grup', requesterRoles: ['pk-finance'], acknowledge: 'none', acknowledgeBy: 'role' }
  const rules = [base, direktur, vendorFinance, icFinance]
  const facts = (payeeType: 'karyawan' | 'vendor' | 'pt_grup', roles: Role[][]) => ({ type: 'advance' as const, grandTotal: 7_500_000, categoryIds: [], projectId: 3, payeeType, requesterRoles: roles })

  it('payeeCondition knows pt_grup', () => {
    expect(payeeCondition({ payeeType: 'pt_grup' })).toBe('pt_grup')
    expect(payeeCondition({ payeeType: 'any' })).toBeNull()
  })

  it('Finance → "Pembayaran antar-PT oleh Finance — Direktur lalu Owner"; the vendor rule never matches a PT grup payment', () => {
    expect(selectRule(rules, facts('pt_grup', [['pk-finance']]))?.name).toBe(INTERCOMPANY_FINANCE_RULE_NAME)
    expect(ruleMatches(vendorFinance, facts('pt_grup', [['pk-finance']]))).toBe(false)
    expect(selectRule(rules, facts('vendor', [['pk-finance']]))?.name).toBe(VENDOR_FINANCE_RULE_NAME)
    expect(selectRule(rules, facts('karyawan', [['pk-finance']]))?.id).toBe(1)
  })

  it('Direktur → "Pengajuan Direktur" (→ Owner), also when he holds Finance too (priority 10 < 20); PM → the default rule', () => {
    expect(selectRule(rules, facts('pt_grup', [['pk-owner']]))?.name).toBe(DIREKTUR_RULE_NAME)
    expect(selectRule(rules, facts('pt_grup', [['pk-owner', 'pk-finance']]))?.name).toBe(DIREKTUR_RULE_NAME)
    expect(selectRule(rules, facts('pt_grup', [['pk-pm']]))?.id).toBe(1)
  })

  it('seed: the PT grup Finance rule (Jenis penerima pt_grup, Peran pemohon Finance, Direktur then Owner, no Diketahui, priority 20)', () => {
    const r = DEFAULT_APPROVAL_RULES.find((x) => x.name === INTERCOMPANY_FINANCE_RULE_NAME) as unknown as RuleInput
    expect(r).toMatchObject({ docType: 'expense_request', payeeType: 'pt_grup', requesterRoles: ['pk-finance'], acknowledge: 'none', priority: 20, active: true })
    expect(r.steps).toEqual([
      { level: 1, approverRole: 'pk-owner' },
      { level: 2, approverRole: 'pk-principal' },
    ])
    // the data migration seeds the same name (frozen copy)
    expect(INTERCOMPANY_FINANCE_RULE).toBe(INTERCOMPANY_FINANCE_RULE_NAME)
  })
})

describe('ADR 0028 notifications', () => {
  const doc = (payeeType: 'vendor' | 'pt_grup' | 'karyawan') => ({ id: 1, type: 'advance', status: 'approved', title: 'x', payeeType }) as never

  it('a voided vendor / PT grup transfer (Selesai → Disetujui) tells Finance "antri transfer" — not "Disetujui" to the people', () => {
    expect(eventsFor({ status: 'completed' }, doc('pt_grup'))).toEqual([{ event: 'expense.transfer_queue', to: 'finance' }])
    expect(eventsFor({ status: 'completed' }, doc('vendor'))).toEqual([{ event: 'expense.transfer_queue', to: 'finance' }])
    // a first approval still informs the people and Finance
    expect(eventsFor({ status: 'pending_approval' }, doc('pt_grup'))).toEqual([
      { event: 'expense.approved', to: 'people' },
      { event: 'expense.transfer_queue', to: 'finance' },
    ])
  })

  it('the receiving PT\'s notification opens the cash entry', () => {
    expect(notificationHref('cash_entry', '42')).toBe('/admin/collections/cash-entries/42')
    expect(notificationHref('cash_entry', 'x')).toBeNull()
  })
})

const SNAP: TimelineSnapshot = {
  acknowledge: 'none',
  acknowledgeBy: 'role',
  acknowledgerUserId: null,
  acknowledgeRole: null,
  decisionRoles: ['pk-owner', 'pk-principal'] as Role[],
  steps: [
    { level: 1, approverRole: 'pk-owner', approverUserId: null },
    { level: 2, approverRole: 'pk-principal', approverUserId: null },
  ],
}
const input = (over: Partial<StepperInput> = {}): StepperInput => ({
  type: 'advance',
  payeeType: 'pt_grup',
  status: 'completed',
  approvalCycle: 1,
  currentLevel: 2,
  submittedAt: '2026-10-14T01:00:00.000Z',
  snapshot: SNAP,
  approvals: [{ cycle: 1, position: 'diajukan', level: 0, actorName: 'Finance Contoh', onBehalf: false, decision: 'signed', reason: null, decidedAt: '2026-10-14T01:00:00.000Z' }],
  transfers: [{ docNo: 'TRF/AAA/2610/0001', kind: 'advance', amount: 1, transferDate: '2026-10-14', status: 'posted' }],
  requesters: 'Finance Contoh',
  createdBy: 'Finance Contoh',
  names: {},
  settlement: null,
  ...over,
})

describe('ADR 0028 stepper / timeline: no LPJ step', () => {
  it('Selesai with the intercompany note, no "Nota & LPJ" / "Penyelesaian LPJ"', () => {
    const st = buildRequestStepper(input())
    expect(st.steps.some((s) => s.key === 'lpj' || s.key === 'settlement')).toBe(false)
    expect(st.steps.find((s) => s.key === 'end')).toMatchObject({ state: 'done', note: INTERCOMPANY_END_NOTE })
    expect(buildRequestStepper(input({ payeeType: 'karyawan' })).steps.some((s) => s.key === 'lpj')).toBe(true)
  })

  it('status path = the vendor path (approved → completed); next actor texts', () => {
    expect(timeline('advance', 'approved', { payeeType: 'pt_grup' }).map((s) => s.status)).toEqual(VENDOR_STATUS_PATH)
    expect(timeline('advance', 'approved', { payeeType: 'pt_grup', skipAck: true }).map((s) => s.status)).toEqual(['draft', 'pending_approval', 'approved', 'completed'])
    expect(nextActor({ type: 'advance', payeeType: 'pt_grup', status: 'approved', currentLevel: null, snapshot: null, requesters: '', names: {} })?.what).toMatch(/rekening penerimaan antar-PT/)
    expect(nextActor({ type: 'advance', payeeType: 'pt_grup', status: 'draft', currentLevel: null, snapshot: null, requesters: '', names: {} })?.what).toMatch(/PT penerima/)
  })
})

describe('ADR 0028 drafts: payee columns', () => {
  const doc = { id: 6, type: 'advance', status: 'rejected', title: 'Jasa antar PT', payeeType: 'pt_grup', payeeCompany: { id: 2 }, invoiceNo: 'MEMO-7', invoiceDate: '2026-10-01', invoiceDueDate: null, invoiceFile: 12, requesters: [3], lines: [] } as unknown as RequestDoc

  it('vendorOfDoc / vendorData round trip: the receiving PT + its document; no vendor columns', () => {
    expect(vendorOfDoc(doc)).toEqual({ payeeType: 'pt_grup', vendorId: null, vendorBankAccountId: null, payeeCompanyId: 2, invoiceNo: 'MEMO-7', invoiceDate: '2026-10-01', invoiceDueDate: null, invoiceFileId: 12 })
    expect(vendorData({ ...vendorOfDoc(doc), vendorId: 9 }, 'pt_grup')).toEqual({ payeeType: 'pt_grup', vendor: null, vendorBankAccount: null, payeeCompany: 2, invoiceNo: 'MEMO-7', invoiceDate: '2026-10-01', invoiceDueDate: null, invoiceFile: 12 })
    expect(vendorData({ payeeCompanyId: 2 }, 'vendor').payeeCompany).toBeNull()
    expect(vendorData({ payeeCompanyId: 2, invoiceNo: 'X' }, 'karyawan')).toMatchObject({ payeeCompany: null, invoiceNo: null })
  })

  it('cost center writable like a vendor payment; "Duplikat" keeps the receiving PT, never the document', () => {
    expect(vendorCostCenterAccess({ data: { payeeType: 'pt_grup' } })).toBe(true)
    const d = duplicateDraftInput(doc)
    expect(d).toMatchObject({ payeeType: 'pt_grup', payeeCompanyId: 2 })
    expect(d).not.toHaveProperty('invoiceNo')
    expect(d).not.toHaveProperty('invoiceFileId')
    expect(duplicateDraftInput({ ...doc, project: null, costCenter: 8 } as unknown as RequestDoc)).toMatchObject({ costCenterId: 8 })
  })
})

describe('ADR 0028 web form conditions and preview', () => {
  const yes = () => true
  it('PT penerima only for PT grup; document fields for vendor AND PT grup; no Pemohon / employee account', () => {
    expect(isIntercompanyForm({ payeeType: 'pt_grup' })).toBe(true)
    expect(isIntercompanyForm({ payeeType: 'vendor' })).toBe(false)
    expect(intercompanyPayee(yes)({ payeeType: 'pt_grup' }, {}, {} as never)).toBe(true)
    expect(intercompanyPayee(yes)({ payeeType: 'vendor' }, {}, {} as never)).toBe(false)
    expect(directPayee(yes)({ payeeType: 'pt_grup' }, {}, {} as never)).toBe(true)
    expect(directPayee(yes)({ payeeType: 'vendor' }, {}, {} as never)).toBe(true)
    expect(directPayee(yes)({ payeeType: 'karyawan' }, {}, {} as never)).toBe(false)
    expect(employeePayee(yes)({ payeeType: 'pt_grup' }, {}, {} as never)).toBe(false)
    expect(employeePayee(yes)({ payeeType: 'karyawan' }, {}, {} as never)).toBe(true)
    expect(vendorPayee(yes)({ payeeType: 'pt_grup' }, {}, {} as never)).toBe(false)
  })

  it('bank preview query: a PT grup draft previews the receiving PT (`payeeCompany`)', () => {
    expect(previewQuery({ requestId: 4, accountId: 7, draft: true, intercompany: true })).toBe('/api/v1/bank-account-preview?request=4&payeeCompany=7')
    expect(previewQuery({ requestId: null, accountId: 7, draft: true, intercompany: true })).toBe('/api/v1/bank-account-preview?payeeCompany=7')
    expect(previewQuery({ requestId: 4, accountId: 7, draft: false, intercompany: true })).toBe('/api/v1/bank-account-preview?request=4')
  })
})

describe('ADR 0028 Kas rules', () => {
  const e = (over: Partial<{ sourceType: 'intercompany' | 'manual' | 'transfer'; status: 'posted' | 'void'; entryDate: string }> = {}) => ({ sourceType: 'intercompany' as const, status: 'posted' as const, entryDate: '2026-10-10', ...over })

  it('the automatic KM is neither editable nor voidable from the cash book (hint names the paying PT\'s transfer)', () => {
    expect(canVoid(e())).toBe(false)
    expect(canEdit(e(), null)).toBe(false)
    expect(voidHint(e())).toBe('Di-void lewat pembatalan transfer di PT pengirim')
    expect(voidHint(e({ status: 'void' }))).toBeNull()
  })

  it('"Sumber" filter of the Kas list', () => {
    const q = parseBookQuery({ sumber: 'intercompany,bogus' })
    expect(q).toEqual({ sumber: ['intercompany'], hal: 1 })
    expect(bookWhere(q)).toEqual({ and: [{ sourceType: { in: ['intercompany'] } }] })
  })

  it('system cash-in source "Antar PT" (code ANTAR-PT) next to LPJ; same code as the data migration', () => {
    expect(SYSTEM_CASH_IN_SOURCES).toContainEqual({ code: 'ANTAR-PT', name: 'Antar PT' })
    expect(INTERCOMPANY_CASH_IN_SOURCE).toEqual({ code: 'ANTAR-PT', name: 'Antar PT' })
    expect(INTERCOMPANY_SOURCE).toEqual(INTERCOMPANY_CASH_IN_SOURCE)
  })
})

describe('ADR 0028 API contract', () => {
  it('PayeeType + create body + sync payload + payee directory query + cash source types + masters type', () => {
    expect(PayeeTypeEnum.safeParse('pt_grup').success).toBe(true)
    expect(PayeeTypeEnum.safeParse('pt').success).toBe(false)
    expect(ExpenseRequestCreate.safeParse({ type: 'advance', title: 'Jasa antar PT', payeeType: 'pt_grup', payeeCompanyId: 2, invoiceNo: 'MEMO-1' }).success).toBe(true)
    expect(SyncDraftUpsertPayload.safeParse({ payee_type: 'pt_grup', payee_company_id: 2 }).success).toBe(true)
    expect(SyncDraftUpsertPayload.safeParse({ payee_company_id: null }).success).toBe(true)
    expect(IntercompanyPayeesQuery.safeParse({ company: '3' })).toMatchObject({ success: true, data: { company: 3 } })
    expect(IntercompanyPayeesQuery.safeParse({}).success).toBe(false)
    expect(CashSourceTypeEnum.safeParse('intercompany').success).toBe(true)
    expect(MASTER_TYPES).toContain('intercompany-payees')
  })
})

describe('ADR 0028 config + migrations', () => {
  it('expense-requests.payeeCompany → companies; payeeType option pt_grup; cash-accounts.intercompanyReceiving; cash-entries source intercompany; approval-rules payee pt_grup', () => {
    const er = config.collections.find((c) => c.slug === 'expense-requests')!
    expect(er.flattenedFields.find((x) => x.name === 'payeeCompany')).toMatchObject({ type: 'relationship', relationTo: 'companies' })
    const payee = er.flattenedFields.find((x) => x.name === 'payeeType') as { options: Array<{ value: string }> }
    expect(payee.options.map((o) => o.value)).toEqual(['karyawan', 'vendor', 'pt_grup'])
    const ca = config.collections.find((c) => c.slug === 'cash-accounts')!
    expect(ca.flattenedFields.find((x) => x.name === 'intercompanyReceiving')).toMatchObject({ type: 'checkbox', defaultValue: false })
    const ce = config.collections.find((c) => c.slug === 'cash-entries')!
    expect((ce.flattenedFields.find((x) => x.name === 'sourceType') as { options: Array<{ value: string }> }).options.map((o) => o.value)).toContain('intercompany')
    const ar = config.collections.find((c) => c.slug === 'approval-rules')!
    expect((ar.flattenedFields.find((x) => x.name === 'payeeType') as { options: Array<{ value: string }> }).options.map((o) => o.value)).toContain('pt_grup')
  })

  it('renumber: the new deferred trigger functions are known as neutral (no prelude needed)', () => {
    expect(RENUMBER_NEUTRAL_FUNCTIONS).toContain('pk_ic_consistency')
    expect(RENUMBER_NEUTRAL_FUNCTIONS).toContain('pk_ic_entry_linked')
    expect(RENUMBER_GUARDED_FUNCTIONS as readonly string[]).not.toContain('pk_ic_consistency')
  })

  it('migrations: enums (own transaction) → schema → guard → data; the guards are pinned', () => {
    const dir = join(__dirname, '../../src/migrations')
    const index = readFileSync(join(dir, 'index.ts'), 'utf8')
    const order = ['20261014_100000_d1310_intercompany_enums', '20261014_100100_d1310_intercompany', '20261014_100200_d1310_intercompany_guard', '20261014_100300_d1310_intercompany_data'].map((n) => index.indexOf(`name: '${n}'`))
    expect(order.every((i) => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    const enums = readFileSync(join(dir, '20261014_100000_d1310_intercompany_enums.ts'), 'utf8')
    expect(enums).toContain(`"enum_expense_requests_payee_type" ADD VALUE IF NOT EXISTS 'pt_grup'`)
    expect(enums).toContain(`"enum_cash_entries_source_type" ADD VALUE IF NOT EXISTS 'intercompany'`)
    const guard = readFileSync(join(dir, '20261014_100200_d1310_intercompany_guard.ts'), 'utf8')
    expect(guard).toContain('CREATE UNIQUE INDEX expense_requests_ic_invoice_uq ON expense_requests (payee_company_id, pk_invoice_key(invoice_no))')
    expect(guard).toContain('CREATE UNIQUE INDEX cash_accounts_ic_receiving_uq ON cash_accounts (company_id)')
    expect(guard).toContain('payee_company_id IS DISTINCT FROM company_id')
    expect(guard).toContain('intercompany link side mismatch')
    expect(guard).toContain('DEFERRABLE INITIALLY DEFERRED')
    const snapshot = JSON.parse(readFileSync(join(dir, '20261014_100100_d1310_intercompany.json'), 'utf8')) as { enums: Record<string, { values: string[] }>; tables: Record<string, { columns: Record<string, unknown> }> }
    expect(snapshot.enums['public.enum_expense_requests_payee_type']!.values).toContain('pt_grup')
    expect(snapshot.enums['public.enum_approval_rules_payee_type']!.values).toContain('pt_grup')
    expect(snapshot.enums['public.enum_cash_entries_source_type']!.values).toContain('intercompany')
    expect(snapshot.tables['public.expense_requests']!.columns).toHaveProperty('payee_company_id')
    expect(snapshot.tables['public.cash_accounts']!.columns).toHaveProperty('intercompany_receiving')
  })
})

describe('GET /me capability intercompanyPayment (gap: /me lists EFFECTIVE roles; the filer rule reads the STORED ones)', () => {
  const user = withCompanyContext(
    { id: 7 },
    [
      { company: 1, roles: ['pk-principal'], employee: null }, // Owner only — effective roles also list pk-owner
      { company: 2, roles: ['pk-principal', 'pk-owner'], employee: null }, // Owner who is also Direktur
      { company: 3, roles: ['pk-finance'], employee: null },
      { company: 4, roles: ['pk-pm', 'pk-staff'], employee: null },
      { company: 5, roles: ['pk-staff', 'pk-admin'], employee: null },
      { company: 6, roles: ['pk-owner'], employee: null },
    ],
    null,
    false,
  )
  const req = { user } as never
  const cap = (company: number) => meCapabilities(req, rolesIn(req, company), { company })

  it('per PT: Finance / PM / Direktur (stored) → true; Owner-only → false although his effective roles hold pk-owner', () => {
    expect(rolesIn(req, 1)).toContain('pk-owner')
    expect(cap(1)).toEqual({ ...capabilitiesOf(rolesIn(req, 1)), intercompanyPayment: false })
    expect(cap(1).approvalInbox).toBe(true) // every other Direktur hint stays
    expect([2, 3, 4, 6].map((c) => cap(c).intercompanyPayment)).toEqual([true, true, true, true])
    expect(cap(5).intercompanyPayment).toBe(false) // Staff + Admin
    expect(cap(99).intercompanyPayment).toBe(false) // not a membership
  })

  it('top level (deprecated, union over the selected PTs) and the contract field', () => {
    expect(meCapabilities(req, rolesOf(user)).intercompanyPayment).toBe(true)
    const ownerOnly = withCompanyContext({ id: 8 }, [{ company: 1, roles: ['pk-principal'], employee: null }], null, false)
    expect(meCapabilities({ user: ownerOnly } as never, rolesOf(ownerOnly)).intercompanyPayment).toBe(false)
    expect(Capabilities.safeParse(cap(3)).success).toBe(true)
    expect(Capabilities.safeParse(capabilitiesOf(['pk-finance'])).success).toBe(false) // required in the contract
  })
})
