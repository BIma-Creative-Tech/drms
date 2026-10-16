import type { PayloadRequest, Where } from 'payload'

import { memberCompanies, relId } from '@/access/roles'

import { fail, validation } from './common'
import { MAX_SERVICE_TYPES, SERVICE_TYPES_REQUIRED } from './rules'

/**
 * FR1 "Jenis servis" (DRMS owner 2026-10-17, ADR 0020 amendment 2026-10-17): the per-PT master `service-types` and
 * the selection rules of a service report — shared by POST/PATCH /api/v1/service-reports, …/corrections, the sync
 * item `service_report.upsert` (domain/field/service.ts) and GET /api/v1/service-types.
 *
 * Selection (`serviceTypeIds`, selection order kept): 1 … MAX_SERVICE_TYPES ids, unique, every one a row of the
 * REPORT's PT; on create every one active; on edit / correction a type already on the report may stay although it was
 * deactivated since, a newly added one must be active. LEGACY single code (`serviceType` / sync `service_type`, the
 * only form APK 0.7.0 knows) — used ONLY when no id list is sent: create → the PT's row with that code (active);
 * edit → unchanged when that code is already on the report (APK 0.7.0 sends it on every edit: a multi-selection made
 * on the web must not collapse), else the selection becomes that one type.
 */
export type ServiceTypeRow = { id: number; companyId: number; code: string; name: string; active: boolean; sortOrder: number; deleted: boolean }

const rowOf = (d: Record<string, unknown>): ServiceTypeRow => ({
  id: d.id as number,
  companyId: relId(d.company) ?? 0,
  code: String(d.code ?? ''),
  name: String(d.name ?? d.code ?? ''),
  active: d.active !== false,
  sortOrder: Number(d.sortOrder ?? 0) || 0,
  deleted: d.isDeleted === true,
})

/** Rows by id (any PT, active or not) — names of the types on reports the caller may read / the checks below. */
export async function serviceTypeRows(req: PayloadRequest, ids: readonly number[]): Promise<Map<number, ServiceTypeRow>> {
  const uniq = [...new Set(ids)].filter((x) => Number.isSafeInteger(x) && x > 0)
  if (uniq.length === 0) return new Map()
  const r = await req.payload.find({
    collection: 'service-types',
    where: { id: { in: uniq } },
    depth: 0,
    pagination: false,
    select: { company: true, code: true, name: true, active: true, sortOrder: true, isDeleted: true } as never,
    overrideAccess: true, // SYSTEM-READ: labels of the types on documents the caller may read / validation of a selection in the report's PT
    req,
  })
  return new Map((r.docs as unknown as Array<Record<string, unknown>>).map((d) => [d.id as number, rowOf(d)]))
}

/** The PT's row with a (legacy) code, or null. */
export async function serviceTypeByCode(req: PayloadRequest, company: number, code: string): Promise<ServiceTypeRow | null> {
  const r = await req.payload.find({
    collection: 'service-types',
    where: { and: [{ company: { equals: company } }, { code: { equals: code } }] },
    depth: 0,
    limit: 1,
    pagination: false,
    select: { company: true, code: true, name: true, active: true, sortOrder: true, isDeleted: true } as never,
    overrideAccess: true, // SYSTEM-READ: legacy code → master row of the report's PT (caller checked by the service)
    req,
  })
  const d = r.docs[0] as unknown as Record<string, unknown> | undefined
  return d ? rowOf(d) : null
}

/** Ids of a hasMany value (`[3, 5]` or populated docs), in stored order. */
export const serviceTypeIdsOf = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => relId(x)).filter((x): x is number => x !== undefined) : [])

const PATH = 'serviceTypeIds'

function checkList(ids: readonly number[]): void {
  if (ids.length === 0) validation([{ path: PATH, message: SERVICE_TYPES_REQUIRED }])
  if (ids.length > MAX_SERVICE_TYPES) validation([{ path: PATH, message: `Maksimal ${MAX_SERVICE_TYPES} jenis servis.` }])
  if (new Set(ids).size !== ids.length) validation([{ path: PATH, message: 'Jenis servis ganda.' }])
}

/** Every id a live row of `company`; `allowInactive` = ids that may be inactive (already on the report). */
async function rowsInCompany(req: PayloadRequest, company: number, ids: readonly number[], allowInactive: ReadonlySet<number>): Promise<ServiceTypeRow[]> {
  const map = await serviceTypeRows(req, ids)
  const out: ServiceTypeRow[] = []
  for (const id of ids) {
    const t = map.get(id)
    if (!t || t.companyId !== company || (t.deleted && !allowInactive.has(id))) validation([{ path: PATH, message: `Jenis servis #${id} tidak ada di PT laporan ini.` }])
    if (!t!.active && !allowInactive.has(id)) validation([{ path: PATH, message: `Jenis servis "${t!.name}" sudah nonaktif — pilih jenis lain.` }])
    out.push(t!)
  }
  return out
}

async function legacyRow(req: PayloadRequest, company: number, code: string): Promise<ServiceTypeRow> {
  const t = await serviceTypeByCode(req, company, code)
  if (!t || t.deleted) return fail(400, 'VALIDATION', `Jenis servis "${code}" tidak ada di master PT ini.`, 'serviceType')
  return t
}

/** Selection of a NEW report (exactly one of ids / legacy code). */
export async function resolveCreateServiceTypes(req: PayloadRequest, company: number, input: { serviceTypeIds?: readonly number[] | null; serviceType?: string | null }): Promise<ServiceTypeRow[]> {
  const ids = input.serviceTypeIds ?? undefined
  const legacy = typeof input.serviceType === 'string' && input.serviceType.trim() ? input.serviceType.trim() : undefined
  if (ids !== undefined && legacy !== undefined) validation([{ path: PATH, message: 'Kirim serviceTypeIds atau serviceType (lama), bukan keduanya.' }])
  if (ids !== undefined) {
    checkList(ids)
    return rowsInCompany(req, company, ids, new Set())
  }
  if (legacy === undefined) validation([{ path: PATH, message: SERVICE_TYPES_REQUIRED }])
  const t = await legacyRow(req, company, legacy!)
  if (!t.active) fail(400, 'VALIDATION', `Jenis servis "${t.name}" sudah nonaktif — pilih jenis lain.`, 'serviceType')
  return [t]
}

/**
 * New selection of an edit / correction, or null when unchanged. `current` = ids on the report (stored order). The
 * legacy code is ignored when an id list is sent.
 */
export async function resolvePatchServiceTypes(req: PayloadRequest, company: number, current: readonly number[], patch: { serviceTypeIds?: readonly number[] | null; serviceType?: string | null }): Promise<ServiceTypeRow[] | null> {
  const ids = patch.serviceTypeIds ?? undefined
  if (ids !== undefined) {
    checkList(ids)
    const rows = await rowsInCompany(req, company, ids, new Set(current))
    return ids.length === current.length && ids.every((x, i) => x === current[i]) ? null : rows
  }
  const legacy = typeof patch.serviceType === 'string' && patch.serviceType.trim() ? patch.serviceType.trim() : undefined
  if (legacy === undefined) return null
  const t = await legacyRow(req, company, legacy)
  if (current.includes(t.id)) return null
  if (!t.active) fail(400, 'VALIDATION', `Jenis servis "${t.name}" sudah nonaktif — pilih jenis lain.`, 'serviceType')
  return [t]
}

/**
 * GET /api/v1/service-types and the web forms: the types of `companyIds` (default: the caller's selected PTs) the
 * caller may read (collection access: every member), active only unless `includeInactive`; soft-deleted rows never.
 * Sorted by `sortOrder` (Urutan) then name (the APK sorts the same way).
 */
export async function listServiceTypes(req: PayloadRequest, f: { companyIds?: readonly number[]; includeInactive?: boolean }): Promise<ServiceTypeRow[]> {
  const companies = f.companyIds?.length ? [...f.companyIds] : memberCompanies(req)
  if (companies.length === 0) return []
  const and: Where[] = [{ company: { in: companies } }]
  if (!f.includeInactive) and.push({ active: { equals: true } })
  const r = await req.payload
    .find({ collection: 'service-types', where: { and }, depth: 0, pagination: false, sort: 'sortOrder', user: req.user, overrideAccess: false /* caller's read scope (members of the PT) */, req })
    .catch(() => ({ docs: [] as unknown[] }))
  return (r.docs as Array<Record<string, unknown>>)
    .map(rowOf)
    .filter((t) => !t.deleted)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'id') || a.id - b.id)
}

/** API / web item. */
export const serviceTypeItem = (t: ServiceTypeRow) => ({ id: t.id, companyId: t.companyId, code: t.code, name: t.name, active: t.active, sortOrder: t.sortOrder })
