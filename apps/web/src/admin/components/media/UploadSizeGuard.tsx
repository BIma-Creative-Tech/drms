'use client'
import { useConfig } from '@payloadcms/ui'
import React, { useEffect } from 'react'

import type { MediaSlug } from '@/collections/media/limits'

import { showResult } from '../feedback/feedback'
import { entityOfPath, fieldNameOfId, oversizeFiles, oversizeMessage, slugByAccept, slugOfField } from './upload-guard'

/**
 * D2610 (user 2026-10-26): size check of every file handed to a Payload upload UI — the file input of an upload field /
 * bulk-upload drawer / media edit view, and a drop or paste on a Payload `.dropzone` — BEFORE Payload sees it. A file
 * over its collection's cap (collections/media/limits.ts, same numbers as the server) is stopped in the capture phase
 * on `window` (before React and the Dropzone's own listeners) and the result popup lists it; nothing is uploaded, so
 * the 413 → Server Action with the file → WAF 403 → silent "saved" path of Payload's drawer cannot start (upload-guard.ts).
 * Mounted once through `admin.components.providers`. The app's own forms (kas, transfer, loan proofs: accept without
 * ", ") post to /api/v1 and show the server's message themselves — untouched.
 */
export function UploadSizeGuard({ children }: { children?: React.ReactNode }) {
  const { config, getEntityConfig } = useConfig()

  useEffect(() => {
    /** Collection of the field around `el` (drop on an upload field's own dropzone: no file input there). */
    const slugOfElement = (el: Element): MediaSlug | null => {
      const input = el.matches('input[type="file"]') ? el : el.closest('.dropzone')?.querySelector('input[type="file"]')
      const byAccept = slugByAccept(input?.getAttribute('accept'))
      if (byAccept) return byAccept
      const name = fieldNameOfId(el.closest('.field-type.upload[id^="field-"]')?.id)
      if (!name) return null
      const entity = entityOfPath(window.location.pathname, config.routes?.admin ?? '/admin')
      const current = entity ? (getEntityConfig(entity) as { fields?: unknown } | null) : null
      return slugOfField(name, current, [...(config.collections ?? []), ...(config.globals ?? [])] as Array<{ fields?: unknown }>)
    }

    /** True (and the popup shown) when one of `files` is too big. */
    const refuse = (files: FileList | null | undefined, slug: MediaSlug | null): boolean => {
      if (!files || files.length === 0) return false
      const big = oversizeFiles(files, slug)
      if (big.length === 0) return false
      showResult({ ok: false, title: big.length === 1 ? 'File terlalu besar' : `${big.length} file terlalu besar`, message: oversizeMessage(big), testId: 'upload-too-big' })
      return true
    }

    const onChange = (e: Event) => {
      const t = e.target
      if (!(t instanceof HTMLInputElement) || t.type !== 'file') return
      const slug = slugByAccept(t.getAttribute('accept'))
      if (!slug) return // not a Payload media input
      if (!refuse(t.files, slug)) return
      e.stopImmediatePropagation()
      t.value = ''
    }

    const onDropOrPaste = (e: DragEvent | ClipboardEvent) => {
      const t = e.target
      if (!(t instanceof Element)) return
      const zone = t.closest('.dropzone')
      if (!zone) return
      const files = 'dataTransfer' in e ? e.dataTransfer?.files : e.clipboardData?.files
      if (!refuse(files, slugOfElement(t))) return
      e.preventDefault()
      e.stopImmediatePropagation()
      // the Dropzone keeps its "dragging" look until a dragleave reaches its own listener
      if (e.type === 'drop') zone.dispatchEvent(new Event('dragleave', { cancelable: true }))
    }

    window.addEventListener('change', onChange, true)
    window.addEventListener('drop', onDropOrPaste, true)
    window.addEventListener('paste', onDropOrPaste, true)
    return () => {
      window.removeEventListener('change', onChange, true)
      window.removeEventListener('drop', onDropOrPaste, true)
      window.removeEventListener('paste', onDropOrPaste, true)
    }
  }, [config, getEntityConfig])

  return <>{children}</>
}
