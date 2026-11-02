import type { PayloadRequest } from 'payload'

import { hasRoleAny, userId } from '@/access/roles'

/**
 * ADR 0022 §9 (price visibility, owner 2026-10-10): loan amounts are money figures → Direktur, Admin, Finance and
 * PM only; Staff / Operator never see loans (empty list, never a 403 inside a transaction).
 */
export function mayReadLoans(req: PayloadRequest): boolean {
  return hasRoleAny(req, 'pk-owner', 'pk-admin', 'pk-finance', 'pk-pm')
}

const CTX_IDS = 'pkVisibleLoanIds'

/** Ids of loans the caller may read (collection read access), cached per request (repayments / approvals read access). */
export async function visibleLoanIds(req: PayloadRequest): Promise<number[]> {
  const uid = userId(req)
  if (uid === undefined || !mayReadLoans(req)) return []
  const cached = req.context?.[CTX_IDS] as { uid: number; ids: number[] } | undefined
  if (cached && cached.uid === uid) return cached.ids
  const res = await req.payload.find({
    collection: 'project-loans',
    depth: 0,
    pagination: false,
    select: { status: true },
    user: req.user,
    overrideAccess: false, // the caller's own read scope decides
    req,
    disableErrors: true, // no read access → [] (a thrown 403 would roll back the request transaction)
  })
  const ids = res.docs.map((d) => d.id as number)
  req.context[CTX_IDS] = { uid, ids }
  return ids
}
