import type { Payload, TypedUser } from 'payload'
import Link from 'next/link'
import React from 'react'

/**
 * S3e (US-05, S-04): notification bell at the top of the admin nav (admin.components.beforeNavLinks —
 * the nav is part of every admin page, including the custom views wrapped in DefaultTemplate, whereas
 * header `actions` are not passed to those). Unread count of the CALLER's own in-app notifications
 * (collection read access, overrideAccess:false); the page /admin/notifikasi lists them and marks
 * them read through /api/v1/notifications. Server-rendered on navigation (no polling in the panel).
 */
export async function NotificationBell({ payload, user }: { payload: Payload; user?: TypedUser }) {
  if (!user) return null
  let unread = 0
  try {
    const r = await payload.count({
      collection: 'notifications',
      where: { and: [{ user: { equals: user.id } }, { readAt: { exists: false } }] },
      user,
      overrideAccess: false,
    })
    unread = r.totalDocs
  } catch {
    unread = 0 // a failing count must never break the nav
  }
  const label = unread > 0 ? `Notifikasi, ${unread} belum dibaca` : 'Notifikasi, tidak ada yang belum dibaca'
  return (
    <div style={{ margin: '0 0 12px', paddingBottom: 8, borderBottom: '1px solid var(--theme-elevation-100)' }}>
      <Link
        href="/admin/notifikasi"
        aria-label={label}
        title={label}
        data-pk-nav-link="notifikasi"
        data-pk-unread={unread}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', textDecoration: 'none' }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        <span style={{ flex: 1 }}>Notifikasi</span>
        {unread > 0 ? (
          <span style={{ background: 'var(--pk-tone-bad)', color: '#FFFFFF', borderRadius: 10, padding: '0 7px', fontSize: 11, fontWeight: 700 }} aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </Link>
    </div>
  )
}

export default NotificationBell
