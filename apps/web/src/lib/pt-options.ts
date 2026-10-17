/**
 * DRMS UI feedback 17/10 #4: per-PT masters carry the same name in every PT (Material, Pemasangan, Normal …), so a
 * picker that lists several PTs at once shows "duplicates". One rule for every option list:
 *   (a) narrow to the form's PT whenever it is known;
 *   (b) while a list still spans several PTs, put the PT code before the label (`[CS1] Material`);
 *   (c) drop duplicate ids (safeguard).
 * Pure functions (no React, no Payload): used by server views (admin/views/pt.tsx re-exports them), client
 * components (line dialog, field forms) and the report filters (domain/reports/registry.ts).
 */

export type PtOption = { id: number | string; label: string; companyId?: number | null }

/** `[CS1] Material` — the PT tag of an option label. */
export const ptLabel = (code: string, label: string): string => `[${code}] ${label}`

/** The options belong to more than one PT. */
export function spansSeveralPts(list: ReadonlyArray<{ companyId?: number | null }>): boolean {
  const seen = new Set<number>()
  for (const o of list) if (typeof o.companyId === 'number') seen.add(o.companyId)
  return seen.size > 1
}

/** PT code by id from a plain map (client props); unknown → `#id`. */
export const codeFrom =
  (codes: Readonly<Record<number, string>> | undefined) =>
  (companyId: number): string =>
    codes?.[companyId] ?? `#${companyId}`

export type PtOptionsArgs = {
  /** PT code of a company id. */
  code: (companyId: number) => string
  /** The form's / filter's PT: only its options (no tag needed). `null` / `undefined` = not known. */
  company?: number | null
  /**
   * Tag the labels? Default: when the (narrowed) list spans several PTs. A view passes `pt.multi` (PT switcher on
   * more than one PT — the same rule as its PT column).
   */
  multi?: boolean
}

/** Options of one PT (when known), unique by id, labels PT-tagged while several PTs are listed. */
export function ptOptions<T extends PtOption>(list: readonly T[], args: PtOptionsArgs): T[] {
  const company = typeof args.company === 'number' ? args.company : undefined
  const seen = new Set<string>()
  const out: T[] = []
  for (const o of list) {
    if (company !== undefined && o.companyId !== company) continue
    const key = String(o.id)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(o)
  }
  const tag = company === undefined && (args.multi ?? spansSeveralPts(out))
  return tag ? out.map((o) => (typeof o.companyId === 'number' ? { ...o, label: ptLabel(args.code(o.companyId), o.label) } : o)) : out
}
