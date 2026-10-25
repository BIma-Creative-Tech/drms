import type { IconName } from '@/admin/modules/icons'
import { itemIcon, type ModuleId, type ResolvedModule } from '@/admin/modules/registry'

/**
 * D2510 (Nexus layout): pure helpers of the sidebar shell — the command palette search (Ctrl+K) over the
 * caller's already-resolved menu items, and the compact-sidebar cookie. No React, no Payload runtime: the
 * client shell (ModuleBar / AppSidebar / CommandPalette) and tests/unit/d2510-web-shell.test.ts use them.
 * The palette only links — every target re-checks access itself (same as the sidebar).
 */

export type NavEntry = { key: string; label: string; href: string; icon: IconName; mod: ModuleId; moduleLabel: string; section?: string; badge?: number; haystack: string }

/** Lower-case, no diacritics, single spaces ("Pengajuan  Biaya" → "pengajuan biaya"). */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('id')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Every visible menu item once (registry order; an alias placement keeps its own module). */
export function navEntries(modules: readonly ResolvedModule[]): NavEntry[] {
  const out: NavEntry[] = []
  const seen = new Set<string>()
  for (const m of modules) {
    for (const s of m.sections) {
      for (const i of s.items) {
        if (seen.has(i.href)) continue
        seen.add(i.href)
        const label = i.label.replace(/^\+\s*/, '')
        const create = i.label.startsWith('+')
        out.push({
          key: i.key,
          label: create ? `Buat ${label.replace(/\s+baru$/i, '')}` : label,
          href: i.href,
          icon: itemIcon(i, m.icon),
          mod: m.id,
          moduleLabel: m.label,
          ...(s.label ? { section: s.label } : {}),
          ...(i.badge ? { badge: i.badge } : {}),
          haystack: fold([label, m.label, s.label ?? '', create ? 'buat baru tambah' : ''].join(' ')),
        })
      }
    }
  }
  return out
}

/**
 * Entries matching every word of the query (in any order, prefix of a word in the label ranks first), at most
 * `limit`. An empty query lists the first entries (registry order) so the palette is never blank.
 */
export function searchNav(entries: readonly NavEntry[], query: string, limit = 12): NavEntry[] {
  const words = fold(query).split(' ').filter(Boolean)
  if (!words.length) return entries.slice(0, limit)
  const scored: Array<{ e: NavEntry; score: number; i: number }> = []
  entries.forEach((e, i) => {
    if (!words.every((w) => e.haystack.includes(w))) return
    const label = fold(e.label)
    const starts = label.startsWith(words[0]!) ? 0 : label.split(' ').some((p) => p.startsWith(words[0]!)) ? 1 : 2
    scored.push({ e, score: starts, i })
  })
  return scored
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .slice(0, limit)
    .map((s) => s.e)
}

/** Ctrl+K / ⌘K opens the palette (also inside text inputs: the combination types nothing there). */
export function isPaletteShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k'
}

/** Desktop sidebar mode, remembered per browser in a cookie so the server renders the right width (no jump). */
export const SIDEBAR_COOKIE = 'pk-side'
export type SidebarMode = 'full' | 'compact'

export function sidebarMode(cookieValue: string | undefined | null): SidebarMode {
  return cookieValue === 'compact' ? 'compact' : 'full'
}

export function sidebarCookie(mode: SidebarMode): string {
  return `${SIDEBAR_COOKIE}=${mode}; Path=/admin; Max-Age=31536000; SameSite=Lax`
}
