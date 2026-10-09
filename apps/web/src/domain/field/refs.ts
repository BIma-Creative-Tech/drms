import type { PayloadRequest } from 'payload'

import { relId } from '@/access/roles'
import { displayNames } from '@/domain/companies'

import { kindOf, unitLabel, type ProjectKind } from './rules'

/**
 * Batch name resolution for the field-report DTOs (one query per referenced collection per page).
 * SYSTEM-READ of records referenced by documents the caller may read.
 */
export type ProjectName = { id: number; code: string | null; name: string | null; kind: ProjectKind | null }
export type UnitName = { id: number; label: string | null; unitCode: string | null; plateDisplay: string | null; type: string | null; owner: 'sendiri' | 'pelanggan' | null }
export type Names = { project: Map<number, ProjectName>; unit: Map<number, UnitName>; user: Map<number, string>; client: Map<number, string> }

const ids = (docs: readonly Record<string, unknown>[], key: string) => [...new Set(docs.map((d) => relId(d[key])).filter((x): x is number => x !== undefined))]

export async function namesOf(req: PayloadRequest, docs: readonly Record<string, unknown>[], keys: { users?: string[]; clients?: string[] } = {}): Promise<Names> {
  const out: Names = { project: new Map(), unit: new Map(), user: new Map(), client: new Map() }
  const p = ids(docs, 'project')
  if (p.length) {
    const r = await req.payload.find({ collection: 'projects', where: { id: { in: p } }, depth: 0, pagination: false, select: { code: true, name: true, kind: true }, overrideAccess: true /* SYSTEM-READ: names */, req })
    for (const d of r.docs as Array<{ id: number; code?: string; name?: string; kind?: string }>) out.project.set(d.id, { id: d.id, code: d.code ?? null, name: d.name ?? null, kind: kindOf(d.kind) })
  }
  const u = ids(docs, 'unit')
  if (u.length) {
    const r = await req.payload.find({
      collection: 'vehicles',
      where: { id: { in: u } },
      depth: 0,
      pagination: false,
      select: { unitCode: true, plateDisplay: true, plateNo: true, type: true, owner: true },
      overrideAccess: true, // SYSTEM-READ: names
      req,
    })
    for (const d of r.docs as Array<{ id: number; unitCode?: string | null; plateDisplay?: string | null; plateNo?: string | null; type?: string | null; owner?: 'sendiri' | 'pelanggan' | null }>) {
      out.unit.set(d.id, { id: d.id, label: unitLabel(d), unitCode: d.unitCode ?? null, plateDisplay: d.plateDisplay ?? d.plateNo ?? null, type: d.type ?? null, owner: d.owner ?? null })
    }
  }
  const users = [...new Set((keys.users ?? ['reporter', 'correctedBy']).flatMap((k) => ids(docs, k)))]
  if (users.length) for (const [id, name] of await displayNames(req, users)) out.user.set(id, name)
  const clients = [...new Set((keys.clients ?? ['client']).flatMap((k) => ids(docs, k)))]
  if (clients.length) {
    const r = await req.payload.find({ collection: 'clients', where: { id: { in: clients } }, depth: 0, pagination: false, select: { name: true }, overrideAccess: true /* SYSTEM-READ: names */, req })
    for (const d of r.docs as Array<{ id: number; name?: string }>) out.client.set(d.id, d.name ?? '')
  }
  return out
}

export const projectRef = (n: Names, v: unknown): ProjectName => {
  const id = relId(v)!
  return n.project.get(id) ?? { id, code: null, name: null, kind: null }
}
export const unitRef = (n: Names, v: unknown): UnitName => {
  const id = relId(v)!
  return n.unit.get(id) ?? { id, label: null, unitCode: null, plateDisplay: null, type: null, owner: null }
}
export const userRef = (n: Names, v: unknown): { id: number; name: string | null } | null => {
  const id = relId(v)
  return id === undefined ? null : { id, name: n.user.get(id) ?? null }
}
export const clientRef = (n: Names, v: unknown): { id: number; name: string | null } | null => {
  const id = relId(v)
  return id === undefined ? null : { id, name: n.client.get(id) ?? null }
}

export const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))
export const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
