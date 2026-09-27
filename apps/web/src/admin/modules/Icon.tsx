import React from 'react'

import { ICONS, type IconDef, type IconName } from './icons'

/**
 * Inline Iconsax glyph (see ./icons.ts for provenance + licence). No hooks → renders in server and
 * client components. Decorative by default (aria-hidden); the surrounding control carries the name.
 */
export function Icon({ name, size = 20, className }: { name: IconName; size?: number | string; className?: string }) {
  const def: IconDef = ICONS[name]
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      {def.paths.map((p, i) =>
        def.style === 'bulk' ? (
          <path key={i} d={p.d} fill="currentColor" opacity={p.o} />
        ) : (
          <path key={i} d={p.d} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" strokeMiterlimit={10} opacity={p.o} />
        ),
      )}
    </svg>
  )
}
