import React from 'react'

import { BRAND_NAME, BRAND_PRODUCT } from '@/theme/graphics'

/** Brand row of the public pages (/unduh, /privasi): inline SVG mark + name, no client JS. */
export function PublicBrand() {
  return (
    <header className="pk-pub__brand">
      <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect width="24" height="24" rx="6" className="pk-pub__mark-bg" />
        <path d="M8 6.5h3.6a5.5 5.5 0 0 1 0 11H8z" fill="none" className="pk-pub__mark-fg" strokeWidth="2.2" strokeLinejoin="round" />
        <circle cx="17.5" cy="17.5" r="2" className="pk-pub__mark-dot" />
      </svg>
      <span>
        <span className="pk-pub__name">{BRAND_NAME}</span> <span className="pk-pub__product">{BRAND_PRODUCT}</span>
      </span>
    </header>
  )
}
