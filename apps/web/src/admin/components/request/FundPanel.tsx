import React from 'react'

import { formatRupiah } from '@/lib/money'

import type { Detail } from './panel-data'

/**
 * ADR 0029 §2 "Ketersediaan dana PT <code>" on the request page (Finance / Direktur / Owner of the PT, while the request
 * waits for a decision or is the Owner's own Draft): Saldo dana (n akun; ADR 0032: accounts still flagged with a legacy site stay excluded) − Komitmen (expandable list)
 * = Dana tersedia; Dibutuhkan = this request; Kurang (red) or "Cukup" (green); the other requests waiting at their final
 * decision; linked inter-PT loans; "Perintahkan pinjaman antar-PT" (Owner, short). Read-only before the final step
 * ("cek akhir di Owner"). The server is the authority: Setujui answers 409 FUND_INSUFFICIENT while short.
 * ADR 0031 amendment (user 2026-10-22): a mapped project shows its Pusat Biaya first (Saldo − Komitmen = Dana bebas);
 * the request passes when the Pusat Biaya OR the PT covers it, and `routeText` says which account Finance pays from.
 */
const rp = formatRupiah
const tone = (ok: boolean): React.CSSProperties => ({
  display: 'inline-block',
  padding: '1px 6px',
  borderRadius: 8,
  fontSize: 11,
  fontWeight: 600,
  color: '#FFFFFF', // ≥ 4.5:1 on every --pk-tone-* (src/theme/tokens.ts)
  background: ok ? 'var(--pk-tone-ok)' : 'var(--pk-tone-bad)',
})

const KIND: Record<'request' | 'shortfall' | 'loan' | 'project_loan', string> = {
  request: 'Pengajuan disetujui, belum ditransfer',
  shortfall: 'Kekurangan LPJ belum dibayar',
  loan: 'Perintah pinjaman (PT ini pemberi), belum dicairkan',
  project_loan: 'Pinjaman antar project disetujui, belum dicairkan',
}

type Item = { kind: keyof typeof KIND; id: number; docNo: string | null; amount: number }

const itemHref = (c: Item): string =>
  c.kind === 'loan' ? `/admin/pinjaman-antar-pt/detail/${c.id}` : c.kind === 'project_loan' ? `/admin/pinjaman/detail/${c.id}` : `/admin/collections/expense-requests/${c.id}`

function Items({ items }: { items: Item[] }) {
  if (items.length === 0) return null
  return (
    <details style={{ marginTop: 4 }}>
      <summary>Rincian komitmen ({items.length})</summary>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
        {items.map((c) => (
          <li key={`${c.kind}-${c.id}`} data-pk-commitment={c.kind}>
            <a href={itemHref(c)}>{c.docNo ?? `#${c.id}`}</a> · {rp(c.amount)} · {KIND[c.kind]}
          </li>
        ))}
      </ul>
    </details>
  )
}

export function FundPanel({ d }: { d: Pick<Detail, 'id' | 'fundCheck' | 'allowedActions' | 'status'> }) {
  const f = d.fundCheck
  if (!f) return null
  const short = f.status === 'insufficient'
  const code = f.company?.shortCode ?? `#${f.companyId}`
  const instruct = (d.allowedActions as readonly string[]).includes('instruct_loan')
  const href = `/admin/pinjaman-antar-pt/baru?borrower=${f.companyId}&requests=${d.id}&amount=${f.gap}`
  const box: React.CSSProperties = { border: `1px solid ${short ? 'var(--pk-tone-bad)' : 'var(--theme-elevation-150)'}`, borderRadius: 4, padding: 12, marginBottom: 16, fontSize: 13 }
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px', margin: '8px 0 0' }
  const pb = f.pusatBiaya
  return (
    <section style={box} data-pk-section="fund-check" data-pk-fund-status={f.status} data-pk-fund-blocked={f.blocked ? 'yes' : 'no'}>
      <strong>Ketersediaan dana PT {code}</strong>{' '}
      {!f.enabled ? <span style={{ fontSize: 12, color: 'var(--theme-elevation-600)' }}>· cek dana PT ini belum aktif (informasi saja)</span> : !f.applies ? <span style={{ fontSize: 12, color: 'var(--theme-elevation-600)' }}>· cek akhir di persetujuan Owner</span> : null}
      {pb ? (
        <dl style={grid} data-pk-fund-pb={pb.accountId}>
          <dt style={{ gridColumn: '1 / -1' }}>
            <b>Pusat biaya: {pb.name}</b>
          </dt>
          <dt>Saldo akun</dt>
          <dd style={{ margin: 0 }} data-pk-fund-pb="balance">
            {rp(pb.balance)}
          </dd>
          <dt>Komitmen</dt>
          <dd style={{ margin: 0 }} data-pk-fund-pb="commitments">
            − {rp(pb.commitments)}
            <Items items={pb.commitmentItems} />
          </dd>
          <dt>
            <b>Dana bebas</b>
          </dt>
          <dd style={{ margin: 0 }} data-pk-fund-pb="available">
            <b>{rp(pb.available)}</b>
          </dd>
          <dt style={{ gridColumn: '1 / -1', marginTop: 4 }}>
            <b>Seluruh PT {code}</b>
          </dt>
        </dl>
      ) : null}
      <dl style={{ ...grid, margin: pb ? '4px 0 0' : grid.margin }}>
        <dt>Saldo dana</dt>
        <dd style={{ margin: 0 }} data-pk-fund="balance">
          {rp(f.balance)} <span style={{ color: 'var(--theme-elevation-600)' }}>({f.accountCount} akun{f.excludedSiteAccounts.count ? ` — ${f.excludedSiteAccounts.count} akun kas cabang (site lama) ${rp(f.excludedSiteAccounts.balance)} tidak dihitung` : ''})</span>
        </dd>
        <dt>Komitmen</dt>
        <dd style={{ margin: 0 }} data-pk-fund="commitments">
          − {rp(f.commitments)}
          <Items items={f.commitmentItems} />
        </dd>
        <dt>
          <b>Dana tersedia</b>
        </dt>
        <dd style={{ margin: 0 }} data-pk-fund="available">
          <b>{rp(f.available)}</b>
        </dd>
        <dt>Dibutuhkan</dt>
        <dd style={{ margin: 0 }} data-pk-fund="needed">
          {rp(f.needed)}
        </dd>
        <dt>{short ? 'Kurang' : 'Status'}</dt>
        <dd style={{ margin: 0 }} data-pk-fund="gap">
          <span style={tone(!short)}>{short ? `Kurang ${rp(f.gap)}` : 'Cukup'}</span>
        </dd>
      </dl>
      {f.routeText ? (
        <p style={{ margin: '8px 0 0' }} data-pk-fund-route={f.route}>
          {f.routeText}
        </p>
      ) : null}
      {f.waitingAtOwner.count > 0 ? (
        <p style={{ margin: '8px 0 0' }} data-pk-fund-waiting>
          Pengajuan lain menunggu persetujuan akhir di PT ini: {f.waitingAtOwner.count}, total {rp(f.waitingAtOwner.amount)} (belum dicadangkan — yang disetujui lebih dulu memakai dana lebih dulu).
        </p>
      ) : null}
      {f.loans.length > 0 ? (
        <p style={{ margin: '8px 0 0' }} data-pk-fund-loans>
          Pinjaman antar-PT untuk pengajuan ini:{' '}
          {f.loans.map((l, i) => (
            <span key={l.id}>
              {i > 0 ? ', ' : ''}
              <a href={`/admin/pinjaman-antar-pt/detail/${l.id}`}>{l.docNo}</a> ({l.lender?.shortCode ?? '—'}, {rp(l.amount)})
            </span>
          ))}
        </p>
      ) : null}
      {f.blocked && f.blockedText ? (
        <p style={{ margin: '8px 0 0', color: 'var(--theme-error-500)' }} data-pk-fund-blocked-text>
          {d.status === 'draft' ? `${pb ? `Dana pusat biaya ${pb.name} maupun dana PT` : 'Dana PT'} tidak cukup — kurang ${rp(f.gap)}. Pengajuan Anda tidak dapat dikirim sampai dana tersedia; perintahkan pinjaman antar-PT.` : f.blockedText}
        </p>
      ) : null}
      {instruct ? (
        <p style={{ margin: '8px 0 0' }}>
          <a className="btn btn--style-primary btn--size-small pk-pbtn" href={href} data-pk-action="instruct-loan">
            Perintahkan pinjaman antar-PT
          </a>
        </p>
      ) : null}
    </section>
  )
}

export default FundPanel
