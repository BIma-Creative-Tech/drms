import { randomUUID } from 'node:crypto'

import { PgDialect } from '@payloadcms/db-postgres/drizzle/pg-core'
import { handleEndpoints } from 'payload'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { resetRateLimits } from '@/lib/rate-limit'
import { up as upOwnerLink } from '@/migrations/20261013_500000_attachments_owner_link'
import config from '@/payload.config'

import { pdfText } from '../fixtures/pdf-text'
import { api, draftBody, makeWorld, ORIGIN, png, upload, type FlowUser, type World } from './flow-world'
import { getTestPayload, sqlAs } from './helpers'

/**
 * Prod 2026-10-12 (PB 230/PB-DRMS): "Lampiran umum" of a submitted request could only be opened by
 * their uploader — the deciders saw no image, and the PDF did not print them. Linked at submit now
 * (`claimAttachments`), backfilled by migration 20261013_500000_attachments_owner_link.
 */
let w: World
const E = '/api/v1/expense-requests'
const key = () => ({ 'Idempotency-Key': randomUUID() })

beforeAll(async () => {
  w = await makeWorld('AL')
})
beforeEach(() => resetRateLimits())
afterAll(async () => {
  await (await getTestPayload()).destroy()
})

async function ok(p: Promise<{ status: number; body: any }>, status = 200) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await p
  expect(r.status, JSON.stringify(r.body)).toBe(status)
  return r.body
}

async function attachment(user: FlowUser): Promise<number> {
  return (await ok(upload('/api/v1/media/attachments', user, await png()), 201)).id as number
}

async function download(path: string, user: FlowUser) {
  resetRateLimits()
  const res = await handleEndpoints({ config, request: new Request(`${ORIGIN}${path}`, { method: 'GET', headers: { Origin: ORIGIN, Cookie: user.cookie } }) })
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) }
}

const fileStatus = async (id: number, user: FlowUser) => (await download(`/api/v1/media/attachments/${id}/file`, user)).status
const owner = async (id: number) => (await sqlAs('app', 'SELECT owner_doc_type, owner_doc_id FROM media_attachments WHERE id = $1', [id])).rows[0]

describe('Lampiran umum: owner link at submit', () => {
  it('a draft attachment is linked at submit → the PM and the Direktur can open it; the PDF prints it', async () => {
    const att = await attachment(w.users.staffA)
    const d = await ok(api('POST', E, w.users.staffA, draftBody(w, { attachmentIds: [att] }), key()), 201)
    expect(await owner(att)).toEqual({ owner_doc_type: null, owner_doc_id: null })
    expect(await fileStatus(att, w.users.pm)).not.toBe(200)

    await ok(api('POST', `${E}/${d.id}/submit`, w.users.staffA, {}, key()))
    expect(await owner(att)).toEqual({ owner_doc_type: 'expense_request', owner_doc_id: String(d.id) })
    expect(await fileStatus(att, w.users.pm)).toBe(200)
    expect(await fileStatus(att, w.users.owner)).toBe(200)
    expect(await fileStatus(att, w.users.staffB)).not.toBe(200) // not on the request

    const pdf = await download(`${E}/${d.id}/pdf`, w.users.owner)
    expect(pdf.status).toBe(200)
    expect(pdfText(pdf.bytes)).toContain('Lampiran Umum')

    // withdraw → submit again: idempotent
    await ok(api('POST', `${E}/${d.id}/withdraw`, w.users.staffA, { reason: 'tambah keterangan' }, key()))
    await ok(api('POST', `${E}/${d.id}/submit`, w.users.staffA, {}, key()))
    expect(await owner(att)).toEqual({ owner_doc_type: 'expense_request', owner_doc_id: String(d.id) })
  })

  it("someone else's unclaimed upload is not linked: submit refused (409), nothing written", async () => {
    const foreign = await attachment(w.users.finance)
    const created = await api('POST', E, w.users.staffA, draftBody(w, { attachmentIds: [foreign] }), key())
    if (created.status !== 201) {
      // the draft itself already refuses a file the caller cannot read — equally safe
      expect(created.status).toBeGreaterThanOrEqual(400)
      return
    }
    const r = await api('POST', `${E}/${created.body.id}/submit`, w.users.staffA, {}, key())
    expect(r.status, JSON.stringify(r.body)).toBe(409)
    expect(JSON.stringify(r.body)).toContain('Lampiran bukan unggahan pembuat/pemohon')
    expect(await owner(foreign)).toEqual({ owner_doc_type: null, owner_doc_id: null })
    expect((await sqlAs('app', 'SELECT status FROM expense_requests WHERE id = $1', [created.body.id])).rows[0]).toEqual({ status: 'draft' })
  })
})

describe('migration 20261013_500000_attachments_owner_link', () => {
  async function migrate(): Promise<Array<Record<string, unknown>>> {
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
    try {
      await c.query('BEGIN')
      await upOwnerLink({ db, payload: { logger: { info: (o: Record<string, unknown>) => logs.push(o) } } } as never)
      await c.query('COMMIT')
    } catch (e) {
      await c.query('ROLLBACK')
      throw e
    } finally {
      await c.end()
    }
    return logs
  }

  it('links the files of requests submitted before the fix (creator upload); drafts never submitted are left alone; idempotent', async () => {
    const legacy = await attachment(w.users.staffA)
    const fresh = await attachment(w.users.staffA)
    const a = await ok(api('POST', E, w.users.staffA, draftBody(w, { attachmentIds: [legacy] }), key()), 201)
    const b = await ok(api('POST', E, w.users.staffA, draftBody(w, { attachmentIds: [fresh] }), key()), 201)
    // a request submitted under the old code and withdrawn (cycle 1, no owner link)
    await sqlAs('owner', 'UPDATE expense_requests SET approval_cycle = 1 WHERE id = $1', [a.id])

    const logs = await migrate()
    expect(logs[0]?.linked as string[]).toContain(`media#${legacy}→request#${a.id}`)
    expect(await owner(legacy)).toEqual({ owner_doc_type: 'expense_request', owner_doc_id: String(a.id) })
    expect(await owner(fresh)).toEqual({ owner_doc_type: null, owner_doc_id: null })
    expect(b.id).toBeGreaterThan(0)
    const audit = await sqlAs('app', "SELECT action, field, source FROM audit_logs WHERE doc_type = 'media_attachments' AND doc_id = $1 AND field = 'owner'", [String(legacy)])
    expect(audit.rows).toEqual([{ action: 'update', field: 'owner', source: 'system' }])

    expect((await migrate())[0]?.linked).toEqual([])
  })
})
