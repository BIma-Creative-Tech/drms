import { headers as nextHeaders } from 'next/headers'
import { redirect } from 'next/navigation'
import { createLocalReq, executeAuthStrategies, getPayload, type ImportMap, type SanitizedConfig } from 'payload'

export const UNAUTHORIZED_ROUTE = '/admin/unauthorized'

/** `/admin/collections/<slug>/create` → slug, else null. */
export function createRouteSlug(segments: readonly string[] | undefined): string | null {
  return segments?.length === 3 && segments[0] === 'collections' && segments[2] === 'create' && segments[1] ? segments[1] : null
}

/**
 * QA-24: Payload 3.90.1 renders a HARD-CODED UnauthorizedView for `/collections/<slug>/create` when the
 * caller lacks create permission (views/Document/getDocumentView.js) — heading "Tidak sah, Anda harus
 * masuk…" (`error:unauthorized`, the same key as the REST 401, which must stay). Before Payload renders,
 * a logged-in caller without create access is sent to `/admin/unauthorized`, whose view is ours
 * (admin.components.views.unauthorized → the uniform no-access page). Not logged in / unknown slug /
 * allowed → Payload's normal flow (login redirect, 404, the form). The create access function is the
 * collection's own (same check Payload runs); the company hook still re-checks the PT on save.
 */
export async function redirectDeniedCreate(args: { config: Promise<SanitizedConfig> | SanitizedConfig; importMap: ImportMap; params: Promise<{ segments?: string[] }> }): Promise<void> {
  const slug = createRouteSlug((await args.params).segments)
  if (!slug) return
  const payload = await getPayload({ config: args.config, cron: true, importMap: args.importMap })
  const collection = payload.collections[slug as keyof typeof payload.collections]
  if (!collection) return
  const { user } = await executeAuthStrategies({ headers: await nextHeaders(), payload, canSetHeaders: false })
  if (!user) return
  const req = await createLocalReq({ user }, payload)
  const access = collection.config.access.create
  const allowed = access ? await access({ req, data: {} }) : Boolean(user)
  if (!allowed) redirect(UNAUTHORIZED_ROUTE)
}
