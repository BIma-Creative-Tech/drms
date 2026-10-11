'use client'
import React, { useState } from 'react'

import { groupDigits } from '../bank-preview-query'

const EYE = 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'
const EYE_OFF = 'M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2'

/**
 * DRMS 10/10 B-2 (item 3): the masked destination account number of the read-only request summary with the 8e
 * eye toggle. The full number is fetched on demand from /api/v1/bank-account-preview (same rule as the DTO:
 * creator / requesters, Finance / Direktur / Admin of the PT) — never rendered into the page up front.
 */
export function BankReveal({ requestId, masked, canReveal }: { requestId: number; masked: string; canReveal: boolean }) {
  const [full, setFull] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toggle = async () => {
    if (full) return setFull(null)
    setBusy(true)
    try {
      const r = await fetch(`/api/v1/bank-account-preview?request=${requestId}&reveal=1`, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      const p = r.ok ? ((await r.json()) as { accountNo?: string }) : null
      if (p?.accountNo) setFull(p.accountNo)
    } finally {
      setBusy(false)
    }
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span data-pk-bank-number={full ? 'full' : 'masked'} style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, letterSpacing: full ? 0.5 : 1 }}>
        {full ? groupDigits(full) : masked}
      </span>
      {canReveal ? (
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          aria-pressed={full !== null}
          aria-label={full ? 'Sembunyikan nomor rekening' : 'Tampilkan nomor rekening lengkap'}
          title={full ? 'Sembunyikan nomor rekening' : 'Tampilkan nomor rekening lengkap'}
          data-pk-action="bank-reveal"
          style={{ display: 'inline-grid', placeItems: 'center', width: 32, height: 32, padding: 0, border: '1px solid var(--theme-elevation-150)', borderRadius: 999, background: 'transparent', color: 'inherit', cursor: 'pointer' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={full ? EYE_OFF : EYE} />
          </svg>
        </button>
      ) : null}
    </span>
  )
}

export default BankReveal
