'use client'

import { motion, MotionConfig } from 'motion/react'
import Link from 'next/link'
import React from 'react'

import { Icon } from '@/admin/modules/Icon'
import type { IconName } from '@/admin/modules/icons'
import type { ResolvedModule } from '@/admin/modules/registry'

/**
 * Launcher tiles: gradient square (module tokens --pk-mod-<id>-from/to, custom.scss) with a white
 * Iconsax Bulk glyph, label, one-line hint and the summed badge count. Staggered entrance + hover
 * lift via motion; MotionConfig reducedMotion="user" turns both off for prefers-reduced-motion.
 * DRMS 10/10 D9: the same grid renders the sub-menu tiles of a module landing page (`tiles`).
 */
const container = { hidden: {}, show: { transition: { staggerChildren: 0.035, delayChildren: 0.04 } } }
const tile = {
  hidden: { opacity: 0, y: 14, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring' as const, stiffness: 380, damping: 30 } },
}

const lift = {
  hover: { y: -4, scale: 1.05, transition: { type: 'spring' as const, stiffness: 420, damping: 24 } },
  tap: { scale: 0.97 },
}

export type GridTile = { key: string; href: string; label: string; hint: string; icon: IconName; mod: string; badge?: number; navKey?: string }

export function LauncherGrid({ modules, tiles, label = 'Modul' }: { modules?: ResolvedModule[]; tiles?: GridTile[]; label?: string }) {
  const list: Array<GridTile & { sub: boolean }> = tiles
    ? tiles.map((t) => ({ ...t, sub: true }))
    : (modules ?? []).map((m) => ({ key: m.id, href: m.href, label: m.label, hint: m.hint, icon: m.icon, mod: m.id, badge: m.badge, sub: false }))
  return (
    <MotionConfig reducedMotion="user">
      <motion.ul className="pk-launcher__grid" variants={container} initial="hidden" animate="show" aria-label={label}>
        {list.map((t) => (
          <motion.li key={t.key} variants={tile} whileHover="hover" whileTap="tap">
            <Link
              href={t.href}
              className="pk-tile"
              data-mod={t.mod}
              data-pk-tile={t.sub ? undefined : t.mod}
              data-pk-subtile={t.sub ? (t.navKey ?? t.href) : undefined}
              aria-label={t.badge ? `${t.label}, ${t.badge} menunggu tindakan` : t.label}
            >
              <motion.span className="pk-tile__icon" variants={lift}>
                <Icon name={t.icon} size="52%" />
                {t.badge ? (
                  <span className="pk-tile__badge" aria-hidden="true">
                    {t.badge > 99 ? '99+' : t.badge}
                  </span>
                ) : null}
              </motion.span>
              <span className="pk-tile__label">{t.label}</span>
              <span className="pk-tile__hint">{t.hint}</span>
            </Link>
          </motion.li>
        ))}
      </motion.ul>
    </MotionConfig>
  )
}

export default LauncherGrid
