import type { UIFieldServerProps } from 'payload'
import React from 'react'

import { relId } from '@/access/roles'

/**
 * Read-only "Pengajuan ulang dari" (F2e UAT): the previous request by its NUMBER plus title
 * (e.g. "230/PB-DRMS/…/2026 — Judul"), linked. Replaces Payload's relationship input, which showed
 * only `useAsTitle` (the title) and queried the collection from the browser. The lookup runs with
 * the viewer's own read access (overrideAccess: false): a request the viewer may not read shows
 * only its id.
 */
export async function ResubmitOfField(props: UIFieldServerProps) {
  const { req, data } = props
  const prevId = relId((data as { resubmitOf?: unknown } | undefined)?.resubmitOf)
  if (prevId === undefined || !req.user) return null
  const prev = (await req.payload
    .findByID({ collection: 'expense-requests', id: prevId, depth: 0, user: req.user, overrideAccess: false, req, disableErrors: true })) as { docNo?: string | null; title?: string } | null
  const label = prev ? `${prev.docNo ?? `#${prevId}`} — ${prev.title ?? ''}` : `#${prevId}`
  return (
    <div className="field-type" data-pk-field="resubmitOf" style={{ marginBottom: 16 }}>
      <div className="field-label">Pengajuan ulang dari</div>
      <a href={`/admin/collections/expense-requests/${prevId}`}>{label}</a>
    </div>
  )
}

export default ResubmitOfField
