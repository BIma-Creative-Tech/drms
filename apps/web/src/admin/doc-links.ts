/**
 * DRMS 10/10 12b (WA-12): every document number in the custom views links to its detail. Audit /
 * history rows carry `docType` + `docId`; this maps them to the admin detail URL. Pure module
 * (unit-tested). The target page re-checks read access (a reader without access gets "Tidak ada akses").
 */
const DETAIL: Record<string, (id: string) => string> = {
  expense_request: (id) => `/admin/collections/expense-requests/${id}`,
  transfer: (id) => `/admin/collections/transfers/${id}`,
  settlement: (id) => `/admin/collections/settlements/${id}`,
  cash_entry: (id) => `/admin/collections/cash-entries/${id}`,
  receipt: (id) => `/admin/collections/receipts/${id}`,
  budget_addendum: (id) => `/admin/collections/budget-addenda/${id}`,
  progress_report: (id) => `/admin/progress/laporan/${id}`,
  daily_report: (id) => `/admin/collections/daily-reports/${id}`,
  service_report: (id) => `/admin/collections/service-reports/${id}`,
  unit_timesheet: (id) => `/admin/collections/unit-timesheets/${id}`,
  aftersales_activity: (id) => `/admin/collections/aftersales-activities/${id}`,
  project_loan: (id) => `/admin/pinjaman/detail/${id}`,
  intercompany_loan: (id) => `/admin/pinjaman-antar-pt/detail/${id}`,
}

/** Detail URL of a numbered document, or null (unknown type / missing or malformed id). */
export function docHref(docType: string | null | undefined, docId: string | number | null | undefined): string | null {
  if (!docType || docId === null || docId === undefined) return null
  const id = String(docId)
  if (!/^\d{1,10}$/.test(id)) return null
  return DETAIL[docType]?.(id) ?? null
}

/**
 * Report cell link (TableRow.links, domain/reports): `{ [cellKey]: detail URL }` for a document-number
 * cell, `{}` when the type is unknown or the id is missing — spread into a row's `links`.
 */
export function docLink(cellKey: string, docType: string | null | undefined, docId: unknown): Partial<Record<string, string>> {
  const href = docHref(docType, typeof docId === 'number' || typeof docId === 'string' ? docId : null)
  return href ? { [cellKey]: href } : {}
}
