import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { visibleRequestIds } from '@/domain/expense/access'
import { loadVisible } from '@/domain/expense/common'
import { loadVisibleLoan } from '@/domain/loans/service'
import { getRequestTx } from '@/lib/tx'

import { getTestPayload, sqlAs, withContext } from './helpers'
import { asUser, makeFlowUser, makeWorld, type FlowUser, type World } from './flow-world'

/**
 * Prod 0.23.0 (2026-11-01/02): /admin/pinjaman/detail/{id} of a loan the caller may not read and /admin/persetujuan
 * answered 500 "getRequestTx: no active transaction on req" instead of "Pinjaman tidak ditemukan" / an empty inbox.
 * Payload rolls the request transaction back on EVERY error one of its operations throws (killTransaction) — the refused
 * read was caught, the page went on and the commit found no transaction. Refusable reads now pass `disableErrors: true`;
 * withReqTransaction names a transaction lost that way. Fictional data only.
 */
let w: World
let memberless: FlowUser
const UNKNOWN_ID = 2_000_000_000

/** The request transaction is still open (raw SQL on it works). */
const alive = async (req: PayloadRequest) => (await getRequestTx(req)).execute(sql`SELECT 1`)

beforeAll(async () => {
  w = await makeWorld('KTX')
  // like the prod callers: the account's only PT membership is inactive → read access `false` (Forbidden) everywhere
  const u = await makeFlowUser(['pk-pm'], 'ktx-memberless', null)
  await sqlAs('app', 'UPDATE company_memberships SET active = false WHERE user_id = $1', [u.id])
  memberless = await withContext(u)
})

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

describe('a refused / unknown read keeps the request transaction open', () => {
  it('loan detail page (`loadVisibleLoan(...).catch(() => null)` inside the transaction) → null, no 500', async () => {
    const doc = await asUser(w.users.finance, async (req) => {
      const d = await loadVisibleLoan(req, UNKNOWN_ID).catch(() => null)
      await alive(req)
      return d
    })
    expect(doc).toBeNull()
  })

  it('loadVisible (expense request): unknown id and no read access → 404, transaction still open', async () => {
    const cases: Array<[FlowUser, number]> = [
      [w.users.finance, UNKNOWN_ID], // findByID: NotFound
      [memberless, 1], // findByID: Forbidden (read access false)
    ]
    for (const [user, id] of cases) {
      const err = await asUser(user, async (req) => {
        const e = (await loadVisible(req, id).then(
          () => null,
          (x: unknown) => x,
        )) as { status?: number; message?: string } | null
        await alive(req)
        return { status: e?.status, message: e?.message }
      })
      expect(err).toEqual({ status: 404, message: 'Pengajuan tidak ditemukan.' })
    }
  })

  it('visibleRequestIds without read access (satellite read rules, Persetujuan inbox) → [], transaction still open', async () => {
    const ids = await asUser(memberless, async (req) => {
      const r = await visibleRequestIds(req)
      await alive(req)
      return r
    })
    expect(ids).toEqual([])
  })
})

describe('withReqTransaction', () => {
  it('a Payload error caught inside → named error instead of a commit of a transaction that is gone', async () => {
    await expect(
      asUser(w.users.finance, async (req) => {
        await req.payload.findByID({ collection: 'projects', id: UNKNOWN_ID, depth: 0, overrideAccess: true /* SYSTEM-READ: test */, req }).catch(() => null)
        return 'ok'
      }),
    ).rejects.toThrow(/rolled back by a caught Payload error/)
  })
})
