import type { PayloadRequest, Where } from 'payload'

import { relId } from '@/access/roles'

import { mayReadRates } from './access'
import { companyDay, fail, loadProject } from './common'
import { namesOf, num, str, unitRef } from './refs'
import { unitLabel } from './rules'

/**
 * FR1 read models for the APK / web (ADR 0020 §3/§4, §7): units ("Unit & Kendaraan", never with
 * contract rates) and the contract units of a project (rate / minimum hours null unless Direktur,
 * Finance or Admin of the PT).
 */

type VehicleRow = Record<string, unknown> & { id: number }
type ContractRow = Record<string, unknown> & { id: number; startDate: string; endDate?: string | null }

async function readableProject(req: PayloadRequest, projectId: number): Promise<{ id: number; company: number; kind: string }> {
  // the caller's project read access decides (Staff: assigned, PM: team, office: all) — else 404
  const visible = await req.payload.find({ collection: 'projects', where: { id: { equals: projectId } }, limit: 1, depth: 0, pagination: false, select: { kind: true }, user: req.user, overrideAccess: false, req }).catch(() => ({ docs: [] }))
  if (visible.docs.length === 0) fail(404, 'NOT_FOUND', 'Project tidak ditemukan.', 'project')
  const p = (await loadProject(req, projectId))!
  return { id: p.id, company: p.company, kind: p.kind }
}

async function activeContracts(req: PayloadRequest, projectId: number, onDate?: string): Promise<ContractRow[]> {
  const and: Where[] = [{ project: { equals: projectId } }, { active: { equals: true } }]
  if (onDate) and.push({ startDate: { less_than_equal: onDate } }, { or: [{ endDate: { exists: false } }, { endDate: { equals: null } }, { endDate: { greater_than_equal: onDate } }] })
  const r = await req.payload.find({ collection: 'contract-units', where: { and }, depth: 0, pagination: false, sort: 'id', overrideAccess: true /* SYSTEM-READ: contracts of a project the caller may read (rates stripped below) */, req })
  return r.docs as unknown as ContractRow[]
}

export async function listUnits(req: PayloadRequest, f: { projectId?: number; updatedSince?: string; companyIds?: readonly number[] }) {
  const and: Where[] = []
  let contractByUnit = new Map<number, ContractRow>()
  if (f.projectId !== undefined) {
    const p = await readableProject(req, f.projectId)
    and.push({ company: { equals: p.company } })
    if (p.kind === 'kontrak_unit') {
      const { today } = await companyDay(req, p.company)
      const contracts = await activeContracts(req, p.id, today)
      contractByUnit = new Map(contracts.map((c) => [relId(c.unit)!, c]))
      and.push({ id: { in: [...contractByUnit.keys(), 0] } })
    } else {
      and.push({ active: { equals: true } })
    }
  }
  if (f.updatedSince) and.push({ updatedAt: { greater_than: f.updatedSince } })
  if (f.companyIds?.length) and.push({ company: { in: [...f.companyIds] } })
  const r = await req.payload.find({ collection: 'vehicles', where: and.length ? { and } : undefined, depth: 0, pagination: false, sort: 'displayName', user: req.user, overrideAccess: false /* every member reads the units of its PTs */, req })
  const docs = r.docs as unknown as VehicleRow[]
  const n = await namesOf(req, docs, { users: [], clients: ['client'] })
  return {
    serverTime: new Date().toISOString(),
    items: docs.map((d) => {
      const c = contractByUnit.get(d.id)
      const client = relId(d.client)
      return {
        id: d.id,
        companyId: relId(d.company)!,
        kind: (d.kind === 'alat_berat' ? 'alat_berat' : 'kendaraan') as 'kendaraan' | 'alat_berat',
        label: unitLabel(d as never),
        unitCode: str(d.unitCode),
        plateNo: str(d.plateNo),
        plateDisplay: str(d.plateDisplay),
        type: str(d.type),
        brandModel: str(d.brandModel),
        serialNo: str(d.serialNo),
        owner: (d.owner === 'pelanggan' ? 'pelanggan' : 'sendiri') as 'sendiri' | 'pelanggan',
        client: client === undefined ? null : { id: client, name: n.client.get(client) ?? null },
        status: (d.status ?? 'siap') as 'siap' | 'rusak' | 'menunggu_part',
        lastHourMeter: num(d.lastHourMeter),
        lastHourMeterAt: str(d.lastHourMeterAt),
        contract: c ? { id: c.id, projectId: relId(c.project)!, startDate: c.startDate, endDate: c.endDate ?? null } : null,
        active: d.active !== false,
        updatedAt: str(d.updatedAt),
      }
    }),
  }
}

/** GET /projects/{id}/contract-units: every contract unit of the project (rates only for the rate roles). */
export async function projectContractUnits(req: PayloadRequest, projectId: number) {
  const p = await readableProject(req, projectId)
  const r = await req.payload.find({ collection: 'contract-units', where: { project: { equals: p.id } }, depth: 0, pagination: false, sort: 'startDate', overrideAccess: true /* SYSTEM-READ: project readable (checked above); rates stripped below */, req })
  const docs = r.docs as unknown as ContractRow[]
  const rates = mayReadRates(req, p.company)
  const n = await namesOf(req, docs, { users: [], clients: [] })
  return {
    projectId: p.id,
    items: docs.map((c) => ({
      id: c.id,
      companyId: relId(c.company)!,
      projectId: p.id,
      unit: unitRef(n, c.unit),
      startDate: c.startDate,
      endDate: c.endDate ?? null,
      active: c.active !== false,
      rateBasis: (c.rateBasis === 'per_bulan' ? 'per_bulan' : 'per_jam') as 'per_jam' | 'per_bulan',
      rate: rates ? num(c.rate) : null,
      minHoursPerMonth: rates ? num(c.minHoursPerMonth) : null,
      ratesVisible: rates,
      notes: str(c.notes),
    })),
  }
}
