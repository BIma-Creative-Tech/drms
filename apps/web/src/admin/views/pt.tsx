import type { PayloadRequest } from 'payload'
import React from 'react'

import { companyContextOf, relId } from '@/access/roles'

import { companyLabels, type CompanyLabel } from '../components/companies/labels'

/**
 * PT column / badge of the custom admin views (MC2-4, wireframe §4 "Kolom PT … hanya tampil bila
 * pilihan > 1 PT"). Queue items of the backend (MC2-1, `mc2-contract.md`) carry `company { id,
 * shortCode, name }`; until every payload does, the views fall back to the `company` column of the
 * rows they already read (`requestCompanies`, caller's access).
 */
export type PtRef = { id: number; shortCode: string; name?: string | null }

export type PtView = {
  /** More than one PT selected in the switcher → show the PT column. */
  multi: boolean
  selected: number[]
  labels: Map<number, CompanyLabel>
  ref: (id: number | null | undefined) => PtRef | null
}

export async function ptView(req: PayloadRequest): Promise<PtView> {
  const ctx = companyContextOf(req.user)
  const selected = ctx?.selected ?? []
  const labels = selected.length > 0 ? await companyLabels(req.payload) : new Map<number, CompanyLabel>()
  return {
    multi: selected.length > 1,
    selected,
    labels,
    ref: (id) => {
      if (typeof id !== 'number') return null
      const l = labels.get(id)
      return l ? { id, shortCode: l.shortCode, name: l.name } : { id, shortCode: `#${id}` }
    },
  }
}

/** expense-request id → company id, read with the caller's access (fallback for items without `company`). */
export async function requestCompanies(req: PayloadRequest, ids: readonly number[]): Promise<Map<number, number>> {
  const uniq = [...new Set(ids)]
  if (uniq.length === 0) return new Map()
  const res = await req.payload.find({
    collection: 'expense-requests',
    where: { id: { in: uniq } },
    depth: 0,
    pagination: false,
    select: { company: true },
    user: req.user,
    overrideAccess: false,
    req,
  })
  const out = new Map<number, number>()
  for (const d of res.docs as unknown as Array<{ id: number; company?: unknown }>) {
    const c = relId(d.company)
    if (c !== undefined) out.set(d.id, c)
  }
  return out
}

/** Company of a queue item: the backend `company` ref when present, else the fallback map. */
export function itemCompany(item: { id: number; company?: unknown }, fallback: ReadonlyMap<number, number>): number | null {
  const c = item.company
  if (c && typeof c === 'object' && typeof (c as { id?: unknown }).id === 'number') return (c as { id: number }).id
  if (typeof c === 'number') return c
  return fallback.get(item.id) ?? null
}

/** PT short-code chip (same look as the list column, custom.scss .pk-pt-chip). */
export function PtChip({ pt }: { pt: PtRef | null }) {
  if (!pt) return <span>—</span>
  return (
    <span className="pk-pt-chip" title={pt.name ?? undefined} data-pk-company={pt.shortCode}>
      {pt.shortCode}
    </span>
  )
}

/** "Menampilkan DRMS, CS1" line under a view title (only with > 1 PT). */
export function PtScopeNote({ pt }: { pt: PtView }) {
  if (!pt.multi) return null
  const codes = pt.selected.map((id) => pt.ref(id)?.shortCode ?? `#${id}`).sort()
  return (
    <p className="pk-pt-scope" data-pk-pt-scope>
      Menampilkan PT: {codes.map((c) => (
        <span key={c} className="pk-pt-chip">
          {c}
        </span>
      ))}
    </p>
  )
}

/** Cash accounts of one PT (transfer / settlement forms must never offer an account of another PT). */
export function accountsOf<T extends { company: number | null }>(accounts: readonly T[], company: number | null): T[] {
  return company === null ? [...accounts] : accounts.filter((a) => a.company === company)
}
