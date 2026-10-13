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

import { Empty, TableScroll, table, td, th } from './shared'
import { settings as companySettings } from '@/domain/companies'

/**
 * "Riwayat" document tab (US-35, requirements §8 "Tampilan log", architecture §8): who (user +
 * roles), when (server time, company TZ), what (field / line, old → new, status, reason) and from
 * where (web/apk/job + app version + device id). Expense requests include their receipts,
 * transfers, LPJ (and cash entries for Finance/Owner/Admin). Access: the document must be readable
 * by the caller (collection access, overrideAccess:false) — else nothing is shown.
 */
export async function RiwayatView(props: DocumentViewServerProps) {
  const req = props.initPageResult.req
  const collection = props.initPageResult.collectionConfig
  const id = Number(props.initPageResult.docID ?? (props.doc as { id?: unknown })?.id)
  const docType = (collection?.custom?.pkAudit as { docType?: string } | undefined)?.docType
  const { rows, denied } = await loadRows()

  async function loadRows(): Promise<{ rows: HistoryRow[]; denied: boolean }> {
    if (!collection || !docType || !Number.isSafeInteger(id)) return { rows: [], denied: false }
    return withReqTransaction(req, async () => {
      if (collection.slug === 'expense-requests') {
        const ok = await loadVisible(req, id).then(
          () => true,
          () => false,
        )
        return ok ? { rows: await requestHistory(req, id), denied: false } : { rows: [], denied: true }
      }
      const visible = await req.payload
        .findByID({ collection: collection.slug as CollectionSlug, id, depth: 0, user: req.user, overrideAccess: false, req })
        .catch(() => null)
      return visible ? { rows: await historyRows(req, [{ docType, ids: [String(id)] }]), denied: false } : { rows: [], denied: true }
    })
  }
  const tz = (await companySettings(req)).timezone || process.env.TZ || DEFAULT_TZ
  return (
    <Gutter>
      <h2 style={{ margin: '16px 0' }}>Riwayat</h2>
      {denied ? <Empty text="Dokumen tidak ditemukan." /> : rows.length === 0 ? <Empty text="Belum ada riwayat." /> : null}
      {rows.length > 0 ? (
        <TableScroll label="Riwayat dokumen">
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Waktu (server)</th>
                <th style={th}>Oleh</th>
                <th style={th}>Dokumen</th>
                <th style={th}>Aksi</th>
                <th style={th}>Field</th>
                <th style={th}>Lama → Baru</th>
                <th style={th}>Alasan</th>
                <th style={th}>Sumber / perangkat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatServerTime(r.serverTime, tz)}</td>
                  <td style={td}>
                    {actorText(r)}
                    {r.userRoles ? <div style={{ fontSize: 11 }}>{r.userRoles}</div> : null}
                  </td>
                  <td style={td}>
                    {DOC_LABELS[r.docType] ?? r.docType}
                    {r.docNo && r.docType !== 'expense_request' ? <div style={{ fontSize: 11 }}>{docHref(r.docType, r.docId) ? <a href={docHref(r.docType, r.docId)!}>{r.docNo}</a> : r.docNo}</div> : null}
                  </td>
                  <td style={td}>{ACTION_LABELS[r.action] ?? r.action}</td>
                  <td style={td}>
                    {r.field ?? '—'}
                    {r.lineNo ? ` (baris ${r.lineNo})` : ''}
                  </td>
                  <td style={td}>
                    {r.statusFrom || r.statusTo ? `${r.statusFrom ?? '—'} → ${r.statusTo ?? '—'}` : `${show(r.oldValue)} → ${show(r.newValue)}`}
                  </td>
                  <td style={td}>{r.reason ?? '—'}</td>
                  <td style={td}>
                    {r.source ?? '—'}
                    {r.appVersion ? ` ${r.appVersion}` : ''}
                    {r.deviceId ? <div style={{ fontSize: 11 }}>perangkat {r.deviceId.slice(0, 8)}…</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      ) : null}
    </Gutter>
  )
}

export default RiwayatView
