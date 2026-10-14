import { hasRole } from '@/access/roles'
import { INTERCOMPANY_PAYMENT_ROLES } from '@/domain/expense/drafts'
import { payeeDirectory } from '@/domain/intercompany/service'

import { HttpError, json, v1 } from '../http'
import { IntercompanyPayeesQuery } from '../schemas-flow'

/**
 * ADR 0028 §2 — GET /api/v1/intercompany/payees?company=<paying PT>: the payee directory of a "PT grup" payment —
 * every OTHER active PT of the group with a designated receiving account: PT short code / name, bank, MASKED number,
 * holder (SYSTEM-READ limited to those fields; a filer of PT A cannot read PT B's cash accounts). Caller: Finance, PM
 * or Direktur IN the paying PT (owner decision 2026-10-14), else 403. Also offered to the APK as masters type
 * `intercompany-payees` (offline cache).
 */
export const intercompanyPayeesEndpoint = v1({
  path: '/intercompany/payees',
  method: 'get',
  rateLimit: [60, 60_000],
  handler: async ({ req }) => {
    const q = IntercompanyPayeesQuery.safeParse(Object.fromEntries(req.searchParams.entries()))
    if (!q.success) throw new HttpError(400, 'Bad Request', { errors: q.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) })
    if (!hasRole(req, INTERCOMPANY_PAYMENT_ROLES, q.data.company)) throw new HttpError(403, 'Forbidden', { detail: 'Pembayaran antar-PT hanya untuk Finance, PM atau Direktur PT ini.' })
    return json({ items: await payeeDirectory(req, q.data.company) })
  },
})

export const INTERCOMPANY_ENDPOINTS = [intercompanyPayeesEndpoint]
