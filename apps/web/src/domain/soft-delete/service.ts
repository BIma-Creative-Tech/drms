import { sql } from '@payloadcms/db-postgres'
import { APIError, type CollectionSlug, type PayloadRequest, type Where } from 'payload'

import { employeeIn, hasRole, hasRoleAny, isGroupAdmin, relId, userId } from '@/access/roles'
import { whereMatches } from '@/admin/row-actions'
import { writeAudit, type AuditRow } from '@/audit/writer'
import { targets } from '@/domain/expense/state'
import { payeeOf, type RequestStatus, type RequestType } from '@/domain/expense/types'
import { getRequestTx } from '@/lib/tx'

import { REASON_MAX, REASON_MIN, softDeleteEntry, type RowState, type SoftDeleteEntry } from './registry'
import { usageOf, type UsageLine } from './usage'

type SQL = ReturnType<typeof sql>

/**
 * D1610 (ADR 0030): the soft delete itself — the ONLY writer of `isDeleted` / `deletedAt` / `deletedBy` /
 * `deleteReason`. One SQL UPDATE of the flag columns (no Payload hooks: nothing else of the row changes, so content
 * validation, notifications and reference re-checks must not run) + one `audit_logs` row, in the caller's
 * transaction. Hard delete stays denied everywhere (`delete: denyAll`, DB grants).
 *
 * Who:
 * - Hapus: whoever may UPDATE the row (the collection's own update access, per PT — the same people who may
 *   "Nonaktifkan" a master / edit a project; for a request: its creator / requesters while it is a Draft);
 * - Pulihkan and "Tampilkan yang dihapus": an Admin of the row's PT (group admins; shared masters: an Admin of any PT).
 * When:
 * - master / project: no other row references it (usage.ts); otherwise 409 with the usage lines;
 * - request: status Draft and never submitted (no number yet); otherwise 409 → "Batalkan".
 */

export class RecordError extends APIError {
  constructor(
    status: number,
    message: string,
    readonly pkCode: string,
    readonly pkDetails: Record<string, unknown> = {},
  ) {
    super(message, status, null, true)
  }
}

const fail = (status: number, code: string, message: string, details: Record<string, unknown> = {}): never => {
  throw new RecordError(status, message, code, details)
}

export type RecordRow = Record<string, unknown> & { id: number; is_deleted?: boolean | null; company_id?: number | null; deleted_at?: string | null }

export type DeleteCheck = {
  collection: string
  id: number
  title: string
  deleted: boolean
  /** The row action for the caller (same rule as the list). */
  action: RowState['action']
  canDelete: boolean
  canRestore: boolean
  /** Why Hapus is not possible (null when it is). */
  blockedReason: string | null
  usage: UsageLine[]
  deletedAt: string | null
  deleteReason: string | null
}

async function rows<T>(req: PayloadRequest, q: SQL): Promise<T[]> {
  const tx = await getRequestTx(req)
  return ((await tx.execute(q)) as unknown as { rows: T[] }).rows
}

export function entryOrFail(slug: string): SoftDeleteEntry {
  return softDeleteEntry(slug) ?? fail(404, 'NOT_FOUND', 'Data ini tidak dapat dihapus lewat aksi Hapus.')
}

/** The row as stored (snake_case columns), optionally locked FOR UPDATE. */
async function loadRow(req: PayloadRequest, entry: SoftDeleteEntry, id: number, lock: boolean): Promise<RecordRow | undefined> {
  const t = sql.identifier(entry.table)
  const r = await rows<{ r: RecordRow }>(req, sql`SELECT to_jsonb(x) AS r FROM ${t} x WHERE x.id = ${id}${lock ? sql` FOR UPDATE` : sql``}`)
  return r[0]?.r
}

/** The caller may read the row (the collection's read access; a deleted row is found by id). */
async function mayRead(req: PayloadRequest, slug: string, id: number): Promise<boolean> {
  try {
    const r = await req.payload.count({ collection: slug as CollectionSlug, where: { id: { equals: id } }, overrideAccess: false, user: req.user, req })
    return r.totalDocs > 0
  } catch (err) {
    if ((err as { status?: number }).status === 403) return false
    throw err
  }
}

/** The collection's update access → true / false / the rows (`Where`) the caller may update. */
export async function updateAccessOf(req: PayloadRequest, slug: string): Promise<boolean | Where> {
  const access = req.payload.collections[slug as CollectionSlug]?.config.access.update
  if (!access) return false
  const res = await access({ req } as never)
  return res === true ? true : res ? (res as Where) : false
}

async function mayUpdate(req: PayloadRequest, slug: string, id: number): Promise<boolean> {
  const access = await updateAccessOf(req, slug)
  if (access === true || access === false) return access
  const r = await req.payload.count({ collection: slug as CollectionSlug, where: { and: [{ id: { equals: id } }, access] }, overrideAccess: true /* SYSTEM-READ: does the caller's update access cover this row? */, req })
  return r.totalDocs > 0
}

/** Pulihkan / "Tampilkan yang dihapus": Admin of the row's PT (shared master: of any selected PT), group admin. */
export function mayRestore(req: PayloadRequest, entry: SoftDeleteEntry, companyId: number | null | undefined): boolean {
  if (isGroupAdmin(req)) return true
  return entry.shared || companyId === null || companyId === undefined ? hasRoleAny(req, 'pk-admin') : hasRole(req, 'pk-admin', companyId)
}

/** "Batalkan proyek": Direktur or Admin of the project's PT (owner decision default, ADR 0030 §3). */
export function mayCancelProject(req: PayloadRequest, companyId: number | null | undefined): boolean {
  return hasRole(req, ['pk-owner', 'pk-admin'], companyId)
}

export const PROJECT_CANCELLABLE: readonly string[] = ['perencanaan', 'berjalan', 'ditunda']

/** A request that may be soft-deleted: a Draft never submitted (the number is allocated at the first submit). */
export function isNeverSubmittedDraft(row: { status?: unknown; doc_no?: unknown; docNo?: unknown }): boolean {
  const no = row.doc_no ?? row.docNo
  return row.status === 'draft' && (no === null || no === undefined || no === '')
}

/** The state machine has a `cancel` transition from the request's status. */
export function requestCancellable(row: { type?: unknown; status?: unknown; payee_type?: unknown; payeeType?: unknown }): boolean {
  return targets((row.type ?? 'advance') as RequestType, row.status as RequestStatus, 'cancel', payeeOf(row.payee_type ?? row.payeeType)).length > 0
}

function titleOf(entry: SoftDeleteEntry, row: Record<string, unknown>): string {
  const pick = (...keys: string[]) => keys.map((k) => row[k]).find((v) => typeof v === 'string' && v.trim() !== '') as string | undefined
  if (entry.kind === 'expense') return [pick('doc_no', 'docNo'), pick('title')].filter(Boolean).join(' — ') || `Pengajuan #${String(row.id)}`
  const code = pick('code', 'unit_code', 'unitCode', 'account_no', 'accountNo', 'plate_no', 'plateNo')
  const name = pick('name', 'display_name', 'displayName', 'account_holder', 'accountHolder', 'title')
  return [code, name].filter(Boolean).join(' — ') || `#${String(row.id)}`
}

function docTypeOf(req: PayloadRequest, slug: string): string {
  const custom = req.payload.collections[slug as CollectionSlug]?.config.custom as { pkAudit?: { docType?: string } } | undefined
  return custom?.pkAudit?.docType ?? slug.replace(/-/g, '_')
}

function blockedText(entry: SoftDeleteEntry, usage: UsageLine[]): string {
  const list = usage.map((u) => `${u.label} (${u.count})`).join(', ')
  if (entry.kind === 'project') return `Project sudah dipakai (${list}). Project yang sudah dipakai tidak dapat dihapus — gunakan "Batalkan proyek".`
  return `Data sudah dipakai (${list}). Data yang sudah dipakai tidak dapat dihapus — gunakan "Nonaktifkan".`
}

function checkReason(reason: string): string {
  const r = reason.trim()
  if (r.length < REASON_MIN || r.length > REASON_MAX) fail(400, 'REASON_REQUIRED', `Alasan wajib diisi (${REASON_MIN}–${REASON_MAX} karakter).`)
  return r
}

/** The action for a USED row (master → Nonaktifkan, project → Batalkan proyek), for the caller. */
function usedAction(req: PayloadRequest, entry: SoftDeleteEntry, row: Record<string, unknown>, canUpdate: boolean): RowState['action'] {
  if (entry.kind === 'project') return PROJECT_CANCELLABLE.includes(String(row.status)) && mayCancelProject(req, relId(row.company_id ?? row.company)) ? 'batalkan' : null
  return canUpdate && row.active === true ? 'nonaktifkan' : null
}

/** GET …/delete-check: what the row action does for this caller, with the usage lines (dialog content). */
export async function deleteCheck(req: PayloadRequest, slug: string, id: number): Promise<DeleteCheck> {
  const entry = entryOrFail(slug)
  const row = await loadRow(req, entry, id, false)
  if (!row || !(await mayRead(req, slug, id))) return fail(404, 'NOT_FOUND', 'Data tidak ditemukan.')
  const company = relId(row.company_id)
  const deleted = row.is_deleted === true
  const canRestore = deleted && mayRestore(req, entry, company)
  const base = { collection: slug, id, title: titleOf(entry, row), deleted, canRestore, deletedAt: (row.deleted_at as string | null) ?? null, deleteReason: (row.delete_reason as string | null) ?? null }
  if (deleted) return { ...base, action: canRestore ? 'pulihkan' : null, canDelete: false, blockedReason: 'Data ini sudah dihapus.', usage: [] }
  const canUpdate = await mayUpdate(req, slug, id)
  if (entry.kind === 'expense') {
    const draft = isNeverSubmittedDraft(row)
    const action = draft && canUpdate ? 'hapus' : !draft && requestCancellable(row) ? 'batalkan' : null
    const blockedReason = !draft ? 'Hanya draft yang belum pernah diajukan yang dapat dihapus. Pengajuan yang sudah diajukan dibatalkan lewat "Batalkan".' : !canUpdate ? 'Anda tidak berhak menghapus pengajuan ini.' : null
    return { ...base, action, canDelete: draft && canUpdate, blockedReason, usage: [] }
  }
  const usage = (await usageOf(req, entry, [id])).get(id) ?? []
  if (usage.length > 0) return { ...base, action: usedAction(req, entry, row, canUpdate), canDelete: false, blockedReason: blockedText(entry, usage), usage }
  return { ...base, action: canUpdate ? 'hapus' : null, canDelete: canUpdate, blockedReason: canUpdate ? null : 'Anda tidak berhak menghapus data ini.', usage }
}

type FlagUpdate = { table: string; ids: number[] }

async function setFlag(req: PayloadRequest, entry: SoftDeleteEntry, row: RecordRow, deleted: boolean, reason: string): Promise<FlagUpdate[]> {
  const uid = userId(req) ?? null
  const t = sql.identifier(entry.table)
  const changed: FlagUpdate[] = [{ table: entry.table, ids: [row.id] }]
  if (deleted) {
    await rows(req, sql`UPDATE ${t} SET is_deleted = true, deleted_at = now(), deleted_by_id = ${uid}, delete_reason = ${reason}, updated_at = now() WHERE id = ${row.id}`)
  } else {
    await rows(req, sql`UPDATE ${t} SET is_deleted = false, deleted_at = NULL, deleted_by_id = NULL, delete_reason = NULL, updated_at = now() WHERE id = ${row.id}`)
  }
  for (const child of entry.owned.filter((o) => o.cascade)) {
    const ct = sql.identifier(child.table)
    const cc = sql.identifier(child.column)
    const ids = deleted
      ? await rows<{ id: number }>(req, sql`UPDATE ${ct} SET is_deleted = true, deleted_at = now(), deleted_by_id = ${uid}, delete_reason = ${`Ikut dihapus bersama induknya: ${reason}`.slice(0, REASON_MAX)}, updated_at = now() WHERE ${cc} = ${row.id} AND is_deleted IS NOT TRUE RETURNING id`)
      : // restore exactly the children deleted together with the row (same transaction → same now())
        await rows<{ id: number }>(req, sql`UPDATE ${ct} SET is_deleted = false, deleted_at = NULL, deleted_by_id = NULL, delete_reason = NULL, updated_at = now() WHERE ${cc} = ${row.id} AND is_deleted IS TRUE AND deleted_at = ${row.deleted_at ?? null}::timestamptz RETURNING id`)
    if (ids.length) changed.push({ table: child.table, ids: ids.map((r) => Number(r.id)) })
  }
  return changed
}

function slugOfTable(req: PayloadRequest, table: string): string {
  return req.payload.config.collections.find((c) => c.slug.replace(/-/g, '_') === table)?.slug ?? table
}

async function audit(req: PayloadRequest, changed: FlagUpdate[], row: RecordRow, entry: SoftDeleteEntry, deleted: boolean, reason: string): Promise<void> {
  const out: AuditRow[] = []
  for (const c of changed) {
    const slug = c.table === entry.table ? entry.slug : slugOfTable(req, c.table)
    for (const id of c.ids) {
      out.push({
        action: deleted ? 'soft_delete' : 'restore',
        docType: docTypeOf(req, slug),
        docId: String(id),
        docNo: id === row.id && c.table === entry.table ? (titleOf(entry, row).slice(0, 120) || undefined) : undefined,
        field: 'isDeleted',
        oldValue: !deleted,
        newValue: deleted,
        statusFrom: deleted ? 'aktif' : 'dihapus',
        statusTo: deleted ? 'dihapus' : 'aktif',
        reason,
        companyId: relId(row.company_id) ?? null,
      })
    }
  }
  await writeAudit(req, out)
}

/** POST …/delete — soft delete (reason required). Returns the check of the row after the change. */
export async function softDelete(req: PayloadRequest, slug: string, id: number, reasonRaw: string): Promise<DeleteCheck> {
  const entry = entryOrFail(slug)
  const reason = checkReason(reasonRaw)
  const row = await loadRow(req, entry, id, true)
  if (!row || !(await mayRead(req, slug, id))) return fail(404, 'NOT_FOUND', 'Data tidak ditemukan.')
  if (row.is_deleted === true) fail(409, 'ALREADY_DELETED', 'Data ini sudah dihapus.')
  if (!(await mayUpdate(req, slug, id))) fail(403, 'FORBIDDEN', entry.kind === 'expense' ? 'Hanya pembuat / pemohon yang dapat menghapus draft pengajuan ini.' : 'Anda tidak berhak menghapus data ini.')
  if (entry.kind === 'expense') {
    if (!isNeverSubmittedDraft(row)) fail(409, 'NOT_A_DRAFT', 'Hanya draft yang belum pernah diajukan yang dapat dihapus. Pengajuan yang sudah diajukan dibatalkan lewat "Batalkan".')
  } else {
    const usage = (await usageOf(req, entry, [id])).get(id) ?? []
    if (usage.length > 0) fail(409, entry.kind === 'project' ? 'PROJECT_IN_USE' : 'IN_USE', blockedText(entry, usage), { usage })
  }
  const changed = await setFlag(req, entry, row, true, reason)
  await audit(req, changed, row, entry, true, reason)
  return deleteCheck(req, slug, id)
}

/** POST …/restore — Admin brings a soft-deleted row back (reason required, audited). */
export async function restoreDeleted(req: PayloadRequest, slug: string, id: number, reasonRaw: string): Promise<DeleteCheck> {
  const entry = entryOrFail(slug)
  const reason = checkReason(reasonRaw)
  const row = await loadRow(req, entry, id, true)
  if (!row || !(await mayRead(req, slug, id))) return fail(404, 'NOT_FOUND', 'Data tidak ditemukan.')
  if (!mayRestore(req, entry, relId(row.company_id))) fail(403, 'FORBIDDEN', 'Hanya Admin PT yang dapat memulihkan data yang dihapus.')
  if (row.is_deleted !== true) fail(409, 'NOT_DELETED', 'Data ini tidak dalam keadaan dihapus.')
  const changed = await setFlag(req, entry, row, false, reason)
  await audit(req, changed, row, entry, false, reason)
  return deleteCheck(req, slug, id)
}

// ---------------------------------------------------------------- list rows (the "Aksi" column)

type ListDoc = Record<string, unknown> & { id?: unknown }

/**
 * The row action of every row of one list page (PkListView): one usage query for the page, the update access
 * evaluated once and matched per row. A UI hint only — the endpoints re-check everything.
 */
export async function rowStates(req: PayloadRequest, slug: string, docs: readonly ListDoc[]): Promise<Map<number, RowState>> {
  const out = new Map<number, RowState>()
  const entry = softDeleteEntry(slug)
  if (!entry || docs.length === 0) return out
  const access = await updateAccessOf(req, slug)
  const canUpdate = (d: ListDoc) => access === true || (access !== false && whereMatches(access, d))
  const live = docs.filter((d) => d.isDeleted !== true && typeof d.id === 'number')
  const usage = entry.kind === 'expense' ? new Map<number, UsageLine[]>() : await usageOf(req, entry, live.map((d) => d.id as number))
  const uid = userId(req)
  for (const d of docs) {
    if (typeof d.id !== 'number') continue
    const company = relId(d.company)
    if (d.isDeleted === true) {
      out.set(d.id, { action: mayRestore(req, entry, company) ? 'pulihkan' : null, deleted: true })
      continue
    }
    if (entry.kind === 'expense') {
      const emp = employeeIn(req, company)
      const own = relId(d.createdBy) === uid || (emp !== undefined && Array.isArray(d.requesters) && d.requesters.some((r) => relId(r) === emp))
      const office = hasRole(req, ['pk-finance', 'pk-owner'], company)
      const action = isNeverSubmittedDraft(d) ? (own ? 'hapus' : null) : requestCancellable(d) && (own || office) ? 'batalkan' : null
      out.set(d.id, { action, deleted: false })
      continue
    }
    const used = (usage.get(d.id) ?? []).length > 0
    out.set(d.id, { action: used ? usedAction(req, entry, { ...d, company_id: company }, canUpdate(d)) : canUpdate(d) ? 'hapus' : null, deleted: false })
  }
  return out
}
