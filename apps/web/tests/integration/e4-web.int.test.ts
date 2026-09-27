import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { addendumProjectOptions } from '@/domain/addendum/service'
import { listReports } from '@/domain/progress/dto'
import { projectProgressVsBudget } from '@/domain/reports/progress'
import { officeScope, teamScope } from '@/domain/reports/scope'
import { resetRateLimits } from '@/lib/rate-limit'

import { api, asUser, makeWorld, type World } from './flow-world'

/**
 * E4 web (Sprint S2 web A): the data behind the new admin views — report `anggaran-project`
 * "Progress fisik" column (was "F5"), the K-09 widget per role scope, the report list filters used by
 * /admin/progress/laporan, and the PM-only project options of the addendum form. Fictional data.
 */
let w: World
let stageA: number

beforeAll(async () => {
  w = await makeWorld('wprg')
  const r = await api('PUT', `/api/v1/projects/${w.project}/stages`, w.users.owner, { stages: [{ name: 'Persiapan', weightPct: 30, sequence: 1 }, { name: 'Struktur', weightPct: 70, sequence: 2 }] })
  expect(r.status).toBe(200)
  stageA = r.body.stages[0].id
  const rep = await api('POST', '/api/v1/progress-reports', w.users.pm, { projectId: w.project, stageId: stageA, pctAfter: 50, work: 'Pembersihan lahan contoh' })
  expect(rep.status).toBe(201)
})

beforeEach(() => resetRateLimits())

describe('report anggaran-project: Progress fisik column (US-12, replaces "F5")', () => {
  it('shows the physical progress and the K-09 status per project; incomplete stages → empty + status text', async () => {
    const r = await api('GET', `/api/v1/reports/anggaran-project?project=${w.project}`, w.users.finance)
    expect(r.status).toBe(200)
    expect(r.body.main.columns.map((c: { key: string }) => c.key)).toEqual(expect.arrayContaining(['progress', 'progressStatus']))
    const row = r.body.main.rows[0]
    expect(row.progress).toBe(15)
    expect(row.progressStatus).toBe('Sesuai') // no commitments yet: 0 % − 15 % ≤ 0
    expect(JSON.stringify(r.body)).not.toContain('F5')
    const other = await api('GET', `/api/v1/reports/anggaran-project?project=${w.otherProject}`, w.users.finance)
    expect(other.body.main.rows[0].progress).toBeNull()
    expect(other.body.main.rows[0].progressStatus).toBe('Tahapan belum 100%')
    for (const f of ['csv', 'xlsx', 'pdf']) expect((await api('GET', `/api/v1/reports/anggaran-project/${f}?project=${w.project}`, w.users.finance)).status, f).toBe(200)
  })
})

describe('K-09 widget scope + report list filters', () => {
  it('PM sees only team projects; Direktur all', async () => {
    const pm = await asUser(w.users.pm, async (req) => projectProgressVsBudget(req, await teamScope(req)))
    expect(pm.projects.map((p) => p.id)).toContain(w.project)
    expect(pm.projects.map((p) => p.id)).not.toContain(w.otherProject)
    const own = await asUser(w.users.owner, async (req) => projectProgressVsBudget(req, await officeScope(req)))
    expect(own.projects.map((p) => p.id)).toEqual(expect.arrayContaining([w.project, w.otherProject]))
    expect(own.projects.find((p) => p.id === w.project)).toMatchObject({ progressPct: 15, stagesComplete: true, reportCount: 1 })
  })
  it('report list filters (project, stage, date range) and scope; other PM sees nothing of this project', async () => {
    const today = (await api('GET', `/api/v1/progress-reports?project=${w.project}`, w.users.owner)).body.items[0].reportDate as string
    const byStage = await asUser(w.users.owner, (req) => listReports(req, { projectId: w.project, stageId: stageA, from: today, to: today, limit: 25 }))
    expect(byStage.items).toHaveLength(1)
    expect(byStage.items[0]!.photos).toEqual([])
    const none = await asUser(w.users.owner, (req) => listReports(req, { projectId: w.project, from: '2000-01-01', to: '2000-01-02', limit: 25 }))
    expect(none.items).toHaveLength(0)
    const otherPm = await asUser(w.users.otherPm, (req) => listReports(req, { projectId: w.project, limit: 25 }))
    expect(otherPm.items).toHaveLength(0)
    const staff = await asUser(w.users.staffA, (req) => listReports(req, { limit: 25 }))
    expect(staff.items).toHaveLength(0)
  })
  it('addendum form options: PM team projects only; Direktur/Finance none (they decide, not submit)', async () => {
    const pm = await asUser(w.users.pm, (req) => addendumProjectOptions(req))
    expect(pm.map((p) => p.id)).toContain(w.project)
    expect(pm.map((p) => p.id)).not.toContain(w.otherProject)
    expect(await asUser(w.users.owner, (req) => addendumProjectOptions(req))).toEqual([])
    expect(await asUser(w.users.finance, (req) => addendumProjectOptions(req))).toEqual([])
  })
})
