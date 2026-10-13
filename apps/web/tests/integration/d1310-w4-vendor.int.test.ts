import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadRequestPanel } from '@/admin/components/request/panel-data'
import { VENDOR_FINANCE_RULE_NAME } from '@/seed/data'
import { resetRateLimits } from '@/lib/rate-limit'

import { companyId, getTestPayload, sqlAs, sqlError } from './helpers'
import { api, makeFlowUser, makeWorld, png, sysCreate, upload, type FlowUser, type World } from './flow-world'

/**
 * DRMS 13/10 Wave 4a (ADR 0025) "Pembayaran vendor" through the real API + DB guards:
 * - vendor accounts (`vendor-bank-accounts`): PT from the vendor, Staff cannot read, masters type for the APK;
 * - who files: Finance and PM only (Staff 403); Pemohon = the filer; type forced to Pengajuan Baru;
 * - approval through the generic engine: Finance → seeded rule "Pembayaran vendor oleh Finance — Direktur";
 *   PM → the project's PM → Direktur rule with the PM step skipped (G1-2);
 * - duplicate invoice (same vendor, normalized number, request not cancelled / rejected) → 409 field error; DB index;
 * - transfer = snapshot of the vendor account, unverified account → confirmation, then Selesai at once (no LPJ);
 *   void → back to the queue; DB: no receipt / LPJ status, no settlement.
 * Fictional data only (example.test style names, generated numbers).
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))

let w: World
let pt: number
let financeV: FlowUser
let pmV: FlowUser
let projectV: number
let vendor: number
let otherVendor: number
let accVerified: number
let accUnverified: number
let accOther: number
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })
const today = () => new Date().toISOString().slice(0, 10)

async function ok(p: Promise<{ status: number; body: any }>, status = 200) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await p
  expect(r.status, JSON.stringify(r.body)).toBe(status)
  return r.body
}

beforeAll(async () => {
  w = await makeWorld('VND')
  pt = await companyId()
  const empFin = await sysCreate('employees', { code: 'VND-FIN', name: 'VND Finance' })
  financeV = await makeFlowUser(['pk-finance'], 'vnd-finance', empFin)
  pmV = w.users.pm // employee emp.pm, PM of the vendor project below
  // own project (no world rule): ADR 0021 shape PM project → Direktur, priority 50 (the seeded vendor rule = 20)
  projectV = await sysCreate('projects', { code: 'VND-PV', name: 'VND Proyek Vendor', pm: pmV.id, budget: 0, status: 'berjalan', costCenter: w.projectCostCenter })
  await sysCreate('approval-rules', {
    name: 'VND rule PM→Direktur (proyek vendor)',
    docType: 'expense_request',
    requestType: 'any',
    priority: 50,
    project: projectV,
    acknowledge: 'required',
    acknowledgeBy: 'scope_manager',
    acknowledgeRole: null,
    minAmount: 0,
    steps: [{ level: 1, approverRole: 'pk-owner' }],
    active: true,
  })
  const bank = (await (await getTestPayload()).find({ collection: 'banks', where: { code: { equals: 'MANDIRI' } }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number
  vendor = await sysCreate('vendors', { company: pt, name: 'CV Contoh Material' })
  otherVendor = await sysCreate('vendors', { company: pt, name: 'PT Contoh Alat' })
  accVerified = await sysCreate('vendor-bank-accounts', { vendor, bank, accountNo: `77${Date.now() % 1e9}`, accountHolder: 'CV Contoh Material', isDefault: true, verificationStatus: 'verified' })
  accUnverified = await sysCreate('vendor-bank-accounts', { vendor, bank, accountNo: `78${Date.now() % 1e9}`, accountHolder: 'CV Contoh Material (2)', verificationStatus: 'unverified' })
  accOther = await sysCreate('vendor-bank-accounts', { vendor: otherVendor, bank, accountNo: `79${Date.now() % 1e9}`, accountHolder: 'PT Contoh Alat', verificationStatus: 'verified' })
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

async function invoiceFile(user: FlowUser): Promise<number> {
  return (await ok(upload('/api/v1/media/attachments', user, await png()), 201)).id as number
}

async function vendorBody(user: FlowUser, over: Record<string, unknown> = {}) {
  return {
    type: 'advance',
    payeeType: 'vendor',
    title: 'Bayar invoice material',
    projectId: projectV,
    vendorId: vendor,
    vendorBankAccountId: accVerified,
    invoiceNo: `INV/${randomUUID().slice(0, 8)}`,
    invoiceDate: today(),
    invoiceFileId: await invoiceFile(user),
    lines: [{ description: 'Semen 50 sak', qty: 50, uomId: w.uom.l, unitPrice: 70_000, categoryId: w.cat.mat }],
    ...over,
  }
}

describe('vendor accounts', () => {
  it('PT derived from the vendor; Staff cannot read them (collection + masters); PM reads them for the picker', async () => {
    const row = (await sqlAs('app', 'SELECT company_id, label FROM vendor_bank_accounts WHERE id = $1', [accVerified])).rows[0]
    expect(row.company_id).toBe(pt)
    expect(row.label).toMatch(/^CV Contoh Material ••\d{4}$/)
    expect((await api('GET', '/api/vendor-bank-accounts', w.users.staffA)).status).toBe(403)
    const staffMasters = await ok(api('GET', '/api/v1/masters?types=vendor-bank-accounts', w.users.staffA))
    expect(staffMasters.types['vendor-bank-accounts'].items).toEqual([])
    const pmMasters = await ok(api('GET', '/api/v1/masters?types=vendor-bank-accounts', pmV))
    expect(pmMasters.types['vendor-bank-accounts'].items.map((i: { id: number }) => i.id)).toEqual(expect.arrayContaining([accVerified, accUnverified, accOther]))
    // DB: no delete, digits only
    expect((await sqlError('app', 'DELETE FROM vendor_bank_accounts WHERE id = $1', [accOther]))?.code).toBe('42501')
    expect((await sqlError('app', "UPDATE vendor_bank_accounts SET account_no = '12-34' WHERE id = $1", [accOther]))?.code).toBe('23514')
  })
})

describe('who may file a vendor payment (D3)', () => {
  it('Staff → 403; Finance → Draft of type advance, Pemohon = the filer, no employee account', async () => {
    const staff = await api('POST', E, w.users.staffA, { ...(await vendorBody(w.users.staffA)), projectId: w.project }, key())
    expect(staff.status, JSON.stringify(staff.body)).toBe(403)
    const d = await ok(api('POST', E, financeV, await vendorBody(financeV, { type: 'reimburse' }), key()), 201)
    expect(d).toMatchObject({ status: 'draft', type: 'advance', payeeType: 'vendor', typeLabel: 'Pembayaran vendor', bankAccountId: null, vendorBankAccountId: accVerified })
    expect(d.vendor).toMatchObject({ id: vendor, name: 'CV Contoh Material' })
    expect(d.requesters.map((r: { id: number }) => r.id)).toEqual([financeV.employee])
    expect(d.invoice).toMatchObject({ date: today(), dueDate: null })
  })

  it('the account must belong to the chosen vendor; an employee account is refused; missing invoice data blocks the submit', async () => {
    const wrong = await api('POST', E, financeV, await vendorBody(financeV, { vendorBankAccountId: accOther }), key())
    expect(wrong.status).toBe(400)
    expect(wrong.body.errors.map((e: { path: string }) => e.path)).toContain('vendorBankAccountId')
    const emp = await api('POST', E, financeV, await vendorBody(financeV, { bankAccountId: w.accA }), key())
    expect(emp.status).toBe(400)
    expect(emp.body.errors.map((e: { path: string }) => e.path)).toContain('bankAccountId')
    const d = await ok(api('POST', E, financeV, await vendorBody(financeV, { invoiceNo: null, invoiceFileId: null }), key()), 201)
    const sent = await api('POST', `${E}/${d.id}/submit`, financeV, {}, key())
    expect(sent.status).toBe(400)
    expect(sent.body.errors.map((e: { path: string }) => e.path)).toEqual(expect.arrayContaining(['invoiceNo', 'invoiceFileId']))
  })
})

describe('approval routing through the generic rule engine', () => {
  it('Finance files → "Pembayaran vendor oleh Finance — Direktur" (Direktur only)', async () => {
    const d = await ok(api('POST', E, financeV, await vendorBody(financeV), key()), 201)
    const s = await ok(api('POST', `${E}/${d.id}/submit`, financeV, {}, key()))
    expect(s.status).toBe('pending_approval')
    expect(s.approvalRule).toMatchObject({ name: VENDOR_FINANCE_RULE_NAME, acknowledge: 'none', steps: [{ level: 1, approverRole: 'pk-owner', approverUserId: null }] })
    // the snapshot = the vendor account
    expect(s.bank).toMatchObject({ accountHolder: 'CV Contoh Material' })
  })

  it('PM files → PM step skipped (he is the project PM) → Direktur; the stepper has no LPJ step', async () => {
    const d = await ok(api('POST', E, pmV, await vendorBody(pmV), key()), 201)
    expect(d.requesters.map((r: { id: number }) => r.id)).toEqual([w.emp.pm])
    const s = await ok(api('POST', `${E}/${d.id}/submit`, pmV, {}, key()))
    expect(s.status).toBe('pending_approval')
    expect(s.approvalRule.skipped.map((x: { position: string }) => x.position)).toEqual(['diketahui'])
    const panel = (await loadRequestPanel(await getTestPayload(), { ...pmV, collection: 'users' } as never, d.id))!
    expect(panel.stepper.steps.map((x) => x.key)).toEqual(['diajukan', 'diketahui', 'approval-1', 'transfer', 'end'])
  })
})

describe('duplicate invoice', () => {
  it('same vendor + same normalized number on a live request → 409 field error; another vendor or a cancelled one is fine', async () => {
    const no = `inv/${Date.now()}-a`
    const first = await ok(api('POST', E, financeV, await vendorBody(financeV, { invoiceNo: no }), key()), 201)
    const dup = await api('POST', E, financeV, await vendorBody(financeV, { invoiceNo: ` ${no.toUpperCase().replace('/', ' ')} ` }), key())
    expect(dup.status).toBe(409)
    expect(dup.body.errors[0]).toMatchObject({ path: 'invoiceNo' })
    expect(dup.body.errors[0].message).toMatch(/sudah dipakai di pengajuan/)
    // another vendor: allowed
    await ok(api('POST', E, financeV, await vendorBody(financeV, { invoiceNo: no, vendorId: otherVendor, vendorBankAccountId: accOther }), key()), 201)
    // the same draft may keep its own number (PATCH)
    await ok(api('PATCH', `${E}/${first.id}`, financeV, { invoiceNo: no, title: 'Bayar invoice material (ubah)' }))
    // cancelled → the invoice may be filed again
    await ok(api('POST', `${E}/${first.id}/cancel`, financeV, { reason: 'salah input invoice' }, key()))
    const again = await ok(api('POST', E, financeV, await vendorBody(financeV, { invoiceNo: no }), key()), 201)
    // DB guard: a raw write of the same key on another live request is refused
    const other = await ok(api('POST', E, financeV, await vendorBody(financeV), key()), 201)
    expect((await sqlError('app', 'UPDATE expense_requests SET invoice_no = $1 WHERE id = $2', [no.toUpperCase(), other.id]))?.code).toBe('23505')
    expect(again.id).toBeGreaterThan(first.id)
  })
})

describe('transfer → Selesai (no LPJ)', () => {
  async function approved(over: Record<string, unknown> = {}): Promise<number> {
    const d = await ok(api('POST', E, financeV, await vendorBody(financeV, over), key()), 201)
    await ok(api('POST', `${E}/${d.id}/submit`, financeV, {}, key()))
    const a = await ok(api('POST', `${E}/${d.id}/approve`, w.users.owner, {}, key()))
    expect(a.status).toBe('approved')
    return d.id as number
  }

  it('the queue shows it with the vendor; the transfer pays the vendor snapshot and completes the request; void re-opens it', async () => {
    const id = await approved()
    const q = await ok(api('GET', '/api/v1/transfer-queue', w.users.finance))
    const item = q.items.find((i: { id: number }) => i.id === id)
    expect(item).toMatchObject({ payeeType: 'vendor', vendorName: 'CV Contoh Material', bankVerification: 'verified', typeLabel: 'Pembayaran vendor' })
    const proof = (await ok(upload('/api/v1/media/transfer-proofs', w.users.finance, await png()), 201)).id as number
    const t = await ok(api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `VND-${id}`, proofMediaId: proof }, key()), 201)
    expect(t.request).toMatchObject({ status: 'completed', allowedActions: expect.arrayContaining(['transfer_void']) })
    expect(t.request.settlement).toBeNull()
    expect(t.request.allowedActions).not.toContain('receipts_complete')
    const dest = (await sqlAs('app', 'SELECT destination_account_holder AS h FROM transfers WHERE id = $1', [t.transferId])).rows[0]
    expect(dest.h).toBe('CV Contoh Material')
    // no LPJ: the requester's LPJ actions are refused, and the DB refuses a receipt / LPJ status
    expect((await api('POST', `${E}/${id}/receipts-complete`, financeV, {}, key())).status).toBe(409)
    expect((await sqlError('app', "UPDATE expense_requests SET status = 'lpj_submitted' WHERE id = $1", [id]))?.code).toBe('23514')
    // void → back to the transfer queue
    const v = await ok(api('POST', `${E}/${id}/transfers/${t.transferId}/void`, w.users.finance, { reason: 'salah rekening sumber' }, key()))
    expect(v.status).toBe('approved')
  })

  it('an unverified vendor account needs the same confirmation as an employee account (audited)', async () => {
    const id = await approved({ vendorBankAccountId: accUnverified })
    const proof = (await ok(upload('/api/v1/media/transfer-proofs', w.users.finance, await png()), 201)).id as number
    const body = { cashAccountId: w.cashAccount, bankRef: `VNDU-${id}`, proofMediaId: proof }
    const refused = await api('POST', `${E}/${id}/transfer`, w.users.finance, body, key())
    expect(refused.body).toMatchObject({ status: 409, code: 'BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED', accountKind: 'vendor', accountHolder: 'CV Contoh Material (2)' })
    const t = await ok(api('POST', `${E}/${id}/transfer`, w.users.finance, { ...body, confirmUnverifiedAccount: true }, key()), 201)
    expect(t.request.status).toBe('completed')
    const audit = await sqlAs('app', "SELECT new_value FROM audit_logs WHERE doc_type = 'transfer' AND doc_id = $1 AND action = 'bank_unverified_confirmed'", [String(t.transferId)])
    expect(audit.rows[0].new_value).toMatchObject({ v: { accountKind: 'vendor', verificationStatus: 'unverified' } })
  })
})
