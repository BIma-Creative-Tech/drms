'use client'
import { useDocumentInfo, useFormFields } from '@payloadcms/ui'
import React, { useEffect, useState } from 'react'

import { groupDigits, previewQuery } from './bank-preview-query'

type Preview = { source: 'account' | 'snapshot'; bankName: string | null; accountHolder: string | null; accountNoMasked: string | null; canReveal: boolean; accountNo?: string }

const relValue = (v: unknown): number | null => {
  if (typeof v === 'number') return v
  if (v && typeof v === 'object' && 'value' in v) return relValue((v as { value: unknown }).value)
  if (v && typeof v === 'object' && 'id' in v) return relValue((v as { id: unknown }).id)
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v)
  return null
}

const EYE = 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'
const EYE_OFF = 'M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2'

/**
 * DRMS 10/10 8e (WA-04): the chosen destination account right under the "Rekening tujuan" picker —
 * bank · holder · masked number ("••••1234") — instead of the snapshot group that stayed empty until
 * submit. After submit the same card shows the snapshot taken at submit. The eye button fetches the
 * full number only when the server allows it (`canReveal`: creator/requesters, Finance/Direktur/Admin
 * of the PT — dto.ts maskAccountNo rule); everyone else never receives it.
 */
export function BankAccountPreview() {
  const { id } = useDocumentInfo()
  const requestId = typeof id === 'number' ? id : typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : null
  // ADR 0027: a vendor payment previews the chosen vendor account
  const vendor = useFormFields(([f]) => f.payeeType?.value === 'vendor')
  // ADR 0028: a PT grup payment previews the receiving PT's designated account (masked until submit)
  const intercompany = useFormFields(([f]) => f.payeeType?.value === 'pt_grup')
  const employeeAccount = useFormFields(([f]) => relValue(f.bankAccount?.value))
  const vendorAccount = useFormFields(([f]) => relValue(f.vendorBankAccount?.value))
  const payeeCompany = useFormFields(([f]) => relValue(f.payeeCompany?.value))
  const accountId = intercompany ? payeeCompany : vendor ? vendorAccount : employeeAccount
  const status = useFormFields(([f]) => (typeof f.status?.value === 'string' ? f.status.value : null))
  const draft = status === null || status === 'draft'
  const url = previewQuery({ requestId, accountId, draft, vendor, intercompany })
  // results are keyed by the query URL → a changed picker value never shows the previous account / number
  const [res, setRes] = useState<{ url: string; data: Preview | null; status: 'ok' | 'none' | 'error' } | null>(null)
  const [revealed, setRevealed] = useState<{ url: string; no: string } | null>(null)
  const [revealing, setRevealing] = useState(false)

  useEffect(() => {
    if (!url) return
    let alive = true
    fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(async (r) => {
        if (!alive) return
        if (r.status === 404) return setRes({ url, data: null, status: 'none' })
        if (!r.ok) throw new Error(String(r.status))
        const data = (await r.json()) as Preview
        if (alive) setRes({ url, data, status: 'ok' })
      })
      .catch(() => alive && setRes({ url, data: null, status: 'error' }))
    return () => {
      alive = false
    }
  }, [url])

  const current = res && res.url === url ? res : null
  const state: 'idle' | 'loading' | 'error' | 'none' = !url ? 'none' : !current ? 'loading' : current.status === 'ok' ? 'idle' : current.status
  const data = current?.data ?? null
  const full = revealed && revealed.url === url ? revealed.no : null

  const toggle = async () => {
    if (full) return setRevealed(null)
    const u = previewQuery({ requestId, accountId, draft, reveal: true, vendor, intercompany })
    if (!u || !url) return
    setRevealing(true)
    try {
      const r = await fetch(u, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      const p = r.ok ? ((await r.json()) as Preview) : null
      if (p?.accountNo) setRevealed({ url, no: p.accountNo })
    } finally {
      setRevealing(false)
    }
  }

  const box: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '10px 12px', border: '1px solid var(--theme-elevation-150)', borderRadius: 4, marginBottom: 'var(--spacing-field, 16px)', fontSize: 13 }
  const title = draft ? (intercompany ? 'Rekening penerimaan antar-PT' : vendor ? 'Rekening vendor dipilih' : 'Rekening dipilih') : 'Rekening tujuan (dicatat saat diajukan)'
  if (state === 'none') {
    return draft ? (
      <div className="field-type" data-pk-bank-preview="none" style={{ ...box, color: 'var(--theme-elevation-600)' }}>
        {accountId === null
          ? intercompany
            ? 'Belum ada PT penerima dipilih — pilih PT penerima; rekening penerimaan antar-PT-nya tampil di sini.'
            : vendor
            ? 'Belum ada rekening vendor dipilih — pilih vendor lalu rekeningnya.'
            : 'Belum ada rekening dipilih — kosongkan untuk memakai rekening default pemohon pertama.'
          : intercompany
            ? 'PT penerima belum menetapkan rekening penerimaan antar-PT.'
            : 'Detail rekening tidak dapat ditampilkan.'}
      </div>
    ) : null
  }
  return (
    <div className="field-type" data-pk-bank-preview={data?.source ?? state} aria-live="polite" style={box}>
      <span style={{ fontWeight: 600 }}>{title}:</span>
      {state === 'loading' && !data ? <span>memuat…</span> : null}
      {state === 'error' ? <span style={{ color: 'var(--theme-error-500)' }}>Gagal memuat rekening.</span> : null}
      {data ? (
        <>
          <span>{data.bankName ?? '—'}</span>
          <span aria-hidden>·</span>
          <span>{data.accountHolder ?? '—'}</span>
          <span aria-hidden>·</span>
          <span data-pk-bank-number={full ? 'full' : 'masked'} style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, letterSpacing: full ? 0.5 : 1 }}>
            {full ? groupDigits(full) : (data.accountNoMasked ?? '—')}
          </span>
          {data.canReveal ? (
            <button
              type="button"
              onClick={toggle}
              disabled={revealing}
              aria-pressed={full !== null}
              aria-label={full ? 'Sembunyikan nomor rekening' : 'Tampilkan nomor rekening lengkap'}
              title={full ? 'Sembunyikan nomor rekening' : 'Tampilkan nomor rekening lengkap'}
              data-pk-action="bank-reveal"
              style={{ display: 'inline-grid', placeItems: 'center', width: 36, height: 36, padding: 0, border: '1px solid var(--theme-elevation-150)', borderRadius: 999, background: 'transparent', color: 'inherit', cursor: 'pointer' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={full ? EYE_OFF : EYE} />
              </svg>
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

export default BankAccountPreview
