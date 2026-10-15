import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { memberCompanies, relId } from '@/access/roles'
import { kindOf } from '@/domain/field/rules'
import { getRequestTx } from '@/lib/tx'

import { rapState, type RapOverviewRow } from './overview'
import { rapRequiredFor } from './rules'
import { rapRoles } from './service'

type ProjectDoc = { id: number; code?: string | null; name?: string | null; kind?: string | null; status?: string | null; company?: unknown; budget?: number | null }
type AggRow = { project_id: number; active_items: string; priced: string; rap_value: string | null }

/**
 * DRMS 13/10 Wave 3 — rows of the "Proyek › RAP" index (pure part: overview.ts). Projects = the caller's project read
 * scope (`overrideAccess: false`; the RAB field drops out where `moneyRead` refuses it) in the selected PTs; RAP
 * figures = one aggregate over `rap_items` of those projects (PT-scoped). The RAP total is kept only where the caller
 * holds a RAP price role for the project (`rapRoles`, same rule as GET /projects/{id}/rap). Call inside a transaction.
 */
export async function loadRapOverview(req: PayloadRequest): Promise<RapOverviewRow[]> {
  const companies = memberCompanies(req)
  if (companies.length === 0) return []
  let docs: ProjectDoc[] = []
  try {
    const res = await req.payload.find({
      collection: 'projects',
      where: { company: { in: companies } },
      sort: 'code',
      depth: 0,
      pagination: false,
      select: { code: true, name: true, kind: true, status: true, company: true, budget: true },
      user: req.user,
      overrideAccess: false, // caller's project read scope (+ field access of the RAB)
      req,
    })
    docs = res.docs as unknown as ProjectDoc[]
  } catch (err) {
    if ((err as { status?: number }).status !== 403) throw err
  }
  if (docs.length === 0) return []
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT i.project_id,
           count(*) FILTER (WHERE coalesce(i.active, true))::text AS active_items,
           count(*) FILTER (WHERE coalesce(i.active, true) AND i.unit_price IS NOT NULL)::text AS priced,
           sum(round(i.volume * i.unit_price)) FILTER (WHERE coalesce(i.active, true) AND i.unit_price IS NOT NULL)::text AS rap_value
      FROM rap_items i
     WHERE i.company_id IN (${sql.join(
       companies.map((c) => sql`${c}`),
       sql`, `,
     )})
       AND i.project_id IN (${sql.join(
         docs.map((d) => sql`${d.id}`),
         sql`, `,
       )})
     GROUP BY i.project_id`)) as unknown as { rows: AggRow[] }
  const agg = new Map(r.rows.map((x) => [Number(x.project_id), x]))
  // D4 "RAP wajib" needs RAB > 0 even where the caller may not read the RAB (`rapRequired` is public on
  // GET /projects/{id}/rap): one flag per project, the amount itself never leaves this function
  const rab = (await tx.execute(sql`
    SELECT p.id FROM projects p
     WHERE p.company_id IN (${sql.join(
       companies.map((c) => sql`${c}`),
       sql`, `,
     )})
       AND p.id IN (${sql.join(
         docs.map((d) => sql`${d.id}`),
         sql`, `,
       )})
       AND coalesce(p.budget, 0) > 0`)) as unknown as { rows: Array<{ id: number }> }
  const withRab = new Set(rab.rows.map((x) => Number(x.id)))
  const out: RapOverviewRow[] = []
  for (const d of docs) {
    const companyId = relId(d.company) ?? -1
    const roles = await rapRoles(req, { id: d.id, company: companyId })
    const a = agg.get(d.id)
    const items = Number(a?.active_items ?? 0)
    const budget = typeof d.budget === 'number' ? d.budget : null
    const kind = kindOf(d.kind)
    out.push({
      id: d.id,
      code: d.code ?? '',
      name: d.name ?? '',
      kind,
      status: d.status ?? null,
      companyId,
      items,
      state: rapState(items, rapRequiredFor({ kind, budget: withRab.has(d.id) ? 1 : null })),
      prices: roles.prices,
      editor: (roles.director || roles.pm) && d.status !== 'arsip' && d.status !== 'dibatalkan',
      rapValue: roles.prices && a && Number(a.priced) > 0 && a.rap_value !== null ? Number(a.rap_value) : null,
      budget,
    })
  }
  return out
}

