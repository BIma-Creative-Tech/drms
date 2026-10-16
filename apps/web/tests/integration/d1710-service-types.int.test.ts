import { randomUUID } from 'node:crypto'

import React, { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createLocalReq, type AdminViewServerProps } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@payloadcms/next/templates', () => ({ DefaultTemplate: ({ children }: { children: ReactNode }) => children }))
vi.mock('@payloadcms/ui', () => ({ Gutter: ({ children }: { children: ReactNode }) => React.createElement('div', { 'data-gutter': '' }, children) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }), usePathname: () => '/admin' }))

import { FieldServiceDetail, FieldServiceList, FieldServiceNew } from '@/admin/views/FieldService'
import { SKIP_COMPANY_DEFAULTS } from '@/domain/company-defaults'
import { resetRateLimits } from '@/lib/rate-limit'
import { BACKFILL_SERVICE_REPORT_TYPES_SQL, SEED_SERVICE_TYPES_SQL } from '@/migrations/20261017_100000_d1710_service_types'

import { api, type FlowUser } from './flow-world'
import { makeFr1World, uploadFieldPhoto, type Fr1World } from './fr1-world'
import { accessToken, companyId, getTestPayload, http, installLocalJwks, registerDevice, sqlAs, sqlError, type TestUser, updateCompany } from './helpers'

/**
 * DRMS owner 2026-10-17 (ADR 0020 amendment 2026-10-17) — Laporan servis: "Jenis servis" = per-PT master
 * `service-types` (Admin / Direktur manage, every member reads, seeded per PT, used → no delete), MULTI-select on
 * create / edit / correction (REST serviceTypeIds, sync service_type_ids) with the LEGACY single code of APK 0.7.0
 * (create maps it; an edit naming a type already on the report keeps a multi-selection), DB guard of the selection
 * (window / correction override, same PT, ≥ 1), photos ≤ 25 (+ adding photos on edit / correction), no "No. part"
 * input (a stored one is kept). Fictional data only.
 */
let w: Fr1World
let drms = 0
/** code → id of the DRMS master */
const T: Record<string, number> = {}
let custom = 0 // an extra type of DRMS (created by the Admin)

type Props = AdminViewServerProps
async function propsFor(user: FlowUser, segments: string[], searchParams: Record<string, string> = {}): Promise<Props> {
  const req = await createLocalReq({ user: { ...user, collection: 'users' } as never }, await getTestPayload())
  return { initPageResult: { req, locale: undefined, permissions: {}, visibleEntities: { collections: [], globals: [] } }, params: { segments }, searchParams } as unknown as Props
}
async function resolve(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolve))
  if (!isValidElement(node)) return node
  const el = node as ReactElement<{ children?: ReactNode }>
  if (typeof el.type === 'function' && el.type.constructor.name === 'AsyncFunction') return resolve(await (el.type as (p: unknown) => Promise<ReactNode>)(el.props))
  if (el.props && 'children' in el.props && el.props.children !== undefined) return cloneElement(el, undefined, ...([] as ReactNode[]).concat(await resolve(el.props.children)))
  return el
}
async function render(view: (p: Props) => Promise<ReactNode>, user: FlowUser, segments: string[], sp: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(React.createElement(React.Fragment, null, await resolve(await view(await propsFor(user, segments, sp)))))
}

const photo = async (u: FlowUser) => {
  const p = await uploadFieldPhoto(u)
  expect(p.status, JSON.stringify(p.body)).toBe(201)
  return p.id
}
const create = (u: FlowUser, body: Record<string, unknown>) => api('POST', '/api/v1/service-reports', u, { projectId: w.kontrak, unitId: w.ex01, action: 'Servis unit uji jenis', unitStatusAfter: 'siap', ...body })
const closeWindow = (id: number) =>
  sqlAs('owner', `ALTER TABLE service_reports DISABLE TRIGGER service_reports_protect; UPDATE service_reports SET editable_until = now() - interval '1 minute' WHERE id = ${id}; ALTER TABLE service_reports ENABLE TRIGGER service_reports_protect;`)
const relsOf = async (id: number) => (await sqlAs('app', 'SELECT service_types_id AS t, "order" AS o FROM service_reports_rels WHERE parent_id = $1 ORDER BY "order"', [id])).rows.map((r) => Number(r.t))

beforeAll(async () => {
  installLocalJwks()
  w = await makeFr1World('svjenis') // letters first: the world's plate suffix comes from the tag
  drms = await companyId()
  const rows = (await sqlAs('app', 'SELECT id, code FROM service_types WHERE company_id = $1', [drms])).rows as Array<{ id: number; code: string }>
  for (const r of rows) T[r.code] = r.id
})
beforeEach(() => resetRateLimits())
afterAll(async () => {
  await updateCompany({ fieldReportsEnabled: false })
})

describe('master "Jenis servis" (per PT)', () => {
  it('migration + seed: every PT has the four legacy types (codes = old enum values); the seed / backfill SQL is idempotent', async () => {
    const r = await sqlAs('app', 'SELECT code, name, active, sort_order::int AS o FROM service_types WHERE company_id = $1 ORDER BY sort_order, code', [drms])
    expect(r.rows.filter((x) => ['inspeksi', 'pemasangan', 'perbaikan', 'servis_berkala'].includes(x.code)).map((x) => [x.code, x.name, x.active, x.o])).toEqual([
      ['servis_berkala', 'Servis berkala', true, 1],
      ['perbaikan', 'Perbaikan', true, 2],
      ['inspeksi', 'Inspeksi', true, 3],
      ['pemasangan', 'Pemasangan', true, 4],
    ])
    // a PT without any type (created like the seed / import, no defaults) gets them from the migration's seed step; a
    // second run adds nothing
    const p = await getTestPayload()
    const bare = (await p.create({ collection: 'companies', data: { name: 'PT Jenis Kosong', shortCode: `JK${randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, 'K')}`, timezone: 'Asia/Makassar', active: false } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */, context: { [SKIP_COMPANY_DEFAULTS]: true } })).id as number
    expect((await sqlAs('app', 'SELECT count(*)::int AS n FROM service_types WHERE company_id = $1', [bare])).rows[0].n).toBe(0)
    await sqlAs('owner', SEED_SERVICE_TYPES_SQL)
    await sqlAs('owner', SEED_SERVICE_TYPES_SQL)
    expect((await sqlAs('app', 'SELECT count(*)::int AS n FROM service_types WHERE company_id = $1', [bare])).rows[0].n).toBe(4)
  })

  it('a new PT created in the app gets the defaults (ensureDefaultServiceTypes); seed / import PTs (SKIP_COMPANY_DEFAULTS) do not', async () => {
    const p = await getTestPayload()
    const sc = () => `SV${randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, 'S')}`
    const pt = (await p.create({ collection: 'companies', data: { name: 'PT Servis Baru', shortCode: sc(), timezone: 'Asia/Makassar', active: false } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */ })).id as number
    const codes = (await sqlAs('app', 'SELECT code FROM service_types WHERE company_id = $1 ORDER BY code', [pt])).rows.map((x) => x.code)
    expect(codes).toEqual(['inspeksi', 'pemasangan', 'perbaikan', 'servis_berkala'])
    const skip = (await p.create({ collection: 'companies', data: { name: 'PT Servis Skip', shortCode: sc(), timezone: 'Asia/Makassar', active: false } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */, context: { [SKIP_COMPANY_DEFAULTS]: true } })).id as number
    expect((await sqlAs('app', 'SELECT count(*)::int AS n FROM service_types WHERE company_id = $1', [skip])).rows[0].n).toBe(0)
  })

  it('Admin and Direktur create / rename / deactivate (reason); PM, Staff, Finance read only; code fixed; no delete', async () => {
    const created = await api('POST', '/api/service-types', w.users.admin, { code: `overhaul-${Date.now() % 10000}`, name: 'Overhaul mesin' })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    custom = (created.body as { doc: { id: number } }).doc.id
    const byOwner = await api('POST', '/api/service-types', w.users.owner, { code: `kalibrasi-${Date.now() % 10000}`, name: 'Kalibrasi' })
    expect(byOwner.status, JSON.stringify(byOwner.body)).toBe(201)
    expect((await api('PATCH', `/api/service-types/${custom}`, w.users.owner, { name: 'Overhaul mesin & transmisi' })).status).toBe(200)
    for (const u of [w.users.pm, w.users.staffA, w.users.finance]) {
      expect((await api('POST', '/api/service-types', u, { code: `x-${u.id}`, name: 'Tidak boleh' })).status, u.email).toBe(403)
      expect((await api('GET', '/api/service-types?limit=50', u)).status, u.email).toBe(200)
      const upd = await api('PATCH', `/api/service-types/${custom}`, u, { name: 'Diubah PM' })
      expect([403, 404], u.email).toContain(upd.status)
    }
    // the code is the APK 0.7.0 key: ignored on update (field access) and immutable in the DB
    await api('PATCH', `/api/service-types/${custom}`, w.users.admin, { code: 'diganti' })
    expect((await sqlAs('app', 'SELECT code, name FROM service_types WHERE id = $1', [custom])).rows[0]).toMatchObject({ name: 'Overhaul mesin & transmisi' })
    expect((await sqlAs('app', 'SELECT code FROM service_types WHERE id = $1', [custom])).rows[0].code).not.toBe('diganti')
    expect((await sqlError('app', `UPDATE service_types SET code = 'x' WHERE id = ${custom}`))?.code).toBe('42501')
    expect((await sqlError('app', `UPDATE service_types SET company_id = company_id + 0 WHERE id = ${custom}`))).toBeNull()
    expect((await sqlError('app', `DELETE FROM service_types WHERE id = ${custom}`))?.code).toBe('42501')
    expect((await api('DELETE', `/api/service-types/${custom}`, w.users.admin)).status).toBe(403)
    // same code twice in one PT → refused
    const dup = await api('POST', '/api/service-types', w.users.admin, { code: 'perbaikan', name: 'Perbaikan 2' })
    expect(dup.status).toBe(400)
  })

  it('GET /api/v1/service-types: active types of the selected PTs by name; includeInactive; foreign ?company= → 403', async () => {
    const inactive = await api('POST', '/api/service-types', w.users.admin, { code: `lama-${Date.now() % 10000}`, name: 'Zz jenis lama' })
    const iid = (inactive.body as { doc: { id: number } }).doc.id
    expect((await api('PATCH', `/api/service-types/${iid}`, w.users.admin, { active: false, changeReason: 'tidak dipakai lagi' })).status).toBe(200)
    const r = await api('GET', '/api/v1/service-types', w.users.staffA)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const items = r.body.items as Array<{ id: number; companyId: number; code: string; name: string; active: boolean; sortOrder: number }>
    expect(items.every((x) => x.active && x.companyId === drms)).toBe(true)
    // sortOrder (Urutan) ascending, then name — the APK sorts the same way
    const key = (x: { sortOrder: number; name: string }) => `${String(x.sortOrder).padStart(5, '0')} ${x.name}`
    expect(items.map(key)).toEqual([...items].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'id')).map(key))
    expect(items.find((x) => x.code === 'perbaikan')).toEqual({ id: T.perbaikan, companyId: drms, code: 'perbaikan', name: 'Perbaikan', active: true, sortOrder: 2 })
    // a new type without Urutan = 0 → listed before the seeded 1–4
    expect(items[0]!.sortOrder).toBe(0)
    expect(items.some((x) => x.id === iid)).toBe(false)
    const all = await api('GET', '/api/v1/service-types?includeInactive=1', w.users.staffA)
    expect((all.body.items as Array<{ id: number; active: boolean }>).find((x) => x.id === iid)).toMatchObject({ active: false })
    expect((await api('GET', `/api/v1/service-types?company=${drms}`, w.users.pm)).status).toBe(200)
    expect((await api('GET', '/api/v1/service-types?company=999999', w.users.pm)).status).toBe(403)
    expect((await api('GET', '/api/v1/service-types', null)).status).toBe(401)
  })
})

describe('service report: multi-select via REST', () => {
  let svId = 0

  it('create with serviceTypeIds (selection order kept; legacy serviceType = first code)', async () => {
    const r = await create(w.users.staffA, { serviceTypeIds: [T.perbaikan, T.inspeksi, custom] })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    svId = r.body.id
    expect(r.body.serviceTypes.map((t: { id: number }) => t.id)).toEqual([T.perbaikan, T.inspeksi, custom])
    expect(r.body.serviceTypes[0]).toEqual({ id: T.perbaikan, code: 'perbaikan', name: 'Perbaikan', active: true })
    expect(r.body.serviceType).toBe('perbaikan')
    expect(await relsOf(svId)).toEqual([T.perbaikan, T.inspeksi, custom])
    expect((await sqlAs('app', 'SELECT service_type FROM service_reports WHERE id = $1', [svId])).rows[0].service_type).toBe('perbaikan')
    const list = await api('GET', `/api/v1/service-reports?project=${w.kontrak}`, w.users.pm)
    expect(list.body.items.find((x: { id: number }) => x.id === svId).serviceTypes).toHaveLength(3)
  })

  it('legacy create (old enum code) → the PT master row; none / both / duplicates / other PT / inactive → 400', async () => {
    const legacy = await create(w.users.staffA, { serviceType: 'inspeksi' })
    expect(legacy.status, JSON.stringify(legacy.body)).toBe(201)
    expect(legacy.body.serviceTypes).toEqual([{ id: T.inspeksi, code: 'inspeksi', name: 'Inspeksi', active: true }])
    const none = await create(w.users.staffA, {})
    expect(none.status).toBe(400)
    expect(JSON.stringify(none.body)).toContain('Pilih minimal satu jenis servis.')
    expect(none.body.errors.map((e: { path: string }) => e.path)).toContain('serviceTypeIds')
    const empty = await create(w.users.staffA, { serviceTypeIds: [] })
    expect(empty.status).toBe(400)
    expect(JSON.stringify(empty.body)).toContain('Pilih minimal satu jenis servis.')
    expect((await create(w.users.staffA, { serviceTypeIds: [T.perbaikan], serviceType: 'perbaikan' })).status).toBe(400)
    expect((await create(w.users.staffA, { serviceTypeIds: [T.perbaikan, T.perbaikan] })).status).toBe(400)
    expect((await create(w.users.staffA, { serviceTypeIds: Array.from({ length: 21 }, (_, i) => i + 1) })).status).toBe(400)
    // a type of another PT
    const p = await getTestPayload()
    const other = (await p.create({ collection: 'companies', data: { name: 'PT Jenis Lain', shortCode: `JL${randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, 'J')}`, timezone: 'Asia/Makassar', active: false } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */ })).id as number
    const foreign = (await sqlAs('app', "SELECT id FROM service_types WHERE company_id = $1 AND code = 'perbaikan'", [other])).rows[0].id as number
    const cross = await create(w.users.staffA, { serviceTypeIds: [foreign] })
    expect(cross.status).toBe(400)
    expect(cross.body.errors[0].path).toBe('serviceTypeIds')
    // an inactive type / an unknown legacy code
    const off = await api('POST', '/api/service-types', w.users.admin, { code: `nonaktif-${Date.now() % 10000}`, name: 'Jenis nonaktif' })
    const offId = (off.body as { doc: { id: number } }).doc.id
    await api('PATCH', `/api/service-types/${offId}`, w.users.admin, { active: false, changeReason: 'uji nonaktif' })
    expect((await create(w.users.staffA, { serviceTypeIds: [offId] })).status).toBe(400)
  })

  it('edit within 24 h: new selection; legacy code already on the report keeps the multi-selection; another legacy code replaces it', async () => {
    const e = await api('PATCH', `/api/v1/service-reports/${svId}`, w.users.staffA, { serviceTypeIds: [T.inspeksi, T.perbaikan] })
    expect(e.status, JSON.stringify(e.body)).toBe(200)
    expect(e.body.serviceTypes.map((t: { id: number }) => t.id)).toEqual([T.inspeksi, T.perbaikan])
    expect(e.body.serviceType).toBe('inspeksi')
    // APK 0.7.0 resends its (first) code on every edit — must NOT collapse the web multi-selection
    const keep = await api('PATCH', `/api/v1/service-reports/${svId}`, w.users.staffA, { serviceType: 'perbaikan', notes: 'edit APK lama' })
    expect(keep.status, JSON.stringify(keep.body)).toBe(200)
    expect(keep.body.serviceTypes.map((t: { id: number }) => t.id)).toEqual([T.inspeksi, T.perbaikan])
    expect(keep.body.notes).toBe('edit APK lama')
    // ids win over the legacy code
    const both = await api('PATCH', `/api/v1/service-reports/${svId}`, w.users.staffA, { serviceTypeIds: [T.perbaikan, T.inspeksi], serviceType: 'pemasangan' })
    expect(both.body.serviceTypes.map((t: { id: number }) => t.id)).toEqual([T.perbaikan, T.inspeksi])
    const replace = await api('PATCH', `/api/v1/service-reports/${svId}`, w.users.staffA, { serviceType: 'pemasangan' })
    expect(replace.body.serviceTypes.map((t: { id: number }) => t.id)).toEqual([T.pemasangan])
    expect(replace.body.serviceType).toBe('pemasangan')
    expect((await api('PATCH', `/api/v1/service-reports/${svId}`, w.users.staffA, { serviceTypeIds: [] })).status).toBe(400)
    const hist = await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE doc_type = 'service_report' AND doc_id = $1 AND field = 'serviceTypes'", [String(svId)])
    expect(hist.rows[0].n).toBeGreaterThanOrEqual(2)
  })

  it('a type deactivated since may stay on the report; a newly added inactive type is refused; correction after the window', async () => {
    const r = await create(w.users.staffA, { serviceTypeIds: [custom, T.perbaikan] })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const id = r.body.id as number
    expect((await api('PATCH', `/api/service-types/${custom}`, w.users.admin, { active: false, changeReason: 'jarang dipakai' })).status).toBe(200)
    try {
      const stay = await api('PATCH', `/api/v1/service-reports/${id}`, w.users.staffA, { serviceTypeIds: [custom, T.perbaikan, T.inspeksi] })
      expect(stay.status, JSON.stringify(stay.body)).toBe(200)
      expect(stay.body.serviceTypes[0]).toMatchObject({ id: custom, active: false })
      const other = await create(w.users.staffA, { serviceTypeIds: [T.perbaikan] })
      const add = await api('PATCH', `/api/v1/service-reports/${other.body.id}`, w.users.staffA, { serviceTypeIds: [T.perbaikan, custom] })
      expect(add.status).toBe(400)
      // after the window: reporter refused; PM correction with a reason changes the types (DB override 'correction')
      await closeWindow(id)
      expect((await api('PATCH', `/api/v1/service-reports/${id}`, w.users.staffA, { serviceTypeIds: [T.inspeksi] })).status).toBe(409)
      const c = await api('POST', `/api/v1/service-reports/${id}/corrections`, w.users.pm, { serviceTypeIds: [T.inspeksi, custom], reason: 'Jenis servis salah pilih' })
      expect(c.status, JSON.stringify(c.body)).toBe(200)
      expect(c.body.serviceTypes.map((t: { id: number }) => t.id)).toEqual([T.inspeksi, custom])
      expect(c.body.flags).toContain('CORRECTED')
    } finally {
      await api('PATCH', `/api/service-types/${custom}`, w.users.admin, { active: true, changeReason: 'dipakai lagi' })
    }
  })

  it('DB guard of the selection: window (correction override only), same PT, ≥ 1 type at commit, DELETE granted only for the rewrite', async () => {
    const r = await create(w.users.staffA, { serviceTypeIds: [T.perbaikan, T.inspeksi] })
    const id = r.body.id as number
    // inside the window the app role may rewrite (Payload: DELETE + INSERT in one transaction)
    expect(await sqlError('app', `BEGIN; DELETE FROM service_reports_rels WHERE parent_id = ${id}; INSERT INTO service_reports_rels ("order", parent_id, path, service_types_id) VALUES (1, ${id}, 'serviceTypes', ${T.pemasangan}); COMMIT;`)).toBeNull()
    // no type left at commit
    expect((await sqlError('app', `DELETE FROM service_reports_rels WHERE parent_id = ${id}`))?.code).toBe('23514')
    // a report inserted without types and without a mappable legacy code is refused at commit
    const company = drms
    expect((await sqlError('app', `INSERT INTO service_reports (company_id, project_id, unit_id, report_date, reporter_id, service_type, action, unit_status_after) VALUES (${company}, ${w.kontrak}, ${w.ex02}, '${w.today}', ${w.users.pm.id}, 'tidak-ada', 'cek', 'siap')`))?.code).toBe('23514')
    // other PT's type / other path
    const other = (await sqlAs('app', 'SELECT id FROM service_types WHERE company_id <> $1 LIMIT 1', [drms])).rows[0].id as number
    expect((await sqlError('app', `INSERT INTO service_reports_rels ("order", parent_id, path, service_types_id) VALUES (2, ${id}, 'serviceTypes', ${other})`))?.message).toMatch(/cross-company reference/)
    expect((await sqlError('app', `INSERT INTO service_reports_rels ("order", parent_id, path, service_types_id) VALUES (2, ${id}, 'lain', ${T.inspeksi})`))?.code).toBe('23514')
    // after the window: no change without the correction override
    await closeWindow(id)
    expect((await sqlError('app', `INSERT INTO service_reports_rels ("order", parent_id, path, service_types_id) VALUES (2, ${id}, 'serviceTypes', ${T.inspeksi})`))?.code).toBe('42501')
    expect((await sqlError('app', `UPDATE service_reports_rels SET service_types_id = ${T.inspeksi} WHERE parent_id = ${id}`))?.code).toBe('42501')
    expect((await sqlError('app', `BEGIN; SELECT set_config('pk.field_override', 'system', true); INSERT INTO service_reports_rels ("order", parent_id, path, service_types_id) VALUES (2, ${id}, 'serviceTypes', ${T.inspeksi}); COMMIT;`))?.code).toBe('42501')
    expect(await sqlError('app', `BEGIN; SELECT set_config('pk.field_override', 'correction', true); INSERT INTO service_reports_rels ("order", parent_id, path, service_types_id) VALUES (2, ${id}, 'serviceTypes', ${T.inspeksi}); COMMIT;`)).toBeNull()
    expect((await sqlError('app', 'TRUNCATE service_reports_rels'))?.code).toBe('42501')
  })

  it('migration backfill: a report without types gets its PT row of its legacy code (exported migration SQL, idempotent)', async () => {
    const r = await create(w.users.staffA, { serviceType: 'servis_berkala' })
    const id = r.body.id as number
    await sqlAs('owner', `BEGIN; ALTER TABLE service_reports_rels DISABLE TRIGGER USER; DELETE FROM service_reports_rels WHERE parent_id = ${id}; ALTER TABLE service_reports_rels ENABLE TRIGGER USER; COMMIT;`)
    expect(await relsOf(id)).toEqual([])
    await sqlAs('owner', BACKFILL_SERVICE_REPORT_TYPES_SQL)
    await sqlAs('owner', BACKFILL_SERVICE_REPORT_TYPES_SQL)
    expect(await relsOf(id)).toEqual([T.servis_berkala])
    const left = await sqlAs('app', 'SELECT count(*)::int AS n FROM service_reports r WHERE NOT EXISTS (SELECT 1 FROM service_reports_rels x WHERE x.parent_id = r.id)')
    expect(left.rows[0].n).toBe(0)
    expect((await sqlAs('app', "SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'service_reports' AND column_name = 'service_type'")).rows[0]).toEqual({ data_type: 'character varying', is_nullable: 'YES' })
  })

  it('used type → no "Hapus" (Nonaktifkan); an unused one may be soft-deleted', async () => {
    const used = await api('GET', `/api/v1/records/service-types/${T.perbaikan}/delete-check`, w.users.admin)
    expect(used.status, JSON.stringify(used.body)).toBe(200)
    expect(used.body).toMatchObject({ canDelete: false, action: 'nonaktifkan' })
    const fresh = await api('POST', '/api/service-types', w.users.admin, { code: `kosong-${Date.now() % 10000}`, name: 'Belum dipakai' })
    const fid = (fresh.body as { doc: { id: number } }).doc.id
    expect((await api('GET', `/api/v1/records/service-types/${fid}/delete-check`, w.users.admin)).body).toMatchObject({ canDelete: true, action: 'hapus' })
    expect((await api('GET', `/api/v1/records/service-types/${fid}/delete-check`, w.users.pm)).body).toMatchObject({ canDelete: false })
  })
})

describe('photos ≤ 25; spare parts keep a stored part no.', () => {
  it('25 photos accepted, the 26th refused (API + DB); edit adds photos up to 25', async () => {
    const ids: number[] = []
    for (let i = 0; i < 24; i++) ids.push(await photo(w.users.staffA))
    const r = await create(w.users.staffA, { serviceTypeIds: [T.perbaikan], photoIds: ids })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const id = r.body.id as number
    resetRateLimits()
    const p25 = await photo(w.users.staffA)
    const p26 = await photo(w.users.staffA)
    const over = await api('PATCH', `/api/v1/service-reports/${id}`, w.users.staffA, { addPhotoIds: [p25, p26] })
    expect(over.status).toBe(400)
    expect(over.body.code).toBe('PHOTO_LIMIT')
    const ok = await api('PATCH', `/api/v1/service-reports/${id}`, w.users.staffA, { addPhotoIds: [p25] })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.photos).toHaveLength(25)
    // DB: the trigger refuses a 26th photo, the CHECK a count above 25
    const e = await sqlError('app', `UPDATE media_progress_photos SET owner_doc_type = 'service_report', owner_doc_id = '${id}' WHERE id = ${p26}`)
    expect(e?.message).toMatch(/already has 25 photo/)
    expect((await sqlError('app', `UPDATE service_reports SET photo_count = 26 WHERE id = ${id}`))?.code).toBe('23514')
    expect((await api('POST', '/api/v1/service-reports', w.users.staffA, { projectId: w.kontrak, unitId: w.ex01, serviceTypeIds: [T.perbaikan], action: 'x foto', unitStatusAfter: 'siap', photoIds: Array.from({ length: 26 }, (_, i) => i + 1) })).status).toBe(400)
  })

  it('correction may add photos (never remove)', async () => {
    const r = await create(w.users.staffA, { serviceTypeIds: [T.inspeksi], photoIds: [await photo(w.users.staffA)] })
    const id = r.body.id as number
    const pmPhoto = await photo(w.users.pm)
    const c = await api('POST', `/api/v1/service-reports/${id}/corrections`, w.users.pm, { addPhotoIds: [pmPhoto], reason: 'Foto sesudah dari PM' })
    expect(c.status, JSON.stringify(c.body)).toBe(200)
    expect(c.body.photos).toHaveLength(2)
  })

  it('a part no. stored on a line stays when the lines are edited without that column', async () => {
    const r = await create(w.users.staffA, { serviceTypeIds: [T.perbaikan], spareparts: [{ name: 'Filter oli', partNo: '600-211-1340', qty: 2, uom: 'PCS' }] })
    const id = r.body.id as number
    // the web editor sends the stored partNo back unchanged (hidden column) together with a new line
    const e = await api('PATCH', `/api/v1/service-reports/${id}`, w.users.staffA, { spareparts: [{ name: 'Filter oli', partNo: '600-211-1340', qty: 3, uom: 'PCS', note: null }, { name: 'Oli mesin', partNo: null, qty: 8, uom: 'LTR', note: null }] })
    expect(e.status, JSON.stringify(e.body)).toBe(200)
    expect(e.body.spareparts[0]).toMatchObject({ name: 'Filter oli', partNo: '600-211-1340', qty: 3 })
  })
})

describe('sync service_report.upsert', () => {
  type Mobile = { token: string; device: string }
  let m: Mobile
  const bearer = (x: Mobile) => ({ Authorization: `Bearer ${x.token}`, 'X-Device-Id': x.device, 'X-App-Version': '1.0.0' })
  async function sync(items: Array<Record<string, unknown>>) {
    resetRateLimits()
    const now = Date.now()
    const clock = { device_time: new Date(now).toISOString(), elapsed_ms: 10_000_000, boot_id: 'boot-1', last_server_time: new Date(now - 600_000).toISOString(), last_server_elapsed_ms: 10_000_000 - 600_000 }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return http('POST', '/api/v1/sync/batch', { headers: bearer(m), json: { batch_id: randomUUID(), device_id: m.device, clock, items } }) as Promise<{ status: number; body: any }>
  }
  const item = (payload: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    client_uuid: randomUUID(),
    type: 'service_report.upsert',
    schema_version: 1,
    offline: false,
    device_time: new Date(Date.now() - 1_000).toISOString(),
    elapsed_ms: 10_000_000 - 1_000,
    company_id: drms,
    payload,
    ...over,
  })

  beforeAll(async () => {
    const p = await getTestPayload()
    const doc = await p.findByID({ collection: 'users', id: w.users.staffA.id, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })
    const t: TestUser = { ...w.users.staffA, keycloakSub: doc.keycloakSub as string }
    const token = await accessToken(t, ['pk-staff'])
    m = { token, device: await registerDevice(t, token) }
  })

  it('new APK: service_type_ids; copy carries service_type_ids + service_type (first code)', async () => {
    const it1 = item({ project_id: w.kontrak, unit_id: w.ex01, service_type_ids: [T.pemasangan, T.inspeksi], action: 'Pasang GPS tracker', unit_status_after: 'siap' })
    const r = await sync([it1])
    const res = r.body.results[0]
    expect(res, JSON.stringify(r.body)).toMatchObject({ status: 'applied', rev: 1 })
    expect(res.server_service_report).toMatchObject({ service_type: 'pemasangan', service_type_ids: [T.pemasangan, T.inspeksi] })
  })

  it('APK 0.7.0: legacy service_type on create; an edit resending a code already on the report keeps the web multi-selection', async () => {
    const it1 = item({ project_id: w.kontrak, unit_id: w.ex01, service_type: 'perbaikan', action: 'Perbaikan rem', unit_status_after: 'siap' })
    const r = await sync([it1])
    expect(r.body.results[0], JSON.stringify(r.body)).toMatchObject({ status: 'applied' })
    const id = Number(r.body.results[0].server_id)
    // the web adds a second type
    const web = await api('PATCH', `/api/v1/service-reports/${id}`, w.users.staffA, { serviceTypeIds: [T.perbaikan, T.inspeksi] })
    expect(web.status, JSON.stringify(web.body)).toBe(200)
    const rev = web.body.rev as number
    // APK 0.7.0 edit (its draft knows only the first code) → selection unchanged
    const edit = await sync([item({ report_id: id, service_type: 'perbaikan', action: 'Perbaikan rem + kampas', unit_status_after: 'siap', spareparts: [{ name: 'Kampas rem', part_no: 'KR-01', qty: 4 }] }, { base_rev: rev })])
    expect(edit.body.results[0], JSON.stringify(edit.body)).toMatchObject({ status: 'applied' })
    expect(edit.body.results[0].server_service_report.service_type_ids).toEqual([T.perbaikan, T.inspeksi])
    expect(await relsOf(id)).toEqual([T.perbaikan, T.inspeksi])
    expect((await api('GET', `/api/v1/service-reports/${id}`, w.users.staffA)).body.spareparts[0]).toMatchObject({ partNo: 'KR-01' })
  })

  it('unknown legacy code / none on create → rejected VALIDATION with the payload field', async () => {
    const bad = await sync([item({ project_id: w.kontrak, unit_id: w.ex01, service_type: 'tidak_ada', action: 'Cek', unit_status_after: 'siap' })])
    expect(bad.body.results[0]).toMatchObject({ status: 'rejected', errors: [{ code: 'VALIDATION', field: 'payload.service_type' }] })
    const none = await sync([item({ project_id: w.kontrak, unit_id: w.ex01, action: 'Cek', unit_status_after: 'siap' })])
    expect(none.body.results[0]).toMatchObject({ status: 'rejected', errors: [{ code: 'VALIDATION', field: 'payload.service_type_ids' }] })
    expect(none.body.results[0].errors[0].message).toBe('Pilih minimal satu jenis servis.')
  })
})

describe('web views', () => {
  it('form: checkbox pills of the PT types, no "No. part" input, "Maks. 25 foto"; list: names joined + filter "Jenis servis"', async () => {
    const html = await render(FieldServiceNew, w.users.staffA, ['laporan-servis', 'baru'], { project: String(w.kontrak) })
    expect(html).toContain('data-pk-form="service-report"')
    expect(html).toContain('type="checkbox"')
    for (const code of ['perbaikan', 'inspeksi']) expect(html).toContain(`data-pk-choice="${T[code]}"`)
    expect(html).not.toContain('>No. part<')
    expect(html).toContain('Maks. 25 foto')
    const r = await create(w.users.staffA, { serviceTypeIds: [T.perbaikan, T.inspeksi] })
    const list = await render(FieldServiceList, w.users.pm, ['laporan-servis'], { jenis: String(T.inspeksi) })
    expect(list).toContain('name="jenis"')
    expect(list).toContain('Perbaikan, Inspeksi')
    expect(list).toContain(`data-pk-row="${r.body.docNo}"`)
  })

  it('detail: names joined, multi-select + photos in the dialogs, inactive attached type "(nonaktif)", "No. part" column only when stored', async () => {
    const withPn = await create(w.users.staffA, { serviceTypeIds: [custom, T.perbaikan], spareparts: [{ name: 'Seal', partNo: 'SL-9', qty: 1 }] })
    const plain = await create(w.users.staffA, { serviceTypeIds: [T.perbaikan], spareparts: [{ name: 'Baut', qty: 4 }] })
    await api('PATCH', `/api/service-types/${custom}`, w.users.admin, { active: false, changeReason: 'uji tampilan' })
    try {
      const pm = await render(FieldServiceDetail, w.users.pm, ['laporan-servis', 'detail', String(withPn.body.id)])
      expect(pm).toContain('data-pk-action="service-correct"')
      expect(pm).toContain('(nonaktif)')
      expect(pm).toContain('Tambah foto')
      expect(pm).toContain('foto maks. 25')
      expect(pm).toContain('>No. part<') // table column for the stored part no.
      expect(pm).not.toContain('aria-label="No. part 1"') // …but no input in the dialog
      const own = await render(FieldServiceDetail, w.users.staffA, ['laporan-servis', 'detail', String(plain.body.id)])
      expect(own).toContain('data-pk-action="service-edit"')
      expect(own).toContain('Perbaikan')
      expect(own).not.toContain('>No. part<') // neither a table column nor an editor column
      expect(own).not.toContain('aria-label="No. part 1"')
    } finally {
      await api('PATCH', `/api/service-types/${custom}`, w.users.admin, { active: true, changeReason: 'uji selesai' })
    }
  })
})
