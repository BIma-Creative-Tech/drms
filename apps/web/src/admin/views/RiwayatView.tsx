import { Gutter } from '@payloadcms/ui'
import type { CollectionSlug, DocumentViewServerProps } from 'payload'
import React from 'react'

import { loadVisible } from '@/domain/expense/common'
import { historyRows, requestHistory, type HistoryRow } from '@/domain/history'
import { actorText, ACTION_LABELS, DOC_LABELS, showValue as show } from '@/domain/history-format'
import { formatServerTime } from '@/pdf/format'
import { DEFAULT_TZ } from '@/lib/time'
import { withReqTransaction } from '@/lib/system-tx'

import { docHref } from '../doc-links'
import { Panel } from '../components/ui/nexus'

import { Empty, NX_TABLE, TableScroll } from './shared'
import { settings as companySettings } from '@/domain/companies'

/**
 * "Riwayat" document tab (US-35, requirements §8 "Tampilan log", architecture §8): who (user +
 * roles), when (server time, company TZ), what (field / line, old → new, status, reason) and from
 * where (web/apk/job + app version + device id). Expense requests include their receipts,
 * transfers, LPJ (and cash entries for Finance/Owner/Admin). Access: the document must be readable
 * by the caller (collection access, overrideAccess:false) — else nothing is shown.
 * UI feedback 17/10 #2: the expense-request page has no tab row (config EXPENSE_REQUEST_VIEWS) — its Riwayat page is
 * opened from the action bar and links back to the request.
 */
export async function RiwayatView(props: DocumentViewServerProps) {
  const req = props.initPageResult.req
  const collection = props.initPageResult.collectionConfig
  const id = Number(props.initPageResult.docID ?? (props.doc as { id?: unknown })?.id)
  const docType = (collection?.custom?.pkAudit as { docType?: string } | undefined)?.docType
  const { rows, denied } = await loadRows()

  async function loadRows(): Promise<{ rows: HistoryRow[]; denied: boolean }> {
    if (!collection || !docType || !Number.isSafeInteger(id)) return { rows: [], denied: false }
    // Visibility first, OUTSIDE the history transaction: a refused findByID (404/403) makes Payload kill the req's
    // transaction, and the commit of withReqTransaction then failed ("no active transaction") — the page crashed
    // instead of showing "Dokumen tidak ditemukan." (found by the UI feedback 17/10 #2 test).
    const isExpense = collection.slug === 'expense-requests'
    const visible = isExpense
      ? await loadVisible(req, id).then(
          () => true,
          () => false,
        )
      : await req.payload
          .findByID({ collection: collection.slug as CollectionSlug, id, depth: 0, user: req.user, overrideAccess: false, req })
          .then(
            () => true,
            () => false,
          )
    if (!visible) return { rows: [], denied: true }
    return withReqTransaction(req, async () => ({ rows: isExpense ? await requestHistory(req, id) : await historyRows(req, [{ docType, ids: [String(id)] }]), denied: false }))
  }
  const tz = (await companySettings(req)).timezone || process.env.TZ || DEFAULT_TZ
  return (
    <Gutter>
      <div className="pk-nx-page pk-nx-page--tab">
      {collection?.slug === 'expense-requests' && Number.isSafeInteger(id) ? (
        <p className="pk-nx-back">
          <a className="btn btn--style-secondary btn--size-small pk-pbtn" href={`/admin/collections/expense-requests/${id}`} data-pk-link="back-to-request">
            ← Kembali ke pengajuan
          </a>
        </p>
      ) : null}
      {/* D2510: the history as a Nexus card (muted header row, soft rows); texts / columns unchanged */}
      <Panel id="riwayat" icon="tShieldSearch" title="Riwayat">
      {denied ? <Empty text="Dokumen tidak ditemukan." /> : rows.length === 0 ? <Empty text="Belum ada riwayat." /> : null}
      {rows.length > 0 ? (
        <TableScroll label="Riwayat dokumen">
          <table className={NX_TABLE}>
            <thead>
              <tr>
                <th>Waktu (server)</th>
                <th>Oleh</th>
                <th>Dokumen</th>
                <th>Aksi</th>
                <th>Field</th>
                <th>Lama → Baru</th>
                <th>Alasan</th>
                <th>Sumber / perangkat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="pk-nx-nowrap">{formatServerTime(r.serverTime, tz)}</td>
                  <td>
                    {actorText(r)}
                    {r.userRoles ? <span className="pk-nx-sub">{r.userRoles}</span> : null}
                  </td>
                  <td>
                    {DOC_LABELS[r.docType] ?? r.docType}
                    {r.docNo && r.docType !== 'expense_request' ? <span className="pk-nx-sub">{docHref(r.docType, r.docId) ? <a href={docHref(r.docType, r.docId)!}>{r.docNo}</a> : r.docNo}</span> : null}
                  </td>
                  <td>{ACTION_LABELS[r.action] ?? r.action}</td>
                  <td>
                    {r.field ?? '—'}
                    {r.lineNo ? ` (baris ${r.lineNo})` : ''}
                  </td>
                  <td>{r.statusFrom || r.statusTo ? `${r.statusFrom ?? '—'} → ${r.statusTo ?? '—'}` : `${show(r.oldValue)} → ${show(r.newValue)}`}</td>
                  <td>{r.reason ?? '—'}</td>
                  <td>
                    {r.source ?? '—'}
                    {r.appVersion ? ` ${r.appVersion}` : ''}
                    {r.deviceId ? <span className="pk-nx-sub">perangkat {r.deviceId.slice(0, 8)}…</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      ) : null}
      </Panel>
      </div>
    </Gutter>
  )
}

export default RiwayatView
