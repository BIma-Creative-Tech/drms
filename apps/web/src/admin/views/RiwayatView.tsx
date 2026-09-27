import { Gutter } from '@payloadcms/ui'
import type { CollectionSlug, DocumentViewServerProps } from 'payload'
import React from 'react'

import { loadVisible } from '@/domain/expense/common'
import { historyRows, requestHistory, type HistoryRow } from '@/domain/history'
import { formatServerTime } from '@/pdf/format'
import { DEFAULT_TZ } from '@/lib/time'
import { withReqTransaction } from '@/lib/system-tx'

import { Empty, table, td, th } from './shared'

const ACTION_LABELS: Record<string, string> = {
  create: 'dibuat',
  update: 'diubah',
  status_change: 'status',
  void: 'void',
  sign: 'tanda tangan',
  acknowledge: 'disetujui Direktur (Diketahui)', // ADR 0013 (pre-E1 rows: PM "Diketahui")
  approve: 'disetujui',
  reject: 'ditolak',
  verify: 'diverifikasi',
  number_issued: 'nomor terbit',
  flag_raised: 'flag muncul',
  flag_reviewed: 'flag diperiksa',
  export: 'PDF/ekspor',
  print: 'cetak',
  view_sensitive: 'dilihat (sensitif)',
  delete_attempt: 'percobaan hapus',
  acknowledge_delegated: 'Diketahui dilimpahkan',
  access_denied: 'aksi ditolak (hak akses)',
  approval_skipped: 'posisi dilewati (tidak berlaku — pemohon)',
}

const DOC_LABELS: Record<string, string> = { expense_request: 'Pengajuan', receipt: 'Nota', transfer: 'Transfer', settlement: 'LPJ', cash_entry: 'Kas' }

function show(v: unknown): string {
  if (v === null || v === undefined) return '—'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 160 ? `${s.slice(0, 157)}…` : s
}

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
  const settings = await req.payload.findGlobal({ slug: 'company-settings', depth: 0, overrideAccess: true /* SYSTEM-READ: timezone */, req })
  const tz = settings.timezone || process.env.TZ || DEFAULT_TZ
  return (
    <Gutter>
      <h2 style={{ margin: '16px 0' }}>Riwayat</h2>
      {denied ? <Empty text="Dokumen tidak ditemukan." /> : rows.length === 0 ? <Empty text="Belum ada riwayat." /> : null}
      {rows.length > 0 ? (
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
                  {r.userName ?? (r.source === 'job' ? 'sistem (job)' : r.userId ? `user#${r.userId}` : 'sistem')}
                  {r.userRoles ? <div style={{ fontSize: 11 }}>{r.userRoles}</div> : null}
                </td>
                <td style={td}>
                  {DOC_LABELS[r.docType] ?? r.docType}
                  {r.docNo && r.docType !== 'expense_request' ? <div style={{ fontSize: 11 }}>{r.docNo}</div> : null}
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
      ) : null}
    </Gutter>
  )
}

export default RiwayatView
