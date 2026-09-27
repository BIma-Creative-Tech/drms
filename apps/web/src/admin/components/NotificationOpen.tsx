'use client'
import React from 'react'

/**
 * S3e: opens the document of a notification and marks it read first (POST
 * /api/v1/notifications/{id}/read, same-origin cookie session). Navigation happens even when the
 * read call fails — the notification then simply stays unread.
 */
export function NotificationOpen({ id, href, unread, label }: { id: number; href: string; unread: boolean; label: string }) {
  const open = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!unread || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    try {
      await fetch(`/api/v1/notifications/${id}/read`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' })
    } catch {
      // ignore: still navigate
    }
    window.location.assign(href)
  }
  return (
    <a href={href} onClick={open} data-pk-notification-open={id}>
      {label}
    </a>
  )
}

export default NotificationOpen
