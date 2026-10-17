'use client'
import { useDocumentInfo, useForm, useFormFields } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import React, { useEffect, useRef, useState } from 'react'

import { requestEditGate } from '@/collections/expense-request-form'
import { REJECT_PROMPT } from '@/domain/expense/decision-texts'

import { ActionButton, postJson, problemText } from '../ActionButton'
import { ActionDialog } from '../ActionDialog'
import type { RequestActionsProps } from './action-bar'
import { setRequestMode, useRequestMode } from './mode'

// .pk-pbtn: the shared button box (custom.scss, DRMS 15/10 #5) — every control of this bar is 38 px, 13 px/600
const BTN = 'btn btn--style-secondary btn--size-small pk-pbtn'
const idemKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined)

/**
 * DRMS 13/10 Persetujuan #5/#7/#12: the action bar of the expense-request page, one row in Payload's document
 * controls before "Simpan": [Tolak] [Setujui] (decision for the current actor, from the server's `allowedActions`) ·
 * Finance flow links · [Cetak] · [Duplikat] · [Riwayat] · [Edit] / [Batal]. "Simpan" is Payload's own submit
 * (RequestSaveButton, shown in edit mode only), so validation, the audit reason and the save flow stay Payload's.
 * Edit → the page's Payload form fields appear with the loaded data (`data-pk-mode="edit"` on <main>); Batal resets
 * the form to the saved document and returns to read mode; a successful save (new `updatedAt`) returns to read mode
 * and refreshes the server-rendered panels.
 */
export function RequestActionsClient({ id, decision, flowLinks, pdfs, canDuplicate, historyHref }: RequestActionsProps) {
  const router = useRouter()
  const ref = useRef<HTMLDivElement>(null)
  const { data, hasSavePermission } = useDocumentInfo()
  const { reset } = useForm()
  const status = useFormFields(([f]) => (typeof f.status?.value === 'string' ? f.status.value : null))
  const mode = useRequestMode(id)
  const gate = requestEditGate({ id, status, hasSavePermission })
  const savedAt = useRef<string | null>(null)
  const [busy, setBusy] = useState(false)

  // the page layout follows the mode (custom.scss: no attribute = read mode)
  useEffect(() => {
    const main = ref.current?.closest('main.collection-edit')
    if (!main) return
    if (mode === 'edit') main.setAttribute('data-pk-mode', 'edit')
    else main.removeAttribute('data-pk-mode')
    return () => main.removeAttribute('data-pk-mode')
  }, [mode])

  // a request that may no longer be edited (submitted meanwhile) leaves edit mode
  useEffect(() => {
    if (mode === 'edit' && gate !== 'editable') setRequestMode(id, 'read')
  }, [gate, id, mode])

  // Simpan succeeded (Payload's onSave stores the saved document → new updatedAt): back to read mode, fresh panels
  const updatedAt = typeof data?.updatedAt === 'string' ? data.updatedAt : null
  useEffect(() => {
    if (mode !== 'edit') return
    if (savedAt.current !== null && updatedAt !== null && updatedAt !== savedAt.current) {
      savedAt.current = null
      setRequestMode(id, 'read')
      router.refresh()
    }
  }, [id, mode, router, updatedAt])

  const startEdit = () => {
    savedAt.current = updatedAt ?? ''
    setRequestMode(id, 'edit')
  }
  const cancelEdit = async () => {
    setBusy(true)
    try {
      await reset(data)
    } finally {
      setBusy(false)
      savedAt.current = null
      setRequestMode(id, 'read')
    }
  }

  return (
    <div ref={ref} className="pk-er-actions" role="group" aria-label="Aksi pengajuan" data-pk-action-bar>
      {decision ? (
        <>
          <span className="pk-er-actions__turn" data-pk-decision-bar>
            Menunggu keputusan Anda: <strong>{decision.stepLabel}</strong>
            {decision.signAs ? <span data-pk-sign-as> · ditandatangani sebagai Direktur PT: {decision.signAs}</span> : null}
          </span>
          {decision.canReject ? <ActionButton url={`/api/v1/expense-requests/${id}/reject`} label="Tolak" prompt={REJECT_PROMPT} testId="reject" /> : null}
          {decision.step && decision.blocked ? (
            // ADR 0029 §2: short funds — "Setujui" disabled with the reason; "Tolak" stays
            <>
              <button type="button" className="btn btn--style-primary btn--size-small btn--disabled pk-pbtn" disabled aria-describedby={`pk-fund-blocked-${id}`} data-pk-action={`${decision.step}-blocked`}>
                {decision.label}
              </button>
              <span id={`pk-fund-blocked-${id}`} className="pk-er-actions__turn" role="note" data-pk-fund-blocked-reason>
                {decision.blocked}
              </span>
            </>
          ) : decision.step ? (
            <ActionButton url={`/api/v1/expense-requests/${id}/${decision.step}`} label={decision.label} variant="primary" confirm={decision.confirm} testId={decision.step} />
          ) : null}
        </>
      ) : null}
      {flowLinks.map((l) => (
        <a key={l.testId} className={BTN} href={l.href} data-pk-link={l.testId}>
          {l.label}
        </a>
      ))}
      {pdfs.length === 1 ? (
        <a className={BTN} href={pdfs[0]!.href} data-pk-action="print">
          Cetak
        </a>
      ) : pdfs.length > 1 ? (
        <PrintMenu pdfs={pdfs} />
      ) : null}
      {canDuplicate && mode === 'read' ? <DuplicateButton id={id} /> : null}
      {/* UI feedback 17/10 #2: the history page as a button (the page has no tab row any more), read mode, every status */}
      {mode === 'read' ? (
        <a className={BTN} href={historyHref} data-pk-link="history">
          Riwayat
        </a>
      ) : null}
      {gate === 'editable' && mode === 'read' ? (
        <button type="button" className={BTN} onClick={startEdit} data-pk-action="edit">
          Edit
        </button>
      ) : null}
      {gate === 'editable' && mode === 'edit' ? (
        <button type="button" className={BTN} onClick={() => void cancelEdit()} disabled={busy} data-pk-action="edit-cancel">
          Batal
        </button>
      ) : null}
    </div>
  )
}

/** "Cetak" + chevron with the PDF variants (closes on an outside click / Escape). */
function PrintMenu({ pdfs }: { pdfs: Array<{ href: string; label: string }> }) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current
      if (!el?.open) return
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !el.contains(e.target as Node)) el.open = false
    }
    document.addEventListener('click', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', close)
    }
  }, [])
  return (
    <details ref={ref} className="pk-er-print" data-pk-action="print-menu">
      <summary className={BTN}>
        <span>Cetak</span>
        <span className="pk-caret" aria-hidden="true" />
      </summary>
      <ul className="pk-er-print__menu" role="list">
        {pdfs.map((p) => (
          <li key={p.href}>
            <a href={p.href} data-pk-action="print">
              {p.label}
            </a>
          </li>
        ))}
      </ul>
    </details>
  )
}

/** "Duplikat" (Persetujuan #12): confirm → POST …/duplicate → open the new Draft. */
function DuplicateButton({ id }: { id: number }) {
  const router = useRouter()
  const key = useRef<string | undefined>(undefined)
  return (
    <ActionDialog
      label="Duplikat"
      title="Duplikat pengajuan"
      description="Buat Draft baru dengan PT, project, pemohon dan baris item yang sama. Nomor, persetujuan, transfer, nota, flag dan lampiran tidak ikut disalin."
      confirmLabel="Buat draft salinan"
      rotateKey={() => {
        key.current = idemKey()
      }}
      onConfirm={async () => {
        const r = await postJson(`/api/v1/expense-requests/${id}/duplicate`, {}, { idempotencyKey: key.current })
        if (!r.ok) return problemText(r.data, r.status)
        const newId = (r.data as { id?: unknown } | null)?.id
        if (typeof newId === 'number') router.push(`/admin/collections/expense-requests/${newId}`)
        return null
      }}
      buttonClassName={BTN}
      testId="duplicate"
    />
  )
}

export default RequestActionsClient
