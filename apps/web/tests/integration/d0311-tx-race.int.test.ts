import { sql } from '@payloadcms/db-postgres'
import { createLocalReq, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { addendumInbox } from '@/domain/addendum/service'
import { shortfallInbox } from '@/domain/expense/shortfall-approval'
import { withReqTransaction } from '@/lib/system-tx'
import { getRequestTx } from '@/lib/tx'

import { getTestPayload } from './helpers'
import { makeWorld, type World } from './flow-world'

/**
 * Prod 0.23.1 (2026-11-03): /admin/persetujuan answered 500 "withReqTransaction: the transaction was rolled back by a
 * caught Payload error" on nearly every load. The Addendum and Kekurangan LPJ sections are sibling server components
 * sharing `initPageResult.req` and rendering concurrently; each withReqTransaction overwrote / deleted the other's
 * `req.transactionID`. Siblings now run one after the other, each in its own transaction. Fictional data only.
 */
let w: World

/** A page request without a transaction (like `initPageResult.req`). */
const pageReq = async (): Promise<PayloadRequest> => createLocalReq({ user: w.users.finance as never }, await getTestPayload())
const txId = async (req: PayloadRequest) => String(await req.transactionID)
const tick = () => new Promise((r) => setTimeout(r, 5))

beforeAll(async () => {
  w = await makeWorld('TXR')
})

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

describe('withReqTransaction on one req from concurrent siblings', () => {
  it('Persetujuan sections (Addendum + Kekurangan LPJ) rendered concurrently → no error', async () => {
    const req = await pageReq()
    const [a, s] = await Promise.all([withReqTransaction(req, () => addendumInbox(req)), withReqTransaction(req, () => shortfallInbox(req))])
    expect(Array.isArray(a.items)).toBe(true)
    expect(Array.isArray(s.items)).toBe(true)
    expect(req.transactionID).toBeUndefined()
  })

  it('siblings never share or lose a transaction; a nested call joins its own', async () => {
    const req = await pageReq()
    const sibling = () =>
      withReqTransaction(req, async () => {
        const id = await txId(req)
        await tick()
        await (await getRequestTx(req)).execute(sql`SELECT 1`)
        const nested = await withReqTransaction(req, () => txId(req))
        await tick()
        expect(await txId(req)).toBe(id)
        return { id, nested }
      })
    const out = await Promise.all([sibling(), sibling(), sibling()])
    for (const o of out) expect(o.nested).toBe(o.id)
    expect(new Set(out.map((o) => o.id)).size).toBe(3)
    expect(req.transactionID).toBeUndefined()
  })

  it('a failing sibling rolls back only its own transaction', async () => {
    const req = await pageReq()
    const [bad, good] = await Promise.allSettled([
      withReqTransaction(req, async () => {
        await tick()
        throw new Error('boom')
      }),
      withReqTransaction(req, async () => {
        await (await getRequestTx(req)).execute(sql`SELECT 1`)
        return 'ok'
      }),
    ])
    expect(bad.status).toBe('rejected')
    expect(good).toEqual({ status: 'fulfilled', value: 'ok' })
  })
})
