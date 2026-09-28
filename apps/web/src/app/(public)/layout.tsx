import type { Metadata } from 'next'
import React from 'react'

import { fontBody, fontHeading } from '@/theme/fonts'
import { themeCssVariables } from '@/theme/tokens'

import './public.css'

/**
 * Root layout of the PUBLIC pages (route group `(public)`, currently only `/unduh`): no Payload,
 * no session, no client components. Same web-starter tokens/fonts as the admin
 * (`(payload)/layout.tsx`): colour tokens as CSS variables on <html>, self-hosted next/font files.
 * Not indexed (robots meta here + X-Robots-Tag in next.config.ts): pages for DRMS employees only.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
}

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${fontHeading.variable} ${fontBody.variable}`} style={themeCssVariables() as React.CSSProperties}>
      <body className="pk-pub">{children}</body>
    </html>
  )
}
