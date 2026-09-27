import React from 'react'

import { semantic } from './tokens'

/**
 * admin.components.graphics (payload 3.90.1 config types: `Icon` = navigation/step-nav icon,
 * `Logo` = login page). Replaces the Payload marks with the DRMS name; no new logo artwork is
 * invented — the mark is a neutral monogram in the theme's primary colour until the client
 * supplies an official logo file. Fill colours are literal token values (not CSS variables)
 * because Payload also renders `Icon` into its OG image route (@payloadcms/next rest/og, satori).
 * Server components, no client JS.
 */
export const BRAND_NAME = 'ProyekKas'
export const BRAND_PRODUCT = 'DRMS'

const { primary, primaryForeground, accent } = semantic.light

function Mark({ size, label }: { size: number | string; label?: string }) {
  return (
    <svg
      className="pk-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      focusable="false"
    >
      <rect width="24" height="24" rx="6" fill={primary} />
      <path
        d="M8 6.5h3.6a5.5 5.5 0 0 1 0 11H8z"
        fill="none"
        stroke={primaryForeground}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <circle cx="17.5" cy="17.5" r="2" fill={accent} />
    </svg>
  )
}

/** Step-nav/home icon. Payload's home link has no text of its own → the mark carries the name. */
export function Icon() {
  return <Mark size="100%" label={`${BRAND_NAME} ${BRAND_PRODUCT} — Beranda`} />
}

/** Login page brand block. */
export function Logo() {
  return (
    <div className="pk-logo">
      <Mark size={44} />
      <span className="pk-logo__text">
        <span className="pk-logo__name">{BRAND_NAME}</span>
        <span className="pk-logo__product">{BRAND_PRODUCT}</span>
      </span>
    </div>
  )
}
