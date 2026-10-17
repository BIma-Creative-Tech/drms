import React from 'react'

/**
 * DRMS 13/10 Persetujuan #8: the document's PT as one small badge — short-code chip + name (custom.scss
 * .pk-pt-badge). Used for an existing document (CompanyField) and a prefilled create form (CompanyPrefill).
 * UI feedback 17/10 #5 ("edit = add"): rendered as a read-only FIELD in the PT picker's slot and size — the same
 * "PT" label and a control-sized box (custom.scss .pk-company-field), so the form does not shift between create and
 * edit. Plain markup: renders in server and client components.
 */
export function CompanyBadge({ shortCode, name, note }: { shortCode: string; name: string | null; note?: string }) {
  return (
    <div className="field-type pk-company-field" data-pk-field="company" data-pk-company-inline={shortCode}>
      <span className="field-label">PT</span>
      <div className="pk-company-field__box" aria-disabled="true">
        <span className="pk-pt-badge" title={name ?? undefined}>
          <span className="pk-pt-chip">{shortCode}</span>
          {name ? <span className="pk-pt-badge__name">{name}</span> : null}
        </span>
      </div>
      {note ? <p className="field-description">{note}</p> : null}
    </div>
  )
}

export default CompanyBadge
