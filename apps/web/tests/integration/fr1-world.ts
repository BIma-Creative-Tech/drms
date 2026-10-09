import { handleEndpoints } from 'payload'
import sharp from 'sharp'

import { addDays } from '@/domain/field/rules'
import { localDate } from '@/domain/progress/rules'
import config from '@/payload.config'

import { makeWorld, ORIGIN, sysCreate, type FlowUser, type World } from './flow-world'
import { updateCompany } from './helpers'

/**
 * FR1 test world (ADR 0020): the F2 world of company #1 DRMS + field reports switched ON for DRMS,
 * a kontrak_unit project and an aftersales project (PM = world PM; Staff A assigned to both, Staff B
 * only to the world's `umum` project), a customer, heavy-equipment units (own + customer-owned) and an
 * active contract unit. Callers switch the flag OFF again in afterAll (other files expect DRMS off).
 * Fictional data only.
 */
export type Fr1World = World & {
  today: string
  kontrak: number
  aftersales: number
  client: number
  client2: number
  ex01: number
  ex02: number
  custUnit: number
  contract: number
}

export const todayWita = () => localDate(new Date(), process.env.TZ || 'Asia/Makassar')

export async function makeFr1World(tag: string): Promise<Fr1World> {
  const w = await makeWorld(tag)
  await updateCompany({ fieldReportsEnabled: true })
  const today = todayWita()
  const client = await sysCreate('clients', { name: `${tag} Pelanggan Tambang` })
  const client2 = await sysCreate('clients', { name: `${tag} Pelanggan Lain` })
  const kontrak = await sysCreate('projects', { code: `${tag}-K`, name: `${tag} Sewa excavator`, kind: 'kontrak_unit', pm: w.users.pm.id, client, status: 'berjalan' })
  const aftersales = await sysCreate('projects', { code: `${tag}-A`, name: `${tag} Aftersales sparepart`, kind: 'aftersales', pm: w.users.pm.id, status: 'berjalan' })
  await sysCreate('team-assignments', { employee: w.emp.a, project: kontrak, roleInProject: 'staff' })
  await sysCreate('team-assignments', { employee: w.emp.a, project: aftersales, roleInProject: 'staff' })
  const code = tag.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const ex01 = await sysCreate('vehicles', { kind: 'alat_berat', unitCode: `${code}-EX01`, type: 'Excavator 20 t', brandModel: 'Komatsu PC200' })
  const ex02 = await sysCreate('vehicles', { kind: 'alat_berat', unitCode: `${code}-EX02`, type: 'Excavator 20 t' })
  const custUnit = await sysCreate('vehicles', { kind: 'alat_berat', unitCode: `${code}-CU1`, type: 'Dozer', owner: 'pelanggan', client })
  const contract = await sysCreate('contract-units', { project: kontrak, unit: ex01, startDate: addDays(today, -20), rateBasis: 'per_jam', rate: 350_000, minHoursPerMonth: 200 })
  return { ...w, today, kontrak, aftersales, client, client2, ex01, ex02, custUnit, contract }
}

let seq = 0
/** Uploads a JPEG to /api/v1/media/progress-photos as `user` (web cookie). */
export async function uploadFieldPhoto(user: FlowUser): Promise<{ status: number; id: number; body: unknown }> {
  const s = ++seq
  const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: (s * 41) % 255, g: (s * 73) % 255, b: 90 } } })
    .jpeg({ quality: 80 })
    .toBuffer()
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'hm.jpg')
  const res = await handleEndpoints({ config, request: new Request(`${ORIGIN}/api/v1/media/progress-photos`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: user.cookie }, body: form }) })
  const body = (await res.json()) as { id: number }
  return { status: res.status, id: body.id, body }
}
