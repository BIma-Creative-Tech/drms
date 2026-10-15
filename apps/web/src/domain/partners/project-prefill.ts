import type { PayloadRequest } from 'payload'

import { relId } from '@/access/roles'
import { adminCreatePrefill } from '@/domain/employee-user-link'

/**
 * DRMS 16/10 "Klien" page, tab Proyek → "+ Proyek baru": the project create form opened as
 * /admin/collections/projects/create?client=<id> starts with that client and its PT. A field `defaultValue` (server
 * side, part of the form's INITIAL state) — never a client-side prefill on mount (Payload's Form replaces its state
 * with the initial state after the children's effects, see fields/company.ts). Only on that admin create route
 * (adminCreatePrefill); API creates are unaffected. The client must be readable by the caller; the company hook
 * re-checks client + PT on save.
 */
async function clientSeed(req: PayloadRequest, id: number): Promise<{ company?: unknown } | null> {
  req.context ??= {}
  const cache = (req.context.pkProjectClientSeed ??= new Map<number, Promise<{ company?: unknown } | null>>()) as Map<number, Promise<{ company?: unknown } | null>>
  if (!cache.has(id)) {
    cache.set(
      id,
      req.payload
        .findByID({ collection: 'clients', id, depth: 0, select: { company: true }, user: req.user, overrideAccess: false, req, disableErrors: true })
        .then((d) => (d as { company?: unknown } | null) ?? null)
        .catch(() => null),
    )
  }
  return cache.get(id)!
}

export function projectFromClientDefault(field: 'client' | 'company') {
  return async ({ req }: { req: PayloadRequest }): Promise<number | undefined> => {
    const id = adminCreatePrefill(req, 'projects', 'client')
    if (id === undefined) return undefined
    const c = await clientSeed(req, id)
    if (!c) return undefined
    return field === 'client' ? id : relId(c.company)
  }
}
