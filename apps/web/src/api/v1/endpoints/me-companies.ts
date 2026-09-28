import { companyCookieName } from '@/access/company-context'
import { companyContextOf } from '@/access/roles'
import { cookieValue, SWITCHER_COOKIE_MAX_AGE } from '@/admin/shell/company-switcher'
import { writeAuditDetached } from '@/audit/writer'
import { serializeCookie } from '@/auth/cookies'
import { getEnv } from '@/lib/env'

import { problem, v1 } from '../http'
import { MeCompaniesBody } from '../schemas-companies'

/**
 * POST /api/v1/me/companies — the web PT switcher (ADR 0016 §5, wireframe §1a, MC2-4). Stores the
 * READ selection in the HttpOnly cookie `pk-company-ids` (`__Host-` on https) that the auth
 * strategies intersect with the caller's ACTIVE memberships on every request. Only narrows: a PT
 * without an active membership → 403 COMPANY_NOT_ALLOWED (audited `access_denied`); mutations
 * never use the selection (role in the document's PT). The APK sends `X-Company-Ids` instead.
 */
export const meCompaniesEndpoint = v1({
  path: '/me/companies',
  method: 'post',
  body: MeCompaniesBody,
  maxBodyBytes: 2048,
  rateLimit: [30, 60_000],
  handler: async ({ req, body }) => {
    const ctx = companyContextOf(req.user)
    const memberIds = (ctx?.memberships ?? []).map((m) => m.company)
    if (memberIds.length === 0) return problem(409, 'Conflict', { detail: 'Akun ini belum menjadi anggota PT mana pun.' })
    const requested = body.companyIds
    if (requested !== null) {
      if (requested.length === 0) return problem(400, 'Bad Request', { detail: 'Pilih minimal satu PT.' })
      if (requested.some((id) => !memberIds.includes(id))) {
        await writeAuditDetached(req, [{ action: 'access_denied', docType: 'company', field: 'companyIds', reason: 'PT di luar keanggotaan (pemilih PT)' }])
        return problem(403, 'Forbidden', { code: 'COMPANY_NOT_ALLOWED', detail: 'PT yang diminta bukan PT Anda.' })
      }
    }
    const value = cookieValue(memberIds, requested)
    const insecure = getEnv().AUTH_COOKIE_INSECURE
    const name = companyCookieName(insecure)
    const cookie = value === null ? serializeCookie(name, '', { maxAge: 0, insecure }) : serializeCookie(name, value, { maxAge: SWITCHER_COOKIE_MAX_AGE, insecure })
    const selected = value === null ? [...memberIds].sort((a, b) => a - b) : value.split(',').map(Number)
    return Response.json({ selected, all: value === null }, { status: 200, headers: { 'Cache-Control': 'no-store', 'Set-Cookie': cookie } })
  },
})
