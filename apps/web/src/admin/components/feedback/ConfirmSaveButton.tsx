'use client'
import { FormSubmit, useConfig, useDocumentInfo, useDocumentTitle, useEditDepth, useForm, useFormModified, useHotkey, useOperation, useTranslation } from '@payloadcms/ui'
import type { SaveButtonClientProps } from 'payload'
import React, { useRef } from 'react'

import { confirmAction, confirmLabel, confirmTitle, failureTitle, lowerFirst, showResult, successTitle } from './feedback'

/**
 * DRMS 24/10: Payload's document "Simpan" with the confirmation popup before and the result popup after (feedback.ts)
 * — wired on every collection / global by `withConfirmSave` (admin/confirm-save.ts), so master forms, the relationship
 * "+" document drawer (same edit components) and the expense-request "Simpan" (RequestSaveButton) behave alike.
 * Same button as @payloadcms/ui 3.90.1 SaveButton (id `action-save`, disabled while unmodified / uploading, Ctrl/⌘+S
 * clicks it) — only the click asks first. Payload's own submit is kept (validation, audit reason, onSave, redirect after
 * create, leave-without-saving guard); `submit()` returns `{ res }` after a request that did not end in a field/message
 * error, nothing after a client-side validation error or a server error Payload already showed (toast + red fields).
 */
type Labels = { singular?: unknown } | undefined

function labelText(labels: Labels, lang: string): string {
  const l = labels?.singular
  if (typeof l === 'string') return l
  if (l && typeof l === 'object') {
    const rec = l as Record<string, unknown>
    const v = rec[lang] ?? rec.id ?? Object.values(rec)[0]
    if (typeof v === 'string') return v
  }
  return 'data'
}

export function ConfirmSaveButton({ label: labelProp }: SaveButtonClientProps) {
  const { uploadStatus, collectionSlug, globalSlug } = useDocumentInfo()
  const { title } = useDocumentTitle()
  const { t, i18n } = useTranslation()
  const { getEntityConfig } = useConfig()
  const { submit } = useForm()
  const modified = useFormModified()
  const editDepth = useEditDepth()
  const operation = useOperation()
  const ref = useRef<HTMLButtonElement>(null)
  const busy = useRef(false)
  const label = labelProp || t('general:save')
  const disabled = (operation === 'update' && !modified) || uploadStatus === 'uploading'

  useHotkey({ cmdCtrlKey: true, editDepth, keyCodes: ['s'] }, (e) => {
    e.preventDefault()
    e.stopPropagation()
    ref.current?.click()
  })

  const entity = getEntityConfig({ collectionSlug, globalSlug }) as { label?: unknown; labels?: Labels } | null
  const noun = lowerFirst(globalSlug ? labelText({ singular: entity?.label }, i18n.language) : labelText(entity?.labels, i18n.language))
  const isCreate = operation === 'create'
  const object = isCreate ? `${noun} baru` : globalSlug ? noun : `${noun}${title ? ` "${title}"` : ''}`

  const onClick = async () => {
    if (uploadStatus === 'uploading' || busy.current) return
    const yes = await confirmAction({
      title: confirmTitle('simpan', object),
      summary: [
        ['Data', noun],
        ['Dokumen', isCreate ? 'Baru' : title || null],
      ],
      description: isCreate ? 'Data baru dibuat setelah disimpan.' : 'Perubahan disimpan dan tercatat di riwayat.',
      confirmLabel: confirmLabel('simpan'),
      testId: 'save',
    })
    if (!yes) return
    busy.current = true
    try {
      const r = (await submit()) as { res?: Response } | void
      const status = r && r.res ? r.res.status : null
      if (status !== null && status < 400) showResult({ ok: true, title: successTitle('simpan', object), testId: 'save' })
      else showResult({ ok: false, title: failureTitle('simpan'), message: 'Data belum tersimpan. Periksa kolom yang ditandai merah dan pesan kesalahan di formulir, lalu simpan lagi.', testId: 'save' })
    } finally {
      busy.current = false
    }
  }

  return (
    <FormSubmit buttonId="action-save" disabled={disabled} onClick={() => void onClick()} ref={ref} size="medium" type="button">
      {label}
    </FormSubmit>
  )
}

export default ConfirmSaveButton
