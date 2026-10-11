/** DRMS 10/10 8i: pure helper of LinesTotalPreview (unit-tested). */

/** Σ of the integer line totals in the form state (`lines.<i>.total`); invalid / empty rows count 0. */
export function sumLineTotals(fields: Record<string, { value?: unknown } | undefined>): { total: number; rows: number } {
  let total = 0
  let rows = 0
  for (const [k, f] of Object.entries(fields)) {
    if (!/^lines\.\d+\.total$/.test(k)) continue
    rows++
    const v = f?.value
    if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) total += v
  }
  return { total, rows }
}

