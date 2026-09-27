import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { handleEndpoints } from 'payload'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { resetAppConfigCache } from '@/api/v1/endpoints/app'
import { lateProgressProjects, notifyLateProgressReport } from '@/domain/progress/reminders'
import { resetRateLimits } from '@/lib/rate-limit'
import { mediaPath } from '@/lib/media-files'
import config from '@/payload.config'

import { accessToken, auditRows, getTestPayload, http, installLocalJwks, registerDevice, sqlAs, sqlError, type TestUser } from './helpers'
import { api, asUser, makeWorld, ORIGIN, sysCreate, type FlowUser, type World } from './flow-world'

/**
 * E4 backend (plan fase1-golive §E4, T11, US-10/11/12/29/31): stage weights = 100 % (G11), progress
 * reports + photos, project progress recalculation, role scoping (negative authz), offline sync
 * (idempotent replay, conflicts), audit rows, K-09 data, E7 hook points. Fictional data only.
 */
let w: World
let stageA: number // Persiapan 30 %
let stageB: number // Struktur 70 %
let firstReport: number
let firstPhotos: number[] = []

type Mobile = { user: FlowUser; token: string; device: string }

async function mobile(user: FlowUser, roles: string[]): Promise<Mobile> {
  const p = await getTestPayload()
  const doc = await p.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })
  const t: TestUser = { ...user, keycloakSub: doc.keycloakSub as string }
  const token = await accessToken(t, roles)
  return { user, token, device: await registerDevice(t, token) }
}
const bearer = (m: Mobile) => ({ Authorization: `Bearer ${m.token}`, 'X-Device-Id': m.device, 'X-App-Version': '1.0.0' })

/** A photo-like JPEG (gradient + shapes) with EXIF incl. GPS, larger than the 1600 px target. */
async function cameraJpeg(seed = 1, width = 2400, height = 1800): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(${(seed * 40) % 255},120,90)"/><stop offset="1" stop-color="rgb(30,${(seed * 70) % 255},160)"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${600 + seed * 10}" cy="700" r="300" fill="#eee"/><rect x="1300" y="400" width="600" height="900" fill="#333"/></svg>`
  return sharp(Buffer.from(svg))
    .jpeg({ quality: 92 })
    .withExif({ IFD0: { Make: 'PhoneCo', Model: 'Test 1' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '2/1 12/1 36/1', GPSLongitudeRef: 'E', GPSLongitude: '113/1 54/1 36/1' } })
    .toBuffer()
}

async function uploadPhoto(auth: { cookie?: string; mobile?: Mobile }, seed = Math.floor(Math.random() * 200)): Promise<{ status: number; body: { id: number; width: number; height: number; filesize: number } }> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(await cameraJpeg(seed))], { type: 'image/jpeg' }), 'foto.jpg')
  const headers: Record<string, string> = auth.mobile ? bearer(auth.mobile) : { Origin: ORIGIN, Cookie: auth.cookie! }
  const res = await handleEndpoints({ config, request: new Request(`${ORIGIN}/api/v1/media/progress-photos`, { method: 'POST', headers, body: form }) })
  return { status: res.status, body: (await res.json()) as { id: number; width: number; height: number; filesize: number } }
}

async function photo(u: FlowUser): Promise<number> {
  const r = await uploadPhoto({ cookie: u.cookie })
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body.id
}

const stagesBody = (over: Array<Record<string, unknown>> = []) => ({
  stages: [
    { name: 'Persiapan', weightPct: 30, sequence: 1 },
    { name: 'Struktur', weightPct: 70, sequence: 2 },
    ...over,
  ],
})

async function projectPct(id: number): Promise<number> {
  return Number((await sqlAs('app', 'SELECT progress_pct FROM projects WHERE id = $1', [id])).rows[0].progress_pct)
}
async function stagePct(id: number): Promise<number> {
  return Number((await sqlAs('app', 'SELECT progress_pct FROM project_stages WHERE id = $1', [id])).rows[0].progress_pct)
}

beforeAll(async () => {
  installLocalJwks()
  w = await makeWorld('prg')
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  const p = await getTestPayload()
  await p.updateGlobal({ slug: 'company-settings', data: { syncProgressReportsEnabled: true }, overrideAccess: true /* SYSTEM-WRITE: fixture reset */ })
  resetAppConfigCache()
})

describe('stage editor (G11: weights = 100 %)', () => {
  it('rejects a set that is not 100 %, Staff/Finance/other PM; PM cannot add stages; Direktur saves 30/70', async () => {
    const bad = await api('PUT', `/api/v1/projects/${w.project}/stages`, w.users.owner, { stages: [{ name: 'Persiapan', weightPct: 30, sequence: 1 }, { name: 'Struktur', weightPct: 60, sequence: 2 }] })
    expect(bad.status).toBe(400)
    expect(bad.body.title).toMatch(/Total bobot harus 100% \(sekarang 90%\)/)
    expect((await api('PUT', `/api/v1/projects/${w.project}/stages`, w.users.staffA, stagesBody())).status).toBe(403)
    expect((await api('PUT', `/api/v1/projects/${w.project}/stages`, w.users.finance, stagesBody())).status).toBe(403)
    expect((await api('PUT', `/api/v1/projects/${w.project}/stages`, w.users.otherPm, stagesBody())).status).toBe(404)
    const pmAdd = await api('PUT', `/api/v1/projects/${w.project}/stages`, w.users.pm, stagesBody())
    expect(pmAdd.status).toBe(403)
    expect(pmAdd.body.code).toBe('FORBIDDEN')
    const ok = await api('PUT', `/api/v1/projects/${w.project}/stages`, w.users.owner, stagesBody())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body).toMatchObject({ weightSum: 100, complete: true, progressPct: 0 })
    stageA = ok.body.stages.find((s: { name: string }) => s.name === 'Persiapan').id
    stageB = ok.body.stages.find((s: { name: string }) => s.name === 'Struktur').id
    expect((await auditRows('project_stage', stageA)).map((r) => r.action)).toContain('create')
  })

  it('single-stage writes in the admin/REST path cannot break a complete set; an empty project can be built up to 100 %', async () => {
    const add = await api('POST', '/api/project-stages', w.users.owner, { project: w.project, name: 'Finishing', weightPct: 10, sequence: 3 })
    expect(add.status).toBe(400)
    expect(JSON.stringify(add.body)).toMatch(/sudah 100%/)
    const rew = await api('PATCH', `/api/project-stages/${stageA}`, w.users.owner, { weightPct: 20, changeReason: 'uji bobot' })
    expect(rew.status).toBe(400)
    const fresh = await sysCreate('projects', { code: 'prg-P3', name: 'e4 build-up', pm: w.users.pm.id, budget: 10_000_000, status: 'berjalan' })
    expect((await api('POST', '/api/project-stages', w.users.owner, { project: fresh, name: 'A', weightPct: 40, sequence: 1 })).status).toBe(201)
    const over = await api('POST', '/api/project-stages', w.users.owner, { project: fresh, name: 'B', weightPct: 70, sequence: 2 })
    expect(over.status).toBe(400)
    expect(JSON.stringify(over.body)).toMatch(/melebihi 100%/)
    // incomplete set → reports are refused (409 WEIGHTS_INCOMPLETE)
    const stageFresh = (await sqlAs('app', 'SELECT id FROM project_stages WHERE project_id = $1', [fresh])).rows[0].id as number
    const r = await api('POST', '/api/v1/progress-reports', w.users.pm, { projectId: fresh, stageId: stageFresh, pctAfter: 10, work: 'Pembersihan lahan' })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('WEIGHTS_INCOMPLETE')
  })

  it('stage % and project % cannot be written directly (REST 403, DB 42501)', async () => {
    const s = await api('PATCH', `/api/project-stages/${stageA}`, w.users.owner, { progressPct: 99 })
    expect(s.status).toBe(403)
    const p = await api('PATCH', `/api/projects/${w.project}`, w.users.owner, { progressPct: 99 })
    expect(p.status).toBe(403)
    const c = await api('POST', '/api/project-stages', w.users.owner, { project: w.otherProject, name: 'X', weightPct: 10, sequence: 1, progressPct: 50 })
    expect(c.status).toBe(403)
    expect((await sqlError('app', `UPDATE project_stages SET progress_pct = 99 WHERE id = ${stageA}`))?.code).toBe('42501')
    expect((await sqlError('app', `UPDATE projects SET progress_pct = 99 WHERE id = ${w.project}`))?.code).toBe('42501')
    expect(await stagePct(stageA)).toBe(0)
    expect(await projectPct(w.project)).toBe(0)
  })
})

describe('progress reports (T11, US-10)', () => {
  it('photo pipeline: resized ≤ 1600 px, ≤ 400 KB, EXIF/GPS stripped, JPEG', async () => {
    const r = await uploadPhoto({ cookie: w.users.pm.cookie }, 7)
    expect(r.status).toBe(201)
    expect(Math.max(r.body.width, r.body.height)).toBeLessThanOrEqual(1600)
    expect(r.body.filesize).toBeLessThanOrEqual(400 * 1024)
    const p = await getTestPayload()
    const doc = (await p.findByID({ collection: 'media-progress-photos', id: r.body.id, depth: 0, overrideAccess: true /* SYSTEM-READ: test */ })) as { filename: string; mimeType: string }
    expect(doc.mimeType).toBe('image/jpeg')
    const meta = await sharp(await readFile(mediaPath(p, 'media-progress-photos', doc.filename)!)).metadata()
    expect(meta.exif).toBeUndefined()
    expect(meta.width).toBeLessThanOrEqual(1600)
    // Staff / Finance cannot upload progress photos
    expect((await uploadPhoto({ cookie: w.users.staffA.cookie })).status).toBe(403)
    expect((await uploadPhoto({ cookie: w.users.finance.cookie })).status).toBe(403)
  })

  it('AC: PM reports 50 % on the 30 % stage → project +15 points in the same transaction, audited before → after', async () => {
    firstPhotos = [await photo(w.users.pm), await photo(w.users.pm)]
    const r = await api('POST', '/api/v1/progress-reports', w.users.pm, { projectId: w.project, stageId: stageA, pctAfter: 50, work: 'Pembersihan lahan dan bouwplank', issues: 'Hujan sore', photoIds: firstPhotos })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    firstReport = r.body.id
    expect(r.body).toMatchObject({ pctBefore: 0, pctAfter: 50, projectPctBefore: 0, projectPctAfter: 15, offline: false, source: 'web', editable: true, rev: 1 })
    expect(r.body.docNo).toMatch(/^LP\/\d{4}\/\d{4}$/)
    expect(r.body.photos.map((x: { id: number }) => x.id)).toEqual(firstPhotos)
    expect(await stagePct(stageA)).toBe(50)
    expect(await projectPct(w.project)).toBe(15)
    // DB clock + 24 h window
    const row = (await sqlAs('app', 'SELECT received_at, editable_until FROM progress_reports WHERE id = $1', [firstReport])).rows[0]
    expect(new Date(row.editable_until).getTime() - new Date(row.received_at).getTime()).toBe(24 * 3_600_000)
    // audit: stage % 0 → 50, project % 0 → 15, report create rows, photos, number issued
    const stageAudit = (await auditRows('project_stage', stageA)).filter((a) => a.field === 'progressPct')
    expect(stageAudit.at(-1)).toMatchObject({ action: 'update', old_value: { v: 0 }, new_value: { v: 50 } })
    const projAudit = (await auditRows('project', w.project)).filter((a) => a.field === 'progressPct')
    expect(projAudit.at(-1)).toMatchObject({ action: 'update', old_value: { v: 0 }, new_value: { v: 15 } })
    const repAudit = await auditRows('progress_report', firstReport)
    expect(repAudit.filter((a) => a.action === 'create').map((a) => a.field)).toEqual(expect.arrayContaining(['docNo', 'pctBefore', 'pctAfter', 'work', 'photos']))
    const txs = new Set([...repAudit.filter((a) => a.action === 'create').map((a) => a.tx_id), projAudit.at(-1)!.tx_id, stageAudit.at(-1)!.tx_id])
    expect(txs.size).toBe(1) // one transaction
  })

  it('a second report on the other stage adds weight × %; progress never goes down; idempotent clientUuid', async () => {
    const clientUuid = randomUUID()
    const body = { projectId: w.project, stageId: stageB, pctAfter: 10, work: 'Galian pondasi', clientUuid }
    const r1 = await api('POST', '/api/v1/progress-reports', w.users.pm, body)
    expect(r1.status).toBe(201)
    expect(await projectPct(w.project)).toBe(22) // 15 + 70 × 10 %
    const r2 = await api('POST', '/api/v1/progress-reports', w.users.pm, body)
    expect(r2.status).toBe(200)
    expect(r2.body.id).toBe(r1.body.id)
    expect((await sqlAs('app', 'SELECT count(*)::int AS n FROM progress_reports WHERE client_uuid = $1', [clientUuid])).rows[0].n).toBe(1)
    const down = await api('POST', '/api/v1/progress-reports', w.users.pm, { projectId: w.project, stageId: stageA, pctAfter: 40, work: 'Koreksi' })
    expect(down.status).toBe(409)
    expect(down.body.code).toBe('PROGRESS_DECREASED')
    const wrongStage = await api('POST', '/api/v1/progress-reports', w.users.pm, { projectId: w.otherProject, stageId: stageA, pctAfter: 60, work: 'Salah project' })
    expect(wrongStage.status).toBe(403) // not the PM of otherProject (checked first)
    const direkturWrongStage = await api('POST', '/api/v1/progress-reports', w.users.owner, { projectId: w.otherProject, stageId: stageA, pctAfter: 60, work: 'Salah project' })
    expect(direkturWrongStage.status).toBe(400)
  })

  it('negative authz: Staff, Finance, Admin and a PM of another project cannot create (403 + access_denied audit); Direktur can', async () => {
    const body = { projectId: w.project, stageId: stageA, pctAfter: 55, work: 'Uji hak akses' }
    for (const u of [w.users.staffA, w.users.finance, w.users.admin, w.users.otherPm]) {
      const r = await api('POST', '/api/v1/progress-reports', u, body)
      expect(r.status, u.email).toBe(403)
      expect(r.body.code).toBe('FORBIDDEN')
    }
    const denied = await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE doc_type = 'progress_report' AND action = 'access_denied' AND user_id = $1", [String(w.users.staffA.id)])
    expect(denied.rows[0].n).toBeGreaterThanOrEqual(1)
    const d = await api('POST', '/api/v1/progress-reports', w.users.owner, { ...body, pctAfter: 60 })
    expect(d.status, JSON.stringify(d.body)).toBe(201)
    expect(await projectPct(w.project)).toBe(25) // 30 × 60 % + 70 × 10 %
    // the collection itself is closed for HTTP writes
    expect((await api('POST', '/api/progress-reports', w.users.owner, { project: w.project, stage: stageA, work: 'x', pctBefore: 0, pctAfter: 1, reportDate: '2026-09-26', reporter: w.users.owner.id })).status).toBe(403)
  })

  it('photo limit: 6 photos refused at create (400), adding beyond 5 on edit refused (PHOTO_LIMIT), foreign photo refused', async () => {
    const six = await api('POST', '/api/v1/progress-reports', w.users.pm, { projectId: w.project, stageId: stageB, pctAfter: 12, work: 'Enam foto', photoIds: [1, 2, 3, 4, 5, 6] })
    expect(six.status).toBe(400)
    const four = [await photo(w.users.pm), await photo(w.users.pm), await photo(w.users.pm), await photo(w.users.pm)]
    const edit = await api('PATCH', `/api/v1/progress-reports/${firstReport}`, w.users.pm, { addPhotoIds: four, reason: 'tambah foto' })
    expect(edit.status).toBe(400)
    expect(edit.body.code).toBe('PHOTO_LIMIT')
    const three = await api('PATCH', `/api/v1/progress-reports/${firstReport}`, w.users.pm, { addPhotoIds: four.slice(0, 3), reason: 'tambah foto' })
    expect(three.status, JSON.stringify(three.body)).toBe(200)
    expect(three.body.photos).toHaveLength(5)
    const foreign = await photo(w.users.owner)
    const f = await api('POST', '/api/v1/progress-reports', w.users.pm, { projectId: w.project, stageId: stageB, pctAfter: 12, work: 'Foto orang lain', photoIds: [foreign] })
    expect(f.status).toBe(403)
    const reused = await api('POST', '/api/v1/progress-reports', w.users.pm, { projectId: w.project, stageId: stageB, pctAfter: 12, work: 'Foto dipakai ulang', photoIds: [firstPhotos[0]] })
    expect(reused.status).toBe(409)
    expect(reused.body.code).toBe('MEDIA_IN_USE')
    // DB: a 6th owner link is refused even for the owner role path
    const sixth = await photo(w.users.pm)
    expect((await sqlError('app', `UPDATE media_progress_photos SET owner_doc_type = 'progress_report', owner_doc_id = '${firstReport}' WHERE id = ${sixth}`))?.code).toBe('23514')
  })

  it('edit: reporter only, reason required, pct correction only on the latest report of the stage; 24 h window (API 409, DB 42501)', async () => {
    expect((await api('PATCH', `/api/v1/progress-reports/${firstReport}`, w.users.pm, { work: 'Tanpa alasan' })).status).toBe(400)
    const other = await api('PATCH', `/api/v1/progress-reports/${firstReport}`, w.users.owner, { work: 'Bukan pelapor', reason: 'uji' + ' edit' })
    expect(other.status).toBe(403)
    const notLatest = await api('PATCH', `/api/v1/progress-reports/${firstReport}`, w.users.pm, { pctAfter: 55, reason: 'koreksi persen' })
    expect(notLatest.status).toBe(409) // the Direktur's 60 % report is the latest of stage A
    const ok = await api('PATCH', `/api/v1/progress-reports/${firstReport}`, w.users.pm, { work: 'Pembersihan lahan, bouwplank, direksi keet', reason: 'lengkapi uraian' })
    expect(ok.status).toBe(200)
    expect(ok.body.rev).toBeGreaterThanOrEqual(3)
    const upd = (await auditRows('progress_report', firstReport)).filter((a) => a.action === 'update' && a.field === 'work')
    expect(upd.at(-1)?.reason).toBe('lengkapi uraian')
    // close the window (test-only: owner disables the identity guard for one statement)
    await sqlAs('owner', `ALTER TABLE progress_reports DISABLE TRIGGER progress_reports_protect; UPDATE progress_reports SET editable_until = now() - interval '1 minute' WHERE id = ${firstReport}; ALTER TABLE progress_reports ENABLE TRIGGER progress_reports_protect;`)
    const late = await api('PATCH', `/api/v1/progress-reports/${firstReport}`, w.users.pm, { work: 'Terlambat', reason: 'lewat 24 jam' })
    expect(late.status).toBe(409)
    expect(late.body.code).toBe('NOT_EDITABLE')
    expect((await sqlError('app', `UPDATE progress_reports SET work = 'x' WHERE id = ${firstReport}`))?.code).toBe('42501')
    expect((await sqlError('app', `DELETE FROM progress_reports WHERE id = ${firstReport}`))?.code).toBe('42501')
    expect((await sqlError('app', `UPDATE progress_reports SET project_id = ${w.otherProject} WHERE id = ${firstReport}`))?.code).toBe('42501')
  })

  it('latest-report correction recalculates the project; below pctBefore is refused', async () => {
    const r = await api('POST', '/api/v1/progress-reports', w.users.pm, { projectId: w.project, stageId: stageB, pctAfter: 20, work: 'Pondasi foot plat' })
    expect(r.status).toBe(201)
    expect(await projectPct(w.project)).toBe(32) // 18 + 14
    const fix = await api('PATCH', `/api/v1/progress-reports/${r.body.id}`, w.users.pm, { pctAfter: 30, reason: 'salah input persen' })
    expect(fix.status, JSON.stringify(fix.body)).toBe(200)
    expect(fix.body.projectPctAfter).toBe(39)
    expect(await stagePct(stageB)).toBe(30)
    expect(await projectPct(w.project)).toBe(39)
    const below = await api('PATCH', `/api/v1/progress-reports/${r.body.id}`, w.users.pm, { pctAfter: 5, reason: 'turun' })
    expect(below.status).toBe(409)
  })

  it('re-weighting through the editor recalculates the project progress (reason required)', async () => {
    const noReason = await api('PUT', `/api/v1/projects/${w.project}/stages`, w.users.pm, { stages: [{ id: stageA, name: 'Persiapan', weightPct: 20, sequence: 1 }, { id: stageB, name: 'Struktur', weightPct: 80, sequence: 2 }] })
    expect(noReason.status).toBe(400)
    const ok = await api('PUT', `/api/v1/projects/${w.project}/stages`, w.users.pm, { stages: [{ id: stageA, name: 'Persiapan', weightPct: 20, sequence: 1 }, { id: stageB, name: 'Struktur', weightPct: 80, sequence: 2 }], reason: 'revisi RAB tahapan' })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.progressPct).toBe(36) // 20 × 60 % + 80 × 30 %
    const weightAudit = (await auditRows('project_stage', stageA)).filter((a) => a.field === 'weightPct')
    expect(weightAudit.at(-1)).toMatchObject({ old_value: { v: 30 }, new_value: { v: 20 }, reason: 'revisi RAB tahapan' })
  })
})

describe('read scope (US-31) and photo files', () => {
  it('PM team / Direktur / Finance read, newest first, filter by project; other PM and Staff see nothing', async () => {
    const pm = await api('GET', `/api/v1/progress-reports?project=${w.project}`, w.users.pm)
    expect(pm.status).toBe(200)
    const ids = pm.body.items.map((i: { id: number }) => i.id)
    expect(ids.length).toBeGreaterThanOrEqual(4)
    expect([...ids].sort((a: number, b: number) => b - a)).toEqual(ids)
    expect((await api('GET', '/api/v1/progress-reports', w.users.finance)).body.items.length).toBeGreaterThanOrEqual(4)
    expect((await api('GET', '/api/v1/progress-reports', w.users.owner)).body.items.length).toBeGreaterThanOrEqual(4)
    expect((await api('GET', `/api/v1/progress-reports?project=${w.project}`, w.users.otherPm)).body.items).toEqual([])
    expect((await api('GET', '/api/v1/progress-reports', w.users.staffA)).body.items).toEqual([])
    expect((await api('GET', `/api/v1/progress-reports/${firstReport}`, w.users.otherPm)).status).toBe(404)
    expect((await api('GET', `/api/v1/progress-reports/${firstReport}`, w.users.staffA)).status).toBe(404)
    const page = await api('GET', `/api/v1/progress-reports?project=${w.project}&limit=2`, w.users.owner)
    expect(page.body.items).toHaveLength(2)
    const next = await api('GET', `/api/v1/progress-reports?project=${w.project}&limit=2&cursor=${page.body.nextCursor}`, w.users.owner)
    expect(next.body.items[0].id).toBeLessThan(page.body.items[1].id)
  })

  it('photo file endpoint: readers of the report get the JPEG; other PM / Staff get 404', async () => {
    const id = firstPhotos[0]
    const pm = await api('GET', `/api/v1/media/progress-photos/${id}/file`, w.users.pm)
    expect(pm.status).toBe(200)
    expect(pm.headers.get('content-type')).toBe('image/jpeg')
    expect(pm.headers.get('cache-control')).toBe('private, no-store')
    expect((await api('GET', `/api/v1/media/progress-photos/${id}/file?variant=thumb`, w.users.finance)).status).toBe(200)
    expect((await api('GET', `/api/v1/media/progress-photos/${id}/file`, w.users.otherPm)).status).toBe(404)
    expect((await api('GET', `/api/v1/media/progress-photos/${id}/file`, w.users.staffA)).status).toBe(404)
  })
})

describe('offline sync progress_report.draft_upsert (ADR 0010 rules)', () => {
  let pmMobile: Mobile
  let staffMobile: Mobile

  async function sync(m: Mobile, items: Array<Record<string, unknown>>) {
    resetRateLimits()
    const now = Date.now()
    const clock = { device_time: new Date(now).toISOString(), elapsed_ms: 10_000_000, boot_id: 'boot-1', last_server_time: new Date(now - 600_000).toISOString(), last_server_elapsed_ms: 10_000_000 - 600_000 }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return http('POST', '/api/v1/sync/batch', { headers: bearer(m), json: { batch_id: randomUUID(), device_id: m.device, clock, items } }) as Promise<{ status: number; body: any }>
  }
  function item(p: Record<string, unknown>, over: Record<string, unknown> = {}) {
    return { client_uuid: randomUUID(), type: 'progress_report.draft_upsert', schema_version: 1, offline: true, device_time: new Date(Date.now() - 300_000).toISOString(), elapsed_ms: 10_000_000 - 300_000, payload: p, ...over }
  }

  beforeAll(async () => {
    pmMobile = await mobile(w.users.pm, ['pk-pm'])
    staffMobile = await mobile(w.users.staffA, ['pk-staff'])
  })

  it('enabled by default in app config; offline report applied once with OFFLINE flag + estimated time; replay = duplicate', async () => {
    resetAppConfigCache()
    expect(((await http('GET', '/api/v1/app/config')).body as { features: { syncProgressReports: boolean } }).features.syncProgressReports).toBe(true)
    const up = await uploadPhoto({ mobile: pmMobile })
    expect(up.status).toBe(201)
    const it1 = item({ project_id: w.project, stage_id: stageB, pct_after: 35, work: 'Bekisting sloof (offline)', photo_media_ids: [up.body.id] })
    const r = await sync(pmMobile, [it1])
    expect(r.status).toBe(200)
    const res = r.body.results[0]
    expect(res, JSON.stringify(r.body)).toMatchObject({ status: 'applied', time_trust: 'estimated', rev: 1, server_copy: null })
    expect(res.flags).toContain('OFFLINE')
    expect(res.server_report).toMatchObject({ client_uuid: it1.client_uuid, pct_before: 30, pct_after: 35, offline: true, photo_media_ids: [up.body.id] })
    const id = Number(res.server_id)
    const row = (await sqlAs('app', 'SELECT offline, time_trust, source, client_uuid FROM progress_reports WHERE id = $1', [id])).rows[0]
    expect(row).toMatchObject({ offline: true, time_trust: 'estimated', source: 'apk', client_uuid: it1.client_uuid })
    expect(await projectPct(w.project)).toBe(40) // 20 × 60 % + 80 × 35 %
    const again = await sync(pmMobile, [it1])
    expect(again.body.results[0]).toMatchObject({ status: 'duplicate', original_status: 'applied', server_id: String(id) })
    expect((await sqlAs('app', 'SELECT count(*)::int AS n FROM progress_reports WHERE client_uuid = $1', [it1.client_uuid])).rows[0].n).toBe(1)
    expect(await projectPct(w.project)).toBe(40)
    expect((await auditRows('progress_report', id)).map((a) => a.action)).toEqual(expect.arrayContaining(['create', 'sync_offline']))

    // a NEW queue item for the same report without base_rev → conflict + server version (server wins)
    const it2 = item({ report_client_uuid: it1.client_uuid, work: 'Edit tanpa base_rev', reason: 'koreksi' })
    const c = await sync(pmMobile, [it2])
    expect(c.body.results[0]).toMatchObject({ status: 'conflict', rev: 1, errors: [{ code: 'STALE_REV' }] })
    expect(c.body.results[0].server_report.work).toBe('Bekisting sloof (offline)')
    // edit with base_rev = 1 + reason → applied, rev 2
    const it3 = item({ report_client_uuid: it1.client_uuid, work: 'Bekisting sloof selesai', reason: 'lengkapi uraian' }, { base_rev: 1 })
    const e = await sync(pmMobile, [it3])
    expect(e.body.results[0], JSON.stringify(e.body)).toMatchObject({ status: 'applied', rev: 2 })
    expect(e.body.results[0].server_report.work).toBe('Bekisting sloof selesai')
    // edit without reason → rejected VALIDATION
    const it4 = item({ report_client_uuid: it1.client_uuid, work: 'Tanpa alasan' }, { base_rev: 2 })
    expect((await sync(pmMobile, [it4])).body.results[0]).toMatchObject({ status: 'rejected', errors: [{ code: 'VALIDATION' }] })
  })

  it('server-side rejections: Staff FORBIDDEN, decrease, incomplete weights, 6 photos, missing photo; switch off → FEATURE_DISABLED', async () => {
    const fresh = (await sqlAs('app', "SELECT id FROM projects WHERE code = 'prg-P3'")).rows[0].id as number
    const freshStage = (await sqlAs('app', 'SELECT id FROM project_stages WHERE project_id = $1', [fresh])).rows[0].id as number
    const staff = await sync(staffMobile, [item({ project_id: w.project, stage_id: stageB, pct_after: 50, work: 'Staff mencoba' })])
    expect(staff.body.results[0]).toMatchObject({ status: 'rejected', errors: [{ code: 'FORBIDDEN' }] })
    const results = (
      await sync(pmMobile, [
        item({ project_id: w.project, stage_id: stageB, pct_after: 10, work: 'Turun' }),
        item({ project_id: fresh, stage_id: freshStage, pct_after: 10, work: 'Bobot belum lengkap' }),
        item({ project_id: w.project, stage_id: stageB, pct_after: 50, work: 'Foto hilang', photo_media_ids: [999_999] }),
        item({ project_id: w.project, stage_id: stageB, pct_after: 50, work: 'Enam foto', photo_media_ids: [1, 2, 3, 4, 5, 6] }),
        item({ project_id: w.project, stage_id: stageB, pct_after: 50 }),
      ])
    ).body.results as Array<{ status: string; errors: Array<{ code: string }> }>
    expect(results.map((r) => r.errors[0]?.code)).toEqual(['PROGRESS_DECREASED', 'WEIGHTS_INCOMPLETE', 'MEDIA_MISSING', 'VALIDATION', 'VALIDATION'])
    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    const p = await getTestPayload()
    await p.updateGlobal({ slug: 'company-settings', data: { syncProgressReportsEnabled: false }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    resetAppConfigCache()
    expect(((await http('GET', '/api/v1/app/config')).body as { features: { syncProgressReports: boolean } }).features.syncProgressReports).toBe(false)
    const off = await sync(pmMobile, [item({ project_id: w.project, stage_id: stageB, pct_after: 50, work: 'Dimatikan' })])
    expect(off.body.results[0]).toMatchObject({ status: 'rejected', errors: [{ code: 'FEATURE_DISABLED' }] })
    await p.updateGlobal({ slug: 'company-settings', data: { syncProgressReportsEnabled: true }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    resetAppConfigCache()
    const rej = await sqlAs('app', "SELECT new_value FROM audit_logs WHERE doc_type = 'progress_report' AND action = 'sync_offline' AND user_id = $1", [String(w.users.pm.id)])
    expect(JSON.stringify(rej.rows)).toContain('WEIGHTS_INCOMPLETE')
  })
})

describe('K-09 data (US-12) and E7 hook points', () => {
  it('GET /projects/progress: scope + reconciliation with SQL (progress = Σ weight × %, K-08 = committed / RAB)', async () => {
    const fin = await api('GET', '/api/v1/projects/progress', w.users.finance)
    expect(fin.status).toBe(200)
    expect(fin.body).toMatchObject({ warnGapPct: 0, badGapPct: 8 })
    const mine = fin.body.projects.find((x: { id: number }) => x.id === w.project)
    const sql = (
      await sqlAs(
        'app',
        `SELECT round(sum(s.weight_pct * s.progress_pct) / 100, 2)::float AS progress, sum(s.weight_pct)::float AS weights,
                (SELECT coalesce(sum(er.grand_total), 0) FROM expense_requests er WHERE er.project_id = $1
                  AND er.status::text IN ('approved','receipt_revision','receipts_verified','transferred','receipts_complete','lpj_submitted','lpj_revision','lpj_verified','completed'))::float AS committed,
                (SELECT budget FROM projects WHERE id = $1)::float AS budget
           FROM project_stages s WHERE s.project_id = $1 AND s.active`,
        [w.project],
      )
    ).rows[0]
    expect(mine.progressPct).toBe(sql.progress)
    expect(mine.progressPct).toBe(await projectPct(w.project))
    expect(mine.weightSum).toBe(sql.weights)
    expect(mine.committed).toBe(sql.committed)
    expect(mine.budgetPct).toBe(Math.round((sql.committed / sql.budget) * 10000) / 100)
    expect(mine.gap).toBe(Math.round((mine.budgetPct - mine.progressPct) * 100) / 100)
    expect(mine.tone).toBe(mine.gap <= 0 ? 'ok' : mine.gap <= 8 ? 'warn' : 'bad')
    expect(mine.reportCount).toBeGreaterThanOrEqual(5)
    const fresh = fin.body.projects.find((x: { code: string }) => x.code === 'prg-P3')
    expect(fresh).toMatchObject({ stagesComplete: false, gap: null, tone: 'none', toneLabel: 'Tahapan belum 100%' })
    const pm = await api('GET', '/api/v1/projects/progress', w.users.pm)
    expect(pm.body.projects.map((x: { id: number }) => x.id)).toContain(w.project)
    expect(pm.body.projects.map((x: { id: number }) => x.id)).not.toContain(w.otherProject)
    expect((await api('GET', '/api/v1/projects/progress', w.users.otherPm)).body.projects.map((x: { id: number }) => x.id)).not.toContain(w.project)
    expect((await api('GET', '/api/v1/projects/progress', w.users.staffA)).status).toBe(403)
    expect((await api('GET', '/api/v1/projects/progress', w.users.admin)).status).toBe(403)
  })

  it('late-report query + in-app notification rows (no scheduling here: E7)', async () => {
    const res = await asUser(null, async (req) => {
      const late = await lateProgressProjects(req, { asOf: '2099-01-10', days: 3 })
      const mine = late.find((l) => l.projectId === w.project)!
      const n = await notifyLateProgressReport(req, mine, [w.users.pm.id, w.users.owner.id, w.users.pm.id])
      const notLate = await lateProgressProjects(req, { asOf: mine.lastReportDate!, days: 3 })
      return { mine, n, notLate }
    })
    expect(res.mine.lastReportDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(res.mine.pmUserId).toBe(w.users.pm.id)
    expect(res.n).toBe(2)
    expect(res.notLate.map((l) => l.projectId)).not.toContain(w.project)
    const rows = await sqlAs('app', "SELECT user_id, title FROM notifications WHERE event = 'progress.late_report' AND doc_id = $1", [String(w.project)])
    expect(rows.rows.map((r) => Number(r.user_id)).sort()).toEqual([w.users.pm.id, w.users.owner.id].sort())
    expect(rows.rows[0].title).toMatch(/^Laporan progress terlambat: prg-P1/)
  })
})
