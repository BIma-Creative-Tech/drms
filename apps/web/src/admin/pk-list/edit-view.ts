import { canUseMatrix, viewerOf } from '@/admin/components/access/role-matrix'

/**
 * DRMS 13/10 Wave 3: collections whose "Buat baru" and row click open a custom tabbed view instead of Payload's
 * document form — `users` → "Pengguna" (/admin/pengguna/baru, /admin/pengguna/<id>) for Admins of a PT / group
 * admins (the onboarding gate). Everyone else (own profile + signature, Direktur read) keeps Payload's form. The
 * "Aksi" column (Payload form) is left out where the custom view applies — the row opens the record. Pure.
 */
export type CustomEdit = { createHref: string; rowHref: (id: string | number) => string }

export function customEditOf(slug: string, user: unknown, adminRoute = '/admin'): CustomEdit | null {
  if (slug !== 'users' || !canUseMatrix(viewerOf(user))) return null
  return {
    createHref: `${adminRoute}/pengguna/baru`,
    rowHref: (id) => `${adminRoute}/pengguna/${encodeURIComponent(String(id))}`,
  }
}
