import React from 'react'

/**
 * Point 13 (DRMS 10/10): LPJ photos as thumbnails that open in the admin lightbox (`a[data-pk-lightbox]`,
 * one group per LPJ: swipe / arrow keys through all photos). Files come from the authorized media endpoint
 * (read access follows the request). No hooks → usable in server and client components.
 */
export function LpjPhotoGrid({ ids, group, label, children, size = 72 }: { ids: number[]; group: string; label: string; children?: (id: number) => React.ReactNode; size?: number }) {
  if (ids.length === 0) return null
  return (
    <ul data-pk-lpj-photos={ids.length} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, listStyle: 'none', padding: 0, margin: '6px 0' }} aria-label={label}>
      {ids.map((id, i) => (
        <li key={id} style={{ display: 'grid', gap: 4, justifyItems: 'center' }}>
          <a href={`/api/v1/media/receipts/${id}/file`} target="_blank" rel="noopener noreferrer" data-pk-lightbox={group} data-pk-lightbox-title={`${label} ${i + 1}/${ids.length}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API file, not a static asset */}
            <img src={`/api/v1/media/receipts/${id}/file?variant=thumb`} alt={`${label} ${i + 1}`} loading="lazy" style={{ width: size, height: size, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--theme-elevation-150)' }} />
          </a>
          {children ? children(id) : null}
        </li>
      ))}
    </ul>
  )
}

export default LpjPhotoGrid
