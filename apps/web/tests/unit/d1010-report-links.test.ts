import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { docLink } from '@/admin/doc-links'
import { ReportTable } from '@/admin/views/f3-ui'
import { measure } from '@/domain/expense/sla'
import type { Table } from '@/domain/reports/registry'
import { slaTables, type SlaRow } from '@/domain/reports/sla-report'

/** DRMS 10/10 12b (Lead review e): every document number in a report opens its document. */
describe('report document-number links', () => {
  it('docLink: cell key → detail URL, nothing for unknown types / missing ids', () => {
    expect(docLink('transfer', 'transfer', 7)).toEqual({ transfer: '/admin/collections/transfers/7' })
    expect(docLink('nomor', 'cash_entry', '12')).toEqual({ nomor: '/admin/collections/cash-entries/12' })
    expect(docLink('nomor', 'expense_request', null)).toEqual({})
    expect(docLink('dokumen', 'user', 3)).toEqual({})
    expect(docLink('dokumen', undefined, 3)).toEqual({})
  })

  it('SLA Transfer: the late rows link the request number AND the TRF number', () => {
    const approvedAt = new Date('2026-10-01T00:00:00Z')
    const transferAt = new Date('2026-10-03T00:00:00Z')
    const row: SlaRow = {
      transfer_id: 41,
      transfer_no: 'TRF/DRMS/2610/0001',
      transfer_at: transferAt.toISOString(),
      created_at: transferAt.toISOString(),
      request_id: 9,
      request_no: 'PB/DRMS/2610/0009',
      title: 'Sewa genset (fiktif)',
      type: 'advance',
      approved_at: approvedAt.toISOString(),
      approved_local: '2026-10-01 08:00',
      company_id: 1,
      sla_hours: 24,
      timezone: 'Asia/Makassar',
      m: measure({ approvedAt, transferAt, recordedAt: transferAt, slaHours: 24 }),
      month: '2026-10',
      slaHours: 24,
    }
    const late = slaTables([row], { from: '2026-10-01', to: '2026-10-31' }).extra[0]!.rows[0]!
    expect(late.links).toEqual({ pengajuan: '/admin/collections/expense-requests/9', transfer: '/admin/collections/transfers/41' })
  })

  it('ReportTable renders per-cell links; the row link skips the PT column of a consolidated report', () => {
    const t: Table = {
      key: 'x',
      title: 'X',
      columns: [
        { key: 'pt', label: 'PT', type: 'text', primary: true },
        { key: 'nomor', label: 'Nomor', type: 'text', primary: true },
        { key: 'transfer', label: 'Transfer', type: 'text' },
        { key: 'judul', label: 'Judul', type: 'text' },
      ],
      rows: [{ cells: { pt: 'DRMS', nomor: 'PB/1', transfer: 'TRF/1', judul: 'Semen' }, href: '/admin/collections/expense-requests/1', links: { transfer: '/admin/collections/transfers/5' }, company: 1 }],
    }
    const html = renderToStaticMarkup(React.createElement(ReportTable, { t, id: 'x' }))
    expect(html).toContain('<a href="/admin/collections/expense-requests/1">PB/1</a>')
    expect(html).toContain('<a href="/admin/collections/transfers/5">TRF/1</a>')
    expect(html).not.toContain('>DRMS</a>')
    expect(html).not.toContain('>Semen</a>')
  })
})
