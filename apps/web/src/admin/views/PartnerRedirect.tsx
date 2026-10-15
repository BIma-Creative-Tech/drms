import { redirect } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'

import { partnerRedirectTarget } from '@/admin/partner-routes'

/**
 * DRMS 16/10 (b): `/admin/collections/{clients,vendors}/<create|id>` → the tabbed Klien / Vendor page
 * (admin/partner-routes.ts partnerRedirectTarget). Page routes only — the relationship drawer renders the collection
 * form through Payload's renderDocument server function, never through this view.
 */
export function PartnerRedirect(props: AdminViewServerProps) {
  const segments = (props.params as { segments?: string[] } | undefined)?.segments ?? []
  const adminRoute = props.initPageResult?.req?.payload?.config?.routes?.admin ?? '/admin'
  const to = partnerRedirectTarget(segments, adminRoute)
  if (to) redirect(to)
  redirect(`${adminRoute}/collections/${encodeURIComponent(segments[1] ?? '')}`)
}

export default PartnerRedirect
