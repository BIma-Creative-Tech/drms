'use client'
import React, { useState } from 'react'

import type { HistoryEntry } from '@/domain/history-format'

const PAGE = 20

const th: React.CSSProperties = { textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid var(--theme-elevation-150)', fontWeight: 600, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '4px 6px', borderBottom: '1px solid var(--theme-elevation-100)', verticalAlign: 'top', overflowWrap: 'anywhere' }

/**
 * DRMS 13/10 Persetujuan #6/#13: "Log perubahan" at the end of the request page — the request's history
 * (domain/history.ts: the request + its receipts, transfers, LPJ, and cash entries for the office roles): who, when,
 * action, field old → new, status change, reason; newest first, 20 per page, collapsed by default. The created /
 * last-changed times (Payload's document meta is hidden on this page, Wave 1 #13) head the section. The full table
 * with source / device stays in the "Riwayat" tab. Rows are pre-formatted on the server (history-format.ts).
 */
export function ChangeLog({ entries, created, updated }: { entries: HistoryEntry[]; created: string | null; updated: string | null }) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(entries.length / PAGE))
  const p = Math.min(page, pages - 1)
  const rows = entries.slice(p * PAGE, p * PAGE + PAGE)
  return (
    <details className="pk-changelog" data-pk-section="changelog">
      <summary className="pk-changelog__summary">
        <strong>Log perubahan</strong> <span className="pk-changelog__count">({entries.length} catatan)</span>
      </summary>
      <p className="pk-changelog__meta" data-pk-timestamps>
        {created ? <span>Dibuat: {created}</span> : null}
        {created && updated ? ' · ' : null}
        {updated ? <span>Terakhir diubah: {updated}</span> : null}
      </p>
      {entries.length === 0 ? (
        <p style={{ fontSize: 13 }}>Belum ada catatan.</p>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }} role="region" aria-label="Log perubahan pengajuan" tabIndex={0}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={th}>Waktu</th>
                  <th style={th}>Oleh</th>
                  <th style={th}>Aksi</th>
                  <th style={th}>Perubahan</th>
                  <th style={th}>Alasan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-pk-log-row={r.id}>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{r.at}</td>
                    <td style={td}>{r.who}</td>
                    <td style={td}>
                      {r.action}
                      {r.doc !== 'Pengajuan' ? <div style={{ fontSize: 11, color: 'var(--theme-elevation-700)' }}>{r.doc}</div> : null}
                    </td>
                    <td style={td}>
                      {r.field ? <span style={{ fontWeight: 600 }}>{r.field}: </span> : null}
                      {r.change}
                    </td>
                    <td style={td}>{r.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 ? (
            <nav className="pk-changelog__pager" aria-label="Halaman log perubahan">
              <button type="button" className="btn btn--style-secondary btn--size-small pk-pbtn" disabled={p === 0} onClick={() => setPage(p - 1)} data-pk-action="log-prev">
                ‹ Sebelumnya
              </button>
              <span aria-live="polite">
                Halaman {p + 1} dari {pages}
              </span>
              <button type="button" className="btn btn--style-secondary btn--size-small pk-pbtn" disabled={p >= pages - 1} onClick={() => setPage(p + 1)} data-pk-action="log-next">
                Berikutnya ›
              </button>
            </nav>
          ) : null}
        </>
      )}
    </details>
  )
}

export default ChangeLog
