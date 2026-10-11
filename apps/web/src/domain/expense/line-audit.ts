/**
 * Per-line audit diff for expense request lines (requirements v1.1 §8 T1 "baris item
 * ditambah/diubah/dihapus", audit column `line_no`). Rows are matched by their stable array row
 * id. Pure module (unit-tested).
 */
import { normalizeValue } from '@/audit/hooks'

export type AuditLine = Record<string, unknown> & { id?: string | null }

export const LINE_FIELDS = ['description', 'qty', 'uom', 'unitPrice', 'total', 'receiptAmount', 'category', 'vehicle', 'notes'] as const

export type LineChange = {
  kind: 'added' | 'removed' | 'changed'
  lineNo: number
  field: string
  oldValue?: unknown
  newValue?: unknown
}

function pick(l: AuditLine): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of LINE_FIELDS) out[f] = normalizeValue(l[f])
  return out
}

export function diffLines(prev: readonly AuditLine[], next: readonly AuditLine[]): LineChange[] {
  const out: LineChange[] = []
  const prevById = new Map(prev.map((l, i) => [String(l.id ?? `#${i}`), { l, no: i + 1 }]))
  const nextIds = new Set<string>()
  next.forEach((l, i) => {
    const id = String(l.id ?? `#new${i}`)
    nextIds.add(id)
    const before = prevById.get(id)
    if (!before) {
      out.push({ kind: 'added', lineNo: i + 1, field: 'lines', newValue: pick(l) })
      return
    }
    const a = pick(before.l)
    const b = pick(l)
    for (const f of LINE_FIELDS) {
      if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) out.push({ kind: 'changed', lineNo: i + 1, field: `lines.${f}`, oldValue: a[f], newValue: b[f] })
    }
  })
  for (const [id, { l, no }] of prevById) {
    if (!nextIds.has(id)) out.push({ kind: 'removed', lineNo: no, field: 'lines', oldValue: pick(l) })
  }
  return out
}
