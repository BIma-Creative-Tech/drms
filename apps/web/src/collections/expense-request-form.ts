import type { Condition } from 'payload'

/**
 * DRMS 10/10 8i / 9a (WA-03, WA-05): what the expense-request form shows per status. Pure module
 * (unit-tested). The create / draft form shows only the inputs (same order as the APK draft editor);
 * system and workflow fields appear once the request is submitted. Conditions only hide UI — field
 * access (`access: system`) and the domain service stay the authority.
 */
type FormData = { status?: string | null; docNo?: string | null; payeeType?: string | null } | undefined | null

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

/**
 * DRMS 10/10 B-2 (item 3): an input of the request header — shown only while the content is editable (new /
 * Draft / Revisi Nota); on a locked request the workflow panel shows the read-only "Rincian pengajuan" summary
 * instead (label: value, no empty pickers, no loading inputs). `name` given: in Revisi Nota only when filled.
 */
export function editableInput(name?: string): Condition {
  return (data, sibling, ctx) => linesEditable(data as FormData) && (!name || draftOrSet(name)(data, sibling, ctx))
}

/**
 * DRMS 10/10 Phase C polish: the sidebar no longer repeats what the workflow panel header ("Nomor · Jenis", status
 * chip, grand total) and the read-only "Rincian pengajuan" already show (Nomor, Status, Dibuat oleh, Grand total,
 * Tanggal pengajuan / diajukan / disetujui) — on every status, so a Draft at phone width no longer ends with these
 * server fields either. The values stay in the document, the API and the PDF.
 */
export const shownInHeader: Condition = () => false

/** "Alasan perubahan" (audit reason of a save): only in "Revisi Nota" — the Draft needs none (Phase C polish). */
export const revisionOnly: Condition = (data) => (data as FormData)?.status === 'receipt_revision'

/** ADR 0027: the form is a vendor payment ("Jenis penerima" = Vendor). */
export function isVendorForm(data: FormData): boolean {
  return data?.payeeType === 'vendor'
}

/** ADR 0027: `cond` AND a vendor payment (vendor, rekening vendor, invoice inputs). */
export function vendorPayee(cond: Condition): Condition {
  return (data, sibling, ctx) => isVendorForm(data as FormData) && cond(data, sibling, ctx)
}

/** ADR 0028: the form is a payment to another PT of the group ("Jenis penerima" = PT grup). */
export function isIntercompanyForm(data: FormData): boolean {
  return data?.payeeType === 'pt_grup'
}

/** ADR 0028: `cond` AND a payment to a PT of the group (PT penerima input). */
export function intercompanyPayee(cond: Condition): Condition {
  return (data, sibling, ctx) => isIntercompanyForm(data as FormData) && cond(data, sibling, ctx)
}

/** ADR 0027 / 0028: `cond` AND a payment without LPJ (vendor or PT grup: invoice / document inputs, cost center without project). */
export function directPayee(cond: Condition): Condition {
  return (data, sibling, ctx) => (isVendorForm(data as FormData) || isIntercompanyForm(data as FormData)) && cond(data, sibling, ctx)
}

/** ADR 0027: `cond` AND paid to an employee (Pemohon picker, rekening karyawan) — ADR 0028: not to a PT of the group either. */
export function employeePayee(cond: Condition): Condition {
  return (data, sibling, ctx) => !isVendorForm(data as FormData) && !isIntercompanyForm(data as FormData) && cond(data, sibling, ctx)
}

/** Field shown only when it has a value (docNo before the first submit is empty). */
export function whenSet(name: string): Condition {
  return (data) => {
    const v = (data as Record<string, unknown> | undefined)?.[name]
    return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)
  }
}

/** Draft: always (an input); after submit only when filled (no empty read-only pickers such as "Pilih pusat biaya…"). */
export function draftOrSet(name: string): Condition {
  const set = whenSet(name)
  return (data, sibling, ctx) => isDraftForm(data as FormData) || set(data, sibling, ctx)
}

/**
 * 8d (WA-15): field-specific placeholders instead of Payload's generic "Pilih nilai" (the global
 * fallback is overridden to "Pilih…" in payload.config.ts). Wording follows the APK hints.
 */
export const PLACEHOLDERS = {
  type: 'Pilih jenis pengajuan…',
  payeeType: 'Pilih jenis penerima…',
  project: 'Pilih project…',
  costCenter: 'Pilih pusat biaya…',
  urgencyLevel: 'Pilih tingkat urgensi…',
  requesters: 'Pilih pemohon…',
  bankAccount: 'Pilih rekening tujuan…',
  vendor: 'Pilih vendor…',
  vendorBankAccount: 'Pilih rekening vendor…',
  payeeCompany: 'Pilih PT penerima…',
  uom: 'Pilih satuan…',
  category: 'Pilih kategori…',
  vehicle: 'Pilih kendaraan…',
  rapItem: 'Pilih item RAP…',
  company: 'Pilih PT…',
} as const

/**
 * DRMS 13/10 Persetujuan #5/#6: request-page values that moved off the form — the totals into the read-only summary,
 * the approval rule into the stepper, timestamps into "Log perubahan". The fields stay in the document, API and PDF.
 */
export const notOnRequestPage: Condition = () => false

/**
 * DRMS 13/10 Persetujuan #7: the request page opens READ-ONLY (summary + lines table); "Edit" switches the Payload
 * form on. A new document (no id) is always in edit mode. "Edit" only when Payload grants the update (collection
 * access: own Draft / Revisi Nota, domain/expense/access.ts requestUpdateAccess → `hasSavePermission`) AND the status
 * is content-editable — UI only, the collection hook rejects any other write.
 */
export function requestEditGate(p: { id?: unknown; status?: string | null; hasSavePermission?: boolean }): 'create' | 'editable' | 'locked' {
  if (p.id === undefined || p.id === null || p.id === '') return 'create'
  return p.hasSavePermission === true && (p.status === 'draft' || p.status === 'receipt_revision') ? 'editable' : 'locked'
}
