import { strFromU8, unzipSync } from 'fflate'
import { handleEndpoints } from 'payload'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { BUDGET_COMMITTED } from '@/domain/expense/types'
import { ALL_REPORTS, type FilterField, type Format } from '@/domain/reports/registry'
import { officeScope } from '@/domain/reports/scope'
import { resetRateLimits } from '@/lib/rate-limit'
import config from '@/payload.config'

import { getTestPayload, sqlAs } from './helpers'
import { api, asUser, makeWorld, ORIGIN, sysCreate, type FlowUser, type Res, type World } from './flow-world'

/**
 * Regression (UAT staging 2b5a83f): `anggaran-project` with a project filter failed with
 * "FULL JOIN is only supported with merge-joinable or hash-joinable join conditions" (the per
 * category table used FULL JOIN … ON IS NOT DISTINCT FROM). Here: the per-category detail (JSON,
 * CSV, XLSX, PDF) with RAB lines, categories outside the RAB and committed lines WITHOUT a category,
 * checked against the K-07 SQL rule (kpi-definitions.md), plus a smoke matrix: every report × every
 * filter (each option of small option lists) as JSON, and every export format with all filters set,
 * for Owner (all) and PM (team scope). Fictional data only.
 */
let w: World
const E = '/api/v1/expense-requests'
const COMMITTED = BUDGET_COMMITTED.map((s) => `'${s}'`).join(',') // constant list, not user input
let today: string
let cat: { code: string; name: string; id: number }[] = []

async function call(method: string, path: string, user: FlowUser, body?: unknown): Promise<Res> {
  resetRateLimits()
  return api(method, path, user, body)
}
async function must(r: Promise<Res>, status = 200): Promise<Res['body']> {
  const res = await r
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${JSON.stringify(res.body).slice(0, 400)}`)
  return res.body
}
async function download(path: string, user: FlowUser): Promise<{ status: number; headers: Headers; bytes: Uint8Array; text: string }> {
  resetRateLimits()
  const res = await handleEndpoints({ config, request: new Request(`${ORIGIN}${path}`, { method: 'GET', headers: { Origin: ORIGIN, Cookie: user.cookie } }) })
  const bytes = new Uint8Array(await res.arrayBuffer())
  return { status: res.status, headers: res.headers, bytes, text: new TextDecoder().decode(bytes) }
}

type Line = { description: string; total: number; categoryId: number | null; qty?: number; uomId?: number; vehicleId?: number }
const UNCAT = 'tanpa kategori'
/**
 * Advance request driven to `target` (approved = committed; pending_approval/rejected = not).
 * Lines marked `categoryId: null` are submitted with a placeholder category (the app requires one
 * on submit, lines.ts) and then un-categorised in the DB, as with legacy/imported data or a deleted
 * category (FK ON DELETE SET NULL): owner role, one transaction, status via an editable state so the
 * frozen-content hash is recomputed by the DB guard itself (no trigger disabled).
 */
async function request(projectId: number, ack: FlowUser, lines: Line[], target: 'approved' | 'pending_approval' | 'rejected') {
  const body = lines.map((l) => ({ ...l, description: l.categoryId === null ? `${l.description} ${UNCAT}` : l.description, categoryId: l.categoryId ?? w.cat.ksm }))
  const d = await must(call('POST', E, w.users.staffA, { type: 'advance', title: 'FR anggaran', projectId, requesterIds: [w.emp.a], bankAccountId: w.accA, neededDate: today, lines: body }), 201)
  await must(call('POST', `${E}/${d.id}/submit`, w.users.staffA, {}))
  if (target === 'rejected') await must(call('POST', `${E}/${d.id}/reject`, ack, { reason: 'tidak sesuai' }))
  else {
    await must(call('POST', `${E}/${d.id}/acknowledge`, ack, {}))
    if (target === 'approved') await must(call('POST', `${E}/${d.id}/approve`, w.users.finance, {}))
  }
  if (lines.some((l) => l.categoryId === null)) await uncategorise(d.id)
}
async function uncategorise(requestId: number) {
  const c = new pg.Client({ connectionString: process.env.PK_TEST_DATABASE_URL_OWNER })
  await c.connect()
  try {
    await c.query('BEGIN')
    const st = await c.query('SELECT status::text AS s FROM expense_requests WHERE id = $1', [requestId])
    await c.query("UPDATE expense_requests SET status = 'draft' WHERE id = $1", [requestId])
    const u = await c.query('UPDATE expense_requests_lines SET category_id = NULL WHERE _parent_id = $1 AND description LIKE $2', [requestId, `%${UNCAT}`])
    if (!u.rowCount) throw new Error('no line un-categorised')
    await c.query('UPDATE expense_requests SET status = $2::enum_expense_requests_status WHERE id = $1', [requestId, st.rows[0].s])
    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK')
    throw e
  } finally {
    await c.end()
  }
}

beforeAll(async () => {
  w = await makeWorld('FR') // letters only (vehicle plate suffix)
  today = await asUser(w.users.finance, async (req) => (await import('@/domain/expense/common')).today(req))
  await sysCreate('team-assignments', { employee: w.emp.a, project: w.otherProject, roleInProject: 'staff' })
  // RAB per category on the world project: MAT 10 jt, KSM 2 jt, INAP 1 jt (INAP without spend)
  await sysCreate('budget-lines', { project: w.project, category: w.cat.mat, amount: 10_000_000 })
  await sysCreate('budget-lines', { project: w.project, category: w.cat.ksm, amount: 2_000_000 })
  await sysCreate('budget-lines', { project: w.project, category: w.cat.inap, amount: 1_000_000 })
  await sysCreate('budget-lines', { project: w.otherProject, category: w.cat.mat, amount: 9_000_000 })
  const { mat, ksm, bbm } = w.cat
  // committed (approved) on the project: MAT 3 jt, KSM 1,5 jt, BBM 250 rb (outside RAB), no category 500 rb + 250 rb
  await request(w.project, w.users.owner, [{ description: 'Semen', total: 3_000_000, categoryId: mat }, { description: 'Lain-lain tanpa kategori', total: 500_000, categoryId: null }, { description: 'BBM', qty: 25, uomId: w.uom.l, total: 250_000, categoryId: bbm, vehicleId: w.vehicle }], 'approved')
  await request(w.project, w.users.owner, [{ description: 'Konsumsi', total: 1_500_000, categoryId: ksm }, { description: 'Tanpa kategori 2', total: 250_000, categoryId: null }], 'approved')
  // NOT committed: pending approval + rejected (incl. uncategorised lines)
  await request(w.project, w.users.owner, [{ description: 'Menunggu', total: 999_000, categoryId: mat }, { description: 'Menunggu tanpa kategori', total: 111_000, categoryId: null }], 'pending_approval')
  await request(w.project, w.users.owner, [{ description: 'Ditolak tanpa kategori', total: 777_000, categoryId: null }], 'rejected')
  // other project: must never leak into the project's detail
  await request(w.otherProject, w.users.owner, [{ description: 'Proyek lain', total: 7_000_000, categoryId: mat }, { description: 'Proyek lain tanpa kategori', total: 40_000, categoryId: null }], 'approved')
  const c = await sqlAs('app', 'SELECT id, code, name FROM expense_categories WHERE id = ANY($1)', [[mat, ksm, bbm, w.cat.inap]])
  cat = c.rows
}, 600_000)

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

/** K-07 per category, recomputed independently from the doc rule (two plain GROUP BYs merged in JS). */
async function expectedByCategory(projectId: number) {
  const rab = await sqlAs('app', 'SELECT category_id, sum(amount)::text AS s FROM budget_lines WHERE project_id = $1 GROUP BY category_id', [projectId])
  const com = await sqlAs(
    'app',
    `SELECT l.category_id, sum(l.total)::text AS s FROM expense_requests er JOIN expense_requests_lines l ON l._parent_id = er.id
      WHERE er.project_id = $1 AND er.status::text IN (${COMMITTED}) GROUP BY l.category_id`,
    [projectId],
  )
  const m = new Map<number | null, { rab: number | null; committed: number }>()
  for (const r of rab.rows) m.set(r.category_id, { rab: Number(r.s), committed: 0 })
  for (const r of com.rows) m.set(r.category_id, { rab: m.get(r.category_id)?.rab ?? null, committed: Number(r.s) })
  return m
}

const label = (id: number | null) => {
  const c = cat.find((x) => x.id === id)
  return c ? `${c.code} ${c.name}` : 'Tanpa kategori'
}

describe('anggaran-project with a project filter (per-category detail, UAT regression)', () => {
  it('JSON: per-category rows = K-07 SQL rule, incl. "outside RAB" and one "Tanpa kategori" bucket', async () => {
    for (const user of [w.users.finance, w.users.owner, w.users.pm]) {
      const r = await must(call('GET', `/api/v1/reports/anggaran-project?project=${w.project}`, user))
      expect(r.count, user.email).toBe(1)
      expect(r.main.rows[0].komitmen).toBe(5_500_000) // 3,75 jt + 1,75 jt (pending/rejected excluded)
      expect(r.main.rows[0].pct).toBe(5.5) // of budget 100 jt
      expect(r.extra).toHaveLength(1)
      const rows = r.extra[0].rows as Array<Record<string, unknown>>
      const exp = await expectedByCategory(w.project)
      expect(rows).toHaveLength(exp.size)
      for (const [id, e] of exp) {
        const row = rows.find((x) => x.kategori === label(id))
        expect(row, label(id)).toBeDefined()
        expect(row!.rab).toBe(e.rab)
        expect(row!.komitmen).toBe(e.committed)
        expect(row!.pct).toBe(e.rab ? Math.round((e.committed / e.rab) * 10000) / 100 : null)
        expect(row!.ket).toBe(e.rab === null ? 'di luar RAB kategori' : '')
      }
      // the same numbers, spelled out
      const by = (k: string) => rows.find((x) => x.kategori === k)
      expect(by(label(w.cat.mat))).toMatchObject({ rab: 10_000_000, komitmen: 3_000_000, pct: 30 })
      expect(by(label(w.cat.ksm))).toMatchObject({ rab: 2_000_000, komitmen: 1_500_000, pct: 75 })
      expect(by(label(w.cat.inap))).toMatchObject({ rab: 1_000_000, komitmen: 0, pct: 0 })
      expect(by(label(w.cat.bbm))).toMatchObject({ rab: null, komitmen: 250_000, pct: null, ket: 'di luar RAB kategori' })
      expect(rows.filter((x) => x.kategori === 'Tanpa kategori')).toHaveLength(1)
      expect(by('Tanpa kategori')).toMatchObject({ rab: null, komitmen: 750_000, pct: null, ket: 'di luar RAB kategori' })
      expect(rows[rows.length - 1]!.kategori).toBe('Tanpa kategori') // NULLS LAST
      // Σ per category = K-07 of the project (grand_total = Σ lines)
      expect(rows.reduce((s, x) => s + Number(x.komitmen), 0)).toBe(r.main.rows[0].komitmen)
    }
  })

  it('other project: its own detail only (uncategorised 40 rb, MAT 7 jt of 9 jt)', async () => {
    const r = await must(call('GET', `/api/v1/reports/anggaran-project?project=${w.otherProject}`, w.users.owner))
    const rows = r.extra[0].rows as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    expect(rows.find((x) => x.kategori === label(w.cat.mat))).toMatchObject({ rab: 9_000_000, komitmen: 7_000_000, pct: 77.78 })
    expect(rows.find((x) => x.kategori === 'Tanpa kategori')).toMatchObject({ rab: null, komitmen: 40_000 })
    // PM of the world project forcing the other project → empty (scope), no detail table
    const pm = await must(call('GET', `/api/v1/reports/anggaran-project?project=${w.otherProject}`, w.users.pm))
    expect(pm.count).toBe(0)
    expect(pm.extra).toHaveLength(0)
  })

  it('project without spend or RAB lines: detail table empty, no error', async () => {
    const p = await sysCreate('projects', { code: 'FR-P3', name: 'FR Kosong', pm: w.users.pm.id, budget: 0, status: 'berjalan' })
    const r = await must(call('GET', `/api/v1/reports/anggaran-project?project=${p}`, w.users.owner))
    expect(r.count).toBe(1)
    expect(r.extra[0].rows).toEqual([])
  })

  it('CSV: per-category section with integer amounts and the uncategorised bucket', async () => {
    const r = await download(`/api/v1/reports/anggaran-project/csv?project=${w.project}`, w.users.finance)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/csv')
    const lines = r.text.split('\r\n')
    const head = lines.indexOf('Kategori;RAB kategori (Rp);Komitmen (Rp);%;Keterangan')
    expect(head).toBeGreaterThan(0)
    const section = lines.slice(head + 1, head + 6)
    expect(section).toContain(`${label(w.cat.mat)};10000000;3000000;30;`)
    expect(section).toContain(`${label(w.cat.ksm)};2000000;1500000;75;`)
    expect(section).toContain(`${label(w.cat.inap)};1000000;0;0;`)
    expect(section).toContain(`${label(w.cat.bbm)};;250000;;di luar RAB kategori`)
    expect(section).toContain('Tanpa kategori;;750000;;di luar RAB kategori')
    expect(r.text).toContain(`;5500000;5.5;`)
  })

  it('XLSX: main sheet + per-category sheet with numeric cells', async () => {
    const r = await download(`/api/v1/reports/anggaran-project/xlsx?project=${w.project}`, w.users.owner)
    expect(r.status).toBe(200)
    const files = unzipSync(r.bytes)
    const sheets = Object.keys(files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
    expect(sheets).toHaveLength(2)
    const s2 = strFromU8(files['xl/worksheets/sheet2.xml']!)
    for (const v of [10_000_000, 3_000_000, 2_000_000, 1_500_000, 1_000_000, 250_000, 750_000]) expect(s2, String(v)).toContain(`<v>${v}</v>`)
    expect(strFromU8(files['xl/sharedStrings.xml'] ?? new Uint8Array()) + s2).toContain('Tanpa kategori')
  })

  it('PDF: rendered with the per-category table (200, %PDF-, export audited)', async () => {
    const before = await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE action='export' AND doc_type='report' AND doc_no='anggaran-project'")
    const withDetail = await download(`/api/v1/reports/anggaran-project/pdf?project=${w.project}`, w.users.owner)
    expect(withDetail.status).toBe(200)
    expect(withDetail.headers.get('content-type')).toBe('application/pdf')
    expect(withDetail.text.slice(0, 5)).toBe('%PDF-')
    const pm = await download(`/api/v1/reports/anggaran-project/pdf?project=${w.project}`, w.users.pm)
    expect(pm.status).toBe(200)
    const after = await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE action='export' AND doc_type='report' AND doc_no='anggaran-project'")
    expect(after.rows[0].n).toBe(before.rows[0].n + 2)
  })
})

// ---------------------------------------------------------------- smoke matrix

/** Values to try per filter: every option of small lists, else the world's own id + the first option. */
function valuesFor(f: FilterField): string[][] {
  if (f.kind === 'date') return [[f.name === 'dari' ? shift(today, -20) : today]]
  if (f.kind === 'month') return [[f.name === 'dari' ? `${shift(today, -62).slice(0, 7)}` : today.slice(0, 7)]]
  if (f.kind === 'text') return [['PB']]
  const opts = (f.options ?? []).map((o) => o.value)
  if (f.kind === 'multiselect') return [...opts.map((o) => [o]), opts]
  if (opts.length <= 12) return opts.map((o) => [o])
  const own: Record<string, number> = { project: w.project, pusat: w.costCenter, kategori: w.cat.mat, kendaraan: w.vehicle, akun: w.cashAccount }
  return [...new Set([String(own[f.name] ?? ''), opts[0]!].filter((v) => v && opts.includes(v)))].map((v) => [v])
}
function shift(d: string, days: number): string {
  const t = new Date(`${d}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}
function query(pairs: Array<[string, string]>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of pairs) sp.append(k, v)
  return sp.toString()
}

describe('smoke matrix: every report × every filter (JSON) and every format with all filters', () => {
  for (const def of ALL_REPORTS) {
    it(`${def.code}`, async () => {
      const users = [w.users.owner, ...(def.roles.includes('pk-pm') ? [w.users.pm] : [])]
      let runs = 0
      for (const user of users) {
        const fields = await asUser(user, async (req) => def.filters(req, await officeScope(req), new URLSearchParams()))
        expect(fields.length, def.code).toBeGreaterThan(0)
        const all: Array<[string, string]> = []
        for (const f of fields) {
          const vals = valuesFor(f)
          if (f.kind !== 'date' && f.kind !== 'month' && f.kind !== 'text') expect(vals.length, `${def.code}.${f.name} has options`).toBeGreaterThan(0)
          for (const v of vals) {
            const q = query(v.map((x) => [f.name, x]))
            const r = await call('GET', `/api/v1/reports/${def.code}?${q}`, user)
            expect(r.status, `${user.email} ${def.code}?${q}: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(200)
            expect(r.body.main.columns.length).toBeGreaterThan(0)
            runs++
          }
          if (vals[0]) for (const x of vals[0]) all.push([f.name, x])
        }
        // all filters together (+ the project filter set explicitly when the report has one)
        const q = query(all)
        expect((await call('GET', `/api/v1/reports/${def.code}?${q}`, user)).status, `${def.code}?${q}`).toBe(200)
        for (const fmt of def.formats as Format[]) {
          const r = await download(`/api/v1/reports/${def.code}/${fmt}?${q}`, user)
          expect(r.status, `${user.email} ${def.code}/${fmt}?${q}: ${r.text.slice(0, 300)}`).toBe(200)
          expect(r.bytes.length).toBeGreaterThan(0)
          runs++
        }
      }
      console.log(`[smoke] ${def.code}: ${runs} report runs (JSON per filter value + exports)`)
      expect(runs).toBeGreaterThan(0)
    })
  }
})
