import type { AdminViewServerProps, Where } from 'payload'
import React from 'react'

import { notificationHref } from '@/domain/notifications'
import { DEFAULT_TZ } from '@/lib/time'

import { ActionButton } from '../components/ActionButton'
import { ListToolbar, Pager } from '../components/list/ListToolbar'
import { NotificationOpen } from '../components/NotificationOpen'
import { isFiltered, pageOfFind, parseListQuery, searchWhere } from '../list-query'
import { dateTimeId } from './progress-ui'
import { Empty, Shell, TableScroll, badge, table, td, th } from './shared'

/**
 * S3e (US-05, S-04): the caller's own in-app notifications (bell in the nav → here). Newest first,
 * unread marked; "Buka" marks one read and opens its document; "Tandai semua dibaca" uses
 * POST /api/v1/notifications/read-all. Reads with the collection access (own rows only).
 */
type Row = { id: number; title: string; body: string; docType?: string | null; docId?: string | null; docNo?: string | null; readAt?: string | null; createdAt: string }

export async function NotificationsView(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  const user = req.user
  if (!user) return null
  // DRMS 10/10 D8: search (judul / isi / nomor) + read-state filter + pagination in the database
  const lq = parseListQuery(props.searchParams, ['status'])
  const own = { user: { equals: user.id } }
  const and: Where[] = [own]
  if (lq.filters.status === 'baru') and.push({ readAt: { exists: false } })
  if (lq.filters.status === 'dibaca') and.push({ readAt: { exists: true } })
  const text = searchWhere(['title', 'body', 'docNo'], lq.q)
  if (text) and.push(text)
  const res = await req.payload.find({ collection: 'notifications', where: { and }, sort: '-id', limit: lq.per, page: lq.page, depth: 0, user, overrideAccess: false, req })
  const rows = res.docs as unknown as Row[]
  const unread = (await req.payload.count({ collection: 'notifications', where: { and: [own, { readAt: { exists: false } }] }, user, overrideAccess: false, req })).totalDocs
  const tz = process.env.TZ || DEFAULT_TZ
  return (
    <Shell props={props} title="Notifikasi">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span data-pk-unread-count={unread}>{unread > 0 ? `${unread} belum dibaca` : 'Semua sudah dibaca.'}</span>
        {unread > 0 ? <ActionButton url="/api/v1/notifications/read-all" label="Tandai semua dibaca" testId="notifications-read-all" /> : null}
      </div>
      <ListToolbar
        id="notifikasi"
        action="/admin/notifikasi"
        query={lq}
        label="Cari notifikasi"
        search={{ placeholder: 'Judul, isi atau nomor dokumen…' }}
        filters={[{ key: 'status', label: 'Status', options: [{ value: 'baru', label: 'Belum dibaca' }, { value: 'dibaca', label: 'Sudah dibaca' }] }]}
      />
      {rows.length === 0 ? (
        <Empty text={isFiltered(lq) ? 'Tidak ada notifikasi yang cocok.' : 'Belum ada notifikasi.'} />
      ) : (
        <TableScroll label="Notifikasi">
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
        </TableScroll>
      )}
      <Pager id="notifikasi" path="/admin/notifikasi" sp={props.searchParams} page={pageOfFind(res)} unit="notifikasi" />
    </Shell>
  )
}

export default NotificationsView
