import type { Payload, SanitizedCollectionConfig, SanitizedFieldsPermissions, TypedUser, Where } from 'payload'

import { companyContextOf, relId } from '@/access/roles'
import { pageOfFind, type PageOf } from '@/admin/list-query'
import { companyLabels } from '@/admin/components/companies/labels'
import { spValue } from '@/admin/list-query'
import { mayShowDeleted } from '@/domain/soft-delete/collection'
import { softDeleteEntry } from '@/domain/soft-delete/registry'
import { ONLY_DELETED, WITH_DELETED } from '@/domain/soft-delete/where'
import { ptOptions } from '@/lib/pt-options'

import { buildPkListConfig, topLevelFields, type PkListConfig } from './config'
import { activeColumns, companyScope, parsePkQuery, pkWhere, type PkQuery } from './query'

/**
 * DRMS 13/10 Umum #3–#8: the data of one PkListView request — config, parsed URL, `where`, one page of rows and
 * the option lists of the relationship / PT filters. Every read is `overrideAccess: false` with the request
 * user, so the collection's access rules and the PT selection of the switcher (company-context) apply exactly
 * as in Payload's own list; the URL can only narrow (PT filter ∩ selection, field access re-checked by Payload).
 * No React here (integration-tested directly).
 */

/** Rows of a relationship filter's option list (master data; beyond that the search box of the list). */
export const OPTION_LIMIT = 200

export type FilterOption = { value: string; label: string; title?: string }

export type PkListData = {
  cfg: PkListConfig
  query: PkQuery
  where: Where
  docs: Array<Record<string, unknown>>
  page: PageOf<unknown>
  /** Visible columns in order ("Aksi" last). */
  columns: string[]
  /** Columns the caller may show (Kolom ▾). */
  available: string[]
  /** Relationship filter → options (the caller's readable rows). */
  relOptions: Record<string, FilterOption[]>
  /** PT filter options (2+ PTs selected and the collection has a PT column), else null. */
  companies: FilterOption[] | null
  /** The where of an old deep link / a filter Payload refused (QueryError) → message. */
  error: string | null
  /** D1610 (ADR 0030): Admin filter "Tampilkan yang dihapus" — offered (`allowed`) and its value. */
  deleted: { allowed: boolean; mode: DeletedMode }
}

/** D1610: URL param of the deleted-rows filter: '' = hidden (default), `tampil` = with deleted, `hanya` = deleted only. */
export const DELETED_PARAM = 'dihapus'
export type DeletedMode = '' | 'tampil' | 'hanya'

/** The deleted-rows mode of one request — only for a soft-delete collection and an Admin (mayShowDeleted). */
export function deletedModeOf(slug: string, user: TypedUser | null | undefined, sp: Record<string, string | string[] | undefined> | undefined): { allowed: boolean; mode: DeletedMode } {
  const allowed = !!softDeleteEntry(slug) && !!user && mayShowDeleted({ user } as never)
  const raw = spValue(sp, DELETED_PARAM)
  return { allowed, mode: allowed && (raw === 'tampil' || raw === 'hanya') ? raw : '' }
}

const configs = new WeakMap<object, PkListConfig>()

/** Memoised per collection config object (built once per process). */
export function pkListConfigOf(c: SanitizedCollectionConfig): PkListConfig {
  let cfg = configs.get(c)
  if (!cfg) {
    cfg = buildPkListConfig(c as never)
    configs.set(c, cfg)
  }
  return cfg
}

/** Field-level read access as Payload's list applies it (filterFieldsWithPermissions): ui columns always. */
export function readableFields(c: SanitizedCollectionConfig, perms: SanitizedFieldsPermissions | undefined): (name: string) => boolean {
  const ui = new Set(topLevelFields(c.fields).filter((f) => f.type === 'ui').map((f) => f.name!))
  return (name) => {
    if (name === 'id' || ui.has(name) || perms === undefined || perms === true) return true
    const p = (perms as Record<string, unknown>)[name]
    return p === true || (!!p && typeof p === 'object' && (p as { read?: unknown }).read === true)
  }
}

function titleOf(doc: Record<string, unknown>, useAsTitle: string | undefined): string {
  const t = useAsTitle ? doc[useAsTitle] : undefined
  return typeof t === 'string' && t.trim() !== '' ? t : typeof t === 'number' ? String(t) : `#${String(doc.id)}`
}

/**
 * PT context of the relationship filters (DRMS UI feedback 17/10 #4): per-PT masters carry the same names in every PT —
 * with the list's PT filter on ONE PT only that PT's rows, else (2+ PTs selected) labels tagged `[CS1]`.
 */
type PtContext = { company: number | null; multi: boolean; code: (id: number) => string }

async function relationshipOptions(payload: Payload, user: TypedUser | null | undefined, relationTo: string, selected: readonly string[], pt: PtContext): Promise<FilterOption[]> {
  const target = (payload.collections as Record<string, { config: SanitizedCollectionConfig } | undefined>)[relationTo]?.config
  if (!target) return []
  const useAsTitle = typeof target.admin?.useAsTitle === 'string' ? target.admin.useAsTitle : undefined
  const titleField = useAsTitle ? topLevelFields(target.fields).find((f) => f.name === useAsTitle) : undefined
  const stored = !!titleField && !titleField.virtual
  const perPt = topLevelFields(target.fields).some((f) => f.name === 'company' && f.type === 'relationship' && f.relationTo === 'companies')
  try {
    const res = await payload.find({
      collection: relationTo as never,
      depth: 0,
      limit: OPTION_LIMIT,
      sort: stored ? useAsTitle : 'id',
      ...(stored ? { select: (perPt ? { [useAsTitle!]: true, company: true } : { [useAsTitle!]: true }) as never } : {}),
      ...(perPt && pt.company !== null ? { where: { company: { equals: pt.company } } } : {}),
      overrideAccess: false, // the caller's readable rows only (PT selection included)
      user,
    })
    const rows = (res.docs as unknown as Array<Record<string, unknown>>).map((d) => ({ id: String(d.id), label: titleOf(d, useAsTitle), companyId: perPt ? (relId(d.company) ?? null) : null }))
    const opts: FilterOption[] = ptOptions(rows, { code: pt.code, multi: perPt && pt.multi && pt.company === null }).map((o) => ({ value: o.id, label: o.label }))
    // a selected value outside the first OPTION_LIMIT rows stays visible (and removable)
    for (const v of selected) if (!opts.some((o) => o.value === v)) opts.push({ value: v, label: `#${v}` })
    return opts
  } catch {
    return [] // no read access to the target → no options (the filter is hidden)
  }
}

export type LoadArgs = {
  payload: Payload
  user: TypedUser | null | undefined
  collection: SanitizedCollectionConfig
  searchParams: Record<string, string | string[] | undefined> | undefined
  /** Saved column preference (Payload `collection-<slug>` → `columns`). */
  columnsPref?: unknown
  fieldPermissions?: SanitizedFieldsPermissions
}

export async function loadPkList({ payload, user, collection, searchParams, columnsPref, fieldPermissions }: LoadArgs): Promise<PkListData> {
  const cfg = pkListConfigOf(collection)
  const readable = readableFields(collection, fieldPermissions)
  const query = parsePkQuery(searchParams, cfg)
  const selected = companyContextOf(user)?.selected ?? null
  const deleted = deletedModeOf(collection.slug, user, searchParams)
  const base = pkWhere(query, cfg, { selected, readable })
  // D1610: an explicit isDeleted condition — kept by the central read rule for Admins only (else ignored)
  const deletedWhere = deleted.mode === 'tampil' ? WITH_DELETED : deleted.mode === 'hanya' ? ONLY_DELETED : null
  const where: Where = deletedWhere ? (Object.keys(base).length ? { and: [base, deletedWhere] } : deletedWhere) : base
  const available = cfg.columns.map((c) => c.name).filter(readable)
  const columns = activeColumns(columnsPref, cfg, readable)

  let error: string | null = null
  let page: PageOf<unknown> = { items: [], page: 1, per: query.per, total: 0, totalPages: 1, from: 0, to: 0 }
  const find = (p: number) =>
    payload.find({
      collection: collection.slug as never,
      where,
      sort: query.sort ?? cfg.defaultSort,
      page: p,
      limit: query.per,
      depth: 0,
      overrideAccess: false, // access rules + PT scope of the caller (company-context), as Payload's own list
      user,
    })
  try {
    let res = await find(query.page)
    // a page beyond the end (rows deleted / filter narrowed via Back) → the last page
    if (res.docs.length === 0 && res.totalDocs > 0 && query.page > res.totalPages) res = await find(res.totalPages)
    page = pageOfFind(res as never)
  } catch (err) {
    // QueryError: a field the caller may not read / an unknown path in an old where[…] link
    if ((err as { name?: string }).name !== 'QueryError') throw err
    error = 'Filter pada tautan ini tidak dapat dipakai untuk daftar ini. Klik Reset untuk menampilkan semua data.'
  }

  // URL PT ids outside the selection never reach the where (companyScope) — and are not shown as ticked
  query.companies = companyScope(query.companies, selected)
  const multiPt = (selected?.length ?? 0) >= 2
  const labels = multiPt ? await companyLabels(payload) : null
  const pt: PtContext = {
    // the list filtered to exactly one PT → the relationship filters offer that PT's rows only
    company: query.companies.length === 1 ? query.companies[0]! : null,
    multi: multiPt && query.companies.length !== 1,
    code: (id) => labels?.get(id)?.shortCode ?? `#${id}`,
  }

  const relOptions: Record<string, FilterOption[]> = {}
  await Promise.all(
    cfg.filters.map(async (f) => {
      if (f.kind === 'relationship' && readable(f.name)) relOptions[f.name] = await relationshipOptions(payload, user, f.relationTo, query.filters[f.name] ?? [], pt)
    }),
  )

  let companies: FilterOption[] | null = null
  if (cfg.hasCompany && readable('company') && labels) {
    companies = selected!
      .map((id) => ({ value: String(id), label: labels.get(id)?.shortCode ?? `#${id}`, title: labels.get(id)?.name }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }

  return { cfg, query, where, docs: page.items as Array<Record<string, unknown>>, page, columns, available, relOptions, companies, error, deleted }
}
