'use client'
import React, { useState } from 'react'

import { Icon } from '@/admin/modules/Icon'

import type { ThumbSource } from './media-url'

/**
 * D2510 image preview (web 0.21.1, user 2026-10-25): THE thumbnail of every image link of the web admin — attendance
 * selfies, receipts / LPJ photos, transfer and cash proofs, request attachments, field-report and progress photos,
 * upload fields and list cells. A fixed-size, lazy, `object-fit: cover` preview inside a real link
 * `a[data-pk-lightbox]`: the shared LightboxProvider opens it in the popup (Esc closes and returns the focus here,
 * ← → through the images of the same `group`, caption, zoom, "Buka di tab baru"); without JS — or with Ctrl/⌘/middle
 * click — the link opens the file in a new tab as before. The URLs come from media-url.ts: the same authorized
 * endpoints the former links used (session cookie, read access + audit unchanged; no public file, no CSP change —
 * img-src 'self' already covers /api/v1).
 * A failed thumbnail falls back to the full file (collections without a small variant or a tiny image) or, where
 * PDFs are allowed, to a file link; a file that is gone (e.g. selfie retention) shows a muted "tidak tersedia" box.
 * Styles: THUMB_STYLE (rendered once by the LightboxProvider).
 */
type DataAttrs = { [k: `data-${string}`]: string | number | boolean | undefined }

export type ImageThumbProps = {
  src: ThumbSource | null
  /** Lightbox group: ← → move between the images of the same group (one record). */
  group: string
  /** Lightbox title and the link's accessible name ("Nota 12 · baris 2"). */
  title: string
  /** Second lightbox line: date / time / location / amount. */
  caption?: string | null
  alt?: string
  /** Edge length in px (default 64) or 'fill' = the size of the surrounding box (galleries). */
  size?: number | 'fill'
  /** Known non-image (PDF): a file link, never the lightbox. */
  file?: boolean
  /** Visible text of the file link (default "Buka berkas"). */
  fileLabel?: string
  /** Accessible name of the image link (default "Perbesar <title>"). */
  label?: string
  className?: string
  /** data-* hooks of the <img>. */
  imgAttrs?: DataAttrs
} & DataAttrs

type Stage = 'thumb' | 'full' | 'file' | 'missing'

const pick = (rest: Record<string, unknown>): DataAttrs => Object.fromEntries(Object.entries(rest).filter(([k]) => k.startsWith('data-'))) as DataAttrs

export function ImageThumb({ src, group, title, caption, alt, size = 64, file = false, fileLabel, label, className, imgAttrs, ...rest }: ImageThumbProps) {
  const key = src ? `${src.thumb}|${src.href}` : ''
  // the stage belongs to ONE source: a new src (re-render with another file) starts again at its thumbnail
  const [state, setState] = useState<{ key: string; stage: Stage }>({ key, stage: 'thumb' })
  const stage: Stage = state.key === key ? state.stage : 'thumb'
  const data = pick(rest)

  const fail = () =>
    setState((s) => {
      const cur: Stage = s.key === key ? s.stage : 'thumb'
      if (!src) return s
      if (cur === 'thumb' && src.thumb !== src.href) return { key, stage: src.fallback === 'full' ? 'full' : 'file' }
      return { key, stage: cur === 'thumb' || cur === 'full' ? 'missing' : cur }
    })
  // an error that fired before hydration had no React listener yet: a finished image without pixels is broken
  const probe = (el: HTMLImageElement | null) => {
    if (el && el.complete && el.naturalWidth === 0 && el.getAttribute('src')) queueMicrotask(fail)
  }

  if (!src) return null
  const tip = caption ? `${title} · ${caption}` : title
  const box = typeof size === 'number' ? ({ '--pk-thumb': `${size}px` } as React.CSSProperties) : undefined
  const cls = (extra: string) => ['pk-thumb', extra, size === 'fill' ? 'fill' : '', className ?? ''].filter(Boolean).join(' ')

  if (file || stage === 'file') {
    return (
      <a className={cls('file')} href={src.href} target="_blank" rel="noopener noreferrer" title={`${tip} (buka di tab baru)`} {...data} data-pk-thumb="file">
        <Icon name="document" size={16} />
        <span>{fileLabel ?? 'Buka berkas'}</span>
      </a>
    )
  }
  if (stage === 'missing') {
    return (
      <span className={cls('missing')} style={box} role="img" aria-label={`${title}: gambar tidak tersedia`} title="Gambar tidak tersedia (mungkin sudah dihapus)" {...data} data-pk-thumb="missing">
        <Icon name="tCamera" size={18} />
      </span>
    )
  }
  const px = typeof size === 'number' ? size : undefined
  return (
    <a
      className={cls('')}
      style={box}
      href={src.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label ?? `Perbesar ${title}`}
      aria-haspopup="dialog"
      title={tip}
      data-pk-lightbox={group}
      data-pk-lightbox-title={title}
      data-pk-lightbox-caption={caption || undefined}
      {...data}
      data-pk-thumb="image"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- authorized, private, no-store /api/v1 file (next/image would cache it) */}
      <img ref={probe} src={stage === 'full' ? src.href : src.thumb} alt={alt ?? title} loading="lazy" decoding="async" width={px} height={px} referrerPolicy="no-referrer" onError={fail} {...imgAttrs} />
    </a>
  )
}

export type ThumbItem = Omit<ImageThumbProps, 'group' | 'size'> & { key: string | number; tag?: React.ReactNode }

/** A wrapping row of thumbnails of ONE record (one lightbox group); `tag` = a short line under each one. */
export function ThumbList({ items, group, size = 64, label, ...rest }: { items: ThumbItem[]; group: string; size?: number; label: string } & DataAttrs) {
  if (items.length === 0) return null
  return (
    <ul className="pk-thumb-list" aria-label={label} {...pick(rest)}>
      {items.map(({ key, tag, ...t }) => (
        <li key={key}>
          <ImageThumb {...t} group={group} size={size} />
          {tag ? <small>{tag}</small> : null}
        </li>
      ))}
    </ul>
  )
}

export default ImageThumb
