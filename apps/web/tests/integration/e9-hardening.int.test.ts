import { NextRequest } from 'next/server'
import { handleEndpoints } from 'payload'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GET as oidcCallback } from '@/app/(auth)/auth/callback/route'
import { auditLoginFailed } from '@/auth/sessions'
import { getEnv } from '@/lib/env'
import { resetRateLimits } from '@/lib/rate-limit'
import { signedMediaPath, signingKeys, signMedia } from '@/lib/signed-url'
import config from '@/payload.config'

import { auditRows, getTestPayload, sqlAs, sqlError } from './helpers'
import { api, draftBody, makeWorld, ORIGIN, png, upload, type FlowUser, type Res, type World } from './flow-world'

/**
 * E9 hardening (plan fase1-golive §E9) through /api/v1:
 * - signed, time-limited media URLs (ADR 0004 §4): expired → 403, valid signature but no access → 403
 *   (+ access_denied), tampering → 403; the bearer/cookie path is unchanged (APK compatibility);
 *   selfies are served by the media file endpoint (uploader / office roles, view_sensitive);
 * - settlement reversal (refund KM / shortfall transfer): balances and statuses restored, audit rows,
 *   Finance only, closed period → 409, re-settle possible, DB guard;
 * - 403 before 409 (UAT 5.2) on the expense flow.
 */
let w: World
const E = '/api/v1/expense-requests'
const OLD_MONTH = '2025-05' // not used by other files (e2: 2025-03, f2: 2026-08, f3: M-1/M-3)
const restoreClosed: string[] = []

async function must(r: Promise<Res>, status = 200): Promise<Res['body']> {
  const x = await r
  expect(x.status, JSON.stringify(x.body)).toBe(status)
  return x.body
}

async function get(path: string, user: FlowUser | null) {
  const h = new Headers({ Origin: ORIGIN })
  if (user) h.set('Cookie', user.cookie)
  const res = await handleEndpoints({ config, request: new Request(`${ORIGIN}${path}`, { method: 'GET', headers: h }) })
  const bytes = Buffer.from(await res.arrayBuffer())
  let body: unknown = null
  try {
    body = JSON.parse(bytes.toString('utf8'))
  } catch {
    body = null
  }
  return { status: res.status, headers: res.headers, bytes, body: body as Record<string, unknown> | null }
}

async function proof(): Promise<number> {
  resetRateLimits()
  return (await must(upload('/api/v1/media/transfer-proofs', w.users.finance, await png()), 201)).id
}

async function transferredAdvance() {
  const c = await must(api('POST', E, w.users.staffA, draftBody(w)), 201)
  const id = c.id as number
  await must(api('POST', `${E}/${id}/submit`, w.users.staffA, {}))
  await must(api('POST', `${E}/${id}/acknowledge`, w.users.owner, {}))
  await must(api('POST', `${E}/${id}/approve`, w.users.finance, {}))
  await must(api('POST', `${E}/${id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `E9-${id}`, proofMediaId: await proof() }), 201)
  return { id, lineIds: c.lines.map((l: { id: string }) => l.id) as string[] }
}

/** Uang Muka 750.000 → LPJ verified with receipts totalling `amounts`. */
async function verifiedLpj(amounts: number[]) {
  const { id, lineIds } = await transferredAdvance()
  for (const [i, amount] of amounts.entries()) {
    const img = await must(upload('/api/v1/media/receipts', w.users.staffA, await png()), 201)
    await must(api('POST', `${E}/${id}/receipts`, w.users.staffA, { lineId: lineIds[i % lineIds.length], receiptNo: `E9-${id}-${i}`, vendorName: 'Toko E9', receiptDate: '2026-09-20', amount, imageId: img.id }), 201)
  }
  await must(api('POST', `${E}/${id}/receipts-complete`, w.users.staffA, {}))
  await must(api('POST', `${E}/${id}/lpj/submit`, w.users.staffA, { usageNotes: 'Material dan konsumsi tukang.' }))
  const d = await must(api('GET', `${E}/${id}`, w.users.finance))
  for (const r of d.receipts) await must(api('POST', `${E}/${id}/receipts/${r.id}/verify`, w.users.finance, {}))
  return { id, verified: await must(api('POST', `${E}/${id}/lpj/verify`, w.users.finance, {})) }
}

async function balance(account: number): Promise<number> {
  const r = await sqlAs(
    'app',
    `SELECT (a.opening_balance + coalesce(sum(CASE WHEN e.direction = 'in' THEN e.amount ELSE -e.amount END), 0))::bigint AS b
       FROM cash_accounts a LEFT JOIN cash_entries e ON e.cash_account_id = a.id WHERE a.id = $1 GROUP BY a.id`,
    [account],
  )
  return Number(r.rows[0].b)
}

beforeAll(async () => {
  w = await makeWorld('EH') // letters only: the tag becomes part of a vehicle plate
})

afterAll(async () => {
  for (const p of restoreClosed.sort()) await api('POST', '/api/v1/period-closings', w.users.finance, { period: p, note: 'dipulihkan setelah uji E9' })
  await (await getTestPayload()).destroy()
})

// ---------------------------------------------------------------- signed media URLs

describe('signed media URLs (ADR 0004 §4)', () => {
  let receiptImg: number
  let requestId: number

  beforeAll(async () => {
    const t = await transferredAdvance()
    requestId = t.id
    receiptImg = (await must(upload('/api/v1/media/receipts', w.users.staffA, await png(9001, 1200, 900)), 201)).id
    await must(api('POST', `${E}/${requestId}/receipts`, w.users.staffA, { lineId: t.lineIds[0], receiptNo: 'E9-SIG-1', vendorName: 'Toko', receiptDate: '2026-09-20', amount: 600_000, imageId: receiptImg }), 201)
  })

  it('mint (caller must be able to read the file) → URL that works WITHOUT cookie/bearer, private/no-store', async () => {
    const m = await get(`/api/v1/media/receipts/${receiptImg}/signed-url?variant=thumb`, w.users.staffA)
    expect(m.status).toBe(200)
    const body = m.body as { url: string; expiresAt: string; ttlSeconds: number }
    expect(body.url).toMatch(new RegExp(`^/api/v1/media/receipts/${receiptImg}/file\\?variant=thumb&exp=\\d+&uid=${w.users.staffA.id}&sig=[A-Za-z0-9_-]{43}$`))
    expect(body.ttlSeconds).toBeGreaterThan(290)
    expect(body.ttlSeconds).toBeLessThanOrEqual(300)
    const f = await get(body.url, null)
    expect(f.status).toBe(200)
    expect(f.headers.get('content-type')).toBe('image/webp')
    expect(f.headers.get('cache-control')).toBe('private, no-store')
    expect(f.headers.get('referrer-policy')).toBe('no-referrer')
    // the team PM and Finance may mint too; another staff / other PM → 404 (no existence leak)
    expect((await get(`/api/v1/media/receipts/${receiptImg}/signed-url`, w.users.pm)).status).toBe(200)
    expect((await get(`/api/v1/media/receipts/${receiptImg}/signed-url`, w.users.staffB)).status).toBe(404)
    expect((await get(`/api/v1/media/receipts/${receiptImg}/signed-url`, w.users.otherPm)).status).toBe(404)
    expect((await get(`/api/v1/media/receipts/${receiptImg}/signed-url`, null)).status).toBe(401)
    expect((await get(`/api/v1/media/receipts/${receiptImg}/signed-url?variant=big`, w.users.staffA)).status).toBe(400)
  })

  it('expired URL → 403 URL_EXPIRED', async () => {
    const keys = signingKeys(getEnv())
    const target = { collection: 'receipts', id: receiptImg, variant: null, userId: w.users.staffA.id }
    const p = signMedia(target, keys, Math.floor(Date.now() / 1000) - 400)
    const r = await get(signedMediaPath('/api', target, p), null)
    expect(r.status).toBe(403)
    expect(r.body).toMatchObject({ status: 403, code: 'URL_EXPIRED' })
  })

  it('tampered id / variant / uid / signature, incomplete query → 403 URL_INVALID (never falls back to the cookie)', async () => {
    const m = await get(`/api/v1/media/receipts/${receiptImg}/signed-url`, w.users.staffA)
    const url = (m.body as { url: string }).url
    const other = (await must(upload('/api/v1/media/receipts', w.users.staffA, await png()), 201)).id
    for (const bad of [
      url.replace(`/receipts/${receiptImg}/`, `/receipts/${other}/`),
      url.replace('/file?', '/file?variant=thumb&'),
      url.replace(`uid=${w.users.staffA.id}`, `uid=${w.users.finance.id}`),
      url.replace(/sig=(.)/, (_s, c: string) => `sig=${c === 'A' ? 'B' : 'A'}`),
      url.replace(/&sig=.*$/, '&sig=x'),
    ]) {
      const r = await get(bad, w.users.staffA)
      expect(r.status, bad).toBe(403)
      expect(r.body?.code, bad).toBe('URL_INVALID')
    }
  })

  it('valid signature but the user may not read the file → 403 FORBIDDEN + access_denied audit', async () => {
    const keys = signingKeys(getEnv())
    const target = { collection: 'receipts', id: receiptImg, variant: null, userId: w.users.staffB.id }
    const r = await get(signedMediaPath('/api', target, signMedia(target, keys, Math.floor(Date.now() / 1000))), null)
    expect(r.status).toBe(403)
    expect(r.body).toMatchObject({ code: 'FORBIDDEN' })
    const rows = await auditRows('media_receipts', receiptImg)
    expect(rows.some((x) => x.action === 'access_denied' && x.field === 'signed_url' && Number(x.user_id) === w.users.staffB.id)).toBe(true)
  })

  it('a user deactivated after minting → 403 (the re-check uses the current user state)', async () => {
    const m = await get(`/api/v1/media/receipts/${receiptImg}/signed-url`, w.users.pm)
    const url = (m.body as { url: string }).url
    expect((await get(url, null)).status).toBe(200)
    await sqlAs('owner', 'UPDATE users SET active = false WHERE id = $1', [w.users.pm.id])
    try {
      expect((await get(url, null)).status).toBe(403)
    } finally {
      await sqlAs('owner', 'UPDATE users SET active = true WHERE id = $1', [w.users.pm.id])
    }
  })

  it('APK/web path unchanged: cookie → 200; anonymous without sig → 401; other staff → 404', async () => {
    expect((await get(`/api/v1/media/receipts/${receiptImg}/file`, w.users.staffA)).status).toBe(200)
    expect((await get(`/api/v1/media/receipts/${receiptImg}/file`, null)).status).toBe(401)
    expect((await get(`/api/v1/media/receipts/${receiptImg}/file`, w.users.staffB)).status).toBe(404)
  })

  it('selfies via the media file endpoint: uploader 200, other staff 404, office 200 + view_sensitive; signed URL works', async () => {
    const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 90, g: 120, b: 150 } } }).jpeg().toBuffer()
    const s = await must(upload('/api/v1/media/selfies', w.users.staffA, jpeg, 'image/jpeg'), 201)
    expect((await get(`/api/v1/media/selfies/${s.id}/file`, w.users.staffA)).status).toBe(200)
    expect((await get(`/api/v1/media/selfies/${s.id}/file`, w.users.staffB)).status).toBe(404)
    const fin = await get(`/api/v1/media/selfies/${s.id}/file`, w.users.finance)
    expect(fin.status).toBe(200)
    expect(fin.headers.get('content-type')).toBe('image/jpeg')
    const rows = await auditRows('media_selfies', s.id)
    expect(rows.filter((x) => x.action === 'view_sensitive').map((x) => Number(x.user_id))).toEqual([w.users.finance.id])
    const m = await get(`/api/v1/media/selfies/${s.id}/signed-url`, w.users.staffA)
    expect((await get((m.body as { url: string }).url, null)).status).toBe(200)
  })
})

// ---------------------------------------------------------------- settlement reversal

describe('settlement reversal (E9, F6 backlog)', () => {
  it('refund: KM voided (reversal row), balance restored, LPJ back to verified, request lpj_verified; audit; re-settle works', async () => {
    const { id, verified } = await verifiedLpj([700_000]) // surplus 50.000
    expect(verified.settlement).toMatchObject({ settlementType: 'refund', difference: 50_000 })
    const before = await balance(w.cashAccount)
    const s = await must(api('POST', `${E}/${id}/settle`, w.users.finance, { cashAccountId: w.cashAccount }))
    expect(await balance(w.cashAccount)).toBe(before + 50_000)
    expect(s.request.allowedActions).toContain('settle_reverse')

    // role / reason / idempotency guards
    expect((await api('POST', `${E}/${id}/settle/reverse`, w.users.owner, { reason: 'salah akun' })).status).toBe(403)
    expect((await api('POST', `${E}/${id}/settle/reverse`, w.users.staffA, { reason: 'salah akun' })).status).toBe(403)
    expect((await api('POST', `${E}/${id}/settle/reverse`, w.users.finance, {})).status).toBe(400)

    const r = await must(api('POST', `${E}/${id}/settle/reverse`, w.users.finance, { reason: 'KM salah akun kas' }))
    expect(r.voided).toMatchObject({ type: 'refund', amount: 50_000, refundCashEntryId: s.refundCashEntryId })
    expect(r.request).toMatchObject({ status: 'lpj_verified', transferredTotal: 750_000 })
    expect(r.request.settlement).toMatchObject({ status: 'verified', settledAt: null, refundCashEntryId: null, reversalCount: 1, lastReversalReason: 'KM salah akun kas' })
    expect(r.request.allowedActions).toContain('settle')
    expect(r.request.allowedActions).not.toContain('settle_reverse')
    expect(await balance(w.cashAccount)).toBe(before)
    const km = await sqlAs('app', 'SELECT status, reversed_by_id FROM cash_entries WHERE id = $1', [s.refundCashEntryId])
    expect(km.rows[0].status).toBe('void')
    const rev = await sqlAs('app', 'SELECT direction, amount::int, source_type, entry_date FROM cash_entries WHERE reversal_of_id = $1', [s.refundCashEntryId])
    expect(rev.rows[0]).toMatchObject({ direction: 'out', amount: 50_000, source_type: 'reversal' })

    const sRows = await auditRows('settlement', r.request.settlement.id)
    expect(sRows.find((x) => x.action === 'void')).toMatchObject({ field: 'settlement', reason: 'KM salah akun kas' })
    expect(sRows.filter((x) => x.action === 'status_change').map((x) => [x.old_value?.v, x.new_value?.v]).at(-1)).toEqual(['settled', 'verified'])
    const reqRows = (await auditRows('expense_request', id)).filter((x) => x.action === 'status_change')
    expect(reqRows.at(-1)).toMatchObject({ old_value: { v: 'completed' }, new_value: { v: 'lpj_verified' }, reason: 'KM salah akun kas' })
    expect((await auditRows('cash_entry', s.refundCashEntryId)).some((x) => x.field === 'status' && x.new_value?.v === 'void')).toBe(true)

    // second reversal → 409 (state), then settle again → Selesai with a new KM
    expect((await api('POST', `${E}/${id}/settle/reverse`, w.users.finance, { reason: 'lagi' })).status).toBe(409)
    const again = await must(api('POST', `${E}/${id}/settle`, w.users.finance, { cashAccountId: w.cashAccount }))
    expect(again.request).toMatchObject({ status: 'completed', settlement: { status: 'settled', reversalCount: 1 } })
    expect(again.refundCashEntryId).not.toBe(s.refundCashEntryId)
    expect(await balance(w.cashAccount)).toBe(before + 50_000)
  })

  it('shortfall: transfer void + KK reversed, transferred total back to 750.000; re-settle posts a new transfer', async () => {
    const { id, verified } = await verifiedLpj([600_000, 200_000]) // shortfall 50.000
    expect(verified.settlement).toMatchObject({ settlementType: 'shortfall', difference: -50_000 })
    const before = await balance(w.cashAccount)
    const s = await must(api('POST', `${E}/${id}/settle`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: 'E9-SF-1', proofMediaId: await proof() }))
    expect(s.request.transferredTotal).toBe(800_000)
    expect(await balance(w.cashAccount)).toBe(before - 50_000)
    const r = await must(api('POST', `${E}/${id}/settle/reverse`, w.users.finance, { reason: 'transfer ditolak bank' }))
    expect(r.voided).toMatchObject({ type: 'shortfall', amount: 50_000, shortfallTransferId: s.shortfallTransferId })
    expect(r.request).toMatchObject({ status: 'lpj_verified', transferredTotal: 750_000, settlement: { status: 'verified', shortfallTransferId: null, reversalCount: 1 } })
    expect(await balance(w.cashAccount)).toBe(before)
    const t = await sqlAs('app', 'SELECT status, void_reason FROM transfers WHERE id = $1', [s.shortfallTransferId])
    expect(t.rows[0]).toEqual({ status: 'void', void_reason: 'transfer ditolak bank' })
    const again = await must(api('POST', `${E}/${id}/settle`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: 'E9-SF-2', proofMediaId: await proof() }))
    expect(again.request).toMatchObject({ status: 'completed', transferredTotal: 800_000 })
    expect(await balance(w.cashAccount)).toBe(before - 50_000)
  })

  it('exact LPJ (no money moved) → nothing to reverse, 409', async () => {
    const { id, verified } = await verifiedLpj([750_000])
    expect(verified).toMatchObject({ status: 'completed', settlement: { settlementType: 'none' } })
    expect(verified.allowedActions).not.toContain('settle_reverse')
    expect((await api('POST', `${E}/${id}/settle/reverse`, w.users.finance, { reason: 'uji' })).status).toBe(409)
  })

  it('closed period: reversal refused with a clear 409; after the Direktur re-opens the period it works', async () => {
    // periods closed by other files that are later than ours are re-opened (latest first) and restored in afterAll
    for (;;) {
      const lock = await must(api('GET', '/api/v1/period-closings', w.users.finance))
      const latest = (lock.items as Array<{ period: string; status: string }>).filter((p) => p.status === 'closed').map((p) => p.period).sort().at(-1)
      if (!latest || latest < OLD_MONTH) break
      await must(api('POST', `/api/v1/period-closings/${latest}/reopen`, w.users.owner, { reason: 'uji E9 dibuka sementara' }))
      restoreClosed.push(latest)
    }
    const { id } = await verifiedLpj([700_000])
    const s = await must(api('POST', `${E}/${id}/settle`, w.users.finance, { cashAccountId: w.cashAccount, date: `${OLD_MONTH}-10` }))
    await must(api('POST', '/api/v1/period-closings', w.users.finance, { period: OLD_MONTH, note: 'tutup uji E9' }), 201)
    const r = await api('POST', `${E}/${id}/settle/reverse`, w.users.finance, { reason: 'salah tanggal' })
    expect(r.status).toBe(409)
    expect(r.body.title).toMatch(new RegExp(`^Periode ${OLD_MONTH} sudah ditutup .*Direktur membuka kembali periode`))
    expect((await sqlAs('app', 'SELECT status FROM cash_entries WHERE id = $1', [s.refundCashEntryId])).rows[0].status).toBe('posted') // rolled back
    await must(api('POST', `/api/v1/period-closings/${OLD_MONTH}/reopen`, w.users.owner, { reason: 'koreksi LPJ' }))
    const ok = await must(api('POST', `${E}/${id}/settle/reverse`, w.users.finance, { reason: 'salah tanggal' }))
    expect(ok.request.status).toBe('lpj_verified')
    const rev = await sqlAs('app', 'SELECT entry_date FROM cash_entries WHERE reversal_of_id = $1', [s.refundCashEntryId])
    expect(rev.rows[0].entry_date).toBe(`${OLD_MONTH}-10`) // dated like the original (period open)
  })

  it('DB guard: a settled LPJ cannot be set back to verified without voiding its KM, nor reversal data forged', async () => {
    const { id } = await verifiedLpj([700_000])
    await must(api('POST', `${E}/${id}/settle`, w.users.finance, { cashAccountId: w.cashAccount }))
    const sid = (await sqlAs('app', 'SELECT id FROM settlements WHERE request_id = $1', [id])).rows[0].id
    const e1 = await sqlError(
      'app',
      "UPDATE settlements SET status = 'verified', settled_at = NULL, settled_by_id = NULL, refund_cash_entry_id = NULL, reversal_count = 1, last_reversed_at = now(), last_reversed_by_id = $2, last_reversal_reason = 'paksa' WHERE id = $1",
      [sid, w.users.finance.id],
    )
    expect(e1?.message).toContain('reverse only after the refund KM is void')
    const e2 = await sqlError('app', "UPDATE settlements SET last_reversal_reason = 'palsu' WHERE id = $1", [sid])
    expect(e2?.message).toContain('settled LPJ is immutable')
    const e3 = await sqlError('app', "UPDATE settlements SET status = 'verified' WHERE id = $1", [sid])
    expect(e3).not.toBeNull()
    // the cash-book void of a refund KM stays refused (only through the LPJ)
    const s = await must(api('GET', `${E}/${id}`, w.users.finance))
    const v = await api('POST', `/api/v1/cash-entries/${s.settlement.refundCashEntryId}/void`, w.users.finance, { reason: 'salah akun' })
    expect(v.status).toBe(409)
    expect(v.body.title).toContain('Batalkan penyelesaian')
  })
})

// ---------------------------------------------------------------- 403 before 409 (UAT 5.2)

describe('403 vs 409 (UAT 5.2)', () => {
  it('requester "approves" own request in "Menunggu Diketahui" → 403 + access_denied (was 409)', async () => {
    const c = await must(api('POST', E, w.users.staffA, draftBody(w)), 201)
    await must(api('POST', `${E}/${c.id}/submit`, w.users.staffA, {}))
    const r = await api('POST', `${E}/${c.id}/approve`, w.users.staffA, {})
    expect(r.status).toBe(403)
    const rows = await auditRows('expense_request', c.id)
    expect(rows.some((x) => x.action === 'access_denied' && x.field === 'approve')).toBe(true)
    // PM (monitor only, ADR 0013) → 403 in every status; Finance (authorized) approving before "Diketahui" → 409
    expect((await api('POST', `${E}/${c.id}/approve`, w.users.pm, {})).status).toBe(403)
    expect((await api('POST', `${E}/${c.id}/approve`, w.users.finance, {})).status).toBe(409)
  })

  it('Staff on Finance actions in a wrong status → 403 (not 409); Finance in a wrong status → 409', async () => {
    const c = await must(api('POST', E, w.users.staffA, draftBody(w)), 201)
    for (const path of ['transfer', 'lpj/verify', 'settle/reverse']) {
      const body = path === 'transfer' ? { cashAccountId: w.cashAccount, bankRef: 'x', proofMediaId: 1 } : path === 'settle/reverse' ? { reason: 'uji' } : {}
      // a foreign request: role gate (403) or invisible (404) — never the state (409)
      expect([403, 404], path).toContain((await api('POST', `${E}/${c.id}/${path}`, w.users.staffB, body)).status)
      expect((await api('POST', `${E}/${c.id}/${path}`, w.users.staffA, body)).status, path).toBe(403)
    }
    expect((await api('POST', `${E}/${c.id}/lpj/verify`, w.users.finance, {})).status).toBe(409)
    expect((await api('POST', `${E}/${c.id}/settle/reverse`, w.users.finance, { reason: 'uji' })).status).toBe(409)
  })
})

// ---------------------------------------------------------------- login_failed (ADR 0003 §7 revision)

describe('login_failed on the ProyekKas side', () => {
  it('a failed OIDC callback (bad login transaction) → 400 and one login_failed row (source web, client ip)', async () => {
    const ip = '203.0.113.77'
    const before = await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'login_failed' AND ip = $1", [ip])
    const res = await oidcCallback(
      new NextRequest(`${ORIGIN}/auth/callback?code=x&state=y`, { headers: { cookie: 'pk_oidc_tx=not-a-sealed-transaction', 'x-real-ip': ip } }),
    )
    expect(res.status).toBe(400)
    const rows = await sqlAs('app', "SELECT doc_type, field, source, reason, user_id FROM audit_logs WHERE action = 'login_failed' AND ip = $1 ORDER BY id", [ip])
    expect(rows.rows.length).toBe(before.rows[0].n + 1)
    expect(rows.rows.at(-1)).toMatchObject({ doc_type: 'web_session', field: 'oidc_callback', source: 'web', user_id: null })
    // without the transaction cookie nothing is written (anonymous hits cannot flood the log)
    expect((await oidcCallback(new NextRequest(`${ORIGIN}/auth/callback?code=x`, { headers: { 'x-real-ip': ip } }))).status).toBe(400)
    expect((await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'login_failed' AND ip = $1", [ip])).rows[0].n).toBe(rows.rows.length)
  })

  it('unknown/inactive account after Keycloak login is recorded with the Keycloak subject; throttled per IP (30/min)', async () => {
    resetRateLimits()
    const payload = await getTestPayload()
    const ip = '203.0.113.78'
    for (let i = 0; i < 35; i++) await auditLoginFailed(payload, new Headers({ 'x-real-ip': ip }), { reason: 'unknown_or_inactive_user', keycloakSub: 'kc-sub-e9' })
    const rows = await sqlAs('app', "SELECT new_value, reason FROM audit_logs WHERE action = 'login_failed' AND ip = $1", [ip])
    expect(rows.rows.length).toBe(30)
    expect(rows.rows[0]).toMatchObject({ new_value: { v: { keycloakSub: 'kc-sub-e9' } }, reason: 'Akun belum terdaftar atau tidak aktif di ProyekKas' })
  })
})
