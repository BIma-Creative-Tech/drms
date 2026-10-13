import type { Where } from 'payload'

import { DEFAULT_PAGE_SIZE, PAGE_SIZES, spValue, spValues, type ListQuery, type PageSize } from '@/admin/list-query'
import { searchWhere } from '@/lib/text-search'

import type { PkDateFilter, PkFilter, PkListConfig } from './config'
import { ROW_ACTIONS_FIELD } from '../row-actions'

/**
 * DRMS 13/10 Umum #3–#5: URL state of PkListView ↔ Payload `where` (pure, unit-tested).
 * Params (the same names as the custom views' ListToolbar, src/admin/list-query.ts):
 *   q            search text (collection's listSearchableFields, `like` per word)
 *   hal / per    page (1-based) / page size 20·50·100
 *   urut         sort: `field` or `-field` (sortable columns only)
 *   f.<field>    multi-select filter, comma-separated values → `where[field][in]` (booleans: equals)
 *   f.company    PT filter — ids INTERSECTED with the caller's PT selection (never wider; unknown ids dropped)
 *   f.<date>.dari / f.<date>.sampai   date range (YYYY-MM-DD, inclusive)
 *   where[…]     Payload-style condition from older deep links (dashboard KPI tiles) — passed through
 *                AND-ed; Payload re-checks field access (overrideAccess:false) and the access rules still apply.
 */

export const FILTER_PREFIX = 'f.'
export const COMPANY_PARAM = 'f.company'
export const SORT_PARAM = 'urut'

type SP = Record<string, string | string[] | undefined> | undefined

export type PkQuery = {
  q: string
  page: number
  per: PageSize
  sort: string | undefined
  /** field → selected values (validated against the filter's kind / options). */
  filters: Record<string, string[]>
  /** date field → inclusive range. */
  dates: Record<string, { from?: string; to?: string }>
  /** PT ids from the URL (not yet intersected with the selection). */
  companies: number[]
  /** where[…] params of an older deep link, parsed. */
  linkWhere: Where | null
}

const ID_RE = /^[1-9][0-9]{0,9}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const filterParam = (name: string) => `${FILTER_PREFIX}${name}`
export const dateParams = (name: string) => ({ from: `${FILTER_PREFIX}${name}.dari`, to: `${FILTER_PREFIX}${name}.sampai` })

function validDate(v: string): string | undefined {
  if (!DATE_RE.test(v)) return undefined
  const d = new Date(`${v}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? undefined : v
}

function validValues(f: PkFilter, values: string[]): string[] {
  if (f.kind === 'boolean') return values.filter((v) => v === 'true' || v === 'false')
  if (f.kind === 'relationship') return values.filter((v) => ID_RE.test(v))
  const allowed = new Set(f.options.map((o) => o.value))
  return values.filter((v) => allowed.has(v))
}

/**
 * Nested object from Next's flat search params `where[a][in][0]=x` (qs-style, depth ≤ 6, `and`/`or` arrays).
 * Only `where…` keys; anything malformed is ignored.
 */
export function parseLinkWhere(sp: SP): Where | null {
  const root: Record<string, unknown> = {}
  let any = false
  for (const [key, raw] of Object.entries(sp ?? {})) {
    if (!key.startsWith('where[')) continue
    const path = [...key.slice(5).matchAll(/\[([^[\]]*)\]/g)].map((m) => m[1]!)
    if (path.length === 0 || path.length > 6 || key.slice(5).replace(/\[[^[\]]*\]/g, '') !== '') continue
    const value = Array.isArray(raw) ? raw.join(',') : raw
    if (typeof value !== 'string') continue
    let node: Record<string, unknown> = root
    path.forEach((seg, i) => {
      if (i === path.length - 1) node[seg] = value
      else node = (node[seg] && typeof node[seg] === 'object' ? node[seg] : (node[seg] = {})) as Record<string, unknown>
    })
    any = true
  }
  return any ? (arraysOf(root) as Where) : null
}

/** {"0": a, "1": b} → [a, b] (qs arrays), recursively. */
function arraysOf(v: unknown): unknown {
  if (!v || typeof v !== 'object') return v
  const o = v as Record<string, unknown>
  const keys = Object.keys(o)
  if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) return keys.sort((a, b) => Number(a) - Number(b)).map((k) => arraysOf(o[k]))
  return Object.fromEntries(keys.map((k) => [k, arraysOf(o[k])]))
}

export function parsePkQuery(sp: SP, cfg: Pick<PkListConfig, 'filters' | 'dates' | 'columns'>): PkQuery {
  const pageRaw = spValue(sp, 'hal')
  const perRaw = Number(spValue(sp, 'per'))
  const sortRaw = spValue(sp, SORT_PARAM)
  const sortName = sortRaw.replace(/^-/, '')
  const sortable = cfg.columns.some((c) => c.name === sortName && c.sortable)
  const filters: Record<string, string[]> = {}
  for (const f of cfg.filters) {
    const v = validValues(f, spValues(sp, filterParam(f.name)))
    if (v.length) filters[f.name] = v
  }
  const dates: PkQuery['dates'] = {}
  for (const d of cfg.dates) {
    const keys = dateParams(d.name)
    const from = validDate(spValue(sp, keys.from))
    const to = validDate(spValue(sp, keys.to))
    if (from || to) dates[d.name] = { ...(from ? { from } : {}), ...(to ? { to } : {}) }
  }
  return {
    q: spValue(sp, 'q').slice(0, 100),
    page: /^\d{1,6}$/.test(pageRaw) && Number(pageRaw) >= 1 ? Number(pageRaw) : 1,
    per: (PAGE_SIZES as readonly number[]).includes(perRaw) ? (perRaw as PageSize) : DEFAULT_PAGE_SIZE,
    sort: sortRaw && sortable ? sortRaw : undefined,
    filters,
    dates,
    companies: spValues(sp, COMPANY_PARAM)
      .filter((v) => ID_RE.test(v))
      .map(Number),
    linkWhere: parseLinkWhere(sp),
  }
}

/** The PT ids the list is narrowed to: URL ids ∩ the caller's selection (empty = the whole selection). */
export function companyScope(urlIds: readonly number[], selected: readonly number[] | null | undefined): number[] {
  const sel = new Set(selected ?? [])
  return urlIds.filter((id) => sel.has(id))
}

function nextDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Inclusive day range. Business dates are `YYYY-MM-DD` text (string order = date order); timestamps compare
 * against the company day (`tzOffset` like "+08:00", WITA) so "sampai 31 Okt" includes the whole 31st.
 */
export function dateWhere(d: PkDateFilter, range: { from?: string; to?: string }, tzOffset = '+08:00'): Where[] {
  const out: Where[] = []
  if (d.kind === 'business') {
    if (range.from) out.push({ [d.name]: { greater_than_equal: range.from } })
    if (range.to) out.push({ [d.name]: { less_than_equal: range.to } })
    return out
  }
  if (range.from) out.push({ [d.name]: { greater_than_equal: new Date(`${range.from}T00:00:00${tzOffset}`).toISOString() } })
  if (range.to) out.push({ [d.name]: { less_than: new Date(`${nextDay(range.to)}T00:00:00${tzOffset}`).toISOString() } })
  return out
}

function filterWhere(f: PkFilter, values: string[]): Where | null {
  if (values.length === 0) return null
  if (f.kind === 'boolean') {
    const yes = values.includes('true')
    const no = values.includes('false')
    if (yes && no) return null
    // an unset checkbox is stored as NULL in older rows → "Tidak" matches false and empty
    return yes ? { [f.name]: { equals: true } } : { or: [{ [f.name]: { equals: false } }, { [f.name]: { exists: false } }] }
  }
  return { [f.name]: { in: f.kind === 'relationship' ? values.map(Number) : values } }
}

/**
 * The `where` of one list request. `selected` = the caller's PT selection (company-context); a PT filter is
 * only ever a subset of it. `readable` limits the filters to fields the caller may read (field access).
 */
export function pkWhere(q: PkQuery, cfg: Pick<PkListConfig, 'filters' | 'dates' | 'hasCompany' | 'searchFields'>, ctx: { selected: readonly number[] | null; readable?: (field: string) => boolean; tzOffset?: string }): Where {
  const and: Where[] = []
  const readable = ctx.readable ?? (() => true)
  const text = searchWhere(cfg.searchFields.filter(readable), q.q)
  if (text) and.push(text)
  for (const f of cfg.filters) {
    if (!readable(f.name)) continue
    const w = filterWhere(f, q.filters[f.name] ?? [])
    if (w) and.push(w)
  }
  for (const d of cfg.dates) {
    const range = q.dates[d.name]
    if (range && readable(d.name)) and.push(...dateWhere(d, range, ctx.tzOffset))
  }
  if (cfg.hasCompany) {
    const ids = companyScope(q.companies, ctx.selected)
    if (ids.length) and.push({ company: { in: ids } })
  }
  if (q.linkWhere) and.push(q.linkWhere)
  return and.length ? { and } : {}
}

/** Active filters (for the Reset link and the empty-state text). */
export function pkFiltered(q: PkQuery): boolean {
  return q.q !== '' || Object.keys(q.filters).length > 0 || Object.keys(q.dates).length > 0 || q.companies.length > 0 || q.linkWhere !== null
}

/**
 * The parsed query in ListToolbar's shape (`filters`: param → comma-joined value) so the shared toolbar
 * renders the search box, checklists, date inputs and page size with the current values.
 */
export function toolbarQuery(q: PkQuery, cfg: Pick<PkListConfig, 'filters' | 'dates'>): ListQuery {
  const filters: Record<string, string> = {}
  for (const f of cfg.filters) filters[filterParam(f.name)] = (q.filters[f.name] ?? []).join(',')
  for (const d of cfg.dates) {
    const k = dateParams(d.name)
    filters[k.from] = q.dates[d.name]?.from ?? ''
    filters[k.to] = q.dates[d.name]?.to ?? ''
  }
  filters[COMPANY_PARAM] = q.companies.join(',')
  return { q: q.q, page: q.page, per: q.per, filters }
}

/** Next sort when a column header is clicked: asc → desc → asc (a new column starts ascending). */
export function nextSort(current: string | undefined, column: string): string {
  return current === column ? `-${column}` : column
}

// ---- column preferences (Payload `collection-<slug>` preference, `columns` = [{ accessor, active }]) ------

export type ColumnPref = { accessor: string; active: boolean }

/**
 * Visible columns in order: the saved preference (Payload's format, shared with its own list and the MC4 /
 * row-actions migrations) restricted to columns that still exist and the caller may read; without a usable
 * preference the collection's defaultColumns. "Aksi" is always last.
 */
export function activeColumns(pref: unknown, cfg: Pick<PkListConfig, 'columns' | 'defaultColumns'>, readable: (field: string) => boolean = () => true): string[] {
  const avail = new Set(cfg.columns.map((c) => c.name).filter((n) => n === 'id' || n === ROW_ACTIONS_FIELD || readable(n)))
  const saved = Array.isArray(pref) ? (pref as unknown[]).filter((p): p is ColumnPref => !!p && typeof p === 'object' && typeof (p as ColumnPref).accessor === 'string') : []
  let cols = saved.filter((p) => p.active && avail.has(p.accessor) && p.accessor !== ROW_ACTIONS_FIELD).map((p) => p.accessor)
  if (cols.length === 0) cols = cfg.defaultColumns.filter((n) => avail.has(n) && n !== ROW_ACTIONS_FIELD)
  if (cols.length === 0) cols = [...avail].filter((n) => n !== ROW_ACTIONS_FIELD).slice(0, 4)
  return avail.has(ROW_ACTIONS_FIELD) ? [...new Set(cols), ROW_ACTIONS_FIELD] : [...new Set(cols)]
}

/** The preference to save for a set of visible columns: every available column, visible ones first in order. */
export function columnsPreference(visible: readonly string[], all: readonly string[]): ColumnPref[] {
  const vis = visible.filter((n) => all.includes(n))
  return [...vis.map((accessor) => ({ accessor, active: true })), ...all.filter((n) => !vis.includes(n)).map((accessor) => ({ accessor, active: false }))]
}

/** The `columns` URL param of Payload's list (`["code","-name"]`, `-` = hidden) — upserted into the preference. */
export function columnsParam(visible: readonly string[], all: readonly string[]): string {
  return JSON.stringify(columnsPreference(visible, all).map((c) => (c.active ? c.accessor : `-${c.accessor}`)))
}

/** Visible columns after the Kolom dialog: the old order kept, newly ticked ones appended in field order. */
export function nextVisible(current: readonly string[], ticked: readonly string[], order: readonly string[]): string[] {
  const keep = current.filter((n) => ticked.includes(n))
  return [...keep, ...order.filter((n) => ticked.includes(n) && !keep.includes(n))]
}
