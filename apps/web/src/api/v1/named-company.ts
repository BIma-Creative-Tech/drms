import type { PayloadRequest } from 'payload'

import { runUnderCompany } from '@/access/company-context'
import { hasRole, mappedCompanies, type Role } from '@/access/roles'
import { writeAuditDetached } from '@/audit/writer'
import { companyOf } from '@/domain/companies'

import { HttpError } from './http'

/** A per-PT reference of a create body the PT is derived from (project, cost center, cash account). */
export type DerivedRef = { collection: 'projects' | 'cost-centers' | 'cash-accounts'; id: number | null | undefined; path: string }

/**
 * MC4 (ADR 0016 §5 "the company is taken from … the create body (`company`)"): optional explicit PT
 * of a `/api/v1` create. Absent → `fn` runs exactly as before (PT derived from the project / cost
 * center / cash account, else the caller's only selected PT) — mobile-v0.2.x / 0.3.0 keep working.
 * Present →
 * 1. it must be an ACTIVE membership of the caller holding one of `roles` IN THAT PT (independent of
 *    the read selection, like sync `company_id`), else 403 `COMPANY_NOT_ALLOWED` (audited
 *    `access_denied`, same answer as a foreign `X-Company-Ids`);
 * 2. the PT of every referenced per-PT document must equal it, else 400 `COMPANY_MISMATCH`
 *    (`errors[].path` = the reference) — the collection hook + DB trigger stay the last guard.
 *    QA-MC4-14 (scope rule): only for a reference in a PT the caller is MAPPED to; a reference of an
 *    unmapped PT is left to `fn`, which answers it exactly like a missing one (no existence oracle);
 * 3. `fn` runs with the read selection narrowed to that PT (a project-less draft lands there; roles,
 *    scope, own employee and settings are those of that PT).
 */
export async function withNamedCompany<T>(req: PayloadRequest, company: number | undefined, opts: { roles: readonly Role[]; refs?: DerivedRef[] }, fn: () => Promise<T>): Promise<T> {
  if (company === undefined) return fn()
  if (!hasRole(req, opts.roles, company)) {
    await writeAuditDetached(req, [{ action: 'access_denied', docType: 'company', field: 'company', reason: 'PT di body bukan keanggotaan dengan peran yang dibutuhkan' }])
    throw new HttpError(403, 'Forbidden', { code: 'COMPANY_NOT_ALLOWED', detail: 'Anda tidak berhak membuat data di PT ini.', errors: [{ path: 'company', message: 'PT bukan PT Anda (atau peran Anda di PT itu tidak cukup).' }] })
  }
  const mapped = mappedCompanies(req)
  for (const ref of opts.refs ?? []) {
    if (typeof ref.id !== 'number') continue
    const derived = await companyOf(req, ref.collection, ref.id)
    if (derived !== undefined && mapped !== null && !mapped.includes(derived)) continue // = missing (fn answers it)
    if (derived !== undefined && derived !== company) {
      throw new HttpError(400, 'Bad Request', { code: 'COMPANY_MISMATCH', detail: 'Data yang dirujuk milik PT lain dari `company`.', errors: [{ path: ref.path, message: 'Data harus dari PT yang sama (cross-company reference).' }] })
    }
  }
  return runUnderCompany(req, company, fn)
}
