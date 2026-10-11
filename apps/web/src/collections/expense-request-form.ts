import type { Condition } from 'payload'

/**
 * DRMS 10/10 8i / 9a (WA-03, WA-05): what the expense-request form shows per status. Pure module
 * (unit-tested). The create / draft form shows only the inputs (same order as the APK draft editor);
 * system and workflow fields appear once the request is submitted. Conditions only hide UI — field
 * access (`access: system`) and the domain service stay the authority.
 */
type FormData = { status?: string | null; docNo?: string | null } | undefined | null

/** New (unsaved) or Draft. */
export function isDraftForm(data: FormData): boolean {
  const s = data?.status
  return s === undefined || s === null || s === '' || s === 'draft'
}

/** Submitted at least once (any status after Draft). */
export const submittedOnly: Condition = (data) => !isDraftForm(data as FormData)

/** Draft only (new form included): inputs that are locked after submit (e.g. the account picker). */
export const draftOnly: Condition = (data) => isDraftForm(data as FormData)

/** Lines are editable as Payload array cards in Draft and "Revisi Nota"; otherwise the "Rincian pengajuan" table shows them. */
export function linesEditable(data: FormData): boolean {
  return isDraftForm(data) || data?.status === 'receipt_revision'
}
export const linesCondition: Condition = (data) => linesEditable(data as FormData)

/** Field shown only when it has a value (docNo before the first submit is empty). */
export function whenSet(name: string): Condition {
  return (data) => {
    const v = (data as Record<string, unknown> | undefined)?.[name]
    return v !== undefined && v !== null && v !== ''
  }
}

/**
 * 8d (WA-15): field-specific placeholders instead of Payload's generic "Pilih nilai" (the global
 * fallback is overridden to "Pilih…" in payload.config.ts). Wording follows the APK hints.
 */
export const PLACEHOLDERS = {
  type: 'Pilih jenis pengajuan…',
  project: 'Pilih project…',
  costCenter: 'Pilih pusat biaya…',
  urgencyLevel: 'Pilih tingkat urgensi…',
  requesters: 'Pilih pemohon…',
  bankAccount: 'Pilih rekening tujuan…',
  uom: 'Pilih satuan…',
  category: 'Pilih kategori…',
  vehicle: 'Pilih kendaraan…',
  company: 'Pilih PT…',
} as const
