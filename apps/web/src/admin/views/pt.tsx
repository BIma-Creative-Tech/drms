import type { PayloadRequest } from 'payload'
import React from 'react'

import { companyContextOf, memberCompanies } from '@/access/roles'

import { companyLabels, type CompanyLabel } from '../components/companies/labels'

/**
 * PT column / badge of the custom admin views (MC2-4, wireframe §4 "Kolom PT … hanya tampil bila
 * pilihan > 1 PT"). Queue items of the backend (MC2-1, `mc2-contract.md` §3) carry `company { id,
 * shortCode, name }`; other rows (Kas book, attendance, K-09, voidable transfers) carry `companyId`.
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

/** Company of a queue item / row: the backend `company` ref (`mc2-contract.md` §3) or a plain `companyId`. */
export function itemCompany(item: { company?: { id: number } | number | null; companyId?: number | null }): number | null {
  const c = item.company
  if (c && typeof c === 'object') return c.id
  if (typeof c === 'number') return c
  return typeof item.companyId === 'number' ? item.companyId : null
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

/**
 * QA-MC4-14: `?pt=` (repeatable / comma list) names a PT outside the caller's selection (switcher ∩
 * active memberships). The /api/v1 reports answer 403 COMPANY_NOT_ALLOWED; the panel views show
 * `PtNotAllowed` (shared.tsx) instead of silently narrowing the page to nothing.
 */
export function foreignPtParam(req: PayloadRequest, sp: Record<string, string | string[] | undefined> | undefined): boolean {
  const raw = sp?.pt
  const ids = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw])
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter((v) => /^\d{1,9}$/.test(v))
    .map(Number)
  if (ids.length === 0) return false
  const selected = memberCompanies(req)
  return ids.some((id) => !selected.includes(id))
}
