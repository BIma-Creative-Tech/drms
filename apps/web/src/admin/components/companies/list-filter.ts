/**
 * Pure helpers of the PT chips above Payload list tables (CompanyListFilter, MC2-4 wireframe §4).
 * Next hands the list view a FLAT searchParams object (`{"where[or][0][and][0][company][equals]": "2"}`);
 * Payload parses it with qs. The chips replace the `where` (and reset `page`) and keep sort / limit /
 * search / columns.
 */
export type SearchParams = Record<string, string | string[] | undefined>

const COMPANY_KEY = /^where(?:\[or\]\[0\]\[and\]\[0\])?\[company\]\[(?:equals|in)\](?:\[0\])?$/

/** The PT the list is narrowed to by a chip (the only `where` condition), else null. */
export function activeCompanyFilter(sp: SearchParams): number | null {
  const whereKeys = Object.keys(sp).filter((k) => k.startsWith('where'))
  if (whereKeys.length !== 1 || !COMPANY_KEY.test(whereKeys[0]!)) return null
  const raw = sp[whereKeys[0]!]
  const v = Array.isArray(raw) ? raw[0] : raw
  return v && /^\d+$/.test(v) ? Number(v) : null
}

/** Any other `where` condition (built with Payload's Filter UI). */
export function hasOtherFilter(sp: SearchParams): boolean {
  return Object.keys(sp).some((k) => k.startsWith('where')) && activeCompanyFilter(sp) === null
}

/** List href narrowed to `companyId` (null = the whole switcher selection). */
export function companyFilterHref(basePath: string, sp: SearchParams, companyId: number | null): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (k.startsWith('where') || k === 'page' || v === undefined) continue
    for (const x of Array.isArray(v) ? v : [v]) q.append(k, x)
  }
  if (companyId !== null) q.set('where[or][0][and][0][company][equals]', String(companyId))
  const s = q.toString()
  return s ? `${basePath}?${s}` : basePath
}
