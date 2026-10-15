/**
 * DRMS 13/10 Wave 3 "Proyek › RAP" (client: "Form RAP + upload, submenu sendiri di bawah Proyek"): the RAP index —
 * every project the caller may read with its RAP state (ada / belum), and for the RAP price roles the RAP total
 * against the RAB. Pure module (no Payload, no DB; loader: overview-load.ts), unit-tested.
 *
 * Money follows the existing rules exactly: the RAP total only when the caller holds a RAP price role for the
 * project (`rapRoles(...).prices`: Direktur / Admin / Finance of the PT, PM of the project team), the RAB only when
 * the `projects.budget` field was readable (`moneyRead`, MONEY_ROLES of the PT). Staff gets neither.
 */

/** ada = ≥ 1 active item; wajib = no item yet but the project needs one (RAB > 0 or konstruksi); opsional = no RAB. */
export const RAP_STATES = ['ada', 'wajib', 'opsional'] as const
export type RapState = (typeof RAP_STATES)[number]
export const RAP_STATE_LABELS: Record<RapState, string> = { ada: 'Sudah ada RAP', wajib: 'Belum ada RAP (wajib)', opsional: 'Belum ada RAP (opsional)' }

export function rapState(activeItems: number, required: boolean): RapState {
  return activeItems > 0 ? 'ada' : required ? 'wajib' : 'opsional'
}

export type RapOverviewRow = {
  id: number
  code: string
  name: string
  kind: string
  status: string | null
  companyId: number
  /** Active RAP items. */
  items: number
  state: RapState
  /** The caller holds a RAP price role for this project. */
  prices: boolean
  /** The caller may edit the RAP (Direktur/Admin of the PT or the project PM; not archived). Lock is per project page. */
  editor: boolean
  /** Σ round(volume × harga satuan) of the active priced items (price roles only; null = none priced / no access). */
  rapValue: number | null
  /** RAB (projects.budget) when readable by the caller, else null. */
  budget: number | null
}

/** RAP total as % of the RAB (2 decimals); null without both figures or a RAB of 0. */
export function rapVsRab(rapValue: number | null, budget: number | null): number | null {
  if (rapValue === null || budget === null || !(budget > 0)) return null
  return Math.round((rapValue / budget) * 10000) / 100
}

/** RAP total above the RAB (warning only, like loadRap `totals.overBudget`). */
export const rapOverRab = (rapValue: number | null, budget: number | null): boolean => rapValue !== null && budget !== null && rapValue > budget

export type OverviewFilter = { companies?: readonly number[]; statuses?: readonly string[]; states?: readonly RapState[] }

/**
 * Rows of the filters (every multi-select: a row matches ANY ticked value). Archived projects only when "Arsip" is
 * ticked in the status filter (the RAP of an archived project cannot change any more).
 */
export function filterOverview(rows: readonly RapOverviewRow[], f: OverviewFilter): RapOverviewRow[] {
  const companies = f.companies ?? []
  const statuses = f.statuses ?? []
  const states = f.states ?? []
  return rows.filter(
    (r) =>
      (companies.length === 0 || companies.includes(r.companyId)) &&
      (statuses.length === 0 ? r.status !== 'arsip' && r.status !== 'dibatalkan' : statuses.includes(r.status ?? '')) &&
      (states.length === 0 || states.includes(r.state)),
  )
}

export type OverviewTotals = { projects: number; withRap: number; items: number; rapValue: number | null; budget: number | null }

/**
 * Footer row of the index table (client: totals at the bottom of tables): counts of every row, Σ RAP of the rows the
 * caller sees prices of, Σ RAB of the rows with a readable RAB (null when none — the money cells stay empty).
 */
export function overviewTotals(rows: readonly RapOverviewRow[]): OverviewTotals {
  const priced = rows.filter((r) => r.prices && r.rapValue !== null)
  const budgets = rows.filter((r) => r.budget !== null)
  return {
    projects: rows.length,
    withRap: rows.filter((r) => r.state === 'ada').length,
    items: rows.reduce((s, r) => s + r.items, 0),
    rapValue: priced.length ? priced.reduce((s, r) => s + (r.rapValue ?? 0), 0) : null,
    budget: budgets.length ? budgets.reduce((s, r) => s + (r.budget ?? 0), 0) : null,
  }
}
