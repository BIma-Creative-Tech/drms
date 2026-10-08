import React from 'react'

import { formatServerTimestamp } from '@/lib/server-time'

/** QA-25 list cell of a server timestamp: fixed company-TZ text, rendered on the server only. */
export function ServerTimeCell({ cellData }: { cellData?: unknown }) {
  return <span data-pk-server-time-cell>{formatServerTimestamp(cellData)}</span>
}

export default ServerTimeCell
