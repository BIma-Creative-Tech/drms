import React from 'react'

import type { detail } from '@/domain/expense/dto'
import { maskAccountNo } from '@/domain/expense/dto'
import { formatRupiah } from '@/lib/money'
import { formatDateLong } from '@/pdf/format'

import { BankReveal } from './BankReveal'

type Detail = Awaited<ReturnType<typeof detail>>

const named = (r: unknown): string => {
  if (!r || typeof r !== 'object') return ''
  const o = r as { code?: unknown; name?: unknown }
  return [o.code, o.name].filter((x) => typeof x === 'string' && x).join(' ')
}

/** Chosen account of a Draft (no submit snapshot yet) — bank-preview.ts, masked. */
export type DraftBank = { bankName: string | null; accountHolder: string | null; accountNoMasked: string | null; canReveal: boolean }

/**
 * DRMS 10/10 B-2 (item 3): read-only "Rincian pengajuan" of a submitted (locked) request — label: value on one
 * line, the APK detail order (PT, project / pusat biaya, urgensi, tanggal, pemohon, dibuat oleh, rekening,
 * keterangan, lampiran). Replaces the disabled header inputs of the Payload form (empty "Pilih project…"
 * placeholders, a "memuat…" account preview). Rows without a value are left out. Server-rendered from the
 * request DTO; the bank number is masked, the eye button reveals it only for the people the DTO allows.
 * DRMS 13/10 Persetujuan #5/#7: shown for EVERY status (read mode of a Draft too) as a two-column grid on wide screens,
 * with the money totals that left the sidebar (Nominal disetujui, Total ditransfer, Total nota terverifikasi LPJ); the
 * grand total stays the footer of "Rincian item".
 */
export function RequestSummary({ d, ptName, attachments, canRevealBank, draftBank = null }: { d: Detail; ptName: string | null; attachments: Array<{ id: number; name: string }>; canRevealBank: boolean; draftBank?: DraftBank | null }) {
  const scope = d.project ? named(d.project) : d.costCenter ? named(d.costCenter) : ''
  const rows: Array<[string, React.ReactNode, string]> = []
  const add = (label: string, value: React.ReactNode, key: string) => {
    if (value !== null && value !== undefined && value !== '') rows.push([label, value, key])
  }
  add('Jenis', d.typeLabel, 'type')
  add('Judul', d.title, 'title')
  add('PT', ptName, 'company')
  add(d.project ? 'Project' : 'Pusat biaya', scope, 'scope')
  // D2 (DRMS 10/10): cost center chosen by Finance on the (latest posted) transfer
  const cc = [...d.transfers].reverse().find((t) => t.status === 'posted' && t.costCenter)?.costCenter
  if (d.project && cc) add('Pusat biaya', named(cc), 'costCenter')
  add('Tingkat urgensi', d.urgencyLevel && 'name' in d.urgencyLevel ? String(d.urgencyLevel.name ?? '') : '', 'urgency')
  add('Tanggal pengajuan', d.requestDate ? formatDateLong(d.requestDate) : '', 'requestDate')
  add('Tanggal dibutuhkan', d.neededDate ? formatDateLong(d.neededDate) : '', 'neededDate')
  add('Pemohon', d.requesters.map((r) => (r && 'name' in r ? String(r.name ?? '') : '')).filter(Boolean).join(', '), 'requesters')
  add('Dibuat oleh', d.createdBy && 'name' in d.createdBy ? String(d.createdBy.name ?? '') : '', 'createdBy')
  // a submitted request shows its submit snapshot; a Draft (read mode, Persetujuan #7) the chosen account
  const bank = d.bank
    ? { bankName: d.bank.bankName, accountHolder: d.bank.accountHolder, masked: d.bank.accountNo ? (maskAccountNo(d.bank.accountNo, false) ?? '') : null, canReveal: canRevealBank }
    : draftBank
      ? { bankName: draftBank.bankName, accountHolder: draftBank.accountHolder, masked: draftBank.accountNoMasked, canReveal: draftBank.canReveal }
      : null
  add(
    'Rekening tujuan',
    bank ? (
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <span>
          {[bank.bankName, bank.accountHolder].filter(Boolean).join(' · ')}
          {bank.masked ? ' ·' : ''}
        </span>
        {bank.masked ? <BankReveal requestId={d.id} masked={bank.masked} canReveal={bank.canReveal} /> : null}
      </span>
    ) : null,
    'bank',
  )
  if (d.approvedAmount !== null) add('Nominal disetujui', formatRupiah(d.approvedAmount), 'approvedAmount')
  if (d.status !== 'draft') add('Total ditransfer', formatRupiah(d.transferredTotal ?? 0), 'transferredTotal')
  if (d.verifiedReceiptsTotal !== null) add('Total nota terverifikasi LPJ', formatRupiah(d.verifiedReceiptsTotal), 'verifiedReceiptsTotal')
  add('Keterangan', d.notes?.trim() ?? '', 'notes')
  add(
    'Lampiran',
    attachments.length > 0 ? (
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '4px 10px' }}>
        {attachments.map((a) => (
          <a key={a.id} href={`/api/v1/media/attachments/${a.id}/file`} target="_blank" rel="noopener noreferrer">
            {a.name}
          </a>
        ))}
      </span>
    ) : null,
    'attachments',
  )
  return (
    <section className="pk-er-summary" data-pk-section="summary" style={{ border: '1px solid var(--theme-elevation-150)', borderRadius: 4, padding: 12, marginBottom: 16, fontSize: 13 }}>
      <strong style={{ display: 'block', marginBottom: 8 }}>Rincian pengajuan</strong>
      <dl className="pk-er-summary__grid" style={{ margin: 0, display: 'grid', gap: 6 }}>
        {rows.map(([label, value, key]) => (
          <div key={key} className={key === 'notes' || key === 'attachments' || key === 'title' ? 'is-wide' : undefined} data-pk-summary={key} style={{ display: 'flex', flexWrap: 'wrap', gap: '0 8px', alignItems: 'baseline' }}>
            <dt style={{ flex: '0 0 auto', minWidth: 132, color: 'var(--pk-muted-fg)' }}>{label}:</dt>
            <dd style={{ margin: 0, flex: '1 1 160px', minWidth: 0, overflowWrap: 'anywhere', fontWeight: 500 }}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export default RequestSummary
