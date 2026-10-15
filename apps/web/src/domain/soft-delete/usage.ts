import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { getRequestTx } from '@/lib/tx'

import { ignoredReference, TABLE_LABELS, type SoftDeleteEntry } from './registry'

type SQL = ReturnType<typeof sql>

/**
 * D1610 (ADR 0030): "is this row used?" — generic, driven by the database's own foreign keys (pg_catalog), so every
 * table that can point at a master / project counts, including hand-written tables (inter-PT loans) and tables
 * added later. A row is used when ANY non-ignored FK column of another table holds its id (rows of that table
 * that are themselves soft-deleted do not count). `owned` children (registry) are not a use; their own references
 * are. Runs inside the request transaction (getRequestTx). Read-only.
 */

export type FkRef = { table: string; column: string; hasIsDeleted: boolean }
export type UsageLine = { table: string; label: string; count: number }

const IDENT = /^[a-z_][a-z0-9_]*$/
const fkCache = new Map<string, FkRef[]>()

async function exec<T>(req: PayloadRequest, q: SQL): Promise<T[]> {
  const tx = await getRequestTx(req)
  return ((await tx.execute(q)) as unknown as { rows: T[] }).rows
}

/** Single-column FKs of the public schema that reference `table` (cached per process: the schema changes only with a deploy). */
export async function referencesTo(req: PayloadRequest, table: string): Promise<FkRef[]> {
  const hit = fkCache.get(table)
  if (hit) return hit
  const rows = await exec<{ ref_table: string; ref_column: string; has_is_deleted: boolean }>(
    req,
    sql`SELECT cl.relname AS ref_table, a.attname AS ref_column,
          EXISTS (SELECT 1 FROM pg_attribute d WHERE d.attrelid = cl.oid AND d.attname = 'is_deleted' AND NOT d.attisdropped) AS has_is_deleted
        FROM pg_constraint c
        JOIN pg_class cl ON cl.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND cardinality(c.conkey) = 1
          AND c.confrelid = (SELECT t.oid FROM pg_class t JOIN pg_namespace tn ON tn.oid = t.relnamespace WHERE tn.nspname = 'public' AND t.relname = ${table})
        ORDER BY 1, 2`,
  )
  const refs = rows.filter((r) => IDENT.test(r.ref_table) && IDENT.test(r.ref_column)).map((r) => ({ table: r.ref_table, column: r.ref_column, hasIsDeleted: r.has_is_deleted === true }))
  fkCache.set(table, refs)
  return refs
}

/** Test seam: forget the cached FK lists. */
export function resetUsageCache(): void {
  fkCache.clear()
}

/** "Pengajuan", "Kas", … — the plural label of the Payload collection that owns `table` (sub-tables included). */
export function tableLabel(req: PayloadRequest, table: string): string {
  if (TABLE_LABELS[table]) return TABLE_LABELS[table]!
  let best: { len: number; label: string } | null = null
  for (const c of req.payload.config.collections) {
    const own = c.slug.replace(/-/g, '_')
    if (table !== own && !table.startsWith(`${own}_`)) continue
    const plural = c.labels?.plural
    const label = typeof plural === 'string' ? plural : plural && typeof plural === 'object' ? ((plural as Record<string, string>).id ?? Object.values(plural as Record<string, string>)[0] ?? c.slug) : c.slug
    if (!best || own.length > best.len) best = { len: own.length, label }
  }
  return best?.label ?? table
}

async function countRefs(req: PayloadRequest, refs: FkRef[], ids: number[]): Promise<Array<{ table: string; id: number; n: number }>> {
  if (refs.length === 0 || ids.length === 0) return []
  const arr = sql`${`{${ids.join(',')}}`}::int[]`
  const parts = refs.map((r) => {
    const t = sql.identifier(r.table)
    const c = sql.identifier(r.column)
    return sql`SELECT ${r.table}::text AS ref_table, ${c}::int AS id, count(*)::int AS n FROM ${t} WHERE ${c} = ANY(${arr})${r.hasIsDeleted ? sql` AND is_deleted IS NOT TRUE` : sql``} GROUP BY ${c}`
  })
  const rows = await exec<{ ref_table: string; id: number; n: number }>(req, sql.join(parts, sql` UNION ALL `))
  return rows.map((r) => ({ table: r.ref_table, id: Number(r.id), n: Number(r.n) }))
}

function addLine(out: Map<number, UsageLine[]>, id: number, line: UsageLine) {
  const list = out.get(id) ?? []
  const same = list.find((l) => l.label === line.label)
  if (same) same.count += line.count
  else list.push({ ...line })
  out.set(id, list)
}

/**
 * Usage of each id of `entry.table`: id → lines ("Pengajuan × 3"); ids without a line are unused. One UNION query
 * per level (the row, then its owned children).
 */
export async function usageOf(req: PayloadRequest, entry: SoftDeleteEntry, ids: readonly number[]): Promise<Map<number, UsageLine[]>> {
  const out = new Map<number, UsageLine[]>()
  const wanted = [...new Set(ids.filter((x) => Number.isSafeInteger(x) && x > 0))]
  if (wanted.length === 0) return out
  const owned = new Set(entry.owned.map((o) => `${o.table}.${o.column}`))
  const refs = (await referencesTo(req, entry.table)).filter((r) => !ignoredReference(entry.table, r.table, r.column) && !owned.has(`${r.table}.${r.column}`))
  for (const r of await countRefs(req, refs, wanted)) addLine(out, r.id, { table: r.table, label: tableLabel(req, r.table), count: r.n })

  for (const child of entry.owned) {
    if (!IDENT.test(child.table) || !IDENT.test(child.column)) continue
    const t = sql.identifier(child.table)
    const c = sql.identifier(child.column)
    const childHasFlag = child.cascade // cascade children carry the soft-delete columns (registry)
    const kids = await exec<{ id: number; parent: number }>(
      req,
      sql`SELECT id, ${c}::int AS parent FROM ${t} WHERE ${c} = ANY(${sql`${`{${wanted.join(',')}}`}::int[]`})${childHasFlag ? sql` AND is_deleted IS NOT TRUE` : sql``}`,
    )
    if (kids.length === 0) continue
    const parentOf = new Map(kids.map((k) => [Number(k.id), Number(k.parent)]))
    const childRefs = (await referencesTo(req, child.table)).filter((r) => !ignoredReference(child.table, r.table, r.column) && r.table !== entry.table)
    for (const r of await countRefs(req, childRefs, [...parentOf.keys()])) {
      const parent = parentOf.get(r.id)
      if (parent !== undefined) addLine(out, parent, { table: r.table, label: tableLabel(req, r.table), count: r.n })
    }
  }
  return out
}
