import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Role } from '@/access/roles'
import { previewQuery } from '@/admin/components/bank-preview-query'
import { itemIcon, resolveModules } from '@/admin/modules/registry'
import { buildPkListConfig } from '@/admin/pk-list/config'
import { employeePayee, isVendorForm, vendorPayee } from '@/collections/expense-request-form'
import type { TimelineSnapshot } from '@/domain/expense/approval-timeline'
import type { RequestDoc } from '@/domain/expense/common'
import { duplicateInvoiceMessage, vendorData, vendorOfDoc } from '@/domain/expense/drafts'
import { duplicateDraftInput } from '@/domain/expense/duplicate'
import { buildRequestStepper, VENDOR_END_NOTE, type StepperInput } from '@/domain/expense/request-stepper'
import { payeeCondition, ruleMatches, selectRule, type RuleInput } from '@/domain/expense/rules'
import { allowedActions, mayPerform, targets, type ActorContext } from '@/domain/expense/state'
import { nextActor, timeline } from '@/domain/expense/timeline'
import { normalizeInvoiceNo, payeeOf, requestKindLabel, VENDOR_FORBIDDEN_STATUSES, VENDOR_PAYMENT_LABEL } from '@/domain/expense/types'
import { DEFAULT_APPROVAL_RULES, VENDOR_FINANCE_RULE_NAME } from '@/seed/data'

/**
 * DRMS 13/10 Wave 4a (ADR 0025) "Pembayaran vendor": payee type vocabulary, state machine (no LPJ path), rule engine
 * condition "Jenis penerima", stepper / timeline, duplicate-invoice key, form conditions, list filter, config. Pure;
 * fictional data only.
 */

let config: SanitizedConfig
beforeAll(async () => {
  process.env.PK_SKIP_ENV_CHECK = 'true'
  config = await (await import('@/payload.config')).default
})

const ctx = (over: Partial<ActorContext> = {}): ActorContext => ({
  type: 'advance',
  payeeType: 'vendor',
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

describe('ADR 0025 vocabulary', () => {
  it('payee type defaults to karyawan; kind label "Pembayaran vendor"', () => {
    expect(payeeOf(undefined)).toBe('karyawan')
    expect(payeeOf(null)).toBe('karyawan')
    expect(payeeOf('vendor')).toBe('vendor')
    expect(payeeOf('x')).toBe('karyawan')
    expect(requestKindLabel('advance', 'vendor')).toBe(VENDOR_PAYMENT_LABEL)
    expect(requestKindLabel('advance', 'karyawan')).toBe('Pengajuan Baru')
    expect(requestKindLabel('reimburse', null)).toBe('Reimburse')
  })

  it('invoice key: upper case letters + digits (same as SQL pk_invoice_key)', () => {
    expect(normalizeInvoiceNo('inv/2026-01 ')).toBe('INV202601')
    expect(normalizeInvoiceNo('INV 2026.01')).toBe('INV202601')
    expect(normalizeInvoiceNo(' - / ')).toBe('')
    expect(normalizeInvoiceNo(null)).toBe('')
    // non-ASCII letters are stripped BEFORE upper-casing (never become ASCII letters, like regexp_replace → upper)
    expect(normalizeInvoiceNo('straße-7')).toBe('STRAE7')
  })

  it('duplicate message names the other request and its status (Indonesian)', () => {
    expect(duplicateInvoiceMessage('INV-9', { id: 4, docNo: '12/PB-CS1/X/2026', status: 'pending_approval' })).toMatch(/^Invoice INV-9 dari vendor ini sudah dipakai di pengajuan 12\/PB-CS1\/X\/2026 — status Menunggu persetujuan Direktur\./)
    expect(duplicateInvoiceMessage('INV-9', { id: 4, docNo: null, status: 'draft' })).toContain('#4 (draft)')
  })
})

describe('ADR 0025 state machine: transfer completes a vendor payment, no LPJ path', () => {
  it('transfer: vendor approved → completed; karyawan approved → transferred', () => {
    expect(targets('advance', 'approved', 'transfer', 'vendor')).toEqual(['completed'])
    expect(targets('advance', 'approved', 'transfer', 'karyawan')).toEqual(['transferred'])
    expect(targets('advance', 'approved', 'transfer')).toEqual(['transferred'])
  })

  it('void: vendor completed → approved; settle_reverse / LPJ actions never for a vendor payment', () => {
    expect(targets('advance', 'completed', 'transfer_void', 'vendor')).toEqual(['approved'])
    expect(targets('advance', 'completed', 'transfer_void', 'karyawan')).toEqual([])
    expect(targets('advance', 'completed', 'settle_reverse', 'vendor')).toEqual([])
    expect(targets('advance', 'completed', 'settle_reverse', 'karyawan')).toEqual(['lpj_verified'])
    for (const a of ['receipts_complete', 'lpj_submit', 'lpj_request_revision', 'lpj_verify', 'settle'] as const) {
      for (const from of VENDOR_FORBIDDEN_STATUSES) expect(targets('advance', from, a, 'vendor'), `${a} from ${from}`).toEqual([])
    }
  })

  it('Finance may transfer an approved vendor payment and void it once completed; the requester never gets LPJ actions', () => {
    expect(allowedActions(ctx())).toContain('transfer')
    expect(allowedActions(ctx({ status: 'completed' }))).toContain('transfer_void')
    expect(allowedActions(ctx({ status: 'completed' }))).not.toContain('settle_reverse')
    const own = ctx({ status: 'completed', roles: ['pk-pm'] as Role[], isCreator: true, isRequester: true })
    expect(allowedActions(own)).toEqual([])
    expect(mayPerform(ctx({ roles: ['pk-pm'] as Role[] }), 'transfer')).toBe(false)
  })
})

describe('ADR 0025 rule engine: "Jenis penerima" condition', () => {
  const base: RuleInput = { id: 1, name: 'Default', docType: 'expense_request', requestType: 'any', minAmount: 0, maxAmount: null, priority: 100, acknowledge: 'required', acknowledgeBy: 'scope_manager', steps: [{ level: 1, approverRole: 'pk-owner' }] }
  const vendorFinance: RuleInput = { ...base, id: 2, name: VENDOR_FINANCE_RULE_NAME, priority: 20, payeeType: 'vendor', requesterRoles: ['pk-finance'], acknowledge: 'none', acknowledgeBy: 'role' }
  const facts = (payeeType: 'karyawan' | 'vendor', roles: Role[][]) => ({ type: 'advance' as const, grandTotal: 5_000_000, categoryIds: [], projectId: 3, payeeType, requesterRoles: roles })

  it('vendor payment filed by Finance → the Finance vendor rule (Direktur only)', () => {
    expect(selectRule([base, vendorFinance], facts('vendor', [['pk-finance']]))?.id).toBe(2)
  })

  it('vendor payment filed by a PM → the default rule (PM project → Direktur; the PM step is skipped at submit, G1-2)', () => {
    expect(selectRule([base, vendorFinance], facts('vendor', [['pk-pm']]))?.id).toBe(1)
  })

  it('an employee payment by Finance never takes the vendor rule; addenda never match a payee condition', () => {
    expect(selectRule([base, vendorFinance], facts('karyawan', [['pk-finance']]))?.id).toBe(1)
    expect(ruleMatches(vendorFinance, { ...facts('vendor', [['pk-finance']]), docType: 'budget_addendum', type: null })).toBe(false)
    expect(payeeCondition({ payeeType: 'any' })).toBeNull()
    expect(payeeCondition({})).toBeNull()
    expect(payeeCondition({ payeeType: 'vendor' })).toBe('vendor')
  })

  it('a payee condition counts as specificity (same priority: the vendor rule wins over an unconditioned one)', () => {
    expect(selectRule([base, { ...vendorFinance, priority: 100, requesterRoles: [] }], facts('vendor', [['pk-pm']]))?.id).toBe(2)
  })

  it('seed: the Finance vendor rule is a default (Jenis penerima vendor, Peran pemohon Finance, Direktur level, no Diketahui)', () => {
    const r = DEFAULT_APPROVAL_RULES.find((x) => x.name === VENDOR_FINANCE_RULE_NAME) as unknown as RuleInput
    expect(r).toMatchObject({ docType: 'expense_request', payeeType: 'vendor', requesterRoles: ['pk-finance'], acknowledge: 'none', priority: 20 })
    expect(r.steps).toEqual([{ level: 1, approverRole: 'pk-owner' }])
  })
})

const PM_DIREKTUR: TimelineSnapshot = {
  acknowledge: 'none',
  acknowledgeBy: 'scope_manager',
  acknowledgerUserId: null,
  acknowledgeRole: null,
  decisionRoles: ['pk-owner', 'pk-finance'] as Role[],
  skipped: [{ position: 'diketahui', level: 0, role: null, userId: 7, reason: 'PM project adalah pemohon/pembuat' }],
  steps: [{ level: 1, approverRole: 'pk-owner', approverUserId: null }],
}
const input = (over: Partial<StepperInput> = {}): StepperInput => ({
  type: 'advance',
  payeeType: 'vendor',
  status: 'pending_approval',
  approvalCycle: 1,
  currentLevel: 1,
  submittedAt: '2026-10-14T01:00:00.000Z',
  snapshot: PM_DIREKTUR,
  approvals: [{ cycle: 1, position: 'diajukan', level: 0, actorName: 'PM Contoh', onBehalf: false, decision: 'signed', reason: null, decidedAt: '2026-10-14T01:00:00.000Z' }],
  transfers: [],
  requesters: 'PM Contoh',
  createdBy: 'PM Contoh',
  names: {},
  settlement: null,
  ...over,
})
const states = (i: StepperInput) => buildRequestStepper(i).steps.map((s) => `${s.key}:${s.state}`)

describe('ADR 0025 stepper / timeline: no LPJ step for a vendor payment', () => {
  it('PM filer: PM step skipped → Direktur → Transfer → Selesai (no "Nota & LPJ", no "Penyelesaian LPJ")', () => {
    expect(states(input())).toEqual(['diajukan:done', 'diketahui:skipped', 'approval-1:current', 'transfer:pending', 'end:pending'])
    const done = buildRequestStepper(
      input({
        status: 'completed',
        approvals: [...input().approvals, { cycle: 1, position: 'approval', level: 1, actorName: 'Direktur Contoh', onBehalf: false, decision: 'approved', reason: null, decidedAt: '2026-10-14T02:00:00.000Z' }],
        transfers: [{ docNo: 'TRF/CS1/2610/0001', kind: 'advance', amount: 1, transferDate: '2026-10-14', status: 'posted' }],
      }),
    )
    expect(done.steps.map((s) => s.key)).toEqual(['diajukan', 'diketahui', 'approval-1', 'transfer', 'end'])
    expect(done.currentKey).toBeNull()
    expect(done.steps.find((s) => s.key === 'end')).toMatchObject({ state: 'done', note: VENDOR_END_NOTE })
  })

  it('an employee Pengajuan Baru keeps its LPJ steps', () => {
    expect(states(input({ payeeType: 'karyawan' })).some((s) => s.startsWith('lpj:'))).toBe(true)
  })

  it('status timeline: approved → completed; next actor = Finance pays the vendor', () => {
    expect(timeline('advance', 'approved', { payeeType: 'vendor', skipAck: true }).map((s) => s.status)).toEqual(['draft', 'pending_approval', 'approved', 'completed'])
    expect(nextActor({ type: 'advance', payeeType: 'vendor', status: 'approved', currentLevel: null, snapshot: null, requesters: '', names: {} })?.what).toMatch(/rekening vendor/)
    expect(nextActor({ type: 'advance', payeeType: 'vendor', status: 'draft', currentLevel: null, snapshot: null, requesters: '', names: {} })?.what).toMatch(/invoice/)
  })
})

describe('ADR 0025 drafts: vendor columns', () => {
  const doc = { id: 5, type: 'advance', status: 'rejected', title: 'Semen', payeeType: 'vendor', vendor: 3, vendorBankAccount: { id: 9 }, invoiceNo: 'INV-1', invoiceDate: '2026-10-01', invoiceDueDate: null, invoiceFile: 11, requesters: [2], lines: [] } as unknown as RequestDoc

  it('vendorOfDoc / vendorData round trip; karyawan clears every vendor column', () => {
    expect(vendorOfDoc(doc)).toEqual({ payeeType: 'vendor', vendorId: 3, vendorBankAccountId: 9, invoiceNo: 'INV-1', invoiceDate: '2026-10-01', invoiceDueDate: null, invoiceFileId: 11 })
    expect(vendorData(vendorOfDoc(doc), true)).toEqual({ payeeType: 'vendor', vendor: 3, vendorBankAccount: 9, invoiceNo: 'INV-1', invoiceDate: '2026-10-01', invoiceDueDate: null, invoiceFile: 11 })
    expect(vendorData(vendorOfDoc(doc), false)).toEqual({ payeeType: 'karyawan', vendor: null, vendorBankAccount: null, invoiceNo: null, invoiceDate: null, invoiceDueDate: null, invoiceFile: null })
    expect(vendorData({ invoiceNo: '   ' }, true).invoiceNo).toBeNull()
  })

  it('"Duplikat" keeps vendor + account but never the invoice (one invoice is paid once)', () => {
    const d = duplicateDraftInput(doc)
    expect(d).toMatchObject({ payeeType: 'vendor', vendorId: 3, vendorBankAccountId: 9 })
    expect(d).not.toHaveProperty('invoiceNo')
    expect(d).not.toHaveProperty('invoiceFileId')
    expect(duplicateDraftInput({ ...doc, payeeType: 'karyawan' } as RequestDoc)).not.toHaveProperty('payeeType')
  })
})

describe('ADR 0025 web form, preview, list, menu', () => {
  it('conditions: vendor inputs only for a vendor payment, the employee account / Pemohon picker only for karyawan', () => {
    const yes = () => true
    expect(isVendorForm({ payeeType: 'vendor' })).toBe(true)
    expect(vendorPayee(yes)({ payeeType: 'vendor' }, {}, {} as never)).toBe(true)
    expect(vendorPayee(yes)({ payeeType: 'karyawan' }, {}, {} as never)).toBe(false)
    expect(employeePayee(yes)({}, {}, {} as never)).toBe(true)
    expect(employeePayee(yes)({ payeeType: 'vendor' }, {}, {} as never)).toBe(false)
  })

  it('bank preview query: a vendor payment previews `vendorAccount`', () => {
    expect(previewQuery({ requestId: 4, accountId: 9, draft: true, vendor: true })).toBe('/api/v1/bank-account-preview?request=4&vendorAccount=9')
    expect(previewQuery({ requestId: 4, accountId: 9, draft: true })).toBe('/api/v1/bank-account-preview?request=4&account=9')
  })

  it('expense-request list: filter "Jenis penerima"; vendor-bank-accounts audited, no delete, in Master Data', async () => {
    const er = buildPkListConfig(config.collections.find((c) => c.slug === 'expense-requests')! as never)
    expect(er.filters.map((f) => f.name)).toContain('payeeType')
    const vba = config.collections.find((c) => c.slug === 'vendor-bank-accounts')!
    expect((vba.custom as { pkAudit?: unknown }).pkAudit).toBeDefined()
    expect(await vba.access.delete({ req: { user: { id: 1, roles: ['pk-admin'] }, context: {} } } as never)).toBe(false)
    expect(itemIcon({ href: '/admin/collections/vendor-bank-accounts', kind: 'collection', label: 'Rekening vendor' }, 'master')).toBe('tCardTick')
    const master = resolveModules({ roles: ['pk-finance'] as Role[], staffOnly: false, canSee: () => true, canManage: () => true, labelOf: (_k, s) => s }).find((m) => m.id === 'master')
    expect(JSON.stringify(master ?? {})).toContain('vendor-bank-accounts')
  })

  it('vendors form: tab "Rekening" with the join of the vendor accounts (no column)', () => {
    const vendors = config.collections.find((c) => c.slug === 'vendors')!
    expect(JSON.stringify(vendors.fields)).toContain('"collection":"vendor-bank-accounts"')
  })

  it('expense request: payeeType required with default karyawan; the vendor fields exist', () => {
    const er = config.collections.find((c) => c.slug === 'expense-requests')!
    const f = er.flattenedFields.find((x) => x.name === 'payeeType') as { required?: boolean; defaultValue?: unknown }
    expect(f).toMatchObject({ required: true, defaultValue: 'karyawan' })
    for (const n of ['vendor', 'vendorBankAccount', 'invoiceNo', 'invoiceDate', 'invoiceDueDate', 'invoiceFile']) expect(er.flattenedFields.some((x) => x.name === n), n).toBe(true)
  })

  it('migrations: schema + guard + data, the duplicate-invoice index and the no-LPJ guard (pinned)', () => {
    const dir = join(__dirname, '../../src/migrations')
    const guard = readFileSync(join(dir, '20261014_100100_d1310_vendor_payments_guard.ts'), 'utf8')
    expect(guard).toContain('CREATE UNIQUE INDEX expense_requests_vendor_invoice_uq ON expense_requests (vendor_id, pk_invoice_key(invoice_no))')
    expect(guard).toContain("status NOT IN ('cancelled', 'rejected')")
    expect(guard).toContain('settlements_no_vendor_payment')
    const index = readFileSync(join(dir, 'index.ts'), 'utf8')
    expect(index.indexOf('20261014_100000_d1310_vendor_payments')).toBeLessThan(index.indexOf('20261014_100100_d1310_vendor_payments_guard'))
    expect(index.indexOf('20261014_100100_d1310_vendor_payments_guard')).toBeLessThan(index.indexOf('20261014_100200_d1310_vendor_payments_data'))
  })
})
