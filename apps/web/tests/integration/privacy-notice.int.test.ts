import { randomUUID } from 'node:crypto'

import { PgDialect } from '@payloadcms/db-postgres/drizzle/pg-core'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { PRIVACY_NOTICE } from '@/legal/privacy-notice'
import { resetRateLimits } from '@/lib/rate-limit'
import { up as upRetention } from '@/migrations/20261005_090100_selfie_retention_6m'

import { api, makeFlowUser, type FlowUser } from './flow-world'
import { accessToken, auditRows, companyId, getTestPayload, http, installFakeKeycloak, installLocalJwks, registerDevice, sqlAs, sqlError, type TestUser } from './helpers'

/**
 * Employee privacy notice + acknowledgement (Q-46, ASVS 8.3.3 / G-06, ADR 0018) and the Q-33 retention migration:
 * public notice endpoint, /me `privacy`, POST /me/privacy-ack (version check 409, idempotency, audit row, DB guards,
 * read-only fields) and `20261005_090100_selfie_retention_6m` (12 → 6 only for untouched PTs, audited, idempotent).
 */
const V = PRIVACY_NOTICE.version
const ACK = '/api/v1/me/privacy-ack'
const key = () => ({ 'Idempotency-Key': randomUUID() })
let staff: FlowUser
let admin: FlowUser

const ackRow = async (uid: number) =>
  (await sqlAs('owner', 'SELECT privacy_ack_version::int AS v, privacy_ack_at AS at FROM users WHERE id = $1', [uid])).rows[0] as { v: number | null; at: Date | null }
const privacyAudits = async (uid: number) => (await auditRows('user', uid)).filter((r) => r.action === 'privacy_ack')

beforeAll(async () => {
  installFakeKeycloak()
  staff = await makeFlowUser(['pk-staff'], 'priv-staff', null, { signature: false })
  admin = await makeFlowUser(['pk-admin'], 'priv-admin', null, { signature: false })
})

beforeEach(() => {
  resetRateLimits()
})

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

describe('GET /api/v1/privacy-notice (public)', () => {
  it('answers without authentication: version, title, html, markdown of the bundled notice', async () => {
    const r = await http('GET', '/api/v1/privacy-notice')
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('public, max-age=300')
    const body = r.body as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['html', 'markdown', 'title', 'version'])
    expect(body.version).toBe(V)
    expect(body.title).toBe(PRIVACY_NOTICE.title)
    expect(String(body.html)).toContain('<strong>Foto selfie absensi: 6 bulan</strong>')
    expect(String(body.html)).not.toMatch(/<(script|a|img)\b/)
    expect(body.markdown).toBe(PRIVACY_NOTICE.markdown)
  })
})

describe('/me privacy + POST /me/privacy-ack', () => {
  it('/me shape before the acknowledgement', async () => {
    const r = await api('GET', '/api/v1/me', staff)
    expect(r.status).toBe(200)
    expect(r.body.privacy).toEqual({ currentVersion: V, ackVersion: null, ackAt: null })
  })

  it('needs a session; refuses a wrong version with 409 (nothing stored, no audit row)', async () => {
    expect((await api('POST', ACK, null, { version: V }, key())).status).toBe(401)
    const wrong = await api('POST', ACK, staff, { version: V + 1 }, key())
    expect(wrong.status).toBe(409)
    expect(wrong.body).toMatchObject({ code: 'PRIVACY_VERSION_MISMATCH', currentVersion: V })
    expect(String(wrong.body.detail)).toMatch(/versi terbaru/)
    if (V > 1) expect((await api('POST', ACK, staff, { version: V - 1 }, key())).status).toBe(409)
    expect((await api('POST', ACK, staff, { version: '1' }, key())).status).toBe(400)
    expect((await api('POST', ACK, staff, { version: V, extra: true }, key())).status).toBe(400)
    expect(await ackRow(staff.id)).toEqual({ v: null, at: null })
    expect(await privacyAudits(staff.id)).toHaveLength(0)
  })

  it('stores version + time, writes ONE privacy_ack audit row; replay and re-ack change nothing', async () => {
    const k = key()
    const first = await api('POST', ACK, staff, { version: V }, k)
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    expect(first.body).toMatchObject({ version: V, alreadyAcknowledged: false })
    const row = await ackRow(staff.id)
    expect(row.v).toBe(V)
    expect(new Date(first.body.ackAt).getTime()).toBe(row.at!.getTime())
    const audits = await privacyAudits(staff.id)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ field: 'privacyAckVersion', old_value: { v: null }, new_value: { v: V }, source: 'web', user_id: String(staff.id) })
    const company = (await sqlAs('owner', "SELECT company_id FROM audit_logs WHERE doc_type = 'user' AND doc_id = $1 AND action = 'privacy_ack'", [String(staff.id)])).rows[0]
    expect(company?.company_id).toBeNull() // app-wide account event

    // same Idempotency-Key + body → stored response replayed
    const replay = await api('POST', ACK, staff, { version: V }, k)
    expect(replay.status).toBe(200)
    expect(replay.headers.get('idempotent-replayed')).toBe('true')
    expect(replay.body).toEqual(first.body)
    // new key → already acknowledged, original time, no second audit row
    const again = await api('POST', ACK, staff, { version: V }, key())
    expect(again.status).toBe(200)
    expect(again.body).toEqual({ version: V, ackAt: first.body.ackAt, alreadyAcknowledged: true })
    // web without a key is allowed (the APK must send one)
    expect((await api('POST', ACK, staff, { version: V })).status).toBe(200)
    expect(await privacyAudits(staff.id)).toHaveLength(1)

    const me = await api('GET', '/api/v1/me', staff)
    expect(me.body.privacy).toEqual({ currentVersion: V, ackVersion: V, ackAt: first.body.ackAt })
  })

  it('APK: Idempotency-Key required (400 without), bearer ack works', async () => {
    await installLocalJwks()
    const p = await getTestPayload()
    const u = await makeFlowUser(['pk-staff'], 'priv-apk', null, { signature: false })
    const doc = await p.findByID({ collection: 'users', id: u.id, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })
    const t: TestUser = { ...u, keycloakSub: doc.keycloakSub as string }
    const token = await accessToken(t, ['pk-staff'])
    const device = await registerDevice(t, token)
    const h = { Authorization: `Bearer ${token}`, 'X-Device-Id': device, 'X-App-Version': '0.3.3' }
    const noKey = await http('POST', ACK, { headers: h, json: { version: V } })
    expect(noKey.status).toBe(400)
    const ok = await http('POST', ACK, { headers: { ...h, ...key() }, json: { version: V } })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    const audits = await privacyAudits(u.id)
    expect(audits).toHaveLength(1)
    expect(audits[0]!.source).toBe('apk')
    const me = await http('GET', '/api/v1/me', { headers: h })
    expect((me.body as { privacy: unknown }).privacy).toMatchObject({ currentVersion: V, ackVersion: V })
  })

  it('fields are read-only outside the endpoint: admin/self updates ignore them, other edits keep the ack', async () => {
    const p = await getTestPayload()
    const before = await ackRow(staff.id)
    const adminCtx = { ...admin, collection: 'users' as const }
    await p.update({ collection: 'users', id: staff.id, data: { name: 'Priv Staff Baru', privacyAckVersion: 99, privacyAckAt: '2020-01-01T00:00:00.000Z' } as never, user: adminCtx as never, overrideAccess: false })
    const after = await ackRow(staff.id)
    expect(after).toEqual(before)
    expect((await sqlAs('owner', 'SELECT name FROM users WHERE id = $1', [staff.id])).rows[0]?.name).toBe('Priv Staff Baru')
    // REST PATCH by the user themself (signature-only self service): the ack fields are not writable either
    const rest = await api('PATCH', `/api/users/${staff.id}`, staff, { privacyAckVersion: 99 })
    expect([200, 403]).toContain(rest.status)
    expect(await ackRow(staff.id)).toEqual(before)
  })

  it('DB guards: cannot be withdrawn, lowered, re-dated or half-set (app role)', async () => {
    expect((await sqlError('app', 'UPDATE users SET privacy_ack_version = NULL, privacy_ack_at = NULL WHERE id = $1', [staff.id]))?.code).toBe('42501')
    expect((await sqlError('app', "UPDATE users SET privacy_ack_at = now() - interval '1 day' WHERE id = $1", [staff.id]))?.code).toBe('42501')
    expect((await sqlError('app', 'UPDATE users SET privacy_ack_version = 0 WHERE id = $1', [staff.id]))?.code).toMatch(/^(42501|23514)$/)
    expect((await sqlError('app', 'UPDATE users SET privacy_ack_version = 1 WHERE id = $1', [admin.id]))?.code).toBe('23514') // no timestamp
    expect((await sqlError('app', 'UPDATE users SET privacy_ack_version = 1.5, privacy_ack_at = now() WHERE id = $1', [admin.id]))?.code).toBe('23514')
    // a newer version may follow (the endpoint is the writer; a bump is allowed by the guard)
    expect(await sqlError('app', 'UPDATE users SET privacy_ack_version = privacy_ack_version + 1, privacy_ack_at = now() WHERE id = $1', [staff.id])).toBeNull()
  })
})

/** Runs a migration function like `payload migrate` does: one OWNER connection, one transaction. */
async function migrate(fn: typeof upRetention): Promise<Array<Record<string, unknown>>> {
  const c = new pg.Client({ connectionString: process.env.PK_TEST_DATABASE_URL_OWNER })
  await c.connect()
  const dialect = new PgDialect()
  const logs: Array<Record<string, unknown>> = []
  const db = {
    execute: async (q: unknown) => {
      const x = dialect.sqlToQuery(q as never)
      return c.query(x.sql, x.params)
    },
  }
  const payload = { logger: { info: (o: Record<string, unknown>) => logs.push(o) } }
  try {
    await c.query('BEGIN')
    await fn({ db, payload } as never)
    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK')
    throw e
  } finally {
    await c.end()
  }
  return logs
}

describe('migration 20261005_090100_selfie_retention_6m (Q-33: 12 → 6 for untouched PTs only)', () => {
  it('moves only untouched 12s, audits each move, leaves the delete switch alone, is idempotent', async () => {
    const p = await getTestPayload()
    const tag = randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, 'X')
    const mk = async (code: string, months: number) =>
      (
        await p.create({
          collection: 'companies',
          data: { name: `PT Retensi ${code}`, shortCode: `R${code}${tag}`, timezone: 'Asia/Makassar', active: false, selfieRetentionMonths: months } as never,
          depth: 0,
          overrideAccess: true, // SYSTEM-WRITE: fixture
        })
      ).id as number
    const untouched = await mk('U', 12) // created with the old default (create audit row only)
    const legacy = await mk('L', 24)
    await sqlAs('owner', 'UPDATE companies SET selfie_retention_months = 12 WHERE id = $1', [legacy]) // pre-audit row (e.g. MC1 copy)
    const chosen = await mk('C', 24)
    await p.update({ collection: 'companies', id: chosen, data: { selfieRetentionMonths: 12 } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */ }) // deliberate 12 (audited)
    const other = await mk('O', 24)
    await sqlAs('owner', 'UPDATE companies SET selfie_retention_delete_enabled = true WHERE id = $1', [untouched])
    // the PT created from the former global (lowest id): a global change of the value counts as "touched"
    const drms = await companyId()
    await sqlAs('owner', 'UPDATE companies SET selfie_retention_months = 12 WHERE id = $1', [drms])
    await sqlAs(
      'owner',
      "INSERT INTO audit_logs (event_id, tx_id, doc_type, action, field, old_value, new_value, source) VALUES ($1, txid_current(), 'company_settings', 'update', 'selfieRetentionMonths', '{\"v\": 6}', '{\"v\": 12}', 'web')",
      [randomUUID()],
    )
    const months = async (id: number) => Number((await sqlAs('owner', 'SELECT selfie_retention_months AS m FROM companies WHERE id = $1', [id])).rows[0]?.m)
    const auditCount = async () => Number((await sqlAs('owner', "SELECT count(*)::int AS n FROM audit_logs WHERE doc_type = 'company' AND field = 'selfieRetentionMonths' AND source = 'system' AND reason LIKE 'Q-33 %'")).rows[0]?.n)
    const before = await auditCount()

    const logs = await migrate(upRetention)
    expect(await months(untouched)).toBe(6)
    expect(await months(legacy)).toBe(6)
    expect(await months(chosen)).toBe(12)
    expect(await months(other)).toBe(24)
    expect(await months(drms)).toBe(12)
    expect((await sqlAs('owner', 'SELECT selfie_retention_delete_enabled AS d FROM companies WHERE id = $1', [untouched])).rows[0]?.d).toBe(true)
    expect((await sqlAs('owner', 'SELECT selfie_retention_delete_enabled AS d FROM companies WHERE id = $1', [legacy])).rows[0]?.d).toBe(false)
    expect(await auditCount()).toBe(before + 2)
    const rows = (
      await sqlAs(
        'owner',
        "SELECT doc_id, company_id, action, old_value, new_value, reason, source FROM audit_logs WHERE doc_type = 'company' AND field = 'selfieRetentionMonths' AND source = 'system' AND reason LIKE 'Q-33 %' AND doc_id = ANY($1) ORDER BY doc_id",
        [[String(untouched), String(legacy)]],
      )
    ).rows
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r).toMatchObject({ action: 'update', old_value: { v: 12 }, new_value: { v: 6 }, source: 'system' })
      expect(Number(r.company_id)).toBe(Number(r.doc_id))
      expect(String(r.reason)).toMatch(/Q-33.*2026-10-05/)
    }
    const log = logs.find((l) => String(l.msg).includes('selfie retention'))
    expect(log?.movedCompanyIds).toEqual(expect.arrayContaining([untouched, legacy]))
    expect(log?.keptAt12CompanyIds).toEqual(expect.arrayContaining([chosen, drms]))

    // re-run: nothing left to move, no new audit rows
    await migrate(upRetention)
    expect(await auditCount()).toBe(before + 2)
    expect(await months(chosen)).toBe(12)

    // restore DRMS for later files (value only; the fixture audit row stays — audit is append-only)
    await sqlAs('owner', 'UPDATE companies SET selfie_retention_months = 6 WHERE id = $1', [drms])
  })

  it('schema migration: new PTs default to 6 months; privacy_ack is an audit action', async () => {
    const d = await sqlAs('owner', "SELECT column_default FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'selfie_retention_months'")
    expect(String(d.rows[0]?.column_default)).toBe('6')
    const e = await sqlAs('owner', "SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'enum_audit_logs_action' AND e.enumlabel = 'privacy_ack'")
    expect(e.rowCount).toBe(1)
  })
})
