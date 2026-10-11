import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { relId } from '@/access/roles'
import { getRequestTx } from '@/lib/tx'

/**
 * P3 web helpers (server): the RAP items and resource types the daily-report form offers. Callers pass
 * projects / PTs already in the caller's scope (fieldProjects / fieldGate); every query is bound to them.
 */
export type FormItem = { id: number; code: string; description: string; kind: 'pekerjaan' | 'material'; uom: string; volume: number; realised: number; stage: string }
export type FormResource = { id: number; kind: 'tenaga' | 'alat'; name: string }

/** Active RAP items per project (ids of projects the caller may read, PTs of those projects). */
export async function formItemsOf(req: PayloadRequest, projects: ReadonlyArray<{ id: number; companyId: number }>): Promise<Record<string, FormItem[]>> {
  const out: Record<string, FormItem[]> = Object.fromEntries(projects.map((p) => [String(p.id), [] as FormItem[]]))
  if (projects.length === 0) return out
  const companies = [...new Set(projects.map((p) => p.companyId))]
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT i.id, i.project_id, i.code, i.description, i.kind::text AS kind, u.code AS uom, i.volume::text AS volume, coalesce(i.realised_qty, 0)::text AS realised, s.name AS stage
      FROM rap_items i JOIN uoms u ON u.id = i.uom_id JOIN project_stages s ON s.id = i.stage_id
     WHERE i.project_id IN (${sql.join(projects.map((p) => sql`${p.id}`), sql`, `)})
       AND i.company_id IN (${sql.join(companies.map((c) => sql`${c}`), sql`, `)})
       AND i.active IS NOT FALSE
     ORDER BY i.project_id, s.sequence NULLS LAST, s.id, i.sort_order, i.code`)) as unknown as {
    rows: Array<{ id: number; project_id: number; code: string; description: string; kind: 'pekerjaan' | 'material'; uom: string; volume: string; realised: string; stage: string }>
  }
  for (const x of r.rows) out[String(x.project_id)]?.push({ id: x.id, code: x.code, description: x.description, kind: x.kind, uom: x.uom, volume: Number(x.volume), realised: Number(x.realised), stage: x.stage })
  return out
}

/** Active resource types per PT. */
export async function formResourcesOf(req: PayloadRequest, companies: readonly number[]): Promise<Record<string, FormResource[]>> {
  const out: Record<string, FormResource[]> = Object.fromEntries(companies.map((c) => [String(c), [] as FormResource[]]))
  if (companies.length === 0) return out
  const res = await req.payload.find({
    collection: 'resource-types',
    where: { and: [{ company: { in: [...companies] } }, { active: { not_equals: false } }] },
    sort: 'code',
    depth: 0,
    pagination: false,
    overrideAccess: true, // SYSTEM-READ: masters of PTs the caller may report in
    req,
  })
  for (const d of res.docs as Array<{ id: number; kind: 'tenaga' | 'alat'; name: string; company?: unknown }>) out[String(relId(d.company))]?.push({ id: d.id, kind: d.kind, name: d.name })
  return out
}
