import React from 'react'

import { ImageThumb } from '../media/ImageThumb'
import { mediaThumbSource } from '../media/media-url'

/**
 * Point 13 (DRMS 10/10): LPJ photos as thumbnails that open in the admin lightbox (`a[data-pk-lightbox]`,
 * one group per LPJ: swipe / arrow keys through all photos). Files come from the authorized media endpoint
 * (read access follows the request). No hooks here → usable in server and client components.
 * D2510 (web 0.21.1): each thumbnail is the shared ImageThumb (fallback to the full file, "tidak tersedia" box).
 */
export function LpjPhotoGrid({ ids, group, label, children, size = 72 }: { ids: number[]; group: string; label: string; children?: (id: number) => React.ReactNode; size?: number }) {
  if (ids.length === 0) return null
  return (
    <ul className="pk-thumb-list" data-pk-lpj-photos={ids.length} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, listStyle: 'none', padding: 0, margin: '6px 0' }} aria-label={label}>
      {ids.map((id, i) => (
        <li key={id} style={{ display: 'grid', gap: 4, justifyItems: 'center' }}>
          <ImageThumb src={mediaThumbSource('receipts', id)} group={group} title={`${label} ${i + 1}/${ids.length}`} alt={`${label} ${i + 1}`} size={size} data-pk-lpj-photo={id} />
          {children ? children(id) : null}
        </li>
      ))}
    </ul>
  )
}

export default LpjPhotoGrid
