import type { CollectionConfig, GlobalConfig } from 'payload'

/**
 * DRMS 10/10 #5 (owner: "ada tombol Edit dan Simpan terpisah"): Payload's document header shows view
 * tabs "Edit" + "API" (raw JSON of the record, a developer tool) above the form — users read "Edit" as
 * a separate step before "Simpan". `admin.hideAPIURL` removes the API tab and route
 * (@payloadcms/next 3.90.1 DocumentHeader/Tabs/tabs + views/Document/getDocumentView); a lone "Edit"
 * tab is hidden by CSS (custom.scss `.doc-tabs`), so the form has ONE primary action: "Simpan". Real
 * extra tabs (e.g. "Riwayat") keep the tab row. Plain data; no React import (configs load in the worker).
 */
export function withoutApiTab(collections: CollectionConfig[]): CollectionConfig[] {
  return collections.map((c) => ({ ...c, admin: { ...(c.admin ?? {}), hideAPIURL: true } }))
}

export function withoutGlobalApiTab(globals: GlobalConfig[]): GlobalConfig[] {
  return globals.map((g) => ({ ...g, admin: { ...(g.admin ?? {}), hideAPIURL: true } }))
}
