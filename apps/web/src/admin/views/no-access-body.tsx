import Link from 'next/link'
import React from 'react'

/**
 * QA-20(c) / QA-24: ONE "no access" page for every custom admin view and for Payload's unauthorized
 * route (admin.components.views.unauthorized). Same text everywhere, no role codes ("pk-finance"),
 * a link back. The server still refuses the data/actions themselves (views re-check, /api/v1 403).
 */
export const NO_ACCESS_TITLE = 'Tidak ada akses'
export const NO_ACCESS_TEXT = 'Anda tidak memiliki akses ke halaman ini.'
export const NO_ACCESS_BACK = { href: '/admin', label: '← Kembali ke beranda' } as const

/** Body of the page (also used by the minimal-template unauthorized view). */
export function NoAccessBody({ hint }: { hint?: React.ReactNode }) {
  return (
    <div className="pk-alert bad" role="alert" data-pk-denied="no-access">
      <b aria-hidden>!</b>
      <div>
        <p style={{ margin: 0 }}>
          <strong>{NO_ACCESS_TEXT}</strong>
        </p>
        {hint ? <p style={{ margin: '6px 0 0' }}>{hint}</p> : null}
        <p style={{ margin: '10px 0 0' }}>
          <Link className="pk-kbtn sm" href={NO_ACCESS_BACK.href} data-pk-back>
            {NO_ACCESS_BACK.label}
          </Link>
        </p>
      </div>
    </div>
  )
}
