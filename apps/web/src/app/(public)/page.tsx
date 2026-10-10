import type { Metadata } from 'next'
import React from 'react'

import { DOWNLOAD_PATH, LOGIN_PATH, PRIVACY_PATH } from '@/legal/paths'
import { BRAND_NAME } from '@/theme/graphics'

import { PublicBrand } from './PublicBrand'

// Rendered per request like /unduh and /privasi: the per-request CSP nonce of src/proxy.ts must reach Next's
// inline bootstrap scripts.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: BRAND_NAME,
  robots: { index: false, follow: false, nocache: true },
}

/**
 * GET / — public home page (owner 2026-10-10: "/" answered 404 and nothing linked to /unduh). Two plain links, no
 * form, no server action (CrowdSec CRS 920420 only exempts admin Server Actions): "Masuk" → web login, "Unduh
 * aplikasi" → APK download page; plus the privacy notice. Not indexed (robots meta of the (public) layout +
 * X-Robots-Tag in next.config.ts).
 */
export default function HomePage() {
  return (
    <main className="pk-pub__main">
      <PublicBrand />
      <h1 className="pk-pub__title">{BRAND_NAME}</h1>
      <p className="pk-pub__lead">Aplikasi proyek, keuangan dan absensi untuk karyawan grup.</p>
      <nav className="pk-pub__actions" aria-label="Pilihan">
        <a className="pk-pub__button" href={LOGIN_PATH} id="pk-home-login">
          Masuk
        </a>
        <a className="pk-pub__button pk-pub__button--secondary" href={DOWNLOAD_PATH} id="pk-home-download">
          Unduh aplikasi Android
        </a>
      </nav>
      <p className="pk-pub__footer">
        <a href={PRIVACY_PATH}>Pemberitahuan privasi</a>
      </p>
    </main>
  )
}
