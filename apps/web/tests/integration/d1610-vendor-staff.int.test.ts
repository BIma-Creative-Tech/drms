import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadRequestPanel } from '@/admin/components/request/panel-data'
import { resetRateLimits } from '@/lib/rate-limit'

import { companyId, getTestPayload, sqlAs } from './helpers'
import { ADR0013_FALLBACK_RULE, api, makeFlowUser, makeWorld, png, sysCreate, upload, type FlowUser, type World } from './flow-world'

/**
 * Owner request 2026-10-16 ("untuk pengajuan vendor dibukakan di level staff"): Staff (`pk-staff`) may file a
 * "Pembayaran vendor" (ADR 0027) in its own PT, through the real API + DB:
 * - Staff READ the vendors and vendor accounts of its own PT (REST + masters, the picker) — never of a PT it is not
 *   mapped to — and never create / update them (REST + /api/v1/vendor-form);
 * - a Staff vendor payment follows the NORMAL Staff flow: the PT's default rule ("Default — PM project lalu Direktur"):
 *   PM project ("Diketahui" = Persetujuan PM) → Direktur → Owner → Finance transfer → Selesai (no LPJ); without project
 *   (ADR 0031) the PM step is left out, the Direktur decides. The seeded Finance vendor rule stays Finance-only;
 * - Admin / Owner-only callers are still refused (403).
 * The world's unscoped ADR 0013 test fallback rule (priority 90) is switched off in this file so the SEEDED default rule
 * decides (restored in afterAll). Fictional data only.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))

const DEFAULT_RULE = 'Default — PM project lalu Direktur (semua nominal)'
let w: World
let pt = 0
let otherPt = 0
let principalS: FlowUser
let projectS = 0
let ccS = 0
let foreignProject = 0
let vendor = 0
let acc = 0
let vendorX = 0
let accX = 0
let fallbackIds: number[] = []
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })
const today = () => new Date().toISOString().slice(0, 10)

async function ok(p: Promise<{ status: number; body: any }>, status = 200) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await p
  expect(r.status, JSON.stringify(r.body)).toBe(status)
  return r.body
}

beforeAll(async () => {
  // 1. PT A world while it is still the only active PT (sysCreate relies on that default)
  w = await makeWorld('VST')
  pt = await companyId()
  const p = await getTestPayload()
  const empOwn = await sysCreate('employees', { code: 'VST-OWN', name: 'VST Owner' })
  principalS = await makeFlowUser(['pk-principal'], 'vst-principal', empOwn) // ADR 0026 Owner level of the default rule
  // own project + cost center without a world rule (the world's rules are scoped to w.project / w.costCenter)
  projectS = await sysCreate('projects', { code: 'VST-PS', name: 'VST Proyek Staff', pm: w.users.pm.id, budget: 0, status: 'berjalan', costCenter: w.projectCostCenter })
  ccS = await sysCreate('cost-centers', { code: 'VST-KTR', name: 'VST Kantor', manager: w.users.pm.id })
  foreignProject = await sysCreate('projects', { code: 'VST-PX', name: 'VST Proyek Tanpa Staff', pm: w.users.pm.id, budget: 0, status: 'berjalan', costCenter: w.projectCostCenter })
  await sysCreate('team-assignments', { employee: w.emp.a, project: projectS, roleInProject: 'staff' })
  await sysCreate('team-assignments', { employee: w.emp.a, costCenter: ccS, roleInProject: 'staff' })
  const bank = (await p.find({ collection: 'banks', where: { code: { equals: 'MANDIRI' } }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number
  vendor = await sysCreate('vendors', { company: pt, name: 'CV Contoh Bangunan Staff' })
  acc = await sysCreate('vendor-bank-accounts', { vendor, bank, accountNo: `71${Date.now() % 1e9}`, accountHolder: 'CV Contoh Bangunan Staff', isDefault: true, verificationStatus: 'verified' })
  // the seeded default rule decides: the unscoped ADR 0013 test fallback (priority 90) off in PT A for this file
  fallbackIds = (await sqlAs('owner', 'UPDATE approval_rules SET active = false WHERE company_id = $1 AND name = $2 AND active RETURNING id', [pt, ADR0013_FALLBACK_RULE])).rows.map((r) => Number(r.id))
  // 2. a PT the Staff is NOT mapped to, with its own vendor + account (explicit company from here on)
  otherPt = await sysCreate('companies', { name: 'PT Contoh Vendor Lain', shortCode: `VSX${Date.now() % 1000}`, timezone: 'Asia/Makassar' })
  vendorX = await sysCreate('vendors', { company: otherPt, name: 'CV Contoh Luar PT' })
  accX = await sysCreate('vendor-bank-accounts', { vendor: vendorX, bank, accountNo: `72${Date.now() % 1e9}`, accountHolder: 'CV Contoh Luar PT', verificationStatus: 'verified' })
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  const p = await getTestPayload()
  if (fallbackIds.length) await sqlAs('owner', 'UPDATE approval_rules SET active = true WHERE id = ANY($1::int[])', [fallbackIds])
  if (otherPt) await p.update({ collection: 'companies', id: otherPt, data: { active: false, changeReason: 'uji vendor staff selesai' } as never, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
  await p.destroy()
})

async function invoiceFile(user: FlowUser): Promise<number> {
  return (await ok(upload('/api/v1/media/attachments', user, await png()), 201)).id as number
}

async function vendorBody(user: FlowUser, over: Record<string, unknown> = {}) {
  return {
    type: 'advance',
    payeeType: 'vendor',
    title: 'Bayar invoice pasir (Staff)',
    projectId: projectS,
    vendorId: vendor,
    vendorBankAccountId: acc,
    invoiceNo: `INV/ST/${randomUUID().slice(0, 8)}`,
    invoiceDate: today(),
    invoiceFileId: await invoiceFile(user),
    lines: [{ description: 'Pasir 5 m3', qty: 5, uomId: w.uom.l, unitPrice: 400_000, categoryId: w.cat.mat }],
    ...over,
  }
}

const idsOf = (rows: Array<{ id: number }>) => rows.map((r) => r.id)

describe('Staff reads the vendor masters of its own PT only', () => {
  it('REST + masters: vendors and accounts of PT A; nothing of the unmapped PT (list, by id, ?company=)', async () => {
    const all = await ok(api('GET', '/api/vendors?limit=200&depth=0', w.users.staffA))
    expect(all.docs.every((d: { company: number }) => d.company === pt)).toBe(true)
    const vs = await ok(api('GET', `/api/vendors?depth=0&where[id][in]=${vendor},${vendorX}`, w.users.staffA))
    expect(idsOf(vs.docs)).toEqual([vendor])
    const accs = await ok(api('GET', `/api/vendor-bank-accounts?depth=0&where[id][in]=${acc},${accX}`, w.users.staffA))
    expect(idsOf(accs.docs)).toEqual([acc])
    expect([403, 404]).toContain((await api('GET', `/api/vendors/${vendorX}?depth=0`, w.users.staffA)).status)
    expect([403, 404]).toContain((await api('GET', `/api/vendor-bank-accounts/${accX}?depth=0`, w.users.staffA)).status)
    const m = await ok(api('GET', '/api/v1/masters?types=vendors,vendor-bank-accounts', w.users.staffA))
    expect(idsOf(m.types.vendors.items)).toContain(vendor)
    expect(idsOf(m.types.vendors.items)).not.toContain(vendorX)
    expect(idsOf(m.types['vendor-bank-accounts'].items)).toContain(acc)
    expect(idsOf(m.types['vendor-bank-accounts'].items)).not.toContain(accX)
    expect((await api('GET', `/api/v1/masters?types=vendors&company=${otherPt}`, w.users.staffA)).status).toBe(403)
    // the vendor page opens read-only (no edit) for the Staff
    const f = await ok(api('GET', `/api/v1/vendor-form/${vendor}`, w.users.staffA))
    expect(f.canEdit).toBe(false)
    expect((await api('GET', `/api/v1/vendor-form/${vendorX}`, w.users.staffA)).status).toBe(404)
  })

  it('Staff never creates or updates a vendor or a vendor account (REST + vendor-form)', async () => {
    const bank = (await sqlAs('app', "SELECT id FROM banks WHERE code = 'MANDIRI'")).rows[0].id as number
    expect((await api('POST', '/api/vendors', w.users.staffA, { company: pt, name: 'CV Buatan Staff' })).status).toBe(403)
    expect((await api('PATCH', `/api/vendors/${vendor}`, w.users.staffA, { name: 'Diubah Staff' })).status).toBe(403)
    expect((await api('POST', '/api/vendor-bank-accounts', w.users.staffA, { vendor, bank, accountNo: '1234567', accountHolder: 'Staff' })).status).toBe(403)
    expect((await api('PATCH', `/api/vendor-bank-accounts/${acc}`, w.users.staffA, { isDefault: false })).status).toBe(403)
    expect((await api('GET', '/api/v1/vendor-form', w.users.staffA)).status).toBe(403)
    expect((await api('POST', '/api/v1/vendor-form', w.users.staffA, { vendor: { name: 'CV Staff Form' } })).status).toBe(403)
    expect((await api('PATCH', `/api/v1/vendor-form/${vendor}`, w.users.staffA, { vendor: { name: 'X' } })).status).toBe(403)
    const row = (await sqlAs('app', 'SELECT v.name, a.is_default FROM vendors v JOIN vendor_bank_accounts a ON a.vendor_id = v.id WHERE a.id = $1', [acc])).rows[0]
    expect(row).toMatchObject({ name: 'CV Contoh Bangunan Staff', is_default: true })
    expect((await sqlAs('app', "SELECT count(*)::int AS n FROM vendors WHERE name IN ('CV Buatan Staff', 'CV Staff Form')")).rows[0].n).toBe(0)
  })
})

describe('Staff files a vendor payment (own PT) → the normal Staff flow', () => {
  it('Draft: Pengajuan Baru, Pemohon = the Staff, no employee account; submit → Persetujuan PM (default rule)', async () => {
    const d = await ok(api('POST', E, w.users.staffA, await vendorBody(w.users.staffA, { type: 'reimburse' }), key()), 201)
    expect(d).toMatchObject({ status: 'draft', type: 'advance', payeeType: 'vendor', typeLabel: 'Pembayaran vendor', bankAccountId: null, vendorBankAccountId: acc })
    expect(d.requesters.map((r: { id: number }) => r.id)).toEqual([w.emp.a])
    // owner decision: a Staff sees the amounts of its OWN request
    expect(d.grandTotal).toBe(2_000_000)

    const s = await ok(api('POST', `${E}/${d.id}/submit`, w.users.staffA, {}, key()))
    expect(s).toMatchObject({ status: 'pending_ack', statusLabel: 'Menunggu persetujuan PM' })
    expect(s.approvalRule).toMatchObject({ name: DEFAULT_RULE, acknowledge: 'required', acknowledgeBy: 'scope_manager', acknowledgerUserId: w.users.pm.id, selfApproval: null })
    expect(s.approvalRule.steps[0]).toMatchObject({ level: 1, approverRole: 'pk-owner' })
    expect(s.bank).toMatchObject({ accountHolder: 'CV Contoh Bangunan Staff' }) // the snapshot = the vendor account
    const panel = (await loadRequestPanel(await getTestPayload(), { ...w.users.staffA, collection: 'users' } as never, d.id))!
    expect(panel.stepper.steps.map((x) => x.key)).toEqual(['diajukan', 'diketahui', 'approval-1', 'approval-2', 'transfer', 'end'])

    // PM → Direktur → Owner → Finance transfer → Selesai (no LPJ)
    expect((await api('POST', `${E}/${d.id}/acknowledge`, w.users.owner, {}, key())).status).toBe(403) // the PM's step, not the Direktur's
    const ack = await ok(api('POST', `${E}/${d.id}/acknowledge`, w.users.pm, {}, key()))
    expect(ack).toMatchObject({ status: 'pending_approval', currentLevel: 1 })
    expect((await ok(api('POST', `${E}/${d.id}/approve`, w.users.owner, {}, key()))).status).toBe('pending_approval')
    expect((await ok(api('POST', `${E}/${d.id}/approve`, principalS, {}, key()))).status).toBe('approved')
    const q = await ok(api('GET', '/api/v1/transfer-queue', w.users.finance))
    expect(q.items.find((i: { id: number }) => i.id === d.id)).toMatchObject({ payeeType: 'vendor', vendorName: 'CV Contoh Bangunan Staff', typeLabel: 'Pembayaran vendor' })
    const proof = (await ok(upload('/api/v1/media/transfer-proofs', w.users.finance, await png()), 201)).id as number
    const t = await ok(api('POST', `${E}/${d.id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `VST-${d.id}`, proofMediaId: proof }, key()), 201)
    expect(t.request.status).toBe('completed')
    expect(t.request.settlement).toBeNull()
  })

  it('without project (ADR 0031: no Pusat Biaya, the cost center is ignored): default rule without the PM step → the Direktur decides', async () => {
    const d = await ok(api('POST', E, w.users.staffA, await vendorBody(w.users.staffA, { projectId: null, costCenterId: ccS }), key()), 201)
    expect(d).toMatchObject({ projectId: null, costCenterId: null, payeeType: 'vendor' })
    const s = await ok(api('POST', `${E}/${d.id}/submit`, w.users.staffA, {}, key()))
    expect(s.status).toBe('pending_approval')
    expect(s.approvalRule).toMatchObject({ name: DEFAULT_RULE, acknowledgerUserId: null })
  })

  it('Staff rules still apply: only for itself, only its assigned project, only vendors / accounts of the PT', async () => {
    const other = await api('POST', E, w.users.staffA, await vendorBody(w.users.staffA, { requesterIds: [w.emp.b] }), key())
    expect(other.status, JSON.stringify(other.body)).toBe(403)
    const notAssigned = await api('POST', E, w.users.staffA, await vendorBody(w.users.staffA, { projectId: foreignProject }), key())
    expect(notAssigned.status).toBe(403)
    expect(notAssigned.body.title).toBe('Project di luar penugasan Anda.')
    const foreign = await api('POST', E, w.users.staffA, await vendorBody(w.users.staffA, { vendorId: vendorX, vendorBankAccountId: accX }), key())
    expect(foreign.status).toBe(400)
    expect(foreign.body.errors.map((e: { path: string }) => e.path)).toEqual(expect.arrayContaining(['vendorId', 'vendorBankAccountId']))
    // PT grup stays Finance / PM / Direktur
    const ic = await api('POST', E, w.users.staffA, { type: 'advance', payeeType: 'pt_grup', title: 'Bayar PT lain', projectId: projectS, payeeCompanyId: otherPt, lines: [] }, key())
    expect(ic.status).toBe(403)
    expect(ic.body.title).toBe('Pembayaran antar-PT hanya dapat diajukan oleh Finance, PM atau Direktur di PT ini.')
  })

  it('Admin and an Owner-only user are still refused', async () => {
    for (const u of [w.users.admin, principalS]) {
      const r = await api('POST', E, u, await vendorBody(u), key())
      expect(r.status, JSON.stringify(r.body)).toBe(403)
      expect(r.body.title).toBe('Pembayaran vendor hanya dapat diajukan oleh Staff, Finance atau PM di PT ini.')
    }
  })
})
