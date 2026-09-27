import type { AdminViewServerProps } from 'payload'
import React from 'react'

import { notificationHref } from '@/domain/notifications'
import { DEFAULT_TZ } from '@/lib/time'

import { ActionButton } from '../components/ActionButton'
import { NotificationOpen } from '../components/NotificationOpen'
import { dateTimeId } from './progress-ui'
import { Empty, Shell, badge, table, td, th } from './shared'

/**
 * S3e (US-05, S-04): the caller's own in-app notifications (bell in the nav → here). Newest first,
 * unread marked; "Buka" marks one read and opens its document; "Tandai semua dibaca" uses
 * POST /api/v1/notifications/read-all. Reads with the collection access (own rows only).
 */
const LIMIT = 50

type Row = { id: number; title: string; body: string; docType?: string | null; docId?: string | null; docNo?: string | null; readAt?: string | null; createdAt: string }

export async function NotificationsView(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  const user = req.user
  if (!user) return null
  const res = await req.payload.find({ collection: 'notifications', where: { user: { equals: user.id } }, sort: '-id', limit: LIMIT, depth: 0, user, overrideAccess: false, req })
  const rows = res.docs as unknown as Row[]
  const unread = rows.filter((r) => !r.readAt).length
  const tz = process.env.TZ || DEFAULT_TZ
  return (
    <Shell props={props} title="Notifikasi">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span data-pk-unread-count={unread}>{unread > 0 ? `${unread} belum dibaca` : 'Semua sudah dibaca.'}</span>
        {unread > 0 ? <ActionButton url="/api/v1/notifications/read-all" label="Tandai semua dibaca" testId="notifications-read-all" /> : null}
      </div>
      {rows.length === 0 ? (
        <Empty text="Belum ada notifikasi." />
      ) : (
        <table style={table} data-pk-table="notifications">
          <thead>
            <tr>
              <th style={th}>Waktu (WITA)</th>
              <th style={th}>Notifikasi</th>
              <th style={th}>Dokumen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => {
              const href = notificationHref(n.docType, n.docId)
              return (
                <tr key={n.id} data-pk-notification={n.id} data-pk-read={n.readAt ? 'true' : 'false'}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{dateTimeId(n.createdAt, tz)}</td>
                  <td style={td}>
                    {!n.readAt ? <span style={{ ...badge('warn'), marginRight: 6 }}>baru</span> : null}
                    <span style={{ fontWeight: n.readAt ? 400 : 700 }}>{n.title}</span>
                    <div style={{ fontSize: 12 }}>{n.body}</div>
                  </td>
                  <td style={td}>{href ? <NotificationOpen id={n.id} href={href} unread={!n.readAt} label={n.docNo ? `Buka ${n.docNo}` : 'Buka'} /> : (n.docNo ?? '—')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {res.totalDocs > LIMIT ? <p style={{ fontSize: 12 }}>Menampilkan {LIMIT} terbaru dari {res.totalDocs}. Riwayat lengkap: menu Sistem → Notifikasi.</p> : null}
    </Shell>
  )
}

export default NotificationsView
