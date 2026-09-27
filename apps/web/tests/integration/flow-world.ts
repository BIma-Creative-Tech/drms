import { randomUUID } from 'node:crypto'

import { handleEndpoints, type CollectionSlug, type PayloadRequest } from 'payload'
import sharp from 'sharp'

import type { Role } from '@/access/roles'
import { withSystemTransaction } from '@/lib/system-tx'
import config from '@/payload.config'
import { seed } from '@/seed/seed'

import { getTestPayload, installFakeKeycloak, webSessionCookie, type TestUser } from './helpers'

/**
 * Isolated F2a test world per test file (all files share one DB): own employees, users (each with
 * a profile signature), project/cost center, bank accounts, cash account and an approval rule
 * scoped to the world's project/cost center (more specific than the seeded default → wins).
 * ADR 0013 (E1): `owner`/`owner2` are Direktur ("Diketahui" = approval), `finance`/`finance2` approve,
 * `pm` only monitors.
 */
export const ORIGIN = 'http://localhost:3000'

export type FlowUser = TestUser & { employee: number | null; cookie: string; _strategy: 'oidcSession' }

export async function sysCreate(collection: CollectionSlug, data: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<number> {
  const p = await getTestPayload()
  const doc = await p.create({ collection, data: data as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: test fixture */, ...extra })
  return doc.id as number
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

export async function makeFlowUser(roles: Role[], label: string, employee: number | null, opts: { signature?: boolean } = {}): Promise<FlowUser> {
  const p = await getTestPayload()
  const email = `${label}-${randomUUID().slice(0, 8)}@drms.test`.toLowerCase()
  const doc = (await p.create({
    collection: 'users',
    data: { email, name: label, keycloakSub: randomUUID(), roles, active: true, employee },
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: test fixture (bootstrap path)
    context: { skipKeycloakSync: true },
  })) as unknown as { id: number }
  const base = { id: doc.id, email, keycloakSub: '', roles, employee, collection: 'users' as const }
  const u = { ...base, cookie: '', _strategy: 'oidcSession' as const } as FlowUser
  u.cookie = await webSessionCookie(u)
  if (opts.signature !== false) {
    const sig = await uploadMedia('media-signatures', u)
    await p.update({ collection: 'users', id: doc.id, data: { signature: sig }, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */, context: { skipKeycloakSync: true } })
  }
  return u
}

export type World = Awaited<ReturnType<typeof makeWorld>>

export async function makeWorld(tag: string) {
  const p = await getTestPayload()
  installFakeKeycloak()
  await seed(p) // masters, sequences, default approval rules (idempotent)
  const code = (c: string) => `${tag}-${c}`
  const ids = async (collection: CollectionSlug, field: string, value: string) =>
    ((await p.find({ collection, where: { [field]: { equals: value } }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]?.id as number)

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
  const project = await sysCreate('projects', { code: code('P1'), name: `${tag} Project`, pm: users.pm.id, budget: 100_000_000, status: 'berjalan' })
  const otherProject = await sysCreate('projects', { code: code('P2'), name: `${tag} Other`, pm: users.otherPm.id, budget: 50_000_000, status: 'berjalan' })
  const costCenter = await sysCreate('cost-centers', { code: code('CC'), name: `${tag} Ops`, manager: users.pm.id })
  for (const e of [emp.a, emp.b]) {
    await sysCreate('team-assignments', { employee: e, project, roleInProject: 'staff' })
    await sysCreate('team-assignments', { employee: e, costCenter, roleInProject: 'staff' })
  }
  const bank = await ids('banks', 'code', 'MANDIRI')
  const accA = await sysCreate('employee-bank-accounts', { employee: emp.a, bank, accountNo: `9${Date.now() % 1e9}1`, accountHolder: `${tag} Staff A`, isDefault: true })
  const accB = await sysCreate('employee-bank-accounts', { employee: emp.b, bank, accountNo: `9${Date.now() % 1e9}2`, accountHolder: `${tag} Staff B`, isDefault: true })
  const cashAccount = await sysCreate('cash-accounts', { name: `${tag} Kas`, kind: 'bank', openingBalance: 50_000_000 })
  const cat = {
    bbm: await ids('expense-categories', 'code', 'BBM'),
    inap: await ids('expense-categories', 'code', 'INAP'),
    ksm: await ids('expense-categories', 'code', 'KSM'),
    mat: await ids('expense-categories', 'code', 'MAT'),
  }
  const uom = { l: await ids('uoms', 'code', 'L'), bln: await ids('uoms', 'code', 'BLN'), kmr: await ids('uoms', 'code', 'KMR'), prs: await ids('uoms', 'code', 'PRS') }
  const vehicle = await sysCreate('vehicles', { plateNo: `KH ${1000 + (Date.now() % 8000)} ${tag.slice(0, 2).toUpperCase()}`, type: 'Hilux' })
  const cashInSource = await ids('cash-in-sources', 'code', 'MODAL')
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
  return { emp, users, project, otherProject, costCenter, accA, accB, cashAccount, cat, uom, vehicle, cashInSource }
}

// ---------------------------------------------------------------- HTTP helpers

export type Res = { status: number; body: any; headers: Headers } // eslint-disable-line @typescript-eslint/no-explicit-any

export async function api(method: string, path: string, user: FlowUser | null, json?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const h = new Headers({ Origin: ORIGIN, ...headers })
  if (user) h.set('Cookie', user.cookie)
  let body: string | undefined
  if (json !== undefined) {
    h.set('Content-Type', 'application/json')
    body = JSON.stringify(json)
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

export function draftBody(w: World, over: Record<string, unknown> = {}) {
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
