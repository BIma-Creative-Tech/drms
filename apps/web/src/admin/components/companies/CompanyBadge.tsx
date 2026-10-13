import React from 'react'

/**
 * DRMS 13/10 Persetujuan #8: the document's PT as one small badge — short-code chip + name (custom.scss
 * .pk-pt-badge), no "PT:" label. Used for an existing document (CompanyField) and a prefilled create form
 * (CompanyPrefill). Plain markup: renders in server and client components.
 */
export function CompanyBadge({ shortCode, name, note }: { shortCode: string; name: string | null; note?: string }) {
  return (
    <div className="field-type" data-pk-field="company" data-pk-company-inline={shortCode} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 'var(--spacing-field, 16px)' }}>
      <span className="pk-pt-badge" title={name ?? undefined}>
        <span className="pk-pt-chip">{shortCode}</span>
        {name ? <span className="pk-pt-badge__name">{name}</span> : null}
      </span>
      {note ? <span style={{ fontSize: 12, color: 'var(--theme-elevation-600)' }}>{note}</span> : null}
    </div>
  )
}

export default CompanyBadge
