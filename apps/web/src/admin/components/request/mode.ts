'use client'
import { useSyncExternalStore } from 'react'

/**
 * DRMS 13/10 Persetujuan #7: read / edit mode of the expense-request page, shared by the action bar ("Edit" /
 * "Batal", in Payload's document controls) and the "Simpan" button (RequestSaveButton) — two React subtrees, so a
 * tiny external store keyed by the document id (a mode never leaks to the next opened request). The page itself
 * reads the mode from `data-pk-mode` on Payload's <main class="collection-edit"> (custom.scss): without that
 * attribute an existing request is in read mode, so the server HTML is already right before hydration.
 */
export type RequestMode = 'read' | 'edit'

let state: { id: string | null; mode: RequestMode } = { id: null, mode: 'read' }
const listeners = new Set<() => void>()

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function setRequestMode(id: number | string, mode: RequestMode): void {
  state = { id: String(id), mode }
  for (const l of listeners) l()
}

/** Mode of document `id`; a new document (no id) is always in edit mode. */
export function useRequestMode(id: number | string | null | undefined): RequestMode {
  const s = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  )
  if (id === undefined || id === null || id === '') return 'edit'
  return s.id === String(id) ? s.mode : 'read'
}
