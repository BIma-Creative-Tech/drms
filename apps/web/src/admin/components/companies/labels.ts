import type { Payload } from 'payload'
import { cache } from 'react'

/**
 * PT labels for list cells / custom views (MC2-4). One grouped query per server render (React
 * `cache` = per request in RSC). SYSTEM-READ of code + name only: a cell only ever shows the PT of a
 * row the caller could already read (rows are filtered by access control), so no existence leak.
 */
export type CompanyLabel = { id: number; shortCode: string; name: string; active: boolean }

export const companyLabels = cache(async (payload: Pick<Payload, 'find'>): Promise<Map<number, CompanyLabel>> => {
  const res = await payload.find({
    collection: 'companies',
    depth: 0,
    pagination: false,
    sort: 'shortCode',
    select: { shortCode: true, name: true, active: true },
    overrideAccess: true, // SYSTEM-READ: PT code/name of rows the caller already sees
  })
  return new Map(res.docs.map((d) => [d.id as number, { id: d.id as number, shortCode: String(d.shortCode ?? d.id), name: String(d.name ?? ''), active: d.active !== false }]))
})

/** Active memberships per PT (list column "Anggota"). */
export const memberCounts = cache(async (payload: Pick<Payload, 'find'>): Promise<Map<number, number>> => {
  const res = await payload.find({
    collection: 'company-memberships',
    where: { active: { equals: true } },
    depth: 0,
    pagination: false,
    select: { company: true },
    overrideAccess: true, // SYSTEM-READ: member COUNT per PT (no identities)
  })
  const out = new Map<number, number>()
  for (const d of res.docs as unknown as Array<{ company: unknown }>) {
    const c = typeof d.company === 'number' ? d.company : (d.company as { id?: number } | null)?.id
    if (typeof c === 'number') out.set(c, (out.get(c) ?? 0) + 1)
  }
  return out
})

/** Relationship cell value → company id. */
export function companyIdOf(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v)
  if (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'number') return (v as { id: number }).id
  return undefined
}
