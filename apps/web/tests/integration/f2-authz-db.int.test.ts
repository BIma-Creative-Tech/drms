import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { accessToken, auditRows, getTestPayload, http, installLocalJwks, registerDevice, sqlAs, sqlError } from './helpers'
import { api, draftBody, makeFlowUser, makeWorld, png, upload, type World } from './flow-world'

/**
 * Architecture §7.4 negative-authorization set for the F2a collections + DB-level guards
 * (ADR 0005/0006): other PM's project, requester approving own request, Finance changing an
 * approved amount, hard deletes, closed-period postings rejected BY THE DB (raw SQL as app role),
 * append-only approvals/snapshots, frozen lines/requesters after submit.
 */
let w: World
const E = '/api/v1/expense-requests'
let approvedId: number
let pendingId: number

beforeAll(async () => {
  w = await makeWorld('AZ')
  const c = await api('POST', E, w.users.staffA, draftBody(w))
  approvedId = c.body.id
  await api('POST', `${E}/${approvedId}/submit`, w.users.staffA, {})
  await api('POST', `${E}/${approvedId}/acknowledge`, w.users.owner, {})
  const a = await api('POST', `${E}/${approvedId}/approve`, w.users.finance, {})
  expect(a.body.status).toBe('approved')
  const d = await api('POST', E, w.users.staffA, draftBody(w))
  pendingId = d.body.id
  await api('POST', `${E}/${pendingId}/submit`, w.users.staffA, {})
})

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

describe('read scopes (own / team / Q-23 / all)', () => {
  it("PM of another project: detail 404, list empty, satellites empty; Staff B sees nothing of A's project request", async () => {
    expect((await api('GET', `${E}/${approvedId}`, w.users.otherPm)).status).toBe(404)
    expect((await api('GET', `${E}?scope=all&limit=100`, w.users.otherPm)).body.items).toEqual([])
    expect((await api('GET', `${E}/${approvedId}/history`, w.users.otherPm)).status).toBe(404)
    const p = await getTestPayload()
    for (const collection of ['approvals', 'receipts', 'receipt-flags', 'transfers', 'expense-line-snapshots'] as const) {
      const r = await p.find({ collection, where: { request: { equals: approvedId } }, user: w.users.otherPm, overrideAccess: false }).catch((e) => ({ docs: [], status: (e as { status: number }).status }))
      expect(r.docs, collection).toEqual([])
    }
    expect((await api('GET', `${E}/${approvedId}`, w.users.staffB)).status).toBe(404) // project request, not his
    expect((await api('GET', `${E}/${approvedId}`, w.users.pm)).status).toBe(200) // team
  })

  it('Q-23: Staff B assigned to the cost center reads its requests (read only, bank number masked)', async () => {
    const c = await api('POST', E, w.users.staffA, draftBody(w, { projectId: null, costCenterId: w.costCenter }))
    const r = await api('GET', `${E}/${c.body.id}`, w.users.staffB)
    expect(r.status).toBe(200)
    expect(r.body.allowedActions).toEqual([])
    expect((await api('PATCH', `${E}/${c.body.id}`, w.users.staffB, { title: 'x' })).status).toBe(403)
    await api('POST', `${E}/${c.body.id}/submit`, w.users.staffA, {})
    const again = await api('GET', `${E}/${c.body.id}`, w.users.staffB)
    expect(again.body.bank.accountNo).toMatch(/^••••\d{4}$/)
    expect((await api('GET', `${E}/${c.body.id}`, w.users.staffA)).body.bank.accountNo).toMatch(/^\d+$/)
  })

  it('cash ledger and period closings are invisible to Staff/PM (403 on /api/v1, 403 on REST)', async () => {
    for (const u of [w.users.staffA, w.users.pm]) {
      expect((await api('GET', '/api/v1/cash-entries', u)).status).toBe(403)
      expect((await api('GET', '/api/v1/cash-accounts/balances', u)).status).toBe(403)
      expect((await api('GET', '/api/cash-entries', u)).status).toBe(403)
      expect((await api('GET', '/api/period-closings', u)).status).toBe(403)
    }
  })
})

describe('decisions (G1, G2, US-17)', () => {
  it('a requester (with the Direktur role) cannot approve their own request — API 403 and DB trigger', async () => {
    const ownerEmp = await (async () => {
      const p = await getTestPayload()
      return (await p.create({ collection: 'employees', data: { code: 'AZ-OWN', name: 'AZ Owner-Pemohon' }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })).id as number
    })()
    const ownerRequester = await makeFlowUser(['pk-owner'], 'az-owner-req', ownerEmp)
    const c = await api('POST', E, w.users.admin, draftBody(w, { requesterIds: [w.emp.a, ownerEmp] })) // 2nd requester = an Owner
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    await api('POST', `${E}/${c.body.id}/submit`, w.users.admin, {})
    await api('POST', `${E}/${c.body.id}/acknowledge`, w.users.owner, {})
    expect((await api('POST', `${E}/${c.body.id}/approve`, ownerRequester, {})).status).toBe(403)
    expect((await api('POST', `${E}/${c.body.id}/reject`, ownerRequester, { reason: 'tolak sendiri' })).status).toBe(403)
    // DB backstop: even a raw insert as the app role is refused
    const err = await sqlError(
      'app',
      "INSERT INTO approvals (doc_type, request_id, cycle, position, level, actor_id, decision) VALUES ('expense_request', $1, 1, 'approval', 1, $2, 'approved')",
      [c.body.id, ownerRequester.id],
    )
    expect(err?.message).toContain('requester/creator cannot hold a decision position')
    // the creator (Admin) cannot either
    const err2 = await sqlError(
      'app',
      "INSERT INTO approvals (doc_type, request_id, cycle, position, level, actor_id, decision) VALUES ('expense_request', $1, 1, 'approval', 1, $2, 'approved')",
      [c.body.id, w.users.admin.id],
    )
    expect(err2?.message).toContain('requester/creator')
  })

  it('PM, Admin, Staff and a Direktur (not the rule step) cannot approve; Finance of the step can (ADR 0013)', async () => {
    await api('POST', `${E}/${pendingId}/acknowledge`, w.users.owner, {})
    for (const u of [w.users.pm, w.users.admin, w.users.owner, w.users.owner2, w.users.staffB]) {
      expect([403, 404], u.email).toContain((await api('POST', `${E}/${pendingId}/approve`, u, {})).status)
    }
    expect((await api('POST', `${E}/${pendingId}/approve`, w.users.finance, {})).status).toBe(200)
  })
})

describe('Finance cannot change an approved amount (G3)', () => {
  it('v1 PATCH 403, generic REST PATCH 403, transfer with another amount 409', async () => {
    expect((await api('PATCH', `${E}/${approvedId}`, w.users.finance, { lines: [{ description: 'x', total: 1, categoryId: w.cat.mat }] })).status).toBe(403)
    const rest = await api('PATCH', `/api/expense-requests/${approvedId}`, w.users.finance, { grandTotal: 1, approvedAmount: 1 })
    expect(rest.status).toBe(403)
    const pf = await upload('/api/v1/media/transfer-proofs', w.users.finance, await png())
    expect((await api('POST', `${E}/${approvedId}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: 'B', proofMediaId: pf.body.id, amount: 1 })).status).toBe(409)
  })

  it('DB: approved_amount / grand_total / locked lines cannot change even with raw SQL as the app role', async () => {
    expect((await sqlError('app', 'UPDATE expense_requests SET approved_amount = 1 WHERE id = $1', [approvedId]))?.message).toMatch(/approved_amount|locked/)
    expect((await sqlError('app', 'UPDATE expense_requests SET grand_total = 1 WHERE id = $1', [approvedId]))?.message).toContain('content is locked')
    expect((await sqlError('app', 'UPDATE expense_requests SET title = $2 WHERE id = $1', [approvedId, 'x']))?.message).toContain('content is locked')
    // lines/requesters are Payload child rows: any change is caught by the DEFERRED freeze check
    expect((await sqlError('app', 'UPDATE expense_requests_lines SET total = 1 WHERE _parent_id = $1', [approvedId]))?.message).toMatch(/locked|grand_total/)
    expect((await sqlError('app', "DELETE FROM expense_requests_rels WHERE parent_id = $1 AND path = 'requesters'", [approvedId]))?.message).toContain('locked')
    // Payload itself (delete + re-insert of identical children on a status update) passes the check
    const t = await api('GET', `${E}/${approvedId}`, w.users.finance)
    expect(t.body).toMatchObject({ grandTotal: 750_000, approvedAmount: 750_000 })
  })

  it('DB: transfers must copy the approved amount; the approved request is the only queue state', async () => {
    const err = await sqlError(
      'app',
      "INSERT INTO transfers (doc_no, request_id, kind, cash_account_id, amount, bank_ref, proof_id, transfer_date, status) VALUES ('TRF/X/1', $1, 'advance', $2, 1, 'r', (SELECT id FROM media_transfer_proofs LIMIT 1), '2026-09-23', 'posted')",
      [approvedId, w.cashAccount],
    )
    expect(err?.message).toContain('amount must equal the approved amount')
  })
})

describe('Class A / B tables (ADR 0006 §2) and hard delete (G4)', () => {
  it('approvals and snapshots: no UPDATE/DELETE/TRUNCATE for the app role; owner blocked by trigger', async () => {
    for (const t of ['approvals', 'expense_line_snapshots']) {
      for (const q of [`UPDATE ${t} SET cycle = 9`, `DELETE FROM ${t}`, `TRUNCATE ${t}`]) expect((await sqlError('app', q))?.code, q).toBe('42501')
      expect((await sqlError('owner', `UPDATE ${t} SET cycle = 9`))?.message).toContain('append-only')
    }
    const t = await sqlAs('app', 'SELECT decided_at FROM approvals WHERE request_id = $1 LIMIT 1', [approvedId])
    expect(Math.abs(new Date(t.rows[0].decided_at).getTime() - Date.now())).toBeLessThan(10 * 60_000) // DB clock
  })

  it('no DELETE on business tables for the app role', async () => {
    for (const t of ['expense_requests', 'receipts', 'receipt_flags', 'transfers', 'cash_entries', 'period_closings']) {
      expect((await sqlError('app', `DELETE FROM ${t} WHERE id = -1`))?.code, t).toBe('42501')
    }
  })

  it('HTTP DELETE on /api/<slug> → 403 for every role and a delete_attempt audit row', async () => {
    const entry = await api('POST', '/api/v1/cash-entries', w.users.finance, { direction: 'in', cashAccountId: w.cashAccount, amount: 10_000, description: 'uji hapus', cashInSourceId: w.cashInSource })
    expect(entry.status, JSON.stringify(entry.body)).toBe(201)
    for (const u of [w.users.finance, w.users.owner, w.users.admin]) {
      expect((await api('DELETE', `/api/cash-entries/${entry.body.id}`, u)).status).toBe(403)
      expect((await api('DELETE', `/api/expense-requests/${approvedId}`, u)).status).toBe(403)
    }
    const rows = await auditRows('cash_entry', entry.body.id)
    expect(rows.filter((r) => r.action === 'delete_attempt').length).toBe(3)
    expect((await auditRows('expense_request', approvedId)).filter((r) => r.action === 'delete_attempt').length).toBe(3)
  })

  it('APK bearer on generic REST /api/expense-requests is never authenticated', async () => {
    await installLocalJwks()
    const sub = (await sqlAs('app', 'SELECT keycloak_sub FROM users WHERE id = $1', [w.users.finance.id])).rows[0].keycloak_sub
    const token = await accessToken({ keycloakSub: sub }, ['pk-finance'])
    const device = await registerDevice({ ...w.users.finance, keycloakSub: sub }, token)
    const r = await http('GET', '/api/expense-requests', { headers: { Authorization: `Bearer ${token}`, 'X-Device-Id': device } })
    expect(r.status).toBe(403)
    const ok = await http('GET', `${E}/${approvedId}`, { headers: { Authorization: `Bearer ${token}`, 'X-Device-Id': device } })
    expect(ok.status).toBe(200)
  })
})

describe('cash ledger (US-23/US-24, ADR 0005) and period closing (G5)', () => {
  let augustEntry: number

  it('manual cash in/out (Finance only), balances = opening + in − out', async () => {
    expect((await api('POST', '/api/v1/cash-entries', w.users.owner, { direction: 'out', cashAccountId: w.cashAccount, amount: 1, description: 'x', categoryId: w.cat.mat })).status).toBe(403)
    expect((await api('POST', '/api/v1/cash-entries', w.users.finance, { direction: 'out', cashAccountId: w.cashAccount, amount: 1, description: 'x' })).status).toBe(400) // category required
    const out = await api('POST', '/api/v1/cash-entries', w.users.finance, { direction: 'out', entryDate: '2026-08-15', cashAccountId: w.cashAccount, amount: 250_000, description: 'Beli ATK', categoryId: w.cat.mat, projectId: w.project })
    expect(out.status, JSON.stringify(out.body)).toBe(201)
    expect(out.body).toMatchObject({ entryNo: expect.stringMatching(/^KK\/2608\/\d{4}$/), period: '2026-08', status: 'posted', sourceType: 'manual' })
    augustEntry = out.body.id
    const bal = await api('GET', '/api/v1/cash-accounts/balances', w.users.owner)
    const mine = bal.body.items.find((b: { cashAccountId: number }) => b.cashAccountId === w.cashAccount)
    expect(mine.balance).toBe(mine.openingBalance + mine.totalIn - mine.totalOut)
    expect(mine.totalOut).toBeGreaterThanOrEqual(250_000)
  })

  it('edit only descriptive fields with a reason; amount changes are impossible (DB)', async () => {
    expect((await api('PATCH', `/api/v1/cash-entries/${augustEntry}`, w.users.finance, { description: 'Beli ATK kantor' })).status).toBe(400)
    const e = await api('PATCH', `/api/v1/cash-entries/${augustEntry}`, w.users.finance, { description: 'Beli ATK kantor', reason: 'typo' })
    expect(e.status, JSON.stringify(e.body)).toBe(200)
    expect((await sqlError('app', 'UPDATE cash_entries SET amount = 1 WHERE id = $1', [augustEntry]))?.message).toContain('immutable')
    expect((await sqlError('app', "UPDATE cash_entries SET entry_date = '2026-08-16' WHERE id = $1", [augustEntry]))?.message).toContain('immutable')
  })

  it('close 2026-08 (Finance): the DB rejects postings dated in the closed period, even raw SQL as the app role', async () => {
    const c = await api('POST', '/api/v1/period-closings', w.users.finance, { period: '2026-08', note: 'tutup Agustus' })
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    expect((await api('POST', '/api/v1/period-closings', w.users.finance, { period: '2026-08' })).status).toBe(409)
    expect((await api('POST', '/api/v1/period-closings', w.users.finance, { period: '2099-01' })).status).toBe(409) // future
    const api409 = await api('POST', '/api/v1/cash-entries', w.users.finance, { direction: 'in', entryDate: '2026-08-20', cashAccountId: w.cashAccount, amount: 5, description: 'telat', cashInSourceId: w.cashInSource })
    expect(api409.status).toBe(409)
    const raw = await sqlError(
      'app',
      "INSERT INTO cash_entries (entry_no, entry_date, direction, amount, cash_account_id, source_type, status) VALUES ('KM/X/1', '2026-08-20', 'in', 5, $1, 'manual', 'posted')",
      [w.cashAccount],
    )
    expect(raw?.code).toBe('42501')
    expect(raw?.message).toContain('is closed')
    expect((await sqlError('app', "UPDATE cash_entries SET description = 'x' WHERE id = $1", [augustEntry]))?.message).toContain('open period')
    const periods = await api('GET', '/api/v1/period-closings', w.users.admin)
    expect(periods.body.lockDate).toBe('2026-08-31')
  })

  it('void of an entry in a closed period: reversal dated in the open period, original stays visible (T8)', async () => {
    expect((await api('POST', `/api/v1/cash-entries/${augustEntry}/void`, w.users.finance, {})).status).toBe(400)
    const v = await api('POST', `/api/v1/cash-entries/${augustEntry}/void`, w.users.finance, { reason: 'salah input' })
    expect(v.status, JSON.stringify(v.body)).toBe(200)
    expect(v.body.original).toMatchObject({ id: augustEntry, status: 'void', voidReason: 'salah input', entryDate: '2026-08-15' })
    expect(v.body.reversal).toMatchObject({ direction: 'in', amount: 250_000, sourceType: 'reversal', reversalOfId: augustEntry })
    expect(v.body.reversal.entryDate > '2026-08-31').toBe(true)
    expect((await api('POST', `/api/v1/cash-entries/${augustEntry}/void`, w.users.finance, { reason: 'lagi' })).status).toBe(409)
    expect((await api('POST', `/api/v1/cash-entries/${v.body.reversal.id}/void`, w.users.finance, { reason: 'balik' })).status).toBe(409)
    const rows = await auditRows('cash_entry', augustEntry)
    expect(rows.find((r) => r.action === 'void' && r.reason === 'salah input')).toBeTruthy()
  })

  it('re-open: Owner only, reason required, only the latest closed period; then postings are accepted again', async () => {
    expect((await api('POST', '/api/v1/period-closings/2026-08/reopen', w.users.finance, { reason: 'koreksi' })).status).toBe(403)
    expect((await api('POST', '/api/v1/period-closings/2026-08/reopen', w.users.owner, {})).status).toBe(400)
    const r = await api('POST', '/api/v1/period-closings/2026-08/reopen', w.users.owner, { reason: 'koreksi auditor' })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.status).toBe('reopened')
    const ok = await api('POST', '/api/v1/cash-entries', w.users.finance, { direction: 'in', entryDate: '2026-08-20', cashAccountId: w.cashAccount, amount: 5, description: 'susulan', cashInSourceId: w.cashInSource })
    expect(ok.status).toBe(201)
    const audit = await sqlAs('app', "SELECT action, reason FROM audit_logs WHERE doc_type = 'period_closing' AND doc_no = '2026-08' ORDER BY id")
    expect(audit.rows).toEqual([
      { action: 'period_close', reason: 'tutup Agustus' },
      { action: 'period_reopen', reason: 'koreksi auditor' },
    ])
  })

  it('transfers dated in a closed period are rejected by the DB (G5)', async () => {
    await api('POST', '/api/v1/period-closings', w.users.finance, { period: '2026-08' })
    const pf = await upload('/api/v1/media/transfer-proofs', w.users.finance, await png())
    const r = await api('POST', `${E}/${approvedId}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: 'OLD', proofMediaId: pf.body.id, transferDate: '2026-08-30' })
    expect(r.status).toBe(409)
    const raw = await sqlError(
      'app',
      "INSERT INTO transfers (doc_no, request_id, kind, cash_account_id, amount, bank_ref, proof_id, transfer_date, status) VALUES ('TRF/X/2', $1, 'advance', $2, 750000, 'r', $3, '2026-08-30', 'posted')",
      [approvedId, w.cashAccount, pf.body.id],
    )
    expect(raw?.message).toContain('is closed')
  })
})

describe('receipts and media ownership', () => {
  it("another staff cannot attach receipts to A's request, nor reuse A's uploaded image", async () => {
    const c = await api('POST', E, w.users.staffA, draftBody(w, { type: 'reimburse' }))
    const img = await upload('/api/v1/media/receipts', w.users.staffA, await png())
    const body = { lineId: c.body.lines[0].id, vendorName: 'x', receiptDate: '2026-09-20', amount: 1000, imageId: img.body.id }
    expect((await api('POST', `${E}/${c.body.id}/receipts`, w.users.staffB, body)).status).toBe(404)
    const own = await api('POST', E, w.users.staffB, draftBody(w, { type: 'reimburse', requesterIds: [w.emp.b], bankAccountId: w.accB }))
    expect(own.status, JSON.stringify(own.body)).toBe(201)
    const steal = await api('POST', `${E}/${own.body.id}/receipts`, w.users.staffB, { ...body, lineId: own.body.lines[0].id })
    expect(steal.status, JSON.stringify(steal.body)).toBe(403)
    expect((await api('POST', `${E}/${c.body.id}/receipts`, w.users.staffA, body)).status).toBe(201)
    // the image is now linked to A's request: the owner link is immutable (DB)
    expect((await sqlError('app', "UPDATE media_receipts SET owner_doc_id = '999' WHERE id = $1", [img.body.id]))?.message).toContain('immutable')
    // Staff B cannot read it through REST; the team PM can
    expect([403, 404]).toContain((await api('GET', `/api/media-receipts/${img.body.id}`, w.users.staffB)).status)
    expect((await api('GET', `/api/media-receipts/${img.body.id}`, w.users.pm)).status).toBe(200)
  })

  it('transfer proofs can be uploaded by Finance only', async () => {
    expect((await upload('/api/v1/media/transfer-proofs', w.users.staffA, await png())).status).toBe(403)
    expect((await upload('/api/v1/media/unknown', w.users.staffA, await png())).status).toBe(404)
  })
})
