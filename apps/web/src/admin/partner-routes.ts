/**
 * DRMS 16/10: the tabbed "Klien" / "Vendor" pages (admin/views/Partners.tsx) — `/admin/klien/baru`,
 * `/admin/klien/<id>`, `/admin/vendor/baru`, `/admin/vendor/<id>`. They replace Payload's document form as the entry of
 * the list ("+ Buat baru", row click) and of the "Ubah" / "Lihat" row action. Pure (client + server).
 */
export const PARTNER_FORM_ROUTES = { clients: '/klien', vendors: '/vendor' } as const

export type PartnerSlug = keyof typeof PARTNER_FORM_ROUTES

export function isPartnerSlug(slug: string): slug is PartnerSlug {
  return slug === 'clients' || slug === 'vendors'
}

/** Page of one record (`'baru'` = create) of a partner collection; null for any other collection. */
export function partnerFormHref(slug: string, id: string | number | 'baru', adminRoute = '/admin'): string | null {
  if (!isPartnerSlug(slug)) return null
  return `${adminRoute}${PARTNER_FORM_ROUTES[slug]}/${id === 'baru' ? 'baru' : encodeURIComponent(String(id))}`
}

/** "+ Proyek baru" of the Klien page: the project create form starting with this client and its PT (server defaults). */
export function projectForClientHref(clientId: number, adminRoute = '/admin'): string {
  return `${adminRoute}/collections/projects/create?client=${encodeURIComponent(String(clientId))}`
}
