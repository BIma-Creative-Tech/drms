import { hasRole, isGroupAdmin, relId, type Role } from '@/access/roles'

import { HttpError, json, v1 } from '../http'
import { MembershipBatchBody } from '../schemas-flow'

/**
 * POST /api/v1/company-memberships/batch — MC2 role matrix (wireframe MC §2, US-MC-02/03): the admin
 * view saves every changed cell in ONE transaction (all-or-nothing, no partial save). Each item must
 * be allowed for the caller: Admin OF THAT PT or group admin (ADR 0016 §2) — one forbidden item → 403,
 * nothing is written. Writes go through the collection (Local API with the caller's access, same
 * hooks: same-PT employee, immutable user/PT) so every change is audited (`role_change` for
 * roles/active, `create` for a new membership) with the batch `reason`.
 */
export const membershipBatchEndpoint = v1({
  path: '/company-memberships/batch',
  method: 'post',
  body: MembershipBatchBody,
  rateLimit: [20, 60_000],
  transactional: true,
  idempotent: true,
  handler: async ({ req, body }) => {
    const seen = new Set<string>()
    for (const [i, it] of body.items.entries()) {
      const k = `${it.user}:${it.company}`
      if (seen.has(k)) throw new HttpError(400, 'Bad Request', { detail: `Baris ${i + 1}: pengguna + PT ganda dalam satu simpan.` })
      seen.add(k)
      if (!isGroupAdmin(req) && !hasRole(req, 'pk-admin', it.company)) throw new HttpError(403, 'Forbidden', { detail: `Baris ${i + 1}: Anda bukan Admin PT ini.` })
    }
    req.context.auditReason = body.reason
    const out = []
    for (const it of body.items) {
      const found = await req.payload.find({
        collection: 'company-memberships',
        where: { and: [{ user: { equals: it.user } }, { company: { equals: it.company } }] },
        limit: 1,
        depth: 0,
        overrideAccess: true, // SYSTEM-READ: existing row of a PT the caller administers (checked above)
        req,
      })
      const existing = found.docs[0] as { id: number } | undefined
      const data: Record<string, unknown> = { roles: [...new Set(it.roles)].sort() as Role[] }
      if (it.employee !== undefined) data.employee = it.employee
      if (it.active !== undefined) data.active = it.active
      const doc = (
        existing
          ? await req.payload.update({ collection: 'company-memberships', id: existing.id, data: data as never, depth: 0, user: req.user, overrideAccess: false, req })
          : await req.payload.create({ collection: 'company-memberships', data: { ...data, user: it.user, company: it.company, active: it.active ?? true } as never, depth: 0, user: req.user, overrideAccess: false, req })
      ) as unknown as { id: number; user: unknown; company: unknown; roles?: string[] | null; employee?: unknown; active?: boolean | null }
      out.push({ id: doc.id, user: relId(doc.user)!, company: relId(doc.company)!, roles: doc.roles ?? [], employee: relId(doc.employee) ?? null, active: doc.active !== false, created: !existing })
    }
    return json({ items: out })
  },
})
