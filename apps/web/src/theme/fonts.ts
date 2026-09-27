/**
 * Web-starter typography: Space Grotesk (headings) + DM Sans (body) via next/font/google
 * (next 16.3.6). next/font downloads the files at BUILD time and serves them from
 * /_next/static/media → no runtime request to Google, compatible with CSP `font-src 'self'`.
 * The `variable` names are consumed by (payload)/custom.scss — do not rename.
 */
import { DM_Sans, Space_Grotesk } from 'next/font/google'

export const fontHeading = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-brand-heading',
})

export const fontBody = DM_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-brand-body',
})
