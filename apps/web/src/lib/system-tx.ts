import { sql } from '@payloadcms/db-postgres'
import { createLocalReq, type Payload, type PayloadRequest } from 'payload'

import { getRequestTx } from './tx'

/** Runs all pending DEFERRED constraint triggers now (errors surface), then defers again. */
export async function forceDeferredChecks(req: PayloadRequest): Promise<void> {
  const tx = await getRequestTx(req)
  await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`)
  await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`)
}

/**
 * Runs `fn` in ONE explicit DB transaction with a fresh local req (ADR 0007 fallback pattern):
 * every Local API call that receives this `req` joins the transaction (Payload initTransaction
 * reuses an existing `req.transactionID` and leaves commit/rollback to its owner).
 * Used by system tooling (auth routes, seed, tests). `user` null = system actor.
 */
export async function withSystemTransaction<T>(
  payload: Payload,
  user: PayloadRequest['user'],
  fn: (req: PayloadRequest) => Promise<T>,
  context: Record<string, unknown> = {},
): Promise<T> {
  const req = await createLocalReq({ user: user ?? undefined, context }, payload)
  return withReqTransaction(req, () => fn(req))
}

/**
 * Wraps `fn` in a transaction bound to an EXISTING req (custom /api/v1 endpoints: Payload does
 * not open a transaction for root endpoints). Nested use joins the outer transaction.
 */
export async function withReqTransaction<T>(req: PayloadRequest, fn: () => Promise<T>): Promise<T> {
  if (req.transactionID) return fn()
  const id = await req.payload.db.beginTransaction()
  if (!id) throw new Error('transactions not supported by adapter')
  req.transactionID = id
  try {
    const result = await fn()
    // Payload rolls the request transaction back and removes it from req on EVERY error one of its operations throws
    // (utilities/killTransaction.js, payload 3.90.1) — also when `fn` catches it (a refused 403/404 read turned into
    // "not found"). Never go on as if it were still open: what `fn` wrote before is gone, later writes ran outside it.
    // Reads that may be refused pass `disableErrors: true` (null / no rows, nothing thrown) instead.
    if (req.transactionID !== id) throw new Error('withReqTransaction: the transaction was rolled back by a caught Payload error (read with disableErrors: true)')
    // Payload's commitTransaction swallows COMMIT errors (@payloadcms/drizzle 3.90.1
    // transactions/commitTransaction.js + beginTransaction.js `.catch`), so a failing DEFERRED
    // constraint trigger would roll back silently while the caller reports success. Force every
    // deferred check to run now, inside the transaction, where an error still propagates.
    await forceDeferredChecks(req)
    await req.payload.db.commitTransaction(id)
    return result
  } catch (err) {
    await req.payload.db.rollbackTransaction(id)
    throw err
  } finally {
    delete req.transactionID
  }
}
