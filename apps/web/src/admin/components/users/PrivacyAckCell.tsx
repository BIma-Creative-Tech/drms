import React from 'react'

import { privacyAckLabel } from '@/legal/privacy-ack-label'

/**
 * Users list column "Privasi dibaca (versi/tanggal)" (Q-46, ADR 0018): the version of the employee privacy notice the
 * user acknowledged and when ("v1 · 05/10/26 10.12"), "Belum" when never, and a hint when an older version was
 * acknowledged (the user is asked again at the next web/APK start). Values come from the row (read-only fields).
 */
export function PrivacyAckCell({ rowData }: { rowData?: { privacyAckVersion?: unknown; privacyAckAt?: unknown } }) {
  const { text, state } = privacyAckLabel(rowData?.privacyAckVersion, rowData?.privacyAckAt)
  return (
    <span data-pk-privacy-ack={state} title={state === 'outdated' ? 'Versi lama — akan diminta membaca versi terbaru' : undefined}>
      {text}
    </span>
  )
}

export default PrivacyAckCell
