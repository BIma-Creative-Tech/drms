import type { CollectionSlug, PayloadRequest, Where } from 'payload'

import { withEffectiveRadius } from '@/domain/attendance/calendar'

import { MASTER_TYPES, MastersQuery, type MasterType } from '../schemas'
import { HttpError, json, problem, v1 } from '../http'

const LIMIT = 500

/** type → collection + whitelisted fields (never internal/sensitive columns like odoo refs). */
const MAP: Record<MasterType, { collection: CollectionSlug; fields: string[] }> = {
  projects: { collection: 'projects', fields: ['code', 'name', 'client', 'address', 'lat', 'lng', 'radiusM', 'pm', 'status', 'startDate', 'targetDate', 'progressPct'] },
  'project-stages': { collection: 'project-stages', fields: ['project', 'name', 'weightPct', 'sequence', 'progressPct', 'active'] },
  'cost-centers': { collection: 'cost-centers', fields: ['code', 'name', 'type', 'manager', 'lat', 'lng', 'radiusM', 'active'] },
  'expense-categories': { collection: 'expense-categories', fields: ['code', 'name', 'defaultUom', 'allowedUoms', 'requiresVehicle', 'active'] },
  uoms: { collection: 'uoms', fields: ['code', 'name', 'category', 'active'] },
  vehicles: { collection: 'vehicles', fields: ['plateNo', 'plateDisplay', 'type', 'brandModel', 'costCenter', 'project', 'active'] },
  employees: { collection: 'employees', fields: ['code', 'name', 'nickname', 'position', 'active'] },
  banks: { collection: 'banks', fields: ['code', 'name', 'active'] },
  'bank-accounts': { collection: 'employee-bank-accounts', fields: ['employee', 'bank', 'accountNo', 'accountHolder', 'isDefault', 'verificationStatus', 'active'] },
  'work-schedules': { collection: 'work-schedules', fields: ['name', 'startTime', 'endTime', 'lateToleranceMin', 'workDays', 'active'] },
  holidays: { collection: 'holidays', fields: ['date', 'name'] },
  'team-assignments': { collection: 'team-assignments', fields: ['employee', 'project', 'costCenter', 'roleInProject', 'startDate', 'endDate'] },
}

function pick(doc: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { id: doc.id, uuid: doc.uuid ?? undefined, updatedAt: doc.updatedAt }
  for (const f of fields) {
    const v = doc[f]
    out[f] = v === undefined ? null : v
  }
  return out
}

async function loadType(req: PayloadRequest, type: MasterType, since?: string) {
  const { collection, fields } = MAP[type]
  const where: Where | undefined = since ? { updatedAt: { greater_than: since } } : undefined
  try {
    const res = await req.payload.find({
      collection,
      where,
      sort: 'updatedAt',
      limit: LIMIT,
      depth: 0,
      overrideAccess: false, // access control of the collection applies (scope own/team/assigned/all)
      req,
    })
    let items = res.docs.map((d) => pick(d as unknown as Record<string, unknown>, fields))
    if (type === 'projects' || type === 'cost-centers') {
      const s = (await req.payload.findGlobal({ slug: 'company-settings', depth: 0, overrideAccess: true /* SYSTEM-READ: default geofence radius */, req })) as { defaultGeofenceRadiusM?: number | null }
      items = items.map((i) => withEffectiveRadius(i, s.defaultGeofenceRadiusM))
    }
    return { items, hasMore: res.hasNextPage }
  } catch (err) {
    // Access `false` (nothing in scope, e.g. staff without assignments) → Forbidden → empty list.
    if ((err as { status?: number }).status === 403) return { items: [], hasMore: false }
    throw err
  }
}

/**
 * GET /api/v1/masters?types=a,b&since=ISO — master data for the APK (architecture §6.3), filtered
 * by each collection's read access for the caller. Deactivated rows are included (`active`) so
 * the APK can hide them; delta sync via `since` (ordered by updatedAt, ≤ 500 per type).
 */
export const mastersEndpoint = v1({
  path: '/masters',
  method: 'get',
  handler: async ({ req }) => {
    const parsed = MastersQuery.safeParse({
      types: req.searchParams.get('types') ?? undefined,
      since: req.searchParams.get('since') ?? undefined,
    })
    if (!parsed.success) return problem(400, 'Bad Request', { errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) })
    const requested = parsed.data.types ? parsed.data.types.split(',') : [...MASTER_TYPES]
    const unknown = requested.filter((t) => !(MASTER_TYPES as readonly string[]).includes(t))
    if (unknown.length) throw new HttpError(400, 'Bad Request', { detail: `Unknown types: ${unknown.join(', ')}` })
    const serverTime = new Date().toISOString()
    const types: Record<string, { items: unknown[]; hasMore: boolean }> = {}
    for (const t of new Set(requested) as Set<MasterType>) types[t] = await loadType(req, t, parsed.data.since)
    return json({ serverTime, types })
  },
})
