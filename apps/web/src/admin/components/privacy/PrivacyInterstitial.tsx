'use client'
import { useRouter } from 'next/navigation'
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import { postJson, problemText } from '@/admin/components/ActionButton'
import { PRIVACY_ACK_API, PRIVACY_PATH } from '@/legal/paths'

const noopSubscribe = () => () => {}

/**
 * Non-dismissable interstitial of the admin shell (Q-46 / ASVS 8.3.3, ADR 0018): shown over every admin page while
 * the logged-in user has not acknowledged the CURRENT privacy notice. No close button, no Escape, the page behind
 * is inert; the only way on is "Saya mengerti" → POST /api/v1/me/privacy-ack (the server stores it + audits it),
 * then the server-rendered shell is refreshed (the gate renders nothing once acknowledged). The notice body is
 * server-rendered and passed in as children.
 */
export function PrivacyInterstitial({ version, title, children }: { version: number; title: string; children: React.ReactNode }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  // client only: the portal target (document.body) does not exist during the server render
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  )

  // Portal into <body> (a `position: fixed` overlay inside the glass nav would be clipped by its backdrop-filter
  // containing block) and make everything else on the page inert (keyboard, pointer, screen readers).
  useEffect(() => {
    const root = overlay.current
    if (done || !mounted || !root) return // acknowledged: the cleanup below already restored the page
    const inerted: Element[] = []
    for (const c of Array.from(document.body.children)) {
      if (c === root || c.hasAttribute('inert') || ['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE', 'NOSCRIPT'].includes(c.tagName)) continue
      c.setAttribute('inert', '')
      inerted.push(c)
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.focus()
    return () => {
      for (const c of inerted) c.removeAttribute('inert')
      document.body.style.overflow = prev
    }
  }, [done, mounted])

  if (done || !mounted) return null

  const acknowledge = async () => {
    setBusy(true)
    setError(null)
    try {
      const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined
      const r = await postJson(PRIVACY_ACK_API, { version }, { idempotencyKey: key })
      if (r.ok) {
        setDone(true)
        router.refresh()
        return
      }
      setError(problemText(r.data, r.status))
      // 409: the server serves a newer notice than this page shows → reload to read it
      if (r.status === 409) router.refresh()
    } catch {
      setError('Tidak dapat terhubung ke server. Periksa koneksi lalu coba lagi.')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div ref={overlay} className="pk-privacy-gate" data-pk-privacy-gate={version}>
      <div
        ref={dialog}
        className="pk-privacy-gate__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pk-privacy-gate-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') e.preventDefault()
        }}
      >
        <h1 id="pk-privacy-gate-title" className="pk-privacy-gate__title">
          {title}
        </h1>
        <div className="pk-privacy-gate__body">{children}</div>
        {error ? (
          <p className="pk-privacy-gate__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="pk-privacy-gate__actions">
          <a href={PRIVACY_PATH} target="_blank" rel="noopener noreferrer">
            Buka di halaman terpisah
          </a>
          <button type="button" className="btn btn--style-primary btn--size-medium" onClick={acknowledge} disabled={busy} data-pk-privacy-ack>
            {busy ? 'Menyimpan…' : 'Saya mengerti'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default PrivacyInterstitial
