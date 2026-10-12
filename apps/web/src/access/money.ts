import type { CollectionSlug, FieldAccess, PayloadRequest } from 'payload'

import { hasRole, membershipsOf, relId, type Role } from './roles'

/**
 * Owner decision 2026-10-11 (DRMS 10/10 follow-up): project money — the RAB / contract value (`projects.budget`),
 * RAP prices and amounts, the committed-% of the RAB, loan amounts — is for the money roles of the project's PT only
 * (Direktur, Admin, Finance, PM). Staff (and Operator/Anggota) see projects read-only WITHOUT money, on the web, the
 * REST/GraphQL API, /api/v1 and the APK. Same role set as the RAP price roles (domain/rap/service.ts `rapRoles`).
 */
export const MONEY_ROLES: readonly Role[] = ['pk-owner', 'pk-admin', 'pk-finance', 'pk-pm']

/** Does the caller hold a money role IN the PT `company` (unknown PT → false)? */
export function seesMoney(req: Pick<PayloadRequest, 'user'>, company: number | null | undefined): boolean {
  return hasRole(req, MONEY_ROLES, company)
}

/** A money role in EVERY selected PT (no document at hand: permission probes, where/sort validation). */
function moneyInEverySelectedPt(req: Pick<PayloadRequest, 'user'>): boolean {
  const ms = membershipsOf(req.user)
  return ms.length > 0 && ms.every((m) => m.roles.some((r) => MONEY_ROLES.includes(r)))
}

const CTX = 'pkMoneyCompanyOf'

/** PT of a row whose `company` was not selected (REST `?select=`), cached per request. SYSTEM-READ. */
async function companyOfRow(req: PayloadRequest, collection: CollectionSlug, id: number | string): Promise<number | undefined> {
  req.context ??= {}
  const cache = ((req.context[CTX] as Map<string, number | null> | undefined) ?? new Map<string, number | null>()) as Map<string, number | null>
  req.context[CTX] = cache
  const key = `${collection}:${id}`
  if (!cache.has(key)) {
    const row = (await req.payload.findByID({ collection, id, depth: 0, select: { company: true } as never, overrideAccess: true /* SYSTEM-READ: PT of a row the caller already reads (field access) */, req, disableErrors: true })) as { company?: unknown } | null
    cache.set(key, relId(row?.company) ?? null)
  }
  return cache.get(key) ?? undefined
}

/**
 * Field read access of a money field: a money role in the row's PT. The PT comes from the row (`doc` / `data` /
 * `siblingData`), else — a `?select=` without `company` — from the database by `doc.id`. Without any row (Payload
 * permission probes, the validation of a `where` / `sort` on the field) the caller needs a money role in every
 * selected PT, so a Staff of PT A who is PM in PT B cannot filter or sort PT A projects by their RAB.
 */
export function moneyRead(collection: CollectionSlug): FieldAccess {
  return async ({ req, id, doc, data, siblingData }) => {
    const row = (doc ?? data) as { id?: unknown; company?: unknown } | undefined
    let company = relId(row?.company) ?? relId((siblingData as { company?: unknown } | undefined)?.company)
    const rowId = row?.id ?? id
    if (company === undefined && (typeof rowId === 'number' || typeof rowId === 'string')) company = await companyOfRow(req, collection, rowId)
    return company !== undefined ? seesMoney(req, company) : moneyInEverySelectedPt(req)
  }
}
