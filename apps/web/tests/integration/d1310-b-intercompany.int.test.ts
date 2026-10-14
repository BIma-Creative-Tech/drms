import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetRateLimits } from '@/lib/rate-limit'
import { DIREKTUR_RULE_NAME, INTERCOMPANY_FINANCE_RULE_NAME } from '@/seed/data'

import { companyId, getTestPayload, sqlAs, sqlError } from './helpers'
import { api, makeFlowUser, makeWorld, png, sysCreate, upload, type FlowUser, type World } from './flow-world'

/**
 * ADR 0028 (DRMS 13/10 Phase B) "Pembayaran antar-PT" through the real API + DB guards. PT A = DRMS (the world), PT B =
 * a fresh fictional receiving PT with a designated "Rekening penerimaan antar-PT", PT C = a fresh PT WITHOUT one.
 * - designated receiving account: one active bank account per PT (hook + DB unique index);
 * - payee directory (masked) for Finance / PM / Direktur of A only; masters type intercompany-payees;
 * - who files (owner 2026-10-14): Finance / PM / Direktur — Staff and Admin 403; mandatory document of the receiving PT,
 *   unique per receiving PT (409); no designated account → 400 INTERCOMPANY_NO_ACCOUNT; own PT → 400;
 * - approval: Finance → "Pembayaran antar-PT oleh Finance — Direktur lalu Owner"; Direktur → "Pengajuan Direktur";
 * - transfer: KK in A + automatic KM in B ("Antar PT", system write), paired link, request Selesai, B notified, the KM
 *   cannot be voided by B; void of A's transfer reverses the KM, voids the link and puts the request back in the queue
 *   (Finance notified, no "Disetujui" to the people); B's closed period refuses the transfer (409
 *   INTERCOMPANY_PERIOD_CLOSED, nothing written); DB guards of intercompany_links.
 * B and C are deactivated in afterAll (every other test file assumes the single-company default). Fictional data only.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))

let w: World
let A = 0
let B = 0
let C = 0
let codeA = ''
let codeB = ''
let financeA: FlowUser
let direkturA: FlowUser
let principalA: FlowUser
let financeB: FlowUser
let projectI = 0
let accB = 0
let accB2 = 0
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })
const today = () => new Date().toISOString().slice(0, 10)
/** Business date of the PTs (Asia/Makassar) — the transfer's default date. */
const ptToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Makassar' })

async function ok(p: Promise<{ status: number; body: any }>, status = 200) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await p
  expect(r.status, JSON.stringify(r.body)).toBe(status)
  return r.body
}

beforeAll(async () => {
  // 1. the DRMS world while DRMS is still the only active PT (sysCreate relies on that default)
  w = await makeWorld('ICO')
  A = await companyId()
  const p = await getTestPayload()
  codeA = String(((await p.findByID({ collection: 'companies', id: A, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })) as { shortCode?: string }).shortCode ?? '')
  const empFin = await sysCreate('employees', { company: A, code: 'ICO-FIN', name: 'ICO Finance' })
  const empDir = await sysCreate('employees', { company: A, code: 'ICO-DIR', name: 'ICO Direktur' })
  const empOwn = await sysCreate('employees', { company: A, code: 'ICO-OWN', name: 'ICO Owner' })
  financeA = await makeFlowUser(['pk-finance'], 'ico-finance', empFin)
  direkturA = await makeFlowUser(['pk-owner'], 'ico-direktur', empDir)
  principalA = await makeFlowUser(['pk-principal'], 'ico-principal', empOwn) // ADR 0026 Owner level
  // own project without a world rule: the seeded PT grup rule (20) / "Pengajuan Direktur" (10) decide, not a scoped one
  projectI = await sysCreate('projects', { company: A, code: 'ICO-PIC', name: 'ICO Proyek Antar PT', pm: w.users.pm.id, budget: 0, status: 'berjalan', costCenter: w.projectCostCenter })

  // 2. PT B (receiving, designated account) and PT C (no designated account) — explicit company from here on
  const n = Date.now() % 1000
  codeB = `ICB${n}`
  B = await sysCreate('companies', { name: 'PT Contoh Penerima', shortCode: codeB, timezone: 'Asia/Makassar' })
  C = await sysCreate('companies', { name: 'PT Contoh Tanpa Rekening', shortCode: `ICC${n}`, timezone: 'Asia/Makassar' })
  const bank = (await p.find({ collection: 'banks', where: { code: { equals: 'MANDIRI' } }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number
  accB = await sysCreate('cash-accounts', { company: B, name: 'Rekening Penerimaan B', kind: 'bank', bank, accountNo: `55${Date.now() % 1e9}`, accountHolder: 'PT Contoh Penerima', openingBalance: 0, openingBalanceDate: '2020-01-01', intercompanyReceiving: true })
  accB2 = await sysCreate('cash-accounts', { company: B, name: 'Rekening Operasional B', kind: 'bank', bank, accountNo: `56${Date.now() % 1e9}`, accountHolder: 'PT Contoh Penerima', openingBalance: 0, openingBalanceDate: '2020-01-01' })
  await sysCreate('cash-accounts', { company: C, name: 'Kas C', kind: 'bank', bank, accountNo: `57${Date.now() % 1e9}`, accountHolder: 'PT Contoh Tanpa Rekening', openingBalance: 0 })
  financeB = await makeFlowUser(['pk-finance'], 'ico-finance-b', null, { company: B })
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  const p = await getTestPayload()
  // B's closing of the current month (scenario f) back to "reopened"; then both PTs inactive again
  if (B) await sqlAs('owner', "UPDATE period_closings SET status = 'reopened', reopen_reason = 'uji antar-PT selesai' WHERE company_id = $1 AND status = 'closed'", [B])
  for (const id of [B, C]) if (id) await p.update({ collection: 'companies', id, data: { active: false, changeReason: 'uji antar-PT selesai' } as never, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
  await p.destroy()
})

async function documentFile(user: FlowUser): Promise<number> {
  return (await ok(upload('/api/v1/media/attachments', user, await png()), 201)).id as number
}

async function icBody(user: FlowUser, over: Record<string, unknown> = {}) {
  return {
    type: 'advance',
    payeeType: 'pt_grup',
    title: 'Jasa manajemen antar PT',
    projectId: projectI,
    payeeCompanyId: B,
    invoiceNo: `MEMO/${randomUUID().slice(0, 8)}`,
    invoiceDate: today(),
    invoiceFileId: await documentFile(user),
    lines: [{ description: 'Jasa manajemen Oktober', qty: 1, uomId: w.uom.l, unitPrice: 2_500_000, categoryId: w.cat.mat }],
    ...over,
  }
}

/** Finance-filed PT grup payment through Direktur and Owner → "Disetujui (Antri Transfer)". */
async function approvedPayment(): Promise<number> {
  const d = await ok(api('POST', E, financeA, await icBody(financeA), key()), 201)
  await ok(api('POST', `${E}/${d.id}/submit`, financeA, {}, key()))
  expect((await ok(api('POST', `${E}/${d.id}/approve`, w.users.owner, {}, key()))).status).toBe('pending_approval')
  expect((await ok(api('POST', `${E}/${d.id}/approve`, principalA, {}, key()))).status).toBe('approved')
  return d.id as number
}

async function transferBody(id: number, over: Record<string, unknown> = {}) {
  const proof = (await ok(upload('/api/v1/media/transfer-proofs', w.users.finance, await png()), 201)).id as number
  return { cashAccountId: w.cashAccount, bankRef: `ICO-${id}-${randomUUID().slice(0, 4)}`, proofMediaId: proof, confirmOverdraft: true, ...over }
}

describe('a. "Rekening penerimaan antar-PT" (one active bank account per PT)', () => {
  it('a second designated account or a cash-kind account is refused (hook); the DB unique index is the final guard', async () => {
    const p = await getTestPayload()
    expect((await sqlAs('app', 'SELECT intercompany_receiving AS f FROM cash_accounts WHERE id = $1', [accB])).rows[0].f).toBe(true)
    await expect(p.update({ collection: 'cash-accounts', id: accB2, data: { intercompanyReceiving: true, changeReason: 'uji rekening kedua' } as never, overrideAccess: true /* SYSTEM-WRITE: fixture */ })).rejects.toThrow()
    await expect(p.create({ collection: 'cash-accounts', data: { company: C, name: 'Kas tunai C', kind: 'cash', openingBalance: 0, intercompanyReceiving: true } as never, overrideAccess: true /* SYSTEM-WRITE: fixture */ })).rejects.toThrow()
    expect((await sqlError('app', 'UPDATE cash_accounts SET intercompany_receiving = true WHERE id = $1', [accB2]))?.code).toBe('23505')
  })
})

describe('b. payee directory', () => {
  it('Finance of A sees B (masked number), never A or a PT without a designated account; Staff → 403; masters type', async () => {
    const r = await ok(api('GET', `/api/v1/intercompany/payees?company=${A}`, financeA))
    const ids = r.items.map((i: { companyId: number }) => i.companyId)
    expect(ids).toContain(B)
    expect(ids).not.toContain(A)
    expect(ids).not.toContain(C)
    const b = r.items.find((i: { companyId: number }) => i.companyId === B)
    expect(b).toMatchObject({ shortCode: codeB, name: 'PT Contoh Penerima', accountHolder: 'PT Contoh Penerima' })
    expect(b.accountNoMasked).toMatch(/^••••\d{4}$/)
    expect(JSON.stringify(r)).not.toMatch(/"accountNo"/)
    expect((await api('GET', `/api/v1/intercompany/payees?company=${A}`, w.users.staffA)).status).toBe(403)
    // an Owner (pk-principal) without a filer role: not a filer (stored roles, owner 2026-10-14)
    expect((await api('GET', `/api/v1/intercompany/payees?company=${A}`, principalA)).status).toBe(403)
    const m = await ok(api('GET', '/api/v1/masters?types=intercompany-payees', financeA))
    expect(m.types['intercompany-payees'].items).toEqual(expect.arrayContaining([expect.objectContaining({ id: B, company: A, shortCode: codeB })]))
    const staffMasters = await ok(api('GET', '/api/v1/masters?types=intercompany-payees', w.users.staffA))
    expect(staffMasters.types['intercompany-payees'].items).toEqual([])
  })
})

describe('c. who files a PT grup payment (owner 2026-10-14: Finance, PM, Direktur)', () => {
  it('Staff, Admin and an Owner-only user → 403; Finance → Draft "Pembayaran antar-PT" (advance, Pemohon = the filer, receiving PT)', async () => {
    expect((await api('POST', E, w.users.staffA, { ...(await icBody(w.users.staffA)), projectId: w.project }, key())).status).toBe(403)
    expect((await api('POST', E, w.users.admin, await icBody(w.users.admin), key())).status).toBe(403)
    expect((await api('POST', E, principalA, await icBody(principalA), key())).status).toBe(403) // Owner (pk-principal) only
    const d = await ok(api('POST', E, financeA, await icBody(financeA, { type: 'reimburse' }), key()), 201)
    expect(d).toMatchObject({ status: 'draft', type: 'advance', payeeType: 'pt_grup', typeLabel: 'Pembayaran antar-PT', bankAccountId: null })
    expect(d.payeeCompany).toMatchObject({ id: B })
    expect(d.requesters.map((r: { id: number }) => r.id)).toEqual([financeA.employee])
  })

  it('no designated account → 400 INTERCOMPANY_NO_ACCOUNT; own PT → 400; missing document blocks the submit', async () => {
    const none = await api('POST', E, financeA, await icBody(financeA, { payeeCompanyId: C }), key())
    expect(none.status).toBe(400)
    expect(none.body.code).toBe('INTERCOMPANY_NO_ACCOUNT')
    expect(none.body.errors.map((e: { path: string }) => e.path)).toContain('payeeCompanyId')
    const own = await api('POST', E, financeA, await icBody(financeA, { payeeCompanyId: A }), key())
    expect(own.status).toBe(400)
    expect(own.body.errors.map((e: { path: string }) => e.path)).toContain('payeeCompanyId')
    const d = await ok(api('POST', E, financeA, await icBody(financeA, { invoiceNo: null, invoiceFileId: null }), key()), 201)
    const sent = await api('POST', `${E}/${d.id}/submit`, financeA, {}, key())
    expect(sent.status).toBe(400)
    expect(sent.body.errors.map((e: { path: string }) => e.path)).toEqual(expect.arrayContaining(['invoiceNo', 'invoiceFileId']))
  })

  it('the same document number of the same receiving PT on a live request → 409 errors[invoiceNo]', async () => {
    const no = `TAG/${Date.now()}-ic`
    await ok(api('POST', E, financeA, await icBody(financeA, { invoiceNo: no }), key()), 201)
    const dup = await api('POST', E, financeA, await icBody(financeA, { invoiceNo: ` ${no.toLowerCase()} ` }), key())
    expect(dup.status).toBe(409)
    expect(dup.body.errors[0]).toMatchObject({ path: 'invoiceNo' })
  })
})

describe('d. approval routing', () => {
  it('Finance files → "Pembayaran antar-PT oleh Finance — Direktur lalu Owner"; the snapshot is B\'s designated account', async () => {
    const d = await ok(api('POST', E, financeA, await icBody(financeA), key()), 201)
    const s = await ok(api('POST', `${E}/${d.id}/submit`, financeA, {}, key()))
    expect(s.status).toBe('pending_approval')
    expect(s.approvalRule).toMatchObject({ name: INTERCOMPANY_FINANCE_RULE_NAME, acknowledge: 'none', steps: [{ level: 1, approverRole: 'pk-owner', approverUserId: null }, { level: 2, approverRole: 'pk-principal', approverUserId: null }] })
    expect(s.bank).toMatchObject({ accountHolder: 'PT Contoh Penerima' })
  })

  it('a Direktur files his own → "Pengajuan Direktur" (Owner approves; G1: someone else)', async () => {
    const d = await ok(api('POST', E, direkturA, await icBody(direkturA), key()), 201)
    expect(d.requesters.map((r: { id: number }) => r.id)).toEqual([direkturA.employee])
    const s = await ok(api('POST', `${E}/${d.id}/submit`, direkturA, {}, key()))
    expect(s.status).toBe('pending_approval')
    expect(s.approvalRule.name).toBe(DIREKTUR_RULE_NAME)
    expect(s.approvalRule.steps.map((x: { approverRole: string }) => x.approverRole)).toEqual(['pk-principal'])
  })
})

let paidId = 0
let transferId = 0
let kmId = 0

describe('e. transfer: KK in A + automatic Kas Masuk in B', () => {
  it('queue badge data; the transfer completes the request and posts the KM in B (paired link)', async () => {
    paidId = await approvedPayment()
    const q = await ok(api('GET', '/api/v1/transfer-queue', w.users.finance))
    expect(q.items.find((i: { id: number }) => i.id === paidId)).toMatchObject({ payeeType: 'pt_grup', typeLabel: 'Pembayaran antar-PT', bankVerification: 'verified', payeeCompany: { id: B, shortCode: codeB } })
    const t = await ok(api('POST', `${E}/${paidId}/transfer`, w.users.finance, await transferBody(paidId), key()), 201)
    transferId = t.transferId
    expect(t.request.status).toBe('completed')
    expect(t.intercompany).toMatchObject({ company: { id: B, shortCode: codeB } })
    expect(t.intercompany.cashEntryNo).toMatch(/^KM\//)
    kmId = t.intercompany.cashEntryId
    expect(t.request.intercompany).toMatchObject({ status: 'posted', targetEntryNo: t.intercompany.cashEntryNo })
    const km = (await sqlAs('app', 'SELECT company_id, direction::text AS direction, source_type::text AS source_type, cash_account_id, amount::int AS amount, project_id FROM cash_entries WHERE id = $1', [kmId])).rows[0]
    expect(km).toMatchObject({ company_id: B, direction: 'in', source_type: 'intercompany', cash_account_id: accB, amount: 2_500_000, project_id: null })
    const link = (await sqlAs('app', "SELECT status, source_company_id, target_company_id, source_transfer_id, source_cash_entry_id FROM intercompany_links WHERE source_doc_type = 'expense_request' AND source_doc_id = $1", [paidId])).rows
    expect(link).toHaveLength(1)
    expect(link[0]).toMatchObject({ status: 'posted', source_company_id: A, target_company_id: B, source_transfer_id: transferId, source_cash_entry_id: t.cashEntryId })
  })

  it('Finance of B sees the KM with its counterpart (numbers + PT only), cannot void it, and was notified', async () => {
    const r = await ok(api('GET', '/api/v1/cash-entries?sourceType=intercompany', financeB))
    const km = r.items.find((i: { id: number }) => i.id === kmId)
    expect(km).toMatchObject({ sourceType: 'intercompany', direction: 'in', companyId: B, intercompany: { direction: 'in', status: 'posted', counterpartCompany: { id: A, shortCode: codeA }, canOpenCounterpart: false } })
    expect(km.intercompany.transferDocNo).toMatch(/\S/)
    const v = await api('POST', `/api/v1/cash-entries/${kmId}/void`, financeB, { reason: 'coba void langsung' }, key())
    expect(v.status).toBe(409)
    const n = await sqlAs('app', "SELECT company_id FROM notifications WHERE user_id = $1 AND event = 'cash.intercompany_received' AND doc_id = $2", [financeB.id, String(kmId)])
    expect(n.rows).toHaveLength(1)
    expect(n.rows[0].company_id).toBe(B)
    // Finance of A reads its KK with the counterpart "Ke PT B"
    const a = await ok(api('GET', '/api/v1/cash-entries?sourceType=transfer', w.users.finance))
    const kk = a.items.find((i: { transferId: number | null }) => i.transferId === transferId)
    expect(kk.intercompany).toMatchObject({ direction: 'out', counterpartCompany: { id: B }, counterpartEntryId: kmId })
  })
})

describe('h. DB guards of intercompany_links', () => {
  it('immutable (only posted → void), no DELETE, sides checked', async () => {
    const link = (await sqlAs('app', 'SELECT id, source_cash_entry_id, target_cash_entry_id, target_cash_account_id, amount FROM intercompany_links WHERE source_transfer_id = $1', [transferId])).rows[0]
    expect((await sqlError('app', 'UPDATE intercompany_links SET amount = 1 WHERE id = $1', [link.id]))?.code).toBe('42501')
    expect((await sqlError('app', 'DELETE FROM intercompany_links WHERE id = $1', [link.id]))?.code).toBe('42501')
    // the request belongs to A, not B → side mismatch
    expect(
      (
        await sqlError(
          'app',
          "INSERT INTO intercompany_links (source_company_id, target_company_id, source_doc_type, source_doc_id, source_cash_entry_id, target_cash_account_id, target_cash_entry_id, amount) VALUES ($1, $2, 'expense_request', $3, $4, $5, $6, $7)",
          [B, A, paidId, link.source_cash_entry_id, link.target_cash_account_id, link.target_cash_entry_id, link.amount],
        )
      )?.code,
    ).toBe('23514')
  })
})

describe('g. void of A\'s transfer', () => {
  it('reverses the KM in B, voids the link, request back in the queue; Finance notified, no "Disetujui" to the people', async () => {
    const before = Number((await sqlAs('app', 'SELECT coalesce(max(id), 0) AS m FROM notifications')).rows[0].m)
    const v = await ok(api('POST', `${E}/${paidId}/transfers/${transferId}/void`, w.users.finance, { reason: 'salah tanggal transfer' }, key()))
    expect(v.status).toBe('approved')
    expect(v.intercompany).toMatchObject({ status: 'void' })
    expect((await sqlAs('app', 'SELECT status::text AS s FROM cash_entries WHERE id = $1', [kmId])).rows[0].s).toBe('void')
    const rev = (await sqlAs('app', "SELECT company_id, direction::text AS direction, source_type::text AS source_type FROM cash_entries WHERE reversal_of_id = $1", [kmId])).rows
    expect(rev).toEqual([{ company_id: B, direction: 'out', source_type: 'reversal' }])
    expect((await sqlAs('app', 'SELECT status FROM intercompany_links WHERE source_transfer_id = $1', [transferId])).rows[0].status).toBe('void')
    const after = await sqlAs('app', 'SELECT user_id, event FROM notifications WHERE id > $1 AND doc_type = $2 AND doc_id = $3', [before, 'expense_request', String(paidId)])
    const events = after.rows as Array<{ user_id: number; event: string }>
    expect(events.some((e) => e.event === 'expense.transfer_queue' && e.user_id === w.users.finance2.id)).toBe(true)
    expect(events.filter((e) => e.event === 'expense.approved')).toEqual([])
    const bNote = await sqlAs('app', "SELECT 1 FROM notifications WHERE user_id = $1 AND event = 'cash.intercompany_reversed' AND doc_id = $2", [financeB.id, String(kmId)])
    expect(bNote.rows).toHaveLength(1)
  })
})

describe('f. closed period in the receiving PT', () => {
  it('B closed for the transfer date → 409 INTERCOMPANY_PERIOD_CLOSED, nothing written', async () => {
    const id = await approvedPayment()
    // the current month of B closed (raw owner write: the app only closes past months; A stays open)
    await sqlAs('owner', "INSERT INTO period_closings (company_id, period, status, note, updated_at, created_at) VALUES ($1, $2, 'closed', 'uji antar-PT', now(), now())", [B, ptToday().slice(0, 7)])
    const r = await api('POST', `${E}/${id}/transfer`, w.users.finance, await transferBody(id), key())
    expect(r.status, JSON.stringify(r.body)).toBe(409)
    expect(r.body.code).toBe('INTERCOMPANY_PERIOD_CLOSED')
    expect((await sqlAs('app', 'SELECT count(*)::int AS n FROM transfers WHERE request_id = $1', [id])).rows[0].n).toBe(0)
    expect((await sqlAs('app', 'SELECT count(*)::int AS n FROM cash_entries WHERE expense_request_id = $1', [id])).rows[0].n).toBe(0)
    expect((await ok(api('GET', `${E}/${id}`, financeA))).status).toBe('approved')
  })
})
