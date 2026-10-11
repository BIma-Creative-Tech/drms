import type { IconName } from '@/admin/modules/icons'
import { activeHref, ADMIN_ROUTE, moduleLandingHref, type ResolvedModule } from '@/admin/modules/registry'

/**
 * Breadcrumb line under the module bar (replaces Payload's AppHeader/StepNav row, whose home crumb
 * is the graphics Icon — a lone "D" on every page, and an empty row on pages without crumbs).
 * Pure (no React): the client ModuleBar feeds it the pathname, the active module and Payload's
 * step-nav items (useStepNav) and renders the result; tests/unit/admin-modules.test.ts covers it.
 *
 * - Home crumb = the current module (icon + name → its first menu item); a page outside every
 *   module (account, a hidden entity) → "Semua modul" (launcher).
 * - Entity routes (/collections/<slug>…, /globals/<slug>, /account): Payload's steps, or — before
 *   the view has set them (SSR, first paint) or when they belong to the previous page — a fallback
 *   from the module's own menu labels, so the line does not jump in after hydration.
 * - The launcher and the custom views of a single-item module set no steps → no crumbs → no row,
 *   no gap (their title is the page's h1 and the bar already names the module).
 * - DRMS 10/10 D9: the home crumb links the module LANDING page (module.href) when the module has
 *   one; its custom views get "module › menu item" so every sub-menu leads back to the landing page,
 *   and the landing page itself shows "Semua modul › module".
 * - The last crumb is the current page (no link, aria-current="page") — except the fallback entity
 *   crumb of an edit page, which stays a link until Payload names the document.
 */

export type StepLike = { label: unknown; url?: string }
export type Crumb = { key: string; label: string; href?: string; icon?: IconName; mod?: string; current?: boolean }

export type CrumbInput = {
  pathname: string
  module: ResolvedModule | null
  /** Payload step-nav items that belong to THIS pathname, or null when there are none yet. */
  steps: readonly StepLike[] | null
  /** Payload label (string | Record<lang, string>) → display string. */
  translate: (label: unknown) => string
}

type Route = { kind: 'collection' | 'global'; slug: string; deeper: boolean } | { kind: 'account' } | { kind: 'other' }

export function routeOf(pathname: string): Route {
  const clean = (pathname.split(/[?#]/)[0] ?? '').replace(/\/+$/, '')
  if (!clean.startsWith(`${ADMIN_ROUTE}/`)) return { kind: 'other' }
  const seg = clean.slice(ADMIN_ROUTE.length).split('/').filter(Boolean)
  if ((seg[0] === 'collections' || seg[0] === 'globals') && seg[1]) {
    return { kind: seg[0] === 'collections' ? 'collection' : 'global', slug: seg[1], deeper: seg.length > 2 }
  }
  if (seg[0] === 'account' && seg.length === 1) return { kind: 'account' }
  return { kind: 'other' }
}

const norm = (s: string) => s.trim().toLocaleLowerCase('id')

/** Label of an entity from the module menu (e.g. "Pengajuan biaya"), else null. */
function menuLabel(module: ResolvedModule | null, href: string): string | null {
  for (const s of module?.sections ?? []) for (const i of s.items) if (i.href === href) return i.label
  return null
}

export function deriveCrumbs({ pathname, module, steps, translate }: CrumbInput): Crumb[] {
  const route = routeOf(pathname)
  let tail: Array<{ label: string; href?: string }> = []
  const fromMenu = !steps?.length
  if (!fromMenu) {
    tail = steps!.map((s) => ({ label: translate(s.label).trim(), href: s.url || undefined })).filter((s) => s.label)
  } else if (route.kind === 'collection' || route.kind === 'global') {
    const href = `${ADMIN_ROUTE}/${route.kind === 'collection' ? 'collections' : 'globals'}/${route.slug}`
    const label = menuLabel(module, href)
    if (label) tail = [{ label, href: route.deeper ? href : undefined }]
  } else if (route.kind === 'account') {
    tail = [{ label: 'Akun' }]
  } else if (module?.landing) {
    const clean = (pathname.split(/[?#]/)[0] ?? '').replace(/\/+$/, '')
    if (clean === moduleLandingHref(module.id)) {
      return [
        { key: 'home', label: 'Semua modul', href: ADMIN_ROUTE, icon: 'grid' },
        { key: 'c0', label: module.label, icon: module.icon, mod: module.id, current: true },
      ]
    }
    const href = activeHref(clean, module.sections.flatMap((sec) => sec.items.map((i) => i.href)))
    const label = href ? menuLabel(module, href) : null
    if (href && label) tail = [{ label, href: clean !== href ? href : undefined }]
  }
  // Custom views / launcher: no steps of their own → nothing to show (and no empty row).
  if (!tail.length) return []

  const home: Crumb = module
    ? { key: 'home', label: module.label, href: module.href, icon: module.icon, mod: module.id }
    : { key: 'home', label: 'Semua modul', href: ADMIN_ROUTE, icon: 'grid' }
  // "Persetujuan › Persetujuan": a step repeating the module name adds nothing.
  if (norm(tail[0]!.label) === norm(home.label)) {
    if (tail.length === 1) return [{ ...home, href: undefined, current: true }]
    tail = tail.slice(1)
  }

  const last = tail.length - 1
  return [
    home,
    // last = current page; a fallback entity crumb on a deeper page (doc title not known yet) stays a link
    ...tail.map((t, i): Crumb => (i === last && !(fromMenu && t.href) ? { key: `c${i}`, label: t.label, current: true } : { key: `c${i}`, label: t.label, href: t.href })),
  ]
}
