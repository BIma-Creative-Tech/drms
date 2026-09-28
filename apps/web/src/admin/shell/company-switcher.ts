/**
 * PT switcher state (ADR 0016 §5, wireframe mc/wireframes.md §1a) — pure functions shared by the
 * client switcher in the module bar, the cookie endpoint (POST /api/v1/me/companies) and the unit
 * tests. No React, no Payload runtime.
 *
 * Model: the user's ACTIVE memberships (`options`) and the effective selection (`selected`, ids ⊆
 * options). "Semua PT" = every option selected; it is stored as NO cookie (null), so a membership
 * added later is included automatically. The server always intersects the cookie with the
 * memberships (access/company-context.ts) — this module only shapes the request.
 */

export type SwitcherCompany = {
  id: number
  shortCode: string
  name: string
  /** Role labels of the user IN this PT (display only). */
  roles: string[]
}

export type SwitcherState = { options: SwitcherCompany[]; selected: number[] }

/** Selection restricted to the options, in option order, without duplicates. */
export function normalizeSelection(options: readonly SwitcherCompany[], selected: readonly number[]): number[] {
  const want = new Set(selected)
  return options.filter((o) => want.has(o.id)).map((o) => o.id)
}

export function isAll(options: readonly SwitcherCompany[], selected: readonly number[]): boolean {
  return options.length > 0 && normalizeSelection(options, selected).length === options.length
}

/**
 * Button label (wireframe §1a): all → "Semua PT"; one → "PT: CS1"; several → "PT: DRMS +1".
 * `compact` (≤ 768px): the code(s) only — "DRMS", "DRMS+1", "Semua".
 */
export function switcherLabel(options: readonly SwitcherCompany[], selected: readonly number[], compact = false): string {
  const sel = normalizeSelection(options, selected)
  if (options.length === 0) return ''
  if (options.length > 1 && sel.length === options.length) return compact ? 'Semua' : 'Semua PT'
  const first = options.find((o) => o.id === sel[0]) ?? options[0]!
  const more = Math.max(0, sel.length - 1)
  if (compact) return more > 0 ? `${first.shortCode}+${more}` : first.shortCode
  return more > 0 ? `PT: ${first.shortCode} +${more}` : `PT: ${first.shortCode}`
}

/** Accessible description of the current selection ("PT dipilih: DRMS, CS1"). */
export function selectionDescription(options: readonly SwitcherCompany[], selected: readonly number[]): string {
  const sel = normalizeSelection(options, selected)
  if (options.length > 1 && sel.length === options.length) return `Semua PT (${options.length}) dipilih`
  return `PT dipilih: ${options.filter((o) => sel.includes(o.id)).map((o) => o.shortCode).join(', ')}`
}

/** Toggles one PT (draft state inside the open switcher; may become empty → Terapkan disabled). */
export function toggleCompany(options: readonly SwitcherCompany[], selected: readonly number[], id: number): number[] {
  if (!options.some((o) => o.id === id)) return normalizeSelection(options, selected)
  const has = selected.includes(id)
  return normalizeSelection(options, has ? selected.filter((x) => x !== id) : [...selected, id])
}

/** "Semua PT saya": all selected → none (lets the user start from scratch), else all. */
export function toggleAll(options: readonly SwitcherCompany[], selected: readonly number[]): number[] {
  return isAll(options, selected) ? [] : options.map((o) => o.id)
}

/** State of the "Semua PT saya" checkbox. */
export function allState(options: readonly SwitcherCompany[], selected: readonly number[]): 'all' | 'some' | 'none' {
  const n = normalizeSelection(options, selected).length
  return n === 0 ? 'none' : n === options.length ? 'all' : 'some'
}

/** Terapkan: at least one PT, and something changed. */
export function canApply(options: readonly SwitcherCompany[], draft: readonly number[], current: readonly number[]): boolean {
  const d = normalizeSelection(options, draft)
  const c = normalizeSelection(options, current)
  return d.length > 0 && (d.length !== c.length || d.some((x, i) => x !== c[i]))
}

/** Body of POST /api/v1/me/companies: null = "Semua PT" (cookie cleared). */
export function requestBody(options: readonly SwitcherCompany[], draft: readonly number[]): { companyIds: number[] | null } {
  const d = normalizeSelection(options, draft)
  return { companyIds: d.length === options.length ? null : d }
}

/** Cookie value for a selection ("1,3"); null → clear the cookie (all memberships). */
export function cookieValue(memberIds: readonly number[], requested: readonly number[] | null): string | null {
  if (requested === null) return null
  const ids = [...new Set(requested)].filter((id) => memberIds.includes(id)).sort((a, b) => a - b)
  if (ids.length === 0 || ids.length === new Set(memberIds).size) return null
  return ids.join(',')
}

/** One year: the choice is a preference, not a credential (the server re-validates every request). */
export const SWITCHER_COOKIE_MAX_AGE = 365 * 24 * 60 * 60
