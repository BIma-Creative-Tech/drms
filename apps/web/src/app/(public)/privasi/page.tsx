import type { Metadata } from 'next'
import React from 'react'

import { PrivacyNoticeBody } from '@/legal/PrivacyNoticeBody'
import { PRIVACY_NOTICE } from '@/legal/privacy-notice'

import { PublicBrand } from '../PublicBrand'

// The notice is bundled at build time (src/legal/privacy-notice.generated.ts). Rendered per request anyway (like
// /unduh): the per-request CSP nonce of src/proxy.ts must reach Next's inline bootstrap scripts.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: PRIVACY_NOTICE.title,
  robots: { index: false, follow: false, nocache: true },
}

/**
 * GET /privasi — the employee privacy notice (Q-46, ASVS 8.3.3), public: readable before login (linked from the
 * web login page and /unduh) and by people without an account. Not indexed (robots meta of the (public) layout +
 * X-Robots-Tag in next.config.ts). Text, title and version come only from the bundled markdown.
 */
export default function PrivasiPage() {
  return (
    <main className="pk-pub__main pk-pub__main--wide">
      <PublicBrand />
      <h1 className="pk-pub__title">{PRIVACY_NOTICE.title}</h1>
      <article className="pk-pub__card" data-pk-privacy-version={PRIVACY_NOTICE.version}>
        <PrivacyNoticeBody skipTitle />
      </article>
    </main>
  )
}
