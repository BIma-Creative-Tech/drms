import type { AdminViewServerProps, Where } from 'payload'
import React from 'react'

import { notificationHref, selectedCompaniesWhere } from '@/domain/notifications'
import { DEFAULT_TZ } from '@/lib/time'

import { ActionButton } from '../components/ActionButton'
import { ListToolbar, Pager } from '../components/list/ListToolbar'
import { NotificationOpen } from '../components/NotificationOpen'
import { Panel } from '../components/ui/nexus'
import { allowedValues, isFiltered, pageOfFind, parseListQuery, searchWhere } from '../list-query'
import { dateTimeId } from './progress-ui'
import { Badge, Empty, NX_TABLE, Shell, TableScroll } from './shared'

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
  // DRMS 23/10: list + count follow the PT switcher (same rule as the bell)
  const pt = selectedCompaniesWhere(user)
  const own: Where = pt ? { and: [{ user: { equals: user.id } }, pt] } : { user: { equals: user.id } }
  const and: Where[] = [own]
  // DRMS 13/10 Umum #4: multi-select — both ticked = every notification
  const status = allowedValues(lq, 'status', ['baru', 'dibaca'] as const)
  if (status.length === 1) and.push({ readAt: { exists: status[0] === 'dibaca' } })
  const text = searchWhere(['title', 'body', 'docNo'], lq.q)
  if (text) and.push(text)
  const res = await req.payload.find({ collection: 'notifications', where: { and }, sort: '-id', limit: lq.per, page: lq.page, depth: 0, user, overrideAccess: false, req })
  const rows = res.docs as unknown as Row[]
  const unread = (await req.payload.count({ collection: 'notifications', where: { and: [own, { readAt: { exists: false } }] }, user, overrideAccess: false, req })).totalDocs
  const tz = process.env.TZ || DEFAULT_TZ
  return (
    <Shell
      props={props}
      title="Notifikasi"
      sub={<span data-pk-unread-count={unread}>{unread > 0 ? `${unread} belum dibaca` : 'Semua sudah dibaca.'}</span>}
      actions={unread > 0 ? <ActionButton url="/api/v1/notifications/read-all" label="Tandai semua dibaca" testId="notifications-read-all" /> : null}
    >
      <Panel id="notifikasi-list" icon="tNotification" title="Kotak masuk" note={`(${res.totalDocs})`}>
      <ListToolbar
        id="notifikasi"
        action="/admin/notifikasi"
        query={lq}
        label="Cari notifikasi"
        search={{ placeholder: 'Judul, isi atau nomor dokumen…' }}
        filters={[{ key: 'status', label: 'Status', multi: true, options: [{ value: 'baru', label: 'Belum dibaca' }, { value: 'dibaca', label: 'Sudah dibaca' }] }]}
      />
      {rows.length === 0 ? (
        <Empty text={isFiltered(lq) ? 'Tidak ada notifikasi yang cocok.' : 'Belum ada notifikasi.'} />
      ) : (
        <TableScroll label="Notifikasi">
          <table className={NX_TABLE} data-pk-table="notifications">
            <thead>
              <tr>
                <th>Waktu (WITA)</th>
                <th>Notifikasi</th>
                <th>Dokumen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => {
                const href = notificationHref(n.docType, n.docId)
                return (
                  <tr key={n.id} data-pk-notification={n.id} data-pk-read={n.readAt ? 'true' : 'false'}>
                    <td className="pk-nx-nowrap">{dateTimeId(n.createdAt, tz)}</td>
                    <td>
                      {!n.readAt ? (
                        <>
                          <Badge tone="warn">baru</Badge>{' '}
                        </>
                      ) : null}
                      <span className={n.readAt ? undefined : 'pk-nx-strong'}>{n.title}</span>
                      <span className="pk-nx-sub">{n.body}</span>
                    </td>
                    <td>{href ? <NotificationOpen id={n.id} href={href} unread={!n.readAt} label={n.docNo ? `Buka ${n.docNo}` : 'Buka'} /> : (n.docNo ?? '—')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
      <Pager id="notifikasi" path="/admin/notifikasi" sp={props.searchParams} page={pageOfFind(res)} unit="notifikasi" />
      </Panel>
    </Shell>
  )
}

export default NotificationsView
