import type { Payload, TypedUser } from 'payload'
import Link from 'next/link'
import React from 'react'

import { Icon } from '@/admin/modules/Icon'
import { loadUnread } from '@/admin/shell/modules-server'

/**
 * S3e (US-05, S-04): notification bell with the unread count of the CALLER's own in-app
 * notifications (collection read access, overrideAccess:false). Since the Odoo-style navigation it
 * sits in the top bar (rendered by the ModuleNav server component and handed to the client bar as a
 * node) instead of admin.components.beforeNavLinks; the bar is part of every admin page, including
 * the custom views wrapped in DefaultTemplate. The page /admin/notifikasi lists the notifications
 * and marks them read through /api/v1/notifications. Server-rendered on navigation (no polling).
 */
export async function NotificationBell({ payload, user }: { payload: Pick<Payload, 'count'>; user?: TypedUser }) {
  if (!user) return null
  const unread = await loadUnread(payload, user)
  const label = unread > 0 ? `Notifikasi, ${unread} belum dibaca` : 'Notifikasi, tidak ada yang belum dibaca'
  return (
    <Link href="/admin/notifikasi" aria-label={label} title={label} data-pk-nav-link="notifikasi" data-pk-unread={unread} className="pk-bar__icon-btn pk-bell">
      <Icon name="bell" size={22} />
      {unread > 0 ? (
        <span className="pk-bar__count" aria-hidden="true">
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </Link>
  )
}

export default NotificationBell
