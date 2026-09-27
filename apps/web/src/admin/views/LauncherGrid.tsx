'use client'

import { motion, MotionConfig } from 'motion/react'
import Link from 'next/link'
import React from 'react'

import { Icon } from '@/admin/modules/Icon'
import type { ResolvedModule } from '@/admin/modules/registry'

/**
 * Launcher tiles: gradient square (module tokens --pk-mod-<id>-from/to, custom.scss) with a white
 * Iconsax Bulk glyph, label, one-line hint and the summed badge count. Staggered entrance + hover
 * lift via motion; MotionConfig reducedMotion="user" turns both off for prefers-reduced-motion.
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

export function LauncherGrid({ modules }: { modules: ResolvedModule[] }) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.ul className="pk-launcher__grid" variants={container} initial="hidden" animate="show" aria-label="Modul">
        {modules.map((m) => (
          <motion.li key={m.id} variants={tile} whileHover="hover" whileTap="tap">
            <Link
              href={m.href}
              className="pk-tile"
              data-mod={m.id}
              data-pk-tile={m.id}
              aria-label={m.badge ? `${m.label}, ${m.badge} menunggu tindakan` : m.label}
            >
              <motion.span className="pk-tile__icon" variants={lift}>
                <Icon name={m.icon} size="52%" />
                {m.badge ? (
                  <span className="pk-tile__badge" aria-hidden="true">
                    {m.badge > 99 ? '99+' : m.badge}
                  </span>
                ) : null}
              </motion.span>
              <span className="pk-tile__label">{m.label}</span>
              <span className="pk-tile__hint">{m.hint}</span>
            </Link>
          </motion.li>
        ))}
      </motion.ul>
    </MotionConfig>
  )
}

export default LauncherGrid
