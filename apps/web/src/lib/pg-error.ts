/**
 * QA-05 (QA report 2026-10-08): Postgres errors reach the services WRAPPED — drizzle throws a
 * `DrizzleQueryError` ("Failed query: …") whose `cause` is the pg `DatabaseError` carrying the
 * SQLSTATE. Checking only `err.code` missed every DB guard (triggers/constraints) and answered 500.
 * Pure module (unit-tested).
 */

/** SQLSTATEs of the DB guards (insufficient privilege, unique, check, raise exception) → 409, never 500. */
export const DB_GUARD_CODES: ReadonlySet<string> = new Set(['42501', '23505', '23514', 'P0001'])

const SQLSTATE = /^[0-9A-Z]{5}$/

/** SQLSTATE of `err` or of the first error in its `cause` chain (max 4 levels); undefined when none. */
export function pgCode(err: unknown): string | undefined {
  let e: unknown = err
  for (let depth = 0; depth < 4 && e !== null && typeof e === 'object'; depth++) {
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string' && SQLSTATE.test(code)) return code
    e = (e as { cause?: unknown }).cause
  }
  return undefined
}

/** True when `err` (or its cause) is a DB guard violation (see DB_GUARD_CODES). */
export function isDbGuardError(err: unknown): boolean {
  const code = pgCode(err)
  return code !== undefined && DB_GUARD_CODES.has(code)
}

/** Message of the pg error (the cause when wrapped) — logs only, never sent to the client. */
export function pgMessage(err: unknown): string | undefined {
  const own = (err as { message?: unknown } | null)?.message
  const cause = (err as { cause?: { message?: unknown } } | null)?.cause?.message
  return typeof cause === 'string' ? cause : typeof own === 'string' ? own : undefined
}
