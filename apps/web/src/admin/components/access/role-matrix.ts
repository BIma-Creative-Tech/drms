import { ROLES, type Role } from '@/access/roles'
import { errorLine } from '@/lib/field-labels'

/**
 * "Pengguna & akses PT" role matrix (MC2-4, ADR 0016 §2/§11, wireframe mc/wireframes.md §2) — pure
 * state + permission logic shared by the server view, the client matrix and the unit tests.
 *
 * One cell = one `company-memberships` row (user × PT). Editable by the Admin of THAT PT or a group
 * admin (same rule as the collection access: create/update = Admin of the row's PT, group admin all;
 * the server re-checks every write and audits `role_change`). Clearing every role = membership
 * INACTIVE (never deleted); ticking a role again reactivates it.
 */

export type MatrixCompany = { id: number; shortCode: string; name: string }
export type MatrixUser = { id: number; name: string; email: string; active: boolean }
export type MatrixEmployee = { id: number; company: number; code: string; name: string; active: boolean }
/** Stored membership (DB state). */
export type MatrixCell = { id: number; user: number; company: number; roles: Role[]; employee: number | null; active: boolean }
/** Edited state of one cell (a new cell has no id). */
export type CellDraft = { id?: number; user: number; company: number; roles: Role[]; employee: number | null; active: boolean }

export type Viewer = { groupAdmin: boolean; adminOf: readonly number[] }

export const ROLE_SHORT: Record<Role, string> = { 'pk-staff': 'Staff', 'pk-pm': 'PM', 'pk-finance': 'Fin', 'pk-owner': 'Dir', 'pk-admin': 'Adm', 'pk-operator': 'Opr' }

export const cellKey = (user: number, company: number) => `${user}:${company}`

/** May the viewer change memberships of this PT? (collection access: Admin of the PT or group admin) */
export function canEditCompany(v: Viewer, company: number): boolean {
  return v.groupAdmin || v.adminOf.includes(company)
}

/** Does the viewer see the page at all? */
export function canUseMatrix(v: Viewer): boolean {
  return v.groupAdmin || v.adminOf.length > 0
}

/**
 * PT columns: group admin → every active PT, Admin → the PTs where they are Admin. Narrowed to the
 * PT switcher selection when the viewer narrowed it (`selection` = null → "Semua PT").
 */
export function matrixColumns(all: readonly MatrixCompany[], v: Viewer, selection: readonly number[] | null): MatrixCompany[] {
  return all.filter((c) => canEditCompany(v, c.id) && (selection === null || selection.includes(c.id)))
}

export function sortRoles(roles: readonly Role[]): Role[] {
  return ROLES.filter((r) => roles.includes(r))
}

/** Toggling one role in a cell; no role left = inactive, a role on an inactive cell = active again. */
export function toggleRole(cell: CellDraft, role: Role): CellDraft {
  const roles = cell.roles.includes(role) ? cell.roles.filter((r) => r !== role) : sortRoles([...cell.roles, role])
  return { ...cell, roles, active: roles.length > 0 }
}

export function setEmployee(cell: CellDraft, employee: number | null): CellDraft {
  return { ...cell, employee }
}

/** "+ Tambah": new (unsaved) cell for a user without membership in that PT. */
export function newCell(user: number, company: number): CellDraft {
  return { user, company, roles: [], employee: null, active: false }
}

const sameRoles = (a: readonly Role[], b: readonly Role[]) => sortRoles(a).join() === sortRoles(b).join()

/** A draft differs from its stored cell (a new cell counts once it has a role). */
export function isChanged(draft: CellDraft, stored: MatrixCell | undefined): boolean {
  if (!stored) return draft.roles.length > 0
  return !sameRoles(draft.roles, stored.roles) || draft.employee !== stored.employee || draft.active !== stored.active
}

export type Op =
  | { kind: 'create'; key: string; company: number; body: { user: number; company: number; roles: Role[]; employee: number | null; active: true } }
  | { kind: 'update'; key: string; company: number; user: number; id: number; body: { roles: Role[]; employee: number | null; active: boolean } }

/** REST operations for the pending drafts (create = POST, update = PATCH), in a stable order. */
export function pendingOps(drafts: ReadonlyMap<string, CellDraft>, stored: ReadonlyMap<string, MatrixCell>): Op[] {
  const ops: Op[] = []
  for (const [key, d] of [...drafts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const s = stored.get(key)
    if (!isChanged(d, s)) continue
    if (!s || d.id === undefined) ops.push({ kind: 'create', key, company: d.company, body: { user: d.user, company: d.company, roles: sortRoles(d.roles), employee: d.employee, active: true } })
    else ops.push({ kind: 'update', key, company: d.company, user: d.user, id: d.id, body: { roles: sortRoles(d.roles), employee: d.employee, active: d.active && d.roles.length > 0 } })
  }
  return ops
}

/** One item of `POST /api/v1/company-memberships/batch` (mc2-contract §8). */
export type BatchItem = { user: number; company: number; roles: Role[]; employee: number | null; active: boolean }

/** Body of the atomic batch save: every pending op, in `ops` order (the server answers per index). */
export function batchBody(ops: readonly Op[], reason: string): { reason: string; items: BatchItem[] } {
  return {
    reason: reason.trim(),
    items: ops.map((o) => (o.kind === 'create' ? { ...o.body } : { user: o.user, company: o.company, ...o.body })),
  }
}

/**
 * Server errors of a refused batch per cell key: `errors[].path = 'items.<i>'` → the i-th op's cell.
 * Errors without an item path go to `general` (nothing was saved either way — all-or-nothing).
 */
export function batchErrors(data: unknown, ops: readonly Op[]): { cells: Map<string, string>; general: string[] } {
  const errs = ((data ?? {}) as { errors?: Array<{ path?: unknown; message?: unknown }> }).errors ?? []
  const cells = new Map<string, string>()
  const general: string[] = []
  for (const e of errs) {
    const m = typeof e.path === 'string' ? /^items\.(\d+)/.exec(e.path) : null
    const op = m ? ops[Number(m[1])] : undefined
    const msg = typeof e.message === 'string' && e.message ? e.message : 'Ditolak.'
    if (op) cells.set(op.key, cells.has(op.key) ? `${cells.get(op.key)}; ${msg}` : msg)
    // QA-21: the field label, never the raw path ("reason: Wajib." → "Alasan: Wajib.")
    else general.push(errorLine({ path: typeof e.path === 'string' ? e.path : null, message: msg }))
  }
  return { cells, general }
}

/** Ops outside the viewer's rights (the client refuses to send any of them: no partial save). */
export function forbiddenOps(ops: readonly Op[], v: Viewer): Op[] {
  return ops.filter((o) => !canEditCompany(v, o.company))
}

export const REASON_MIN = 3
export function reasonOk(reason: string): boolean {
  return reason.trim().length >= REASON_MIN
}

/**
 * Employees selectable in a cell: active employees of THAT PT not linked to another account in that
 * PT (unique (company, employee)); the cell's current employee always stays selectable.
 */
export function employeeChoices(
  employees: readonly MatrixEmployee[],
  cells: Iterable<CellDraft | MatrixCell>,
  company: number,
  user: number,
  current: number | null,
): MatrixEmployee[] {
  const taken = new Set<number>()
  for (const c of cells) if (c.company === company && c.user !== user && c.employee !== null) taken.add(c.employee)
  return employees
    .filter((e) => e.company === company && (e.id === current || (e.active && !taken.has(e.id))))
    .sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name))
}

/** Two accounts linked to the same employee of a PT (would fail the unique index on save). */
export function duplicateEmployees(cells: Iterable<CellDraft>): string[] {
  const seen = new Map<string, number>()
  const dup = new Set<string>()
  for (const c of cells) {
    if (c.employee === null || !c.active) continue
    const k = `${c.company}:${c.employee}`
    const prev = seen.get(k)
    if (prev !== undefined && prev !== c.user) dup.add(k)
    seen.set(k, c.user)
  }
  return [...dup]
}

/**
 * Wireframe §2 "Peringatan": a PT left without an active Direktur or Finance cannot submit requests
 * (409). Warn, never block. `users` = active accounts (an inactive account does not count).
 */
export function coverageWarnings(companies: readonly MatrixCompany[], cells: Iterable<CellDraft>, activeUsers: ReadonlySet<number>): string[] {
  const list = [...cells]
  const out: string[] = []
  for (const c of companies) {
    const live = list.filter((x) => x.company === c.id && x.active && activeUsers.has(x.user))
    const missing: string[] = []
    if (!live.some((x) => x.roles.includes('pk-owner'))) missing.push('Direktur')
    if (!live.some((x) => x.roles.includes('pk-finance'))) missing.push('Finance')
    if (missing.length) out.push(`PT ${c.shortCode} tidak punya ${missing.join(' dan ')} aktif — pengajuan ${c.shortCode} tidak bisa diajukan (409).`)
  }
  return out
}

/** Merge of stored cells and drafts (drafts win) — what the matrix shows. */
export function effectiveCells(stored: ReadonlyMap<string, MatrixCell>, drafts: ReadonlyMap<string, CellDraft>): Map<string, CellDraft> {
  const out = new Map<string, CellDraft>()
  for (const [k, s] of stored) out.set(k, { ...s })
  for (const [k, d] of drafts) out.set(k, d)
  return out
}
