/**
 * D1610 (ADR 0030, owner 2026-10-16): the collections with a "Hapus" (SOFT delete) row action. Pure module (no
 * Payload import; unit-tested, bundled into the OpenAPI generator).
 *
 * A soft delete only sets `isDeleted = true` (+ who / when / reason) through the dedicated endpoint
 * (`POST /api/v1/records/{collection}/{id}/delete`); hard delete stays denied (`delete: denyAll`). Allowed ONLY
 * while nothing references the row:
 * - `master`  — master data: no foreign key of any other table points at the row (usage.ts reads the FKs from
 *               pg_catalog, so a new table is covered without code); used → the existing "Nonaktifkan" path;
 * - `project` — the same FK rule; used → "Batalkan proyek" (status `dibatalkan`, cascade, domain/projects/cancel.ts);
 * - `expense` — a Draft that was NEVER submitted (no number); otherwise the existing "Batalkan" action.
 * `owned` children belong to the row (the vendor's bank accounts, the project's stages): they do not count as a use
 * themselves (their OWN references do), and `cascade` children are soft-deleted / restored together with the row.
 */

export type SoftDeleteKind = 'master' | 'project' | 'expense'

export type OwnedChild = {
  /** Table of the child rows and its FK column to the parent. */
  table: string
  column: string
  /** Soft-deleted / restored together with the parent (the child table carries the soft-delete columns). */
  cascade: boolean
}

export type SoftDeleteEntry = {
  slug: string
  /** Postgres table (Payload: snake_case of the slug). */
  table: string
  kind: SoftDeleteKind
  /** Shared master without a `company` column (banks, UoM): restore / show-deleted by an Admin of any PT. */
  shared: boolean
  owned: readonly OwnedChild[]
}

const master = (slug: string, extra: Partial<SoftDeleteEntry> = {}): SoftDeleteEntry => ({ slug, table: slug.replace(/-/g, '_'), kind: 'master', shared: false, owned: [], ...extra })

export const SOFT_DELETE_ENTRIES: readonly SoftDeleteEntry[] = [
  master('banks', { shared: true }),
  master('uoms', { shared: true }),
  master('clients'),
  master('vendors', { owned: [{ table: 'vendor_bank_accounts', column: 'vendor_id', cascade: true }] }),
  master('vendor-bank-accounts'),
  master('employees', { owned: [{ table: 'employee_bank_accounts', column: 'employee_id', cascade: true }] }),
  master('employee-bank-accounts'),
  master('sites'),
  master('cost-centers'),
  master('expense-categories'),
  master('urgency-levels'),
  master('resource-types'),
  // DRMS owner 2026-10-17: "Jenis servis" — used by a report (service_reports_rels FK) → Nonaktifkan only
  master('service-types'),
  master('vehicles'),
  master('cash-in-sources'),
  master('cash-accounts'),
  master('work-schedules'),
  master('stage-templates'),
  master('rap-templates'),
  // A project's stages (weights) and team assignments are its own set-up: they do not make it "used". Progress /
  // daily / field reports, requests, cash, loans, addenda, RAP items … reference the project itself.
  {
    slug: 'projects',
    table: 'projects',
    kind: 'project',
    shared: false,
    owned: [
      { table: 'project_stages', column: 'project_id', cascade: false },
      { table: 'team_assignments', column: 'project_id', cascade: false },
    ],
  },
  { slug: 'expense-requests', table: 'expense_requests', kind: 'expense', shared: false, owned: [] },
]

export const SOFT_DELETE: Readonly<Record<string, SoftDeleteEntry>> = Object.fromEntries(SOFT_DELETE_ENTRIES.map((e) => [e.slug, e]))

export const SOFT_DELETE_SLUGS: readonly string[] = SOFT_DELETE_ENTRIES.map((e) => e.slug)

export function softDeleteEntry(slug: string | undefined | null): SoftDeleteEntry | undefined {
  return slug ? SOFT_DELETE[slug] : undefined
}

/** Field names (Payload) and columns (Postgres) of the soft delete. */
export const IS_DELETED = 'isDeleted'
export const DELETED_AT = 'deletedAt'
export const DELETED_BY = 'deletedBy'
export const DELETE_REASON = 'deleteReason'

export const REASON_MIN = 3
export const REASON_MAX = 1000

/** `req.context` key: a server-side read that wants soft-deleted rows too (the explicit `isDeleted` condition is kept). */
export const INCLUDE_DELETED = 'pkIncludeDeleted'

/** Row action of a soft-deletable collection in the list ("Aksi" column), computed server-side per row. */
export type RowState = {
  /** `hapus` = soft delete allowed; `batalkan` = cancel instead (project / request in flight); `nonaktifkan` = used master (deactivate in the form); `pulihkan` = deleted row, Admin may restore. */
  action: 'hapus' | 'batalkan' | 'nonaktifkan' | 'pulihkan' | null
  deleted: boolean
}

/** Key of the row state on a list row (`rowData`, read by RowActionsCell). */
export const ROW_STATE_KEY = '_pkRow'

/** Hand-written tables (not Payload collections) → label of a usage line. */
export const TABLE_LABELS: Readonly<Record<string, string>> = {
  intercompany_loans: 'Pinjaman antar-PT',
  intercompany_loan_requests: 'Pinjaman antar-PT',
  intercompany_loan_transfers: 'Pinjaman antar-PT',
  intercompany_links: 'Pembayaran antar-PT',
  company_memberships: 'Akses pengguna per PT',
  expense_requests_lines: 'Pengajuan',
  expense_requests_rels: 'Pengajuan',
}

/**
 * FK columns that never make a row "used": the row's own sub-tables (`<table>_rels.parent_id`, array rows
 * `<table>_<field>._parent_id`), Payload system tables (`payload_*`: document locks, preferences) and the
 * `deleted_by_id` audit columns of the soft delete itself.
 */
export function ignoredReference(table: string, refTable: string, refColumn: string): boolean {
  if (refTable.startsWith('payload_')) return true
  if (refColumn === 'deleted_by_id') return true
  if (refTable.startsWith(`${table}_`) && (refColumn === 'parent_id' || refColumn === '_parent_id')) return true
  return false
}
