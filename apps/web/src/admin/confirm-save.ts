import type { CollectionConfig, GlobalConfig } from 'payload'

/**
 * DRMS 24/10 (user decision: popup before and after every data-changing action): the document "Simpan" of EVERY
 * collection and global asks "Yakin ingin simpan …?" first and shows the result popup after the save
 * (admin/components/feedback/ConfirmSaveButton.tsx). Applied once in payload.config.ts, so a new collection gets it
 * automatically; a collection with its own SaveButton (expense requests: RequestSaveButton, which renders the
 * confirming button itself) keeps it. Plain data (import-map path); no React import — configs also load in the worker.
 */
export const CONFIRM_SAVE_BUTTON = '@/admin/components/feedback/ConfirmSaveButton#ConfirmSaveButton'

export function withConfirmSave(collections: CollectionConfig[]): CollectionConfig[] {
  return collections.map((c) => {
    const components = c.admin?.components ?? {}
    if (components.edit?.SaveButton) return c
    return { ...c, admin: { ...(c.admin ?? {}), components: { ...components, edit: { ...(components.edit ?? {}), SaveButton: CONFIRM_SAVE_BUTTON } } } }
  })
}

export function withGlobalConfirmSave(globals: GlobalConfig[]): GlobalConfig[] {
  return globals.map((g) => {
    const components = g.admin?.components ?? {}
    if (components.elements?.SaveButton) return g
    return { ...g, admin: { ...(g.admin ?? {}), components: { ...components, elements: { ...(components.elements ?? {}), SaveButton: CONFIRM_SAVE_BUTTON } } } }
  })
}
