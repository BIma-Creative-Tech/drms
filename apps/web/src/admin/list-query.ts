/**
 * DRMS 10/10 D8: search + filter + pagination of the custom views' tables — the URL query is the state
 * (links, reload and Back keep it). Pure helpers (no React, unit-tested in tests/unit/d1010-tables.test.ts);
 * the UI is admin/components/list (ListToolbar = GET form + debounced auto-submit, Pager = links).
 *
 * Params: `q` (search text), `hal` (page, 1-based — the name the Kas book already used), `per` (page
 * size 20 / 50 / 100) and view-specific filter keys. Worklists that the domain returns whole (approval
 * inbox, transfer queue — bounded by status) are filtered/paged server-side in memory; growing tables
 * (cash book, LPJ queue) page in the database.
 */

export const PAGE_SIZES = [20, 50, 100] as const
export type PageSize = (typeof PAGE_SIZES)[number]
export const DEFAULT_PAGE_SIZE: PageSize = 20

type SP = Record<string, string | string[] | undefined> | undefined

/** First value of a search param, trimmed ('' when absent). */
export function spValue(sp: SP, key: string): string {
  const raw = sp?.[key]
  const v = Array.isArray(raw) ? raw[0] : raw
  return typeof v === 'string' ? v.trim() : ''
}

/** Max values of one multi-select filter / chars of one value (URL length + query size guard). */
export const MAX_FILTER_VALUES = 50
const MAX_VALUE_LEN = 100

/**
 * DRMS 13/10 Umum #4: every value of a (multi-select) filter param — `?jenis=a,b` (checklist dropdown) and the
 * repeated form `?jenis=a&jenis=b` (plain GET form) both give ['a', 'b']; trimmed, de-duplicated, capped.
 */
export function spValues(sp: SP, key: string): string[] {
  const raw = sp?.[key]
  const parts = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).flatMap((v) => (typeof v === 'string' ? v.split(',') : []))
  const out: string[] = []
  for (const p of parts) {
    const v = p.trim().slice(0, MAX_VALUE_LEN)
    if (v !== '' && !out.includes(v)) out.push(v)
    if (out.length >= MAX_FILTER_VALUES) break
  }
  return out
}

export type ListQuery = {
  q: string
  page: number
  per: PageSize
  /** Only the declared filter keys; multi-select values comma-joined ('' = not set) — split with filterValues. */
  filters: Record<string, string>
}

/** The values of one filter of a parsed query (DRMS 13/10 Umum #4: filters are multi-select). */
export function filterValues(q: Pick<ListQuery, 'filters'>, key: string): string[] {
  return spValues(q.filters, key)
}

/** filterValues restricted to `allowed` (unknown values from the URL are dropped). */
export function allowedValues<T extends string>(q: Pick<ListQuery, 'filters'>, key: string, allowed: readonly T[]): T[] {
  return filterValues(q, key).filter((v): v is T => (allowed as readonly string[]).includes(v))
}

/** Positive integer ids of a filter (e.g. PT / project ids); anything else is dropped. */
export function idValues(q: Pick<ListQuery, 'filters'>, key: string): number[] {
  return filterValues(q, key)
    .filter((v) => /^[1-9][0-9]{0,9}$/.test(v))
    .map(Number)
}

/** Parses `q` / `hal` / `per` + the declared filter keys; bad values fall back to the defaults. */
export function parseListQuery(sp: SP, filterKeys: readonly string[] = [], opts: { pageKey?: string } = {}): ListQuery {
  const q = spValue(sp, 'q').slice(0, 100)
  const pageRaw = spValue(sp, opts.pageKey ?? 'hal')
  const page = /^\d{1,6}$/.test(pageRaw) && Number(pageRaw) >= 1 ? Number(pageRaw) : 1
  const perRaw = Number(spValue(sp, 'per'))
  const per = (PAGE_SIZES as readonly number[]).includes(perRaw) ? (perRaw as PageSize) : DEFAULT_PAGE_SIZE
  const filters: Record<string, string> = {}
  for (const k of filterKeys) filters[k] = spValues(sp, k).join(',')
  return { q, page, per, filters }
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('id')

/** Every whitespace-separated token of `q` occurs in one of the texts (case/diacritics-insensitive). */
export function matchesQuery(texts: ReadonlyArray<string | number | null | undefined>, q: string): boolean {
  const tokens = fold(q).split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const hay = fold(texts.filter((t) => t !== null && t !== undefined && t !== '').join(' \u0001 '))
  return tokens.every((t) => hay.includes(t))
}

export type PageOf<T> = { items: T[]; page: number; per: number; total: number; totalPages: number; from: number; to: number }

/** One page of an in-memory list; a page beyond the end clamps to the last page. */
export function paginate<T>(all: readonly T[], page: number, per: number): PageOf<T> {
  const total = all.length
  const totalPages = Math.max(1, Math.ceil(total / per))
  const p = Math.min(Math.max(1, page), totalPages)
  const start = (p - 1) * per
  const items = all.slice(start, start + per)
  return { items, page: p, per, total, totalPages, from: total === 0 ? 0 : start + 1, to: start + items.length }
}

/** PageOf from a Payload paginated find result. */
export function pageOfFind<T>(res: { docs: T[]; page?: number; totalDocs: number; totalPages: number; limit: number }): PageOf<T> {
  const page = res.page ?? 1
  const start = (page - 1) * res.limit
  return { items: res.docs, page, per: res.limit, total: res.totalDocs, totalPages: Math.max(1, res.totalPages), from: res.totalDocs === 0 ? 0 : start + 1, to: start + res.docs.length }
}

/**
 * URL of the same view with `patch` applied to the current params (`null`/'' removes a key). Any
 * change other than the page itself resets the page to 1.
 */
export function listHref(path: string, sp: SP, patch: Record<string, string | number | null | undefined>, opts: { pageKey?: string } = {}): string {
  const pageKey = opts.pageKey ?? 'hal'
  const params = new URLSearchParams()
  for (const [k, raw] of Object.entries(sp ?? {})) {
    // a repeated param (multi-select of a plain GET form) is kept as one comma-joined value
    const v = Array.isArray(raw) ? raw.filter((x) => typeof x === 'string' && x !== '').join(',') : raw
    if (typeof v === 'string' && v !== '') params.set(k, v)
  }
  const touchesOther = Object.keys(patch).some((k) => k !== pageKey)
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') params.delete(k)
    else params.set(k, String(v))
  }
  if (touchesOther && !(pageKey in patch)) params.delete(pageKey)
  if (params.get(pageKey) === '1') params.delete(pageKey)
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

/** True when the query narrows the list (search text or any filter set). */
export function isFiltered(q: ListQuery): boolean {
  return q.q !== '' || Object.values(q.filters).some((v) => v !== '')
}

export { searchWhere } from '@/lib/text-search'
