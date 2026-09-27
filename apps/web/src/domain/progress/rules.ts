/**
 * E4 (T11, US-10/US-29, G11): pure rules for project stages and progress reports. No Payload import
 * (unit-tested in tests/unit/e4-progress.test.ts, bundled into the OpenAPI generator).
 *
 * - Stage weights of a project sum to 100 % (G11). The stage editor (PUT /api/v1/projects/{id}/stages)
 *   saves the whole set at once and must hit 100 %; single-stage writes through the collection
 *   (admin panel) may build an incomplete set up to 100 %, but can never break a complete set.
 * - Project physical progress = Σ(weight × stage %) / 100 over ACTIVE stages (requirements US-10),
 *   rounded to 2 decimals; stage % changes only through progress reports (requirements §1 #7).
 */

/** Weights/percentages are numeric with ≤ 2 decimals; sums compare with this tolerance. */
export const WEIGHT_TOLERANCE = 0.01

/** US-10: at most 5 photos per report (requirements §9 "Maks. 5 per laporan"). */
export const MAX_PHOTOS = 5

/** Requirements §8 T11: a report is editable for 24 h (DB: editable_until = received_at + 24 h). */
export const EDIT_WINDOW_HOURS = 24

export const round2 = (v: number): number => Math.round(v * 100) / 100

export type StageLike = { weightPct?: number | null; progressPct?: number | null; active?: boolean | null }

export const isActive = (s: StageLike): boolean => s.active !== false

export function weightSum(stages: readonly StageLike[]): number {
  return round2(stages.filter(isActive).reduce((sum, s) => sum + (s.weightPct ?? 0), 0))
}

export const isComplete = (sum: number): boolean => Math.abs(sum - 100) < WEIGHT_TOLERANCE

/** Σ(weight × %) / 100 over active stages, 2 decimals, clamped to 0..100. */
export function projectProgress(stages: readonly StageLike[]): number {
  const raw = stages.filter(isActive).reduce((sum, s) => sum + ((s.weightPct ?? 0) * (s.progressPct ?? 0)) / 100, 0)
  return Math.min(100, Math.max(0, round2(raw)))
}

/** Percent with ≤ 2 decimals in 0..100. */
export function isPct(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 && Math.abs(round2(v) - v) < 1e-9
}

/**
 * Single-stage write through the collection (admin/REST): `before` = active weight sum of the
 * project before the write, `after` = after it. A complete set must stay complete; an incomplete
 * one may grow up to 100 %. Returns an error message or null.
 */
export function collectionWeightError(before: number, after: number): string | null {
  if (isComplete(before)) {
    return isComplete(after)
      ? null
      : `Total bobot tahapan project sudah 100%; perubahan ini membuatnya ${after}%. Ubah bobot lewat editor tahapan (semua tahapan disimpan sekaligus).`
  }
  return after > 100 + WEIGHT_TOLERANCE ? `Total bobot tahapan melebihi 100% (menjadi ${after}%).` : null
}

export type StageInput = { id?: number; name: string; weightPct: number; sequence: number }

/** Validation of a full stage set from the editor (G11). Paths are relative to the body. */
export function stageSetErrors(stages: readonly StageInput[]): Array<{ path: string; message: string }> {
  const errors: Array<{ path: string; message: string }> = []
  if (stages.length === 0) errors.push({ path: 'stages', message: 'Minimal satu tahapan.' })
  const seq = new Set<number>()
  const ids = new Set<number>()
  const names = new Set<string>()
  stages.forEach((s, i) => {
    if (!s.name || !s.name.trim()) errors.push({ path: `stages.${i}.name`, message: 'Nama tahapan wajib diisi.' })
    const key = s.name.trim().toLowerCase()
    if (key && names.has(key)) errors.push({ path: `stages.${i}.name`, message: 'Nama tahapan ganda.' })
    names.add(key)
    if (!isPct(s.weightPct)) errors.push({ path: `stages.${i}.weightPct`, message: 'Bobot 0–100 dengan maks. 2 desimal.' })
    if (!Number.isInteger(s.sequence) || s.sequence < 1) errors.push({ path: `stages.${i}.sequence`, message: 'Urutan bilangan bulat ≥ 1.' })
    else if (seq.has(s.sequence)) errors.push({ path: `stages.${i}.sequence`, message: 'Urutan ganda.' })
    seq.add(s.sequence)
    if (s.id !== undefined) {
      if (ids.has(s.id)) errors.push({ path: `stages.${i}.id`, message: 'Tahapan ganda.' })
      ids.add(s.id)
    }
  })
  const sum = round2(stages.reduce((t, s) => t + (typeof s.weightPct === 'number' ? s.weightPct : 0), 0))
  if (stages.length > 0 && !isComplete(sum)) errors.push({ path: 'stages', message: `Total bobot harus 100% (sekarang ${sum}%).` })
  return errors
}

/** Business date 'YYYY-MM-DD' of an instant in the company timezone. */
export function localDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Calendar days between two business dates (b − a). */
export function daysBetweenDates(a: string, b: string): number {
  const toUtc = (d: string) => {
    const [y, m, day] = d.split('-').map(Number) as [number, number, number]
    return Date.UTC(y, m - 1, day)
  }
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000)
}
