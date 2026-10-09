import { lookup } from 'node:dns/promises'

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Outbound email against a THROWAWAY SMTP sink (Mailpit, MIT) — never a real mail server.
 * SMTP_* are set here, BEFORE the Payload config is imported (vi.hoisted), from PK_TEST_SMTP_*:
 *   PK_TEST_SMTP_HOST / PK_TEST_SMTP_PORT      sink with STARTTLS required + AUTH (e.g. pk-smtp-mailpit:1025)
 *   PK_TEST_SMTP_USER / PK_TEST_SMTP_PASSWORD_FILE
 *   PK_TEST_MAILPIT_API                        Mailpit HTTP API (e.g. http://pk-smtp-mailpit:8025)
 *   NODE_EXTRA_CA_CERTS                        throwaway CA of the sink cert (verification stays ON)
 * Without PK_TEST_SMTP_HOST (e.g. CI) only the not-configured path + the DB guard run.
 */
const smtp = vi.hoisted(() => {
  const host = process.env.PK_TEST_SMTP_HOST
  if (!host) return null
  const user = process.env.PK_TEST_SMTP_USER ?? ''
  Object.assign(process.env, {
    SMTP_HOST: host,
    SMTP_PORT: process.env.PK_TEST_SMTP_PORT ?? '1025',
    SMTP_USER: user,
    SMTP_PASSWORD_FILE: process.env.PK_TEST_SMTP_PASSWORD_FILE ?? '',
    SMTP_FROM_ADDRESS: user,
    SMTP_FROM_NAME: 'ProyekKas Test',
  })
  return { host, port: Number(process.env.SMTP_PORT), user, api: process.env.PK_TEST_MAILPIT_API ?? '' }
})

import { smtpEmailAdapter } from '@/email/adapter'
import { EmailRateLimitedError, MAIL_BURST, takeMailTokens } from '@/email/rate-guard'
import { parseSmtpEnv } from '@/lib/env'

import { getTestPayload, http, makeUser, sqlAs, webSessionCookie } from './helpers'

type MailpitMsg = { ID: string; From: { Name: string; Address: string }; To: Array<{ Address: string }>; Subject: string }

async function mailsTo(address: string): Promise<MailpitMsg[]> {
  const r = await fetch(`${smtp!.api}/api/v1/messages?limit=100`)
  const body = (await r.json()) as { messages: MailpitMsg[] }
  return body.messages.filter((m) => m.To.some((t) => t.Address.toLowerCase() === address.toLowerCase()))
}

async function resetBucket(tokens?: number): Promise<void> {
  await sqlAs('owner', 'DELETE FROM mail_rate_buckets')
  if (tokens !== undefined) {
    await sqlAs('app', 'INSERT INTO mail_rate_buckets (mailbox, tokens, updated_at) VALUES ($1, $2, clock_timestamp())', [
      (smtp?.user || 'no-reply@pk-smtp.test').toLowerCase(),
      tokens,
    ])
  }
}

beforeAll(async () => {
  await getTestPayload()
})
beforeEach(async () => resetBucket())

describe('mailbox rate guard (DB bucket shared by web + worker)', () => {
  it(`burst of ${MAIL_BURST}, then refused; refills at 24/h (one token per 150 s)`, async () => {
    const db = (await getTestPayload()).db.drizzle as never
    const box = 'guard-test@pk-smtp.test'
    for (let i = 0; i < MAIL_BURST; i++) expect(await takeMailTokens(db, box)).toBe(true)
    expect(await takeMailTokens(db, box)).toBe(false)
    // 150 s later exactly one more token (app role may UPDATE, not DELETE)
    await sqlAs('app', "UPDATE mail_rate_buckets SET updated_at = updated_at - interval '151 seconds' WHERE mailbox = $1", [box])
    expect(await takeMailTokens(db, box)).toBe(true)
    expect(await takeMailTokens(db, box)).toBe(false)
    // n tokens at once: all or nothing
    await sqlAs('app', "UPDATE mail_rate_buckets SET updated_at = updated_at - interval '1 hour' WHERE mailbox = $1", [box])
    expect(await takeMailTokens(db, box, MAIL_BURST)).toBe(true)
    expect(await takeMailTokens(db, box, 1)).toBe(false)
  })

  it('concurrent takes never exceed the burst (row lock)', async () => {
    const db = (await getTestPayload()).db.drizzle as never
    const results = await Promise.all(Array.from({ length: 12 }, () => takeMailTokens(db, 'race@pk-smtp.test')))
    expect(results.filter(Boolean)).toHaveLength(MAIL_BURST)
  })

  it('app role cannot delete buckets', async () => {
    await sqlAs('app', "INSERT INTO mail_rate_buckets VALUES ('x@pk-smtp.test', 1, now())")
    await expect(sqlAs('app', 'DELETE FROM mail_rate_buckets')).rejects.toMatchObject({ code: '42501' })
  })
})

describe('POST /api/v1/admin/test-email', () => {
  it('admin only (403 for other roles, 401 anonymous)', async () => {
    const finance = await makeUser(['pk-finance'])
    const r = await http('POST', '/api/v1/admin/test-email', { headers: { Cookie: await webSessionCookie(finance), Origin: 'http://localhost:3000' } })
    expect(r.status).toBe(403)
    expect((await http('POST', '/api/v1/admin/test-email')).status).toBe(401)
  })

  it.skipIf(smtp)('503 when SMTP is not configured (console adapter, nothing queued)', async () => {
    const admin = await makeUser(['pk-admin'])
    const r = await http('POST', '/api/v1/admin/test-email', { headers: { Cookie: await webSessionCookie(admin), Origin: 'http://localhost:3000' } })
    expect(r.status).toBe(503)
  })
})

describe.skipIf(!smtp)('delivery through the SMTP sink (STARTTLS required, AUTH, verified cert)', () => {
  it('queues (audited), the worker path sends it to the caller with the forced From', async () => {
    const payload = await getTestPayload()
    expect(payload.email.name).toBe('nodemailer')
    const admin = await makeUser(['pk-admin'], { label: 'mailadmin' })
    const cookie = await webSessionCookie(admin)
    const r = await http('POST', '/api/v1/admin/test-email', { headers: { Cookie: cookie, Origin: 'http://localhost:3000' } })
    expect(r.status).toBe(202)
    const { jobId } = r.body as { jobId: string }
    const audit = await sqlAs('app', "SELECT action, new_value FROM audit_logs WHERE doc_type = 'users' AND doc_id = $1 AND action = 'email_test'", [String(admin.id)])
    expect(audit.rows).toEqual([{ action: 'email_test', new_value: { v: { jobId } } }])
    expect(await mailsTo(admin.email)).toHaveLength(0) // nothing sent by the web request itself

    await payload.jobs.runByID({ id: jobId }) // = what the worker does
    const job = await payload.findByID({ collection: 'payload-jobs', id: jobId, depth: 0, overrideAccess: true /* SYSTEM-READ: test */ })
    expect(job.completedAt).toBeTruthy()
    expect(job.hasError).toBeFalsy()

    const mails = await mailsTo(admin.email)
    expect(mails).toHaveLength(1)
    expect(mails[0]!.From).toEqual({ Name: 'ProyekKas Test', Address: smtp!.user })
    expect(mails[0]!.Subject).toBe('RR Teams — email uji')
  })

  it('From is forced even when a caller passes another sender', async () => {
    const payload = await getTestPayload()
    const to = `forced-from-${Date.now()}@pk-smtp.test`
    await payload.sendEmail({ to, subject: 'from test', text: 'x', from: 'ceo@evil.test', sender: 'x@evil.test' } as never)
    const mails = await mailsTo(to)
    expect(mails).toHaveLength(1)
    expect(mails[0]!.From.Address).toBe(smtp!.user)
  })

  it('empty bucket: send refused before SMTP; the job is kept for a retry with backoff', async () => {
    const payload = await getTestPayload()
    await resetBucket(0)
    const user = await makeUser(['pk-finance'], { label: 'limited' })
    const to = user.email
    await expect(payload.sendEmail({ to, subject: 'x', text: 'x' })).rejects.toBeInstanceOf(EmailRateLimitedError)
    const job = await payload.jobs.queue({ task: 'sendEmail', input: { userId: user.id, subject: 'limited', text: 'x' } })
    const before = Date.now()
    await payload.jobs.runByID({ id: job.id })
    const after = await payload.findByID({ collection: 'payload-jobs', id: job.id, depth: 0, overrideAccess: true /* SYSTEM-READ: test */ })
    expect(after.completedAt).toBeFalsy()
    expect(after.hasError).toBeFalsy() // not final: 6 attempts
    expect(new Date(after.waitUntil!).getTime()).toBeGreaterThanOrEqual(before + 140_000)
    expect(await mailsTo(to)).toHaveLength(0)
    // the address never enters payload_jobs (it is logged on task errors) — only the user id
    const jobRow = await sqlAs('app', 'SELECT row_to_json(j)::text AS r FROM payload_jobs j WHERE id = $1', [job.id])
    const logRows = await sqlAs('app', 'SELECT row_to_json(l)::text AS r FROM payload_jobs_log l WHERE _parent_id = $1', [job.id])
    expect(jobRow.rows).toHaveLength(1)
    expect(JSON.stringify([...jobRow.rows, ...logRows.rows])).not.toContain(to)
  })

  it('inactive users are skipped (no mail)', async () => {
    const payload = await getTestPayload()
    const user = await makeUser(['pk-finance'], { label: 'inactive', active: false })
    const job = await payload.jobs.queue({ task: 'sendEmail', input: { userId: user.id, subject: 'x', text: 'x' } })
    await payload.jobs.runByID({ id: job.id })
    const after = await payload.findByID({ collection: 'payload-jobs', id: job.id, depth: 0, overrideAccess: true /* SYSTEM-READ: test */ })
    expect(after.completedAt).toBeTruthy()
    expect(await mailsTo(user.email)).toHaveLength(0)
  })

  it('certificate verification is ON: the same sink by IP (name mismatch) is refused', async () => {
    const cfg = parseSmtpEnv(process.env)!
    const { address } = await lookup(cfg.host, { family: 4 })
    const byIp = await smtpEmailAdapter({ ...cfg, host: address }, () => async () => true)
    const adapter = byIp({ payload: await getTestPayload() })
    await expect(adapter.sendEmail({ to: 'nobody@pk-smtp.test', subject: 'x', text: 'x' })).rejects.toThrow(/certificate|altnames|IP/i)
    expect(await mailsTo('nobody@pk-smtp.test')).toHaveLength(0)
  })
})
