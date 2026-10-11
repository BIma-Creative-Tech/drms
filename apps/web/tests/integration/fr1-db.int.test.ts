import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { SKIP_COMPANY_DEFAULTS } from '@/domain/company-defaults'
import { addDays } from '@/domain/field/rules'
import { resetRateLimits } from '@/lib/rate-limit'

import { api, sysCreate } from './flow-world'
import { makeFr1World, todayWita, uploadFieldPhoto, type Fr1World } from './fr1-world'
import { companyId, getTestPayload, sqlAs, sqlError, updateCompany } from './helpers'

/**
 * FR1 DB guards (migrations fr1_foundation / fr1_field_reports / fr1_security, ADR 0020 §6):
 * migration data (kind defaults, SV sequence, UoMs), unit master constraints, contract overlap,
 * unique unit+date, project-kind checks, immutability + 24 h window + override, cross-PT refusals,
 * photo limits, project kind frozen. Fictional data only.
 */
let w: Fr1World
let timesheetId: number
let serviceId: number

beforeAll(async () => {
  w = await makeFr1World('fr1db')
})
beforeEach(() => resetRateLimits())
afterAll(async () => {
  await updateCompany({ fieldReportsEnabled: false })
})

describe('migration data', () => {
  it('existing rows default: projects umum, vehicles kendaraan/sendiri/siap; SV sequence per PT; UoM codes once', async () => {
    const p = (await sqlAs('app', 'SELECT kind::text AS kind FROM projects WHERE id = $1', [w.project])).rows[0]
    expect(p.kind).toBe('umum')
    const v = (await sqlAs('app', 'SELECT kind::text AS kind, owner::text AS owner, status::text AS status, display_name FROM vehicles WHERE id = $1', [w.vehicle])).rows[0]
    expect(v).toMatchObject({ kind: 'kendaraan', owner: 'sendiri', status: 'siap' })
    expect(v.display_name).toMatch(/^KH /)
    const seq = await sqlAs('app', "SELECT pattern, reset_policy::text AS r, padding FROM document_sequences WHERE doc_type = 'service_report' AND company_id = $1", [await companyId()])
    expect(seq.rows[0]).toMatchObject({ pattern: 'SV/{COMPANY}/{YY}{MM}/{seq}', r: 'monthly' }) // D5 (migration 20261012_200100_d1010_data)
    const u = await sqlAs('app', "SELECT code, count(*)::int AS n FROM uoms WHERE code IN ('M3', 'HM', 'LTR', 'L', 'OH', 'TITIK') GROUP BY code ORDER BY code")
    expect(u.rows.map((r) => [r.code, r.n])).toEqual([['HM', 1], ['L', 1], ['LTR', 1], ['M3', 1], ['OH', 1], ['TITIK', 1]])
    const flag = (await sqlAs('app', 'SELECT field_reports_enabled FROM companies ORDER BY id LIMIT 1')).rows[0]
    expect(typeof flag.field_reports_enabled).toBe('boolean')
  })
})

describe('Unit & Kendaraan', () => {
  it('heavy equipment needs a unit code (unique per PT), a vehicle a plate; customer unit ⇔ client', async () => {
    const noCode = await api('POST', '/api/vehicles', w.users.admin, { kind: 'alat_berat', type: 'Excavator' })
    expect(noCode.status).toBe(400)
    expect(JSON.stringify(noCode.body)).toMatch(/Kode unit wajib/)
    const dup = await api('POST', '/api/vehicles', w.users.admin, { kind: 'alat_berat', unitCode: 'fr1db ex01', type: 'Excavator' })
    expect(dup.status).toBe(400)
    expect(JSON.stringify(dup.body)).toMatch(/sudah dipakai/)
    const ok = await api('POST', '/api/vehicles', w.users.admin, { kind: 'alat_berat', unitCode: 'fr1db-ex09', type: 'Wheel loader' })
    expect(ok.status, JSON.stringify(ok.body)).toBe(201)
    expect(ok.body.doc).toMatchObject({ unitCode: 'FR1DB-EX09', plateNo: null, displayName: 'FR1DB-EX09', status: 'siap', owner: 'sendiri' })
    const noPlate = await api('POST', '/api/vehicles', w.users.admin, { kind: 'kendaraan', type: 'Hilux' })
    expect(noPlate.status).toBe(400)
    const cust = await api('POST', '/api/vehicles', w.users.admin, { kind: 'alat_berat', unitCode: 'FR1DB-C9', type: 'Dozer', owner: 'pelanggan' })
    expect(cust.status).toBe(400)
    expect(JSON.stringify(cust.body)).toMatch(/Pelanggan wajib/)
    // DB: same rules (CHECK / partial unique index)
    expect((await sqlError('app', `UPDATE vehicles SET plate_no = NULL WHERE id = ${w.vehicle}`))?.code).toBe('23514')
    expect((await sqlError('app', `UPDATE vehicles SET owner = 'pelanggan' WHERE id = ${w.ex02}`))?.code).toBe('23514')
    expect((await sqlError('app', `UPDATE vehicles SET unit_code = 'FR1DB-EX01' WHERE id = ${w.ex02}`))?.code).toBe('23505')
    // status / HM are system fields
    const sys = await api('PATCH', `/api/vehicles/${w.ex02}`, w.users.admin, { status: 'rusak', lastHourMeter: 5 })
    expect([200, 403]).toContain(sys.status)
    expect((await sqlAs('app', 'SELECT status::text AS s, last_hour_meter FROM vehicles WHERE id = $1', [w.ex02])).rows[0]).toMatchObject({ s: 'siap', last_hour_meter: null })
  })
})

describe('contract units', () => {
  it('one unit is never ACTIVE in two overlapping contracts (hook 400 + DB trigger); own units of kontrak_unit projects only', async () => {
    const overlap = await api('POST', '/api/contract-units', w.users.admin, { project: w.kontrak, unit: w.ex01, startDate: addDays(w.today, -5), rateBasis: 'per_bulan', rate: 1 })
    expect(overlap.status).toBe(400)
    expect(JSON.stringify(overlap.body)).toMatch(/sudah aktif di kontrak lain/)
    const company = await companyId()
    const raw = await sqlError('app', `INSERT INTO contract_units (company_id, project_id, unit_id, start_date, rate_basis, rate, active) VALUES (${company}, ${w.kontrak}, ${w.ex01}, '${addDays(w.today, 3)}', 'per_jam', 1, true)`)
    expect(raw?.code).toBe('23514')
    expect(raw?.message).toMatch(/overlapping/)
    // adjacent period after an end date is fine; an inactive overlapping row is fine
    expect((await sqlError('app', `INSERT INTO contract_units (company_id, project_id, unit_id, start_date, end_date, rate_basis, rate, active) VALUES (${company}, ${w.kontrak}, ${w.ex02}, '2026-01-01', '2026-01-31', 'per_jam', 1, true)`))).toBeNull()
    expect((await sqlError('app', `INSERT INTO contract_units (company_id, project_id, unit_id, start_date, rate_basis, rate, active) VALUES (${company}, ${w.kontrak}, ${w.ex02}, '2026-01-15', 'per_jam', 1, false)`))).toBeNull()
    // wrong project kind / customer unit
    const wrongKind = await api('POST', '/api/contract-units', w.users.admin, { project: w.aftersales, unit: w.ex02, startDate: w.today, rateBasis: 'per_jam', rate: 1 })
    expect(wrongKind.status).toBe(400)
    expect((await sqlError('app', `INSERT INTO contract_units (company_id, project_id, unit_id, start_date, rate_basis, rate) VALUES (${company}, ${w.aftersales}, ${w.ex02}, '${w.today}', 'per_jam', 1)`))?.code).toBe('23514')
    expect((await sqlError('app', `INSERT INTO contract_units (company_id, project_id, unit_id, start_date, rate_basis, rate) VALUES (${company}, ${w.kontrak}, ${w.custUnit}, '${w.today}', 'per_jam', 1)`))?.code).toBe('23514')
    // no delete, unit/project immutable
    expect((await sqlError('app', `DELETE FROM contract_units WHERE id = ${w.contract}`))?.code).toBe('42501')
    expect((await sqlError('app', `UPDATE contract_units SET unit_id = ${w.ex02} WHERE id = ${w.contract}`))?.code).toBe('42501')
  })
})

describe('field reports: DB guards', () => {
  it('a created timesheet gets DB clock + 24 h window; unique unit + date; kind and contract checked by the DB', async () => {
    const photo = await uploadFieldPhoto(w.users.staffA)
    expect(photo.status, JSON.stringify(photo.body)).toBe(201)
    const r = await api('POST', '/api/v1/unit-timesheets', w.users.staffA, { projectId: w.kontrak, unitId: w.ex01, reportDate: addDays(w.today, -1), hmStart: 1000, hmEnd: 1008, workHours: 8, hmPhotoId: photo.id })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    timesheetId = r.body.id
    const row = (await sqlAs('app', 'SELECT received_at, editable_until FROM unit_timesheets WHERE id = $1', [timesheetId])).rows[0]
    expect(new Date(row.editable_until).getTime() - new Date(row.received_at).getTime()).toBe(24 * 3_600_000)
    const company = await companyId()
    const base = `(company_id, project_id, unit_id, contract_unit_id, report_date, reporter_id, hm_start, hm_end, work_hours)`
    // unique unit + date
    expect((await sqlError('app', `INSERT INTO unit_timesheets ${base} VALUES (${company}, ${w.kontrak}, ${w.ex01}, ${w.contract}, '${addDays(w.today, -1)}', ${w.users.staffA.id}, 1, 2, 1)`))?.code).toBe('23505')
    // outside the contract period / Σ hours > 24 / HM end < start
    expect((await sqlError('app', `INSERT INTO unit_timesheets ${base} VALUES (${company}, ${w.kontrak}, ${w.ex01}, ${w.contract}, '2025-01-01', ${w.users.staffA.id}, 1, 2, 1)`))?.message).toMatch(/not in an active contract/)
    expect((await sqlError('app', `INSERT INTO unit_timesheets ${base} VALUES (${company}, ${w.kontrak}, ${w.ex01}, ${w.contract}, '${addDays(w.today, -2)}', ${w.users.staffA.id}, 1, 2, 25)`))?.code).toBe('23514')
    expect((await sqlError('app', `INSERT INTO unit_timesheets ${base} VALUES (${company}, ${w.kontrak}, ${w.ex01}, ${w.contract}, '${addDays(w.today, -2)}', ${w.users.staffA.id}, 5, 2, 1)`))?.code).toBe('23514')
    // wrong project kind for a service report / an activity
    expect((await sqlError('app', `INSERT INTO service_reports (company_id, project_id, unit_id, report_date, reporter_id, service_type, action, unit_status_after) VALUES (${company}, ${w.project}, ${w.ex02}, '${w.today}', ${w.users.pm.id}, 'inspeksi', 'cek', 'siap')`))?.message).toMatch(/kontrak_unit\/aftersales only/)
    expect((await sqlError('app', `INSERT INTO aftersales_activities (company_id, project_id, activity_date, reporter_id, client_id, kind) VALUES (${company}, ${w.kontrak}, '${w.today}', ${w.users.pm.id}, ${w.client}, 'kunjungan')`))?.message).toMatch(/aftersales only/)
    // PO status only on po_masuk; relates_to must be a PO of the same customer
    expect((await sqlError('app', `INSERT INTO aftersales_activities (company_id, project_id, activity_date, reporter_id, client_id, kind, po_status) VALUES (${company}, ${w.aftersales}, '${w.today}', ${w.users.pm.id}, ${w.client}, 'kunjungan', 'sebagian')`))?.code).toBe('23514')
  })

  it('no DELETE; UPDATE after the window only with the correction/system override; identity columns immutable', async () => {
    const photo = await uploadFieldPhoto(w.users.staffA)
    const sr = await api('POST', '/api/v1/service-reports', w.users.staffA, { projectId: w.kontrak, unitId: w.ex01, serviceType: 'servis_berkala', action: 'Ganti oli mesin + filter', unitStatusAfter: 'siap', hourMeter: 1010, photoIds: [photo.id] })
    expect(sr.status, JSON.stringify(sr.body)).toBe(201)
    serviceId = sr.body.id
    expect((await sqlError('app', `DELETE FROM service_reports WHERE id = ${serviceId}`))?.code).toBe('42501')
    expect((await sqlError('owner', `DELETE FROM service_reports WHERE id = ${serviceId}`))?.code).toBe('42501')
    expect((await sqlError('app', `DELETE FROM unit_timesheets WHERE id = ${timesheetId}`))?.code).toBe('42501')
    expect((await sqlError('app', `UPDATE service_reports SET doc_no = 'X' WHERE id = ${serviceId}`))?.code).toBe('42501')
    expect((await sqlError('app', `UPDATE service_reports SET unit_id = ${w.ex02} WHERE id = ${serviceId}`))?.code).toBe('42501')
    expect((await sqlError('app', `UPDATE service_reports SET received_at = now() WHERE id = ${serviceId}`))?.code).toBe('42501')
    // inside the window an UPDATE of content passes
    expect(await sqlError('app', `UPDATE service_reports SET notes = 'dalam jendela' WHERE id = ${serviceId}`)).toBeNull()
    // close the window (test-only: owner disables the identity guard for one statement)
    await sqlAs('owner', `ALTER TABLE service_reports DISABLE TRIGGER service_reports_protect; UPDATE service_reports SET editable_until = now() - interval '1 minute' WHERE id = ${serviceId}; ALTER TABLE service_reports ENABLE TRIGGER service_reports_protect;`)
    expect((await sqlError('app', `UPDATE service_reports SET notes = 'lewat jendela' WHERE id = ${serviceId}`))?.code).toBe('42501')
    expect(await sqlError('app', `BEGIN; SELECT set_config('pk.field_override', 'correction', true); UPDATE service_reports SET notes = 'koreksi' WHERE id = ${serviceId}; COMMIT;`)).toBeNull()
    // 'system' allows only po_status / flags / sync_rev
    expect((await sqlError('app', `BEGIN; SELECT set_config('pk.field_override', 'system', true); UPDATE service_reports SET notes = 'sistem' WHERE id = ${serviceId}; COMMIT;`))?.code).toBe('42501')
    expect(await sqlError('app', `BEGIN; SELECT set_config('pk.field_override', 'system', true); UPDATE service_reports SET sync_rev = sync_rev + 1 WHERE id = ${serviceId}; COMMIT;`)).toBeNull()
  })

  it('cross-PT references are rejected by the DB (unit / client / contract of another PT)', async () => {
    const p = await getTestPayload()
    const other = (await p.create({ collection: 'companies', data: { name: 'PT FR1 Lain', shortCode: 'FRDBX', timezone: 'Asia/Makassar', active: false } as never, depth: 0, overrideAccess: true, context: { [SKIP_COMPANY_DEFAULTS]: true } })).id as number
    const foreignUnit = (await sqlAs('owner', `INSERT INTO vehicles (company_id, kind, unit_code, type, owner) VALUES (${other}, 'alat_berat', 'X-EX01', 'Excavator', 'sendiri') RETURNING id`)).rows[0].id as number
    const foreignClient = (await sqlAs('owner', `INSERT INTO clients (company_id, name) VALUES (${other}, 'Klien PT lain') RETURNING id`)).rows[0].id as number
    const company = await companyId()
    const sv = await sqlError('app', `INSERT INTO service_reports (company_id, project_id, unit_id, report_date, reporter_id, service_type, action, unit_status_after) VALUES (${company}, ${w.kontrak}, ${foreignUnit}, '${w.today}', ${w.users.pm.id}, 'inspeksi', 'cek', 'siap')`)
    expect(sv?.code).toBe('23514')
    expect(sv?.message).toMatch(/cross-company reference/)
    expect((await sqlError('app', `INSERT INTO aftersales_activities (company_id, project_id, activity_date, reporter_id, client_id, kind) VALUES (${company}, ${w.aftersales}, '${w.today}', ${w.users.pm.id}, ${foreignClient}, 'kunjungan')`))?.message).toMatch(/cross-company reference/)
    expect((await sqlError('app', `UPDATE vehicles SET owner = 'pelanggan', client_id = ${foreignClient} WHERE id = ${w.ex02}`))?.message).toMatch(/cross-company reference/)
    expect((await sqlError('app', `UPDATE service_reports SET company_id = ${other} WHERE id = ${serviceId}`))?.code).toBe('42501')
    // API: a unit of another PT is answered like a missing one
    const api404 = await api('POST', '/api/v1/service-reports', w.users.pm, { projectId: w.kontrak, unitId: foreignUnit, serviceType: 'inspeksi', action: 'cek unit', unitStatusAfter: 'siap' })
    expect(api404.status).toBe(404)
  })

  it('photos: owner PT derived by the DB; at most 1 HM photo per timesheet', async () => {
    const own = (await sqlAs('app', "SELECT owner_company_id FROM media_progress_photos WHERE owner_doc_type = 'unit_timesheet' AND owner_doc_id = $1", [String(timesheetId)])).rows
    expect(own).toHaveLength(1)
    expect(own[0].owner_company_id).toBe(await companyId())
    const extra = await uploadFieldPhoto(w.users.staffA)
    const e = await sqlError('app', `UPDATE media_progress_photos SET owner_doc_type = 'unit_timesheet', owner_doc_id = '${timesheetId}' WHERE id = ${extra.id}`)
    expect(e?.code).toBe('23514')
    expect(e?.message).toMatch(/already has 1 photo/)
  })

  it('the project kind is frozen once field data exists (hook 409 + DB trigger)', async () => {
    const r = await api('PATCH', `/api/projects/${w.kontrak}`, w.users.owner, { kind: 'aftersales' })
    expect(r.status).toBe(409)
    expect((await sqlError('app', `UPDATE projects SET kind = 'umum' WHERE id = ${w.kontrak}`))?.message).toMatch(/cannot change/)
    // a project without field data changes kind (the Admin may change the kind)
    const fresh = await sysCreate('projects', { code: 'fr1db-P9', name: 'fr1db kosong', pm: w.users.pm.id, status: 'perencanaan' })
    const admin = await api('PATCH', `/api/projects/${fresh}`, w.users.admin, { kind: 'trading' })
    expect(admin.status, JSON.stringify(admin.body)).toBe(200)
    expect(admin.body.doc.kind).toBe('trading')
    // owner decision 2026-10-09 (reverses QA-20(b)): the Admin edits projects like the Direktur
    const adminName = await api('PATCH', `/api/projects/${fresh}`, w.users.admin, { kind: 'aftersales', name: 'diubah admin' })
    expect(adminName.status, JSON.stringify(adminName.body)).toBe(200)
    expect(adminName.body.doc).toMatchObject({ kind: 'aftersales', name: 'diubah admin' })
    // the PM may edit the team's projects but not the kind (field access: Direktur/Admin)
    await api('PATCH', `/api/projects/${fresh}`, w.users.pm, { kind: 'umum' })
    const after = (await sqlAs('owner', 'SELECT kind::text AS kind FROM projects WHERE id = $1', [fresh])).rows[0] as { kind: string }
    expect(after.kind).toBe('aftersales')
    expect(todayWita()).toBe(w.today)
  })
})
