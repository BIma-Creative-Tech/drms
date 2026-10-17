import React from 'react'

import { RapImport } from '../field/RapImport'
import { RapTemplateActions } from '../field/RapTemplateActions'

/**
 * UI feedback 17/10 #3 (RAP = form first, Excel optional): the Excel / template tools of a project's RAP — "Template
 * Excel kosong", "Unduh RAP (.xlsx)", RAP templates of the PT (RapTemplateActions) and the Excel import with preview
 * (RapImport) — folded in one <details>, closed by default, below the item form (RapItemsEditor "+ Tambah item").
 * Shared by the project's RAP tab (ProjectTabs ProjectRapTab) and the RAP page /admin/rap/:id (Rap.tsx RapProject), so
 * both pages show the same order. Only rendered for the RAP editors (loadRap `canEdit`); the server re-checks writes.
 */
export const RAP_EXCEL_SUMMARY = 'Impor / template Excel (opsional)'

const STYLE = `
.pk-rap-excel { margin: 16px 0 0; border-top: 1px solid var(--pk-border); padding-top: 12px; }
.pk-rap-excel > summary { cursor: pointer; width: fit-content; min-height: 32px; display: flex; align-items: center; font-size: 13px; font-weight: 600; color: var(--pk-fg); }
.pk-rap-excel > summary:focus-visible { outline: 2px solid var(--pk-ring); outline-offset: 2px; border-radius: var(--style-radius-s); }
.pk-rap-excel[open] > summary { margin-bottom: 8px; }
.pk-rap-excel .pk-rap-excel__hint { margin: 0 0 12px; font-size: 12px; color: var(--pk-muted-fg); line-height: 1.45; }
@media (pointer: coarse) { .pk-rap-excel > summary { min-height: 44px; } }
`

type Templates = React.ComponentProps<typeof RapTemplateActions>['templates']

export function RapExcelTools({ projectId, hasItems, templates, needsReason, stageRequired }: { projectId: number; hasItems: boolean; templates: Templates; needsReason: boolean; stageRequired: boolean }) {
  return (
    <details className="pk-rap-excel" data-pk-rap-excel>
      <style>{STYLE}</style>
      <summary data-pk-action="rap-excel-toggle">{RAP_EXCEL_SUMMARY}</summary>
      <p className="pk-rap-excel__hint">Untuk banyak item sekaligus: isi Template Excel, unggah, periksa pratinjau, lalu simpan. Atau pakai template RAP PT ini.</p>
      <div className="pk-kact" style={{ marginBottom: 12 }}>
        <a className="pk-kbtn" href="/api/v1/rap/template.xlsx" data-pk-link="rap-template">
          Template Excel kosong
        </a>
        {hasItems ? (
          <a className="pk-kbtn" href={`/api/v1/projects/${projectId}/rap.xlsx`} data-pk-link="rap-download">
            Unduh RAP (.xlsx)
          </a>
        ) : null}
      </div>
      <RapTemplateActions projectId={projectId} templates={templates} empty={!hasItems} />
      <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>Impor RAP dari Excel</h3>
      <RapImport projectId={projectId} needsReason={needsReason} stageRequired={stageRequired} />
    </details>
  )
}

export default RapExcelTools
