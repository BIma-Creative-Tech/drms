import { randomUUID } from 'node:crypto'

import { handleEndpoints, type CollectionSlug, type PayloadRequest } from 'payload'
import sharp from 'sharp'

import type { Role } from '@/access/roles'
import { withSystemTransaction } from '@/lib/system-tx'
import config from '@/payload.config'
import { seed } from '@/seed/seed'

import { fixtureRap, fixtureRapItem, withFixtureRap } from './fixture-rap'
import { addMembership, companyId, getTestPayload, installFakeKeycloak, sqlAs, webSessionCookie, withContext, type TestUser } from './helpers'

export { fixtureRapItem, withFixtureRap }

/**
 * Isolated F2a test world per test file (all files share one DB): own employees, users (each with
 * a profile signature), project/cost center, bank accounts, cash account and an approval rule
 * scoped to the world's project/cost center (more specific than the seeded default → wins).
 * ADR 0013 (E1): `owner`/`owner2` are Direktur ("Diketahui" = approval), `finance`/`finance2` approve,
 * `pm` only monitors.
 */
export const ORIGIN = 'http://localhost:3000'

export type FlowUser = TestUser & { employee: number | null; cookie: string; _strategy: 'oidcSession' }

/**
 * `extra.rap: false` = no fixture RAP item for a project with a RAB (tests of the D4 "no RAP yet" rule); the other
 * `extra` keys go to `payload.create`.
 */
export async function sysCreate(collection: CollectionSlug, data: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<number> {
  const p = await getTestPayload()
  const { rap, ...rest } = extra
  const doc = await p.create({ collection, data: data as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: test fixture */, ...rest })
  const id = doc.id as number
  // D4 (owner 2026-10-11): a project with a RAB needs a RAP to send requests → a fixture item (konstruksi tests build theirs)
  if (collection === 'projects' && rap !== false && typeof data.budget === 'number' && data.budget > 0 && data.kind !== 'konstruksi') {
    fixtureRap.set(id, await sysRapItem(id))
  }
  await fixturePusatBiaya(collection, data, doc as { id: number; company?: unknown; active?: boolean | null })
  return id
}

/**
 * ADR 0031: a transfer of a project request needs the project's Pusat Biaya (a cash account). Fixture default: a project
 * created WITHOUT a `cashAccount` key is mapped to the first active cash account of its PT created by sysCreate (now,
 * or as soon as one is created). `cashAccount: null` keeps a project unmapped on purpose.
 */
const pbDefault = new Map<number, number>()
const pbUnmapped = new Map<number, number[]>()
async function fixturePusatBiaya(collection: CollectionSlug, data: Record<string, unknown>, doc: { id: number; company?: unknown; active?: boolean | null }): Promise<void> {
  const company = typeof doc.company === 'object' && doc.company !== null ? (doc.company as { id: number }).id : (doc.company as number | undefined)
  if (company === undefined) return
  const p = await getTestPayload()
  const map = (project: number, account: number) => p.update({ collection: 'projects', id: project, data: { cashAccount: account } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: test fixture */ })
  if (collection === 'projects' && !('cashAccount' in data)) {
    const acc = pbDefault.get(company)
    if (acc !== undefined) await map(doc.id, acc)
    else pbUnmapped.set(company, [...(pbUnmapped.get(company) ?? []), doc.id])
  }
  if (collection === 'cash-accounts' && doc.active !== false && !pbDefault.has(company)) {
    pbDefault.set(company, doc.id)
    for (const project of pbUnmapped.get(company) ?? []) await map(project, doc.id)
    pbUnmapped.delete(company)
  }
}


/**
 * DRMS 10/10 D4 (owner 2026-10-11 "RAP wajib untuk semua proyek yang punya RAB"): a project with a RAB needs ≥ 1 RAP
 * item before a request can be submitted, and every line then names one. Fixture RAP item: no stage (allowed
 * outside konstruksi), unpriced by default (never "Melebihi RAP"), uom LS.
 */
export async function sysRapItem(project: number, opts: { code?: string; unitPrice?: number | null; volume?: number; stage?: number | null } = {}): Promise<number> {
  const p = await getTestPayload()
  const ls = (await p.find({ collection: 'uoms', where: { code: { equals: 'LS' } }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]!.id as number
  return sysCreate('rap-items', { project, stage: opts.stage ?? null, code: opts.code ?? 'UMUM', description: 'Biaya umum project', kind: 'pekerjaan', uom: ls, volume: opts.volume ?? 1, unitPrice: opts.unitPrice ?? null, active: true })
}

let pngSeq = 0
/** Unique PNG bytes (distinct sha256) unless `seed` repeats. */
export async function png(seedValue = ++pngSeq, w = 640, h = 480): Promise<Buffer> {
  const r = (seedValue * 37) % 256
  const g = (seedValue * 91) % 256
  const b = (seedValue * 53) % 256
  return sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="${seedValue % 200}" y="10" width="40" height="40" fill="#000"/></svg>`) }])
    .png()
    .toBuffer()
}

export async function uploadMedia(collection: CollectionSlug, user: FlowUser, bytes?: Buffer, mimetype = 'image/png'): Promise<number> {
  const p = await getTestPayload()
  const data = bytes ?? (await png())
  const doc = await p.create({
    collection,
    data: {},
    file: { data, mimetype, name: `f-${randomUUID().slice(0, 6)}.png`, size: data.length },
    user,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: fixture upload as `user` (uploadedBy = user)
  })
  return doc.id as number
}

export async function makeFlowUser(roles: Role[], label: string, employee: number | null, opts: { signature?: boolean; company?: number; groupAdmin?: boolean } = {}): Promise<FlowUser> {
  const p = await getTestPayload()
  const email = `${label}-${randomUUID().slice(0, 8)}@drms.test`.toLowerCase()
  const groupAdmin = opts.groupAdmin ?? roles.includes('pk-admin')
  const doc = (await p.create({
    collection: 'users',
    data: { email, name: label, keycloakSub: randomUUID(), active: true, groupAdmin },
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: test fixture (bootstrap path)
    context: { skipKeycloakSync: true },
  })) as unknown as { id: number }
  // ADR 0016: roles + employee = membership of company #1 DRMS (default)
  await addMembership(doc.id, opts.company ?? (await companyId()), roles, employee)
  const base = await withContext({ id: doc.id, email, keycloakSub: '', groupAdmin, collection: 'users' as const })
  const u = { ...base, cookie: '', _strategy: 'oidcSession' as const } as FlowUser
  u.cookie = await webSessionCookie(u)
  if (opts.signature !== false) {
    const sig = await uploadMedia('media-signatures', u)
    await p.update({ collection: 'users', id: doc.id, data: { signature: sig }, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */, context: { skipKeycloakSync: true } })
  }
  return u
}

export type World = Awaited<ReturnType<typeof makeWorld>>

export const ADR0013_FALLBACK_RULE = 'Uji — Direktur lalu Finance (ADR 0013, fallback tes)'

/**
 * ADR 0021 made the SEEDED default "PM project → Direktur". Test files that are not about the approval flow
 * (KPIs, PT isolation, …) drive requests through the ADR 0013 shape (Direktur "Diketahui" → Finance) on
 * projects / cost centers without a world rule: this active, unscoped rule (priority 90 < seeded 100) keeps
 * that shape in the given PTs. Idempotent. The ADR 0021 flow itself is covered by approval-pm-direktur.
 */
export async function adr0013Fallback(companies: number[]): Promise<void> {
  const p = await getTestPayload()
  for (const company of companies) {
    const have = await p.find({ collection: 'approval-rules', where: { and: [{ company: { equals: company } }, { name: { equals: ADR0013_FALLBACK_RULE } }] }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })
    if (have.docs.length > 0) continue
    await sysCreate('approval-rules', {
      company,
      name: ADR0013_FALLBACK_RULE,
      docType: 'expense_request',
      requestType: 'any',
      minAmount: 0,
      priority: 90,
      acknowledge: 'required',
      acknowledgeBy: 'role',
      acknowledgeRole: 'pk-owner',
      steps: [{ level: 1, approverRole: 'pk-finance' }],
      active: true,
    })
  }
}

/**
 * `rule`: 'direktur_finance' (default) = the ADR 0013 world rules (Direktur "Diketahui" → Finance levels) —
 * kept so the old-snapshot flow stays covered; 'pm_direktur' = ADR 0021 (PM project "Diketahui" →
 * Direktur level 1, Finance only transfers), one rule per scope for every amount.
 */
export async function makeWorld(tag: string, opts: { rule?: 'direktur_finance' | 'pm_direktur' } = {}) {
  const p = await getTestPayload()
  installFakeKeycloak()
  await seed(p) // masters, sequences, default approval rules (idempotent)
  await adr0013Fallback([await companyId()])
  const code = (c: string) => `${tag}-${c}`
  // ADR 0016: masters are per PT (codes repeat across PTs) — the world lives in company #1 DRMS
  const drms = await companyId()
  const shared = new Set<CollectionSlug>(['banks', 'uoms'])
  const ids = async (collection: CollectionSlug, field: string, value: string) =>
    ((await p.find({ collection, where: shared.has(collection) ? { [field]: { equals: value } } : { and: [{ company: { equals: drms } }, { [field]: { equals: value } }] }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]?.id as number)

  const emp = {
    a: await sysCreate('employees', { code: code('A'), name: `${tag} Staff A` }),
    b: await sysCreate('employees', { code: code('B'), name: `${tag} Staff B` }),
    pm: await sysCreate('employees', { code: code('PM'), name: `${tag} PM` }),
    admin: await sysCreate('employees', { code: code('ADM'), name: `${tag} Admin` }),
    noAccount: await sysCreate('employees', { code: code('NA'), name: `${tag} Sopir` }),
  }
  const users = {
    staffA: await makeFlowUser(['pk-staff'], `${tag}-staff-a`, emp.a),
    staffB: await makeFlowUser(['pk-staff'], `${tag}-staff-b`, emp.b),
    pm: await makeFlowUser(['pk-pm'], `${tag}-pm`, emp.pm),
    otherPm: await makeFlowUser(['pk-pm'], `${tag}-other-pm`, null),
    finance: await makeFlowUser(['pk-finance'], `${tag}-finance`, null),
    finance2: await makeFlowUser(['pk-finance'], `${tag}-finance2`, null),
    owner: await makeFlowUser(['pk-owner'], `${tag}-owner`, null),
    owner2: await makeFlowUser(['pk-owner'], `${tag}-owner2`, null),
    admin: await makeFlowUser(['pk-admin'], `${tag}-admin`, emp.admin),
    nosig: await makeFlowUser(['pk-staff'], `${tag}-nosig`, null, { signature: false }),
  }
  // DRMS 10/10 D2: Finance books a transfer on a cost center (default = the project's) — a dedicated one, so the
  // legacy cost-center requests of the world (`costCenter`) and the project money stay apart in the reports
  const projectCostCenter = await sysCreate('cost-centers', { code: code('PCC'), name: `${tag} Proyek` })
  // ADR 0031: the Pusat Biaya of both projects = the world's cash account (transfers of project requests are charged to it)
  const cashAccount = await sysCreate('cash-accounts', { name: `${tag} Kas`, kind: 'bank', openingBalance: 50_000_000 })
  const project = await sysCreate('projects', { code: code('P1'), name: `${tag} Project`, pm: users.pm.id, budget: 100_000_000, status: 'berjalan', costCenter: projectCostCenter, cashAccount })
  const otherProject = await sysCreate('projects', { code: code('P2'), name: `${tag} Other`, pm: users.otherPm.id, budget: 50_000_000, status: 'berjalan', costCenter: projectCostCenter, cashAccount })
  // D4: both projects have a RAB → each got a fixture RAP item (request bodies charge their lines to it)
  const rap = { project: fixtureRapItem(project)!, otherProject: fixtureRapItem(otherProject)! }
  const costCenter = await sysCreate('cost-centers', { code: code('CC'), name: `${tag} Ops`, manager: users.pm.id })
  for (const e of [emp.a, emp.b]) {
    await sysCreate('team-assignments', { employee: e, project, roleInProject: 'staff' })
    await sysCreate('team-assignments', { employee: e, costCenter, roleInProject: 'staff' })
  }
  const bank = await ids('banks', 'code', 'MANDIRI')
  // QA-17: world accounts are verified (a transfer to an unverified account asks for a confirmation)
  const accA = await sysCreate('employee-bank-accounts', { employee: emp.a, bank, accountNo: `9${Date.now() % 1e9}1`, accountHolder: `${tag} Staff A`, isDefault: true, verificationStatus: 'verified' })
  const accB = await sysCreate('employee-bank-accounts', { employee: emp.b, bank, accountNo: `9${Date.now() % 1e9}2`, accountHolder: `${tag} Staff B`, isDefault: true, verificationStatus: 'verified' })
  const cat = {
    bbm: await ids('expense-categories', 'code', 'BBM'),
    inap: await ids('expense-categories', 'code', 'INAP'),
    ksm: await ids('expense-categories', 'code', 'KSM'),
    mat: await ids('expense-categories', 'code', 'MAT'),
  }
  const uom = { l: await ids('uoms', 'code', 'L'), bln: await ids('uoms', 'code', 'BLN'), kmr: await ids('uoms', 'code', 'KMR'), prs: await ids('uoms', 'code', 'PRS') }
  const vehicle = await sysCreate('vehicles', { plateNo: `KH ${1000 + (Date.now() % 8000)} ${tag.slice(0, 2).toUpperCase()}`, type: 'Hilux' })
  const cashInSource = await ids('cash-in-sources', 'code', 'MODAL')
  if (opts.rule === 'pm_direktur') {
    // World rules (priority 10, scoped), ADR 0021: "Diketahui" = the PM project (`pm`: projects.pm and the
    // cost center's manager), then the Direktur (`owner`/`owner2`) level 1; Finance only transfers.
    for (const scope of [{ project }, { costCenter }]) {
      await sysCreate('approval-rules', {
        docType: 'expense_request',
        requestType: 'any',
        priority: 10,
        acknowledge: 'required',
        acknowledgeBy: 'scope_manager',
        acknowledgeRole: null,
        active: true,
        ...scope,
        name: `${tag} rule PM→Direktur ${JSON.stringify(scope)}`,
        minAmount: 0,
        steps: [{ level: 1, approverRole: 'pk-owner' }],
      })
    }
    return { emp, users, project, otherProject, rap, costCenter, projectCostCenter, accA, accB, cashAccount, cat, uom, vehicle, cashInSource }
  }
  // World rules (priority 10, scoped), ADR 0013: "Diketahui" = Direktur (pk-owner, `owner`/`owner2`)
  // approval, then Finance level 1; > 10 juta: two Finance levels (`finance` + `finance2`, Q-31 example).
  const ruleBase = { docType: 'expense_request', requestType: 'any', priority: 10, acknowledge: 'required', acknowledgeBy: 'role', acknowledgeRole: 'pk-owner', active: true }
  for (const scope of [{ project }, { costCenter }]) {
    await sysCreate('approval-rules', { ...ruleBase, ...scope, name: `${tag} rule ≤10jt ${JSON.stringify(scope)}`, minAmount: 0, maxAmount: 10_000_000, steps: [{ level: 1, approverRole: 'pk-finance' }] })
    await sysCreate('approval-rules', {
      ...ruleBase,
      ...scope,
      name: `${tag} rule >10jt ${JSON.stringify(scope)}`,
      minAmount: 10_000_001,
      steps: [
        { level: 1, approverRole: 'pk-finance' },
        { level: 2, approverRole: 'pk-finance' },
      ],
    })
  }
  return { emp, users, project, otherProject, rap, costCenter, projectCostCenter, accA, accB, cashAccount, cat, uom, vehicle, cashInSource }
}

// ---------------------------------------------------------------- HTTP helpers

export type Res = { status: number; body: any; headers: Headers } // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * D2410 (point 6): a Reimburse is sent with ≥ 1 general attachment ("Lampiran"). A Reimburse draft created through `api()`
 * — POST /api/v1/expense-requests (`attachmentIds`) or the web form's Payload REST create (`attachments`) — without that
 * key gets one PNG uploaded by the same user (the fixture of every test written before the rule). A test of the rule
 * itself passes `attachmentIds: []` / `attachments: []`.
 */
async function withReimburseAttachment(method: string, path: string, user: FlowUser | null, json: unknown): Promise<unknown> {
  if (method !== 'POST' || !user || !json || typeof json !== 'object' || (json as { type?: unknown }).type !== 'reimburse') return json
  const key = path === '/api/v1/expense-requests' ? 'attachmentIds' : path === '/api/expense-requests' ? 'attachments' : null
  if (!key || (json as Record<string, unknown>)[key] !== undefined) return json
  const up = await upload('/api/v1/media/attachments', user, await png())
  if (up.status !== 201) throw new Error(`fixture attachment upload ${up.status}: ${JSON.stringify(up.body)}`)
  return { ...(json as Record<string, unknown>), [key]: [up.body.id as number] }
}

export async function api(method: string, path: string, user: FlowUser | null, json?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const h = new Headers({ Origin: ORIGIN, ...headers })
  if (user) h.set('Cookie', user.cookie)
  let body: string | undefined
  json = await withReimburseAttachment(method, path, user, json)
  if (json !== undefined) {
    h.set('Content-Type', 'application/json')
    body = JSON.stringify(withFixtureRap(json))
  }
  const res = await handleEndpoints({ config, request: new Request(`${ORIGIN}${path}`, { method, headers: h, body }) })
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  return { status: res.status, body: parsed, headers: res.headers }
}

export async function upload(path: string, user: FlowUser, bytes: Buffer, mimetype = 'image/png'): Promise<Res> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mimetype }), 'upload.png')
  const res = await handleEndpoints({
    config,
    request: new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: user.cookie }, body: form }),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers }
}

/** Runs a domain call in its own transaction as `user` (service-level tests). */
export async function asUser<T>(user: FlowUser | null, fn: (req: PayloadRequest) => Promise<T>): Promise<T> {
  return withSystemTransaction(await getTestPayload(), user as never, fn)
}

/**
 * DRMS 10/10 D2: turns a Draft into a LEGACY cost-center request — no project, its own cost center, already submitted
 * once (approval cycle ≥ 1, e.g. withdrawn) — the only kind of cost-center request that can still be sent. Since D2
 * the app refuses to create one, so only the DB owner can (trigger expense_requests_project_rules paused for it).
 */
export async function legacyCostCenter(id: number, costCenter: number): Promise<void> {
  // legacy rows predate D4 too: their lines name no RAP item (draftBody charged them to the world project's item)
  await sqlAs('owner', 'UPDATE expense_requests_lines SET rap_item_id = NULL WHERE _parent_id = $1', [id])
  // three statements = three transactions (the UPDATE queues deferred checks; ALTER TABLE refuses pending events)
  await sqlAs('owner', 'ALTER TABLE expense_requests DISABLE TRIGGER expense_requests_project_rules')
  try {
    await sqlAs('owner', 'UPDATE expense_requests SET project_id = NULL, cost_center_id = $1, approval_cycle = greatest(coalesce(approval_cycle, 0), 1) WHERE id = $2', [costCenter, id])
  } finally {
    await sqlAs('owner', 'ALTER TABLE expense_requests ENABLE TRIGGER expense_requests_project_rules')
  }
}

/** D4: lines charged to the fixture RAP item of the body's project (see withFixtureRap). */
export function draftBody(w: World, over: Record<string, unknown> = {}) {
  return withFixtureRap(draftBodyRaw(w, over))
}

function draftBodyRaw(w: World, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'advance',
    title: 'Pembelian material',
    projectId: w.project,
    requesterIds: [w.emp.a],
    bankAccountId: w.accA,
    neededDate: '2026-09-30',
    lines: [
      { description: 'Semen', qty: 10, uomId: w.uom.l, unitPrice: 60_000, total: 600_000, categoryId: w.cat.mat },
      { description: 'Makan tukang', total: 150_000, categoryId: w.cat.ksm },
    ],
    ...over,
  }
}
