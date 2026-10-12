import { handleEndpoints } from 'payload'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { rapMissingProjects } from '@/domain/rap/budget'
import { RAP_MISSING_MESSAGE } from '@/domain/rap/rules'
import { buildRapWorkbook } from '@/domain/rap/workbook'
import { resetRateLimits } from '@/lib/rate-limit'
import config from '@/payload.config'

import { api, asUser, draftBody, makeWorld, ORIGIN, sysCreate, type FlowUser, type World } from './flow-world'
import { sqlAs, sqlError } from './helpers'

/**
 * DRMS 10/10 D4, owner decision 2026-10-11 "RAP wajib untuk semua proyek yang punya RAB" ("Melebihi RAP" stays a
 * warning): a project of ANY kind with a RAB needs ≥ 1 RAP item before a request can be submitted, every line picks
 * an item; RAP editor / Excel / templates for every kind (stage optional outside konstruksi, progress untouched);
 * konstruksi unchanged. Fictional data.
 */
const E = '/api/v1/expense-requests'
let w: World
let trd = 0 // trading project WITH RAB, no RAP yet
let umum = 0 // umum project WITH RAB (template target)
let noRab = 0 // umum project WITHOUT RAB and without RAP
let kon = 0 // konstruksi project without RAB and without RAP
let stage = 0 // a manual stage of `trd` (progress must stay manual)
const item: Record<string, number> = {}

const line = (rapItemId: number | null | undefined, unitPrice: number, over: Record<string, unknown> = {}) => ({
  description: 'Semen untuk dijual',
  qty: 1,
  uomId: w.uom.l,
  unitPrice,
  categoryId: w.cat.mat,
  ...(rapItemId === undefined ? {} : { rapItemId }),
  ...over,
})

async function rapUpload(user: FlowUser, project: number, step: 'preview' | 'commit', bytes: Uint8Array, payload?: Record<string, unknown>) {
  const form = new FormData()
  form.append('file', new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'rap.xlsx')
  if (payload) form.append('_payload', JSON.stringify(payload))
  const res = await handleEndpoints({ config, request: new Request(`${ORIGIN}/api/v1/projects/${project}/rap/import/${step}`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: user.cookie }, body: form }) })
  return { status: res.status, body: (await res.json()) as any } // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function submitted(project: number, lines: unknown[]) {
  const c = await api('POST', E, w.users.staffA, draftBody(w, { projectId: project, lines }))
  expect(c.status, JSON.stringify(c.body)).toBe(201)
  return { id: c.body.id as number, submit: await api('POST', `${E}/${c.body.id}/submit`, w.users.staffA, {}) }
}

beforeAll(async () => {
  const tag = `fr${Date.now() % 100000}`
  w = await makeWorld(tag)
  trd = await sysCreate('projects', { code: `${tag}-TRD`, name: 'Trading semen uji', kind: 'trading', pm: w.users.pm.id, budget: 20_000_000, status: 'berjalan', costCenter: w.projectCostCenter }, { rap: false })
  umum = await sysCreate('projects', { code: `${tag}-UMM`, name: 'Umum ber-RAB uji', kind: 'umum', pm: w.users.pm.id, budget: 5_000_000, status: 'berjalan' }, { rap: false })
  noRab = await sysCreate('projects', { code: `${tag}-NRB`, name: 'Umum tanpa RAB', kind: 'umum', pm: w.users.pm.id, status: 'berjalan' })
  kon = await sysCreate('projects', { code: `${tag}-KON`, name: 'Konstruksi tanpa RAB', kind: 'konstruksi', pm: w.users.pm.id, status: 'berjalan' })
  for (const p of [trd, umum, noRab, kon]) await sysCreate('team-assignments', { employee: w.emp.a, project: p, roleInProject: 'staff' })
  stage = await sysCreate('project-stages', { project: trd, name: 'Pengadaan', weightPct: 100, sequence: 1 })
})
beforeEach(() => resetRateLimits())

describe('D4: a project with a RAB (any kind) needs a RAP before a request can be submitted', () => {
  it('trading with RAB, no RAP: the draft saves, the submit → 400 projectId "Project belum punya RAP — hubungi PM"', async () => {
    const { id, submit } = await submitted(trd, [line(undefined, 300_000)])
    expect(submit.status).toBe(400)
    expect(submit.body.errors).toEqual([{ path: 'projectId', message: RAP_MISSING_MESSAGE }])
    expect((await api('GET', `${E}/${id}`, w.users.staffA)).body.status).toBe('draft')
  })

  it('the requester sees it before submitting: /projects + /projects/{id}/rap carry rapRequired / rapMissing', async () => {
    const rap = await api('GET', `/api/v1/projects/${trd}/rap`, w.users.staffA)
    expect(rap.status).toBe(200)
    expect(rap.body).toMatchObject({ kind: 'trading', rapRequired: true, drivesProgress: false, items: [], canEdit: false })
    const list = (await api('GET', '/api/v1/projects?limit=100', w.users.staffA)).body.docs as Array<{ id: number; rapRequired: boolean; rapMissing: boolean }>
    expect(list.find((p) => p.id === trd)).toMatchObject({ rapRequired: true, rapMissing: true })
    expect(list.find((p) => p.id === noRab)).toMatchObject({ rapRequired: false, rapMissing: false })
    expect(list.find((p) => p.id === kon)).toMatchObject({ rapRequired: true, rapMissing: true })
  })

  it('PM nudge / Direktur hint: projects with a RAB and no RAP (PM: team only)', async () => {
    const owner = await asUser(w.users.owner, (req) => rapMissingProjects(req, { limit: 500 }))
    const ids = owner.rows.map((r) => r.id)
    expect(ids).toEqual(expect.arrayContaining([trd, umum, kon]))
    expect(ids).not.toContain(noRab)
    expect(ids).not.toContain(w.project) // world project has its RAP item
    const pm = await asUser(w.users.pm, (req) => rapMissingProjects(req, { teamOnly: true, limit: 500 }))
    expect(pm.rows.map((r) => r.id)).toEqual(expect.arrayContaining([trd, umum]))
    const other = await asUser(w.users.otherPm, (req) => rapMissingProjects(req, { teamOnly: true, limit: 500 }))
    expect(other.rows.map((r) => r.id)).not.toContain(trd)
  })

  it('umum WITHOUT RAB and without RAP: not required — lines without RAP item are sent', async () => {
    const { submit } = await submitted(noRab, [line(undefined, 100_000)])
    expect(submit.status, JSON.stringify(submit.body)).toBe(200)
  })

  it('konstruksi unchanged: no RAB, no RAP → blocked; a konstruksi item needs a stage (API 400, DB 23514)', async () => {
    const { submit } = await submitted(kon, [line(undefined, 100_000)])
    expect(submit.status).toBe(400)
    expect(submit.body.errors).toEqual([{ path: 'projectId', message: RAP_MISSING_MESSAGE }])
    const r = await api('POST', `/api/v1/projects/${kon}/rap/items`, w.users.pm, { code: 'K.1', description: 'Galian', kind: 'pekerjaan', uomId: w.uom.l, volume: 1 })
    expect(r.status).toBe(400)
    expect(r.body.errors).toEqual([expect.objectContaining({ path: 'stageId', message: 'Tahapan wajib untuk project konstruksi.' })])
    const err = await sqlError('owner', "INSERT INTO rap_items (company_id, project_id, code, description, kind, uom_id, volume, uuid) SELECT company_id, id, 'K.9', 'x', 'pekerjaan', $2, 1, gen_random_uuid()::text FROM projects WHERE id = $1", [kon, w.uom.l])
    expect(err?.code).toBe('23514')
    expect(err?.message).toMatch(/needs a stage/)
  })
})

describe('D4: RAP editor for every kind (stage optional, progress untouched)', () => {
  it('PM imports a trading RAP from Excel WITHOUT tahapan; an unknown tahapan is refused (no stage created)', async () => {
    const rows = [
      { code: 'T.1', description: 'Semen 50 kg (beli)', stageName: '', kind: 'material' as const, uomCode: 'SAK', volume: 100, unitPrice: 60_000, weightPct: null },
      { code: 'T.2', description: 'Ongkos angkut', stageName: 'Pengadaan', kind: 'pekerjaan' as const, uomCode: 'LS', volume: 1, unitPrice: 1_000_000, weightPct: null },
    ]
    const unknown = await rapUpload(w.users.pm, trd, 'preview', buildRapWorkbook(['SAK', 'LS'], [{ ...rows[0]!, stageName: 'Gudang' }]))
    expect(unknown.status).toBe(200)
    expect(unknown.body.newStages).toEqual([])
    expect(unknown.body.issues).toEqual([expect.objectContaining({ row: 2, column: 'tahapan' })])
    const bytes = buildRapWorkbook(['SAK', 'LS'], rows)
    const pv = await rapUpload(w.users.pm, trd, 'preview', bytes)
    expect(pv.body).toMatchObject({ issues: [], newStages: [], counts: { new: 2 } })
    const ok = await rapUpload(w.users.pm, trd, 'commit', bytes, { fileHash: pv.body.fileHash })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    for (const i of ok.body.items as Array<{ code: string; id: number }>) item[i.code] = i.id
    expect(ok.body.items.map((i: { code: string; stage: unknown }) => [i.code, i.stage])).toEqual([
      ['T.1', null],
      ['T.2', { id: stage, name: 'Pengadaan' }],
    ])
    // the cost plan does not take over the stage progress (manual, E4)
    expect(ok.body.stages).toEqual([expect.objectContaining({ id: stage, progressMode: 'manual' })])
    const s = (await sqlAs('app', 'SELECT progress_mode::text AS mode FROM project_stages WHERE id = $1', [stage])).rows[0]
    expect(s.mode).toBe('manual')
    // a single item without stage through the API too
    const one = await api('POST', `/api/v1/projects/${trd}/rap/items`, w.users.pm, { code: 'T.3', description: 'Biaya admin bank', kind: 'pekerjaan', uomId: w.uom.l, volume: 1, unitPrice: 50_000 })
    expect(one.status, JSON.stringify(one.body)).toBe(201)
    expect(one.body.stage).toBeNull()
    // RAP export keeps the empty tahapan
    expect((await api('GET', `/api/v1/projects/${trd}/rap.xlsx`, w.users.pm)).status).toBe(200)
  })

  it('with a RAP: every line needs an item; with one the request is sent', async () => {
    const without = await submitted(trd, [line(undefined, 300_000)])
    expect(without.submit.status).toBe(400)
    expect(without.submit.body.errors).toEqual([expect.objectContaining({ path: 'lines.0.rapItemId', message: 'Item RAP wajib dipilih.' })])
    const ok = await submitted(trd, [line(item['T.1'], 300_000)])
    expect(ok.submit.status, JSON.stringify(ok.submit.body)).toBe(200)
    const list = (await api('GET', '/api/v1/projects?limit=100', w.users.staffA)).body.docs as Array<{ id: number; rapMissing: boolean }>
    expect(list.find((p) => p.id === trd)?.rapMissing).toBe(false)
  })

  it('"Melebihi RAP" works for a non-konstruksi project (warning only, PM / Direktur see it, Staff not)', async () => {
    // T.2 plans Rp 1.000.000 → a 1.500.000 line is over plan, still sent
    const { id, submit } = await submitted(trd, [line(item['T.2'], 1_500_000, { description: 'Ongkos angkut tambahan' })])
    expect(submit.status, JSON.stringify(submit.body)).toBe(200)
    for (const u of [w.users.owner, w.users.pm]) {
      const d = (await api('GET', `${E}/${id}`, u)).body
      expect(d.lines[0].rapOverBudget, u.email).toBe(true)
      expect(d.flags).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'rap_over_budget', kindLabel: 'Melebihi RAP', level: 'warning' })]))
    }
    const staff = (await api('GET', `${E}/${id}`, w.users.staffA)).body
    expect(staff.flags.some((f: { kind: string }) => f.kind === 'rap_over_budget')).toBe(false)
  })

  it('the kind is frozen once the project has a RAP (409 with a clear message)', async () => {
    const r = await api('PATCH', `/api/projects/${trd}`, w.users.owner, { kind: 'umum' })
    expect(r.status).toBe(409)
    expect(JSON.stringify(r.body)).toContain('sudah punya RAP')
  })
})

describe('D4: RAP templates per project kind', () => {
  let tpl = 0
  it('save-template stores the project kind; another trading project can use it, an umum project cannot', async () => {
    const s = await api('POST', `/api/v1/projects/${trd}/rap/save-template`, w.users.pm, { name: 'RAP trading uji' })
    expect(s.status, JSON.stringify(s.body)).toBe(201)
    tpl = s.body.id
    expect((await sqlAs('app', 'SELECT project_kind::text AS k FROM rap_templates WHERE id = $1', [tpl])).rows[0].k).toBe('trading')
    const wrong = await api('POST', `/api/v1/projects/${umum}/rap/apply-template`, w.users.pm, { templateId: tpl })
    expect(wrong.status).toBe(400)
    expect(wrong.body.errors).toEqual([expect.objectContaining({ path: 'templateId', message: 'Template RAP ini untuk project jenis Trading.' })])
    const trd2 = await sysCreate('projects', { code: `TRD2-${Date.now() % 100000}`, name: 'Trading kedua', kind: 'trading', pm: w.users.pm.id, budget: 3_000_000, status: 'berjalan' }, { rap: false })
    const ok = await api('POST', `/api/v1/projects/${trd2}/rap/apply-template`, w.users.pm, { templateId: tpl })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    // the new project has no stage "Pengadaan": outside konstruksi the template stage is dropped (item without stage)
    expect(ok.body.items.map((i: { code: string; stage: unknown }) => [i.code, i.stage])).toEqual([
      ['T.1', null],
      ['T.2', null],
      ['T.3', null],
    ])
  })
})
