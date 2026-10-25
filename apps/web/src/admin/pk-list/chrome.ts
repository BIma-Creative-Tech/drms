import type { IconName } from '@/admin/modules/icons'
import { ADMIN_ROUTE, ITEM_ICONS, moduleForPath, type ModuleId } from '@/admin/modules/registry'

/**
 * D2510 (ADR 0033): the head of a PkListView card — the collection's sidebar glyph (ITEM_ICONS, unknown → document)
 * on the tint of the module whose menu lists it (`data-mod`, same gradient as the sidebar chip; none → brand blue).
 * Pure, unit-tested.
 */
export function listChrome(slug: string): { icon: IconName; mod: ModuleId | null } {
  const rel = `/collections/${slug}`
  return { icon: ITEM_ICONS[rel] ?? 'document', mod: moduleForPath(`${ADMIN_ROUTE}${rel}`) }
}
