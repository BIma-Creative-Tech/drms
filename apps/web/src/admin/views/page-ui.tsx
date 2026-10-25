import React from 'react'

import type { Tone } from '@/admin/components/ui/nexus'
import type { IconName } from '@/admin/modules/icons'
import { ADMIN_ROUTE, ITEM_ICONS, MODULES, moduleForPath, type ModuleId } from '@/admin/modules/registry'

/**
 * D2510 (ADR 0033): pure pieces of the custom-view pages (no Payload template → importable by unit tests; frame.tsx /
 * shared.tsx re-use them). Module + glyph of a custom view, for the chip of its page header (PageHead, Shell).
 * Module = the sidebar's `moduleForPath` (deeper routes /kas/12/ubah → keuangan); glyph = the sidebar item with the
 * longest matching route (`ITEM_ICONS`: /absensi/rekap, /kas, /laporan…), else the module glyph. Unknown route → null
 * (the header then has no chip).
 */
export function pageModuleOf(props: { params?: unknown }): { mod: ModuleId; icon: IconName } | null {
  const segments = ((props.params as { segments?: unknown } | undefined)?.segments ?? []) as unknown
  const seg = Array.isArray(segments) ? segments.filter((s): s is string => typeof s === 'string' && s !== '') : []
  return pageModuleOfPath(`${ADMIN_ROUTE}/${seg.join('/')}`)
}

export function pageModuleOfPath(pathname: string): { mod: ModuleId; icon: IconName } | null {
  const mod = moduleForPath(pathname)
  const def = mod ? MODULES.find((m) => m.id === mod) : undefined
  if (!mod || !def) return null
  const rel = (pathname.split(/[?#]/)[0] ?? '').replace(/\/+$/, '').slice(ADMIN_ROUTE.length)
  let best: string | null = null
  for (const k of Object.keys(ITEM_ICONS)) if ((rel === k || rel.startsWith(`${k}/`)) && (!best || k.length > best.length)) best = k
  return { mod, icon: best ? ITEM_ICONS[best]! : def.icon }
}

/**
 * D2510 (ADR 0033): custom-view tables = `<table className="pk-nx-table">` inside a card (muted header row, roomy
 * rows, numbers in `td.n`; custom.scss "D2510 custom pages") and statuses = `<Badge>` (the kit's soft badge). DRMS
 * 15/10 #6 stays: the table hugs its columns (width auto, `.is-full` = the whole card); wide ones scroll inside
 * TableScroll with the frozen header row (custom.scss .pk-tscroll). Long texts wrap, never an ellipsis.
 */
export const NX_TABLE = 'pk-nx-table'

export type BadgeTone = 'ok' | 'warn' | 'bad' | 'muted'
const SOFT_TONE: Record<BadgeTone, Tone> = { ok: 'ok', warn: 'warn', bad: 'bad', muted: 'neutral' }

/**
 * Soft status badge (same markup as the kit's `SoftBadge`) that also carries the `data-pk-*` hooks, aria-label and
 * title of the badges it replaces. Text = the tone's *-text token on its 14 % tint (AA in both modes).
 */
export function Badge({ tone, children, title, ...rest }: { tone: BadgeTone | Tone; children: React.ReactNode; title?: string; 'aria-label'?: string } & Record<`data-${string}`, string | number | undefined>) {
  const t = tone in SOFT_TONE ? SOFT_TONE[tone as BadgeTone] : (tone as Tone)
  return (
    <span className="pk-nx-badge" data-tone={t} title={title} {...rest}>
      {children}
    </span>
  )
}

