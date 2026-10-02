import type { PayloadRequest } from 'payload'

import { parseCompanyIds } from '@/access/company-context'
import { memberCompanies } from '@/access/roles'
import { writeAuditDetached } from '@/audit/writer'

import { HttpError } from './http'

/**
 * MC3-1 (ADR 0016 §5): optional `?company=1,3` filter of /api/v1 list / queue endpoints. It only
 * NARROWS the request's effective selection (`X-Company-Ids` / cookie ∩ active memberships): every
 * id must be in that selection, else 403 `COMPANY_NOT_ALLOWED` (audited `access_denied`, same
 * answer as a foreign `X-Company-Ids`); malformed → 400. Absent/empty → `undefined` (no filter).
 * The result is never empty, so a caller can pass it on as a narrowing filter safely.
 */
export async function companyQuery(req: PayloadRequest, name = 'company'): Promise<number[] | undefined> {
  const raw = req.searchParams?.get(name) ?? null
  const ids = parseCompanyIds(raw)
  if (ids === 'invalid') throw new HttpError(400, 'Bad Request', { detail: `${name} harus daftar id PT (mis. 1,3).`, errors: [{ path: name, message: 'id PT tidak valid.' }] })
  if (ids === null || ids.length === 0) return undefined
  await assertSelectedCompanies(req, ids, name)
  return ids.sort((a, b) => a - b)
}

/**
 * Every id must be in the request's selection (`X-Company-Ids` / cookie ∩ active memberships), else 403
 * `COMPANY_NOT_ALLOWED` (audited). Shared by `?company=` and the report parameter `?pt=` (QA-MC4-14:
 * a foreign `pt` used to narrow the report silently to nothing).
 */
export async function assertSelectedCompanies(req: PayloadRequest, ids: readonly number[], name: string): Promise<void> {
  const selected = memberCompanies(req)
  if (ids.some((id) => !selected.includes(id))) {
    await writeAuditDetached(req, [{ action: 'access_denied', docType: 'company', field: name, reason: `PT di luar pilihan/keanggotaan (filter ?${name}=)` }])
    throw new HttpError(403, 'Forbidden', { code: 'COMPANY_NOT_ALLOWED', detail: 'PT yang diminta bukan PT Anda (atau tidak termasuk PT yang dipilih).' })
  }
}

/** Single-PT variant (`?company=3`): more than one id → 400. */
export async function singleCompanyQuery(req: PayloadRequest, name = 'company'): Promise<number | undefined> {
  const ids = await companyQuery(req, name)
  if (ids === undefined) return undefined
  if (ids.length !== 1) throw new HttpError(400, 'Bad Request', { detail: `${name} hanya satu PT.`, errors: [{ path: name, message: 'Pilih satu PT.' }] })
  return ids[0]
}
