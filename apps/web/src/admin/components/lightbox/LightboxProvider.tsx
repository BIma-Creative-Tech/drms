'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'

import { collect, keyAction, LIGHTBOX_ATTR, step, swipeAction, type LightboxItem, type ZoomMode } from './gallery'

const STYLE = `
.pk-lb { width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; margin: 0; padding: 0; border: 0; background: rgb(2 6 23 / .94); color: #F8FAFC; }
.pk-lb::backdrop { background: rgb(2 6 23 / .7); }
.pk-lb__wrap { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto; height: 100%; }
.pk-lb__bar { display: flex; align-items: center; gap: 8px; padding: 8px max(12px, env(safe-area-inset-left)); min-height: 52px; }
.pk-lb__title { flex: 1 1 auto; min-width: 0; font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pk-lb__count { font-size: 13px; font-variant-numeric: tabular-nums; opacity: .85; white-space: nowrap; }
.pk-lb__btn { flex: none; display: inline-grid; place-items: center; min-width: 44px; height: 44px; padding: 0 10px; border-radius: 999px; border: 1px solid rgb(248 250 252 / .35); background: rgb(15 23 42 / .6); color: #F8FAFC; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; }
.pk-lb__btn:hover { background: rgb(51 65 85 / .9); }
.pk-lb__btn:focus-visible { outline: 2px solid #93C5FD; outline-offset: 2px; }
.pk-lb__stage { position: relative; overflow: auto; display: grid; place-items: center; touch-action: pan-x pan-y pinch-zoom; }
.pk-lb__stage[data-zoom='fit'] img { max-width: 100%; max-height: 100%; object-fit: contain; cursor: zoom-in; }
.pk-lb__stage[data-zoom='actual'] { place-items: start; }
.pk-lb__stage[data-zoom='actual'] img { max-width: none; max-height: none; cursor: zoom-out; }
.pk-lb__nav { position: absolute; top: 50%; transform: translateY(-50%); }
.pk-lb__nav.prev { left: 8px; } .pk-lb__nav.next { right: 8px; }
.pk-lb__foot { display: flex; justify-content: center; gap: 8px; padding: 8px 12px calc(8px + env(safe-area-inset-bottom)); font-size: 12px; opacity: .85; }
.pk-lb__err { padding: 24px; text-align: center; font-size: 14px; }
@media (max-width: 520px) { .pk-lb__bar { gap: 6px; padding: 6px 8px; } .pk-lb__btn { padding: 0 8px; } .pk-lb__nav { top: auto; bottom: 8px; transform: none; } .pk-lb__hint { display: none; } }
`

/**
 * DRMS 10/10 12c (WA-11): ONE image lightbox for the whole admin (receipts, progress / field-report
 * photos, transfer and cash proofs, selfies). Mounted once through `admin.components.providers`;
 * a delegated click on `a[data-pk-lightbox]` opens the image in a modal <dialog> (focus trapped, Esc
 * closes and returns focus to the thumbnail) with fit ↔ 100 % zoom, previous / next within the same
 * group (arrow keys, buttons, swipe), a counter and "Buka di tab baru". Ctrl/⌘/middle click keeps the
 * browser's new tab. Images that fail to load (e.g. a PDF proof) offer the new-tab link instead.
 * The image URLs are the existing authorized /api/v1 endpoints — nothing new is exposed.
 */
export function LightboxProvider({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const [items, setItems] = useState<LightboxItem[]>([])
  const [index, setIndex] = useState(0)
  const [zoom, setZoom] = useState<ZoomMode>('fit')
  const [failed, setFailed] = useState(false)

  const go = useCallback(
    (to: number) => {
      setIndex(to)
      setZoom('fit')
      setFailed(false)
    },
    [setIndex],
  )

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.(`a[${LIGHTBOX_ATTR}]`)
      if (!(a instanceof HTMLAnchorElement)) return
      const group = a.getAttribute(LIGHTBOX_ATTR) ?? ''
      // only the rendered copies: the desktop table and the ≤ 640 px cards carry the same thumbnails (one is display:none)
      const members = [...document.querySelectorAll<HTMLAnchorElement>(`a[${LIGHTBOX_ATTR}]`)].filter((x) => x.getAttribute(LIGHTBOX_ATTR) === group && (x === a || x.getClientRects().length > 0))
      const titleOf = (x: HTMLAnchorElement) => x.dataset.pkLightboxTitle || x.querySelector('img')?.alt || x.getAttribute('aria-label') || x.textContent?.trim() || 'Gambar'
      const g = collect(members.map((x) => ({ href: x.href, title: titleOf(x) })), a.href, members.indexOf(a))
      e.preventDefault()
      opener.current = a
      setItems(g.items)
      go(g.index)
      ref.current?.showModal()
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [go])

  const cur = items[index]
  const many = items.length > 1
  const act = (a: ReturnType<typeof keyAction> | ReturnType<typeof swipeAction>) => {
    if (!a || items.length === 0) return
    if (a === 'next' && many) go(step(index, items.length, 1))
    else if (a === 'prev' && many) go(step(index, items.length, -1))
    else if (a === 'first') go(0)
    else if (a === 'last') go(items.length - 1)
    else if (a === 'zoom') setZoom((z) => (z === 'fit' ? 'actual' : 'fit'))
  }

  return (
    <>
      {children}
      <style>{STYLE}</style>
      <dialog
        ref={ref}
        className="pk-lb"
        aria-label={cur ? `Pratinjau gambar: ${cur.title}` : 'Pratinjau gambar'}
        data-pk-lightbox-dialog
        onClose={() => {
          setItems([])
          opener.current?.focus()
        }}
        onKeyDown={(e) => {
          const a = keyAction(e.key)
          if (a) {
            e.preventDefault()
            act(a)
          }
        }}
      >
        {cur ? (
          <div className="pk-lb__wrap">
            <div className="pk-lb__bar">
              <span className="pk-lb__title" title={cur.title}>
                {cur.title}
              </span>
              {many ? (
                <span className="pk-lb__count" aria-live="polite" data-pk-lightbox-count>
                  {index + 1} / {items.length}
                </span>
              ) : null}
              <button type="button" className="pk-lb__btn" onClick={() => act('zoom')} aria-pressed={zoom === 'actual'} data-pk-lightbox-zoom>
                {zoom === 'fit' ? 'Perbesar' : 'Pas layar'}
              </button>
              <a className="pk-lb__btn" href={cur.src} target="_blank" rel="noopener noreferrer" aria-label="Buka di tab baru" title="Buka di tab baru">
                ↗
              </a>
              <button type="button" className="pk-lb__btn" onClick={() => ref.current?.close()} aria-label="Tutup" title="Tutup (Esc)" data-pk-lightbox-close autoFocus>
                ✕
              </button>
            </div>
            <div
              className="pk-lb__stage"
              data-zoom={zoom}
              onTouchStart={(e) => {
                const t = e.touches[0]
                touch.current = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null
              }}
              onTouchEnd={(e) => {
                const s = touch.current
                const t = e.changedTouches[0]
                touch.current = null
                if (s && t && zoom === 'fit') act(swipeAction(t.clientX - s.x, t.clientY - s.y))
              }}
            >
              {failed ? (
                <div className="pk-lb__err" role="alert">
                  Berkas ini tidak dapat ditampilkan sebagai gambar.{' '}
                  <a href={cur.src} target="_blank" rel="noopener noreferrer" style={{ color: '#93C5FD' }}>
                    Buka di tab baru
                  </a>
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- authorized /api/v1 file, not a static asset
                <img key={cur.src} src={cur.src} alt={cur.title} onClick={() => act('zoom')} onError={() => setFailed(true)} data-pk-lightbox-img />
              )}
              {many ? (
                <>
                  <button type="button" className="pk-lb__btn pk-lb__nav prev" onClick={() => act('prev')} aria-label="Gambar sebelumnya" data-pk-lightbox-prev>
                    ‹
                  </button>
                  <button type="button" className="pk-lb__btn pk-lb__nav next" onClick={() => act('next')} aria-label="Gambar berikutnya" data-pk-lightbox-next>
                    ›
                  </button>
                </>
              ) : null}
            </div>
            <div className="pk-lb__foot pk-lb__hint">Esc tutup · ← → pindah · klik gambar / Z perbesar</div>
          </div>
        ) : null}
      </dialog>
    </>
  )
}

export default LightboxProvider
