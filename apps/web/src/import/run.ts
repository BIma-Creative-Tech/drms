/**
 * Go-live data import (plan fase1-golive E11) — executor. Pipeline:
 *   read .xlsx → parse (pure) → reference check against DB keys (read-only) → [stop on errors]
 *   → VALIDATION PASS: every write executed in ONE transaction that is always rolled back
 *     (Payload hooks, field validation and DB triggers run for real; nothing persists)
 *   → dry-run: report the validation pass · commit: run again, one transaction PER MASTER, in order.
 * Idempotent: every row is upserted on its natural key and only changed fields are written, so a
 * second commit with the same file creates/updates nothing. Runs as the system actor (audit
 * source=system) with the reason "Impor data go-live <file> (sha256 …)"; each master that changed
 * something and the run itself are recorded as audit action `import`.
 * Keycloak is NOT called (out of scope, infra Lead): users are created only when a `--kc-map`
 * links their username to an existing Keycloak account (`skipKeycloakSync`); the others are
 * reported as "pending" and exported for the Lead (keycloakUsers).
 * E9 B-2: for the same reason a user (de)activated by the import is NOT disabled/enabled in Keycloak
 * and its Keycloak sessions are NOT ended (the device revocation cascade skips Keycloak too): such
 * users are listed once in `keycloakFollowUp` for the operator (runbook: disable + logout via kc_*).
 */
import { createHash, randomUUID } from 'node:crypto'

import { sql } from '@payloadcms/db-postgres'
import type { CollectionSlug, Payload, PayloadRequest, Where } from 'payload'

import { writeAudit } from '@/audit/writer'
import { settings as companySettings } from '@/domain/companies'
import { periodEnd } from '@/domain/cash/periods'
import { SKIP_COMPANY_DEFAULTS } from '@/domain/company-defaults'
import { DEFAULT_SEQUENCES, formatDocNo, parseBusinessDate, periodKey, type ResetPolicy } from '@/domain/numbering'
import { CTX_STAGE_EDITOR, projectStages, recalcProjectProgress } from '@/domain/progress/recalc'
import { DEFAULT_APPROVAL_RULES } from '@/seed/data'
import { withSystemTransaction } from '@/lib/system-tx'
import { DEFAULT_TZ } from '@/lib/time'
import { getRequestTx } from '@/lib/tx'

import { hasErrors, parseWorkbook, type ImportData, type Issue } from './parse'
import { effectiveEmail, isPlaceholderEmail, ptOf, ptSet, resolveReferences, type DbKeys, type PtKeys, type UserPlan } from './resolve'
import { SHEET_BY_KEY, type SheetKey } from './spec'
import { readXlsx, XlsxError } from './xlsx-io'

export type Mode = 'dry-run' | 'commit'

export type MasterReport = { key: SheetKey | 'cutover'; sheet: string; rows: number; created: number; updated: number; unchanged: number; skipped: number }

export type CutoverReport = {
  /** PT short code (MC2-5: one cut-over per PT of the file). */
  pt: string
  goLiveDate: string
  pbStartAt: number
  pbCounterBefore: number | null
  pbCounterAfter: number | null
  firstPbNumber: string | null
  closedPeriod: string | null
  closeNote: string
}

export type KeycloakUserRow = { username: string; email: string; firstName: string; enabled: boolean; realmRoles: string[]; employeeCode: string }

/**
 * E9 B-2: Keycloak step the operator must do by hand (realm drms) because the import never calls
 * Keycloak — `disable_logout`: user deactivated here → disable the account + log out all sessions;
 * `enable`: user re-activated here → enable the account again.
 */
export type KeycloakFollowUpRow = { username: string; email: string; keycloakSub: string | null; action: 'disable_logout' | 'enable' }

export type ImportReport = {
  mode: Mode
  runId: string
  file: string
  sha256: string
  startedAt: string
  finishedAt: string
  ok: boolean
  committed: boolean
  issues: Issue[]
  masters: MasterReport[]
  /** Cut-over of the first PT (single-PT files); every PT in `cutovers`. */
  cutover: CutoverReport | null
  cutovers: CutoverReport[]
  /** Users to create in Keycloak realm `drms` (no passwords). */
  keycloakUsers: KeycloakUserRow[]
  /** Users (de)activated by this run whose Keycloak account/sessions the operator must update (E9 B-2). */
  keycloakFollowUp: KeycloakFollowUpRow[]
}

export type ImportInput = { bytes: Uint8Array; fileName: string; mode: Mode; kcMap?: ReadonlyMap<string, string>; operator?: string; now?: Date }

class RowError extends Error {
  constructor(
    readonly sheet: string,
    readonly row: number | undefined,
    message: string,
  ) {
    super(message)
  }
}
class DryRunRollback extends Error {}

function errorText(e: unknown): string {
  const err = e as { message?: string; data?: { errors?: Array<{ path?: string; message?: string }> }; cause?: { message?: string } }
  const details = (err.data?.errors ?? []).map((d) => `${d.path ? `${d.path}: ` : ''}${d.message ?? ''}`).filter(Boolean)
  const base = err.cause?.message && !err.message?.includes(err.cause.message) ? `${err.message} (${err.cause.message})` : (err.message ?? String(e))
  return details.length > 0 ? `${base} — ${details.join('; ')}` : base
}

// ------------------------------------------------------------------ DB keys (read-only)

export async function loadDbKeys(payload: Payload): Promise<DbKeys> {
  // ADR 0016 / MC2-5: per-PT masters are matched INSIDE their PT (`kode_pt`)
  const companiesRes = await payload.find({ collection: 'companies', depth: 0, pagination: false, limit: 0, select: { shortCode: true, active: true }, overrideAccess: true /* SYSTEM-READ: import reference check */ })
  const companies = new Map<string, { id: number; active: boolean }>()
  const codeOf = new Map<number, string>()
  for (const c of companiesRes.docs as unknown as Array<{ id: number; shortCode: string; active?: boolean | null }>) {
    companies.set(c.shortCode, { id: c.id, active: c.active !== false })
    codeOf.set(c.id, c.shortCode)
  }
  const perPt = async (collection: CollectionSlug): Promise<PtKeys> => {
    const r = await payload.find({ collection, depth: 0, pagination: false, limit: 0, select: { code: true, company: true } as never, overrideAccess: true /* SYSTEM-READ: import reference check */ })
    const out: PtKeys = new Map()
    for (const d of r.docs as unknown as Array<{ code: string; company: number | { id: number } }>) {
      const pt = codeOf.get(typeof d.company === 'object' ? d.company.id : d.company)
      if (pt) ptSet(out, pt).add(d.code)
    }
    return out
  }
  const codes = async (collection: CollectionSlug) => {
    const r = await payload.find({ collection, depth: 0, pagination: false, limit: 0, select: { code: true } as never, overrideAccess: true /* SYSTEM-READ: import reference check */ })
    return new Set((r.docs as unknown as Array<{ code: string }>).map((d) => d.code))
  }
  const users = await payload.find({
    collection: 'users',
    depth: 0,
    pagination: false,
    limit: 0,
    select: { email: true, keycloakSub: true } as never,
    overrideAccess: true, // SYSTEM-READ: import reference check
  })
  const memberships = await payload.find({ collection: 'company-memberships', depth: 0, pagination: false, limit: 0, overrideAccess: true /* SYSTEM-READ: import reference check */ })
  const employeeOf = new Map<number, number>()
  const membershipsByUser = new Map<number, Set<string>>()
  for (const r of memberships.docs as unknown as Array<{ user: number; company: number; employee?: number | null; active?: boolean | null }>) {
    if (typeof r.employee === 'number' && !employeeOf.has(r.user)) employeeOf.set(r.user, r.employee)
    const pt = codeOf.get(r.company)
    if (pt && r.active !== false) {
      const set = membershipsByUser.get(r.user) ?? new Set<string>()
      set.add(pt)
      membershipsByUser.set(r.user, set)
    }
  }
  const usersByEmail = new Map<string, { id: number; sub: string | null; employee: number | null }>()
  const usersBySub = new Map<string, { id: number; email: string }>()
  for (const u of users.docs as unknown as Array<{ id: number; email: string; keycloakSub?: string | null }>) {
    usersByEmail.set(u.email.toLowerCase(), { id: u.id, sub: u.keycloakSub ?? null, employee: employeeOf.get(u.id) ?? null })
    if (u.keycloakSub) usersBySub.set(u.keycloakSub.toLowerCase(), { id: u.id, email: u.email })
  }
  return {
    companies,
    employees: await perPt('employees'),
    banks: await codes('banks'),
    uoms: await codes('uoms'),
    categories: await perPt('expense-categories'),
    costCenters: await perPt('cost-centers'),
    sites: await perPt('sites'),
    projects: await perPt('projects'),
    membershipsByUser,
    usersByEmail,
    usersBySub,
  }
}

// ------------------------------------------------------------------ generic upsert

type Action = 'created' | 'updated' | 'unchanged'

function norm(v: unknown, isDate: boolean): unknown {
  if (v === undefined || v === null || v === '') return null
  if (isDate && typeof v === 'string') return v.slice(0, 10)
  if (Array.isArray(v)) return v.map((x) => norm(x, false)).sort((a, b) => String(a).localeCompare(String(b)))
  if (typeof v === 'object' && v !== null && 'id' in v) return (v as { id: unknown }).id
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  return v
}

/** ISO timestamp at 12:00 UTC: the same calendar day in every timezone of Indonesia (and ±11 h). */
export const dateValue = (d: string | null) => (d ? `${d}T12:00:00.000Z` : null)

/**
 * Per-PT collections the import writes / looks up (ADR 0016 §4): natural keys are unique PER PT, so every
 * lookup is scoped to the import's PT and new master rows get it explicitly (MC2-5: `kode_pt` per row).
 */
const PER_PT_IMPORT = new Set<CollectionSlug>([
  'employees', 'expense-categories', 'cost-centers', 'sites', 'projects', 'project-stages', 'budget-lines', 'vehicles', 'team-assignments',
  'cash-accounts', 'employee-bank-accounts', 'clients', 'document-sequences', 'period-closings', 'cash-in-sources', 'approval-rules',
])
/** Of those, the ones whose company is chosen on create (the others derive it from their parent). */
const COMPANY_ON_CREATE = new Set<CollectionSlug>(['employees', 'expense-categories', 'cost-centers', 'sites', 'projects', 'vehicles', 'cash-accounts', 'clients', 'document-sequences', 'period-closings', 'cash-in-sources', 'approval-rules'])

class Exec {
  readonly cache = new Map<string, number>()
  readonly kcFollowUp: KeycloakFollowUpRow[] = []
  /** PT of the row being written (set by `use`), 0 = none yet. */
  companyId = 0
  constructor(
    readonly req: PayloadRequest,
    readonly data: ImportData,
    readonly users: Map<string, UserPlan>,
    readonly defaultPt: string | null,
  ) {}

  /** PT short code → id (companies created by the Perusahaan step included). */
  async ptId(code: string): Promise<number> {
    const k = `companies:shortCode:${code}`
    const hit = this.cache.get(k)
    if (hit !== undefined) return hit
    const r = await this.req.payload.find({ collection: 'companies', where: { shortCode: { equals: code } }, limit: 1, depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ: import PT */, req: this.req })
    const id = r.docs[0]?.id as number | undefined
    if (id === undefined) throw new Error(`PT "${code}" tidak ditemukan`)
    this.cache.set(k, id)
    return id
  }

  /** Switches the per-PT scope to the PT of a row (`kode_pt`, empty = the only PT). */
  async use(row: { pt: string | null }): Promise<number> {
    const code = ptOf(row, this.defaultPt)
    if (code === null) throw new Error('kode_pt wajib diisi (lebih dari satu PT)')
    this.companyId = await this.ptId(code)
    return this.companyId
  }

  /** Cache key; per-PT collections are keyed inside their PT (codes repeat across PTs). */
  key(collection: CollectionSlug, field: string, value: string): string {
    return PER_PT_IMPORT.has(collection) ? `${this.companyId}:${collection}:${field}:${value}` : `${collection}:${field}:${value}`
  }

  async findOne(collection: CollectionSlug, where: Where): Promise<Record<string, unknown> | null> {
    const scoped: Where = PER_PT_IMPORT.has(collection) ? { and: [{ company: { equals: this.companyId } }, where] } : where
    const r = await this.req.payload.find({ collection, where: scoped, limit: 1, depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ: import upsert */, req: this.req })
    return (r.docs[0] as unknown as Record<string, unknown>) ?? null
  }

  async idOf(collection: CollectionSlug, field: string, value: string | null): Promise<number | null> {
    if (value === null) return null
    const k = this.key(collection, field, value)
    const hit = this.cache.get(k)
    if (hit !== undefined) return hit
    const doc = await this.findOne(collection, { [field]: { equals: value } })
    if (!doc) throw new Error(`${collection} "${value}" tidak ditemukan`)
    this.cache.set(k, doc.id as number)
    return doc.id as number
  }

  /** Username (Pengguna sheet) or email of an existing user → user id; undefined = pending (leave the field alone). */
  async userId(ref: string | null): Promise<number | null | undefined> {
    if (ref === null) return null
    if (ref.includes('@')) return this.idOf('users', 'email', ref)
    const plan = this.users.get(ref)
    if (!plan || plan.action === 'pending') return undefined
    return this.idOf('users', 'email', plan.email)
  }

  /** `cacheKey` given as `collection:field:value` → scoped like `key()`. */
  scopedKey(collection: CollectionSlug, cacheKey: string): string {
    return PER_PT_IMPORT.has(collection) ? `${this.companyId}:${cacheKey}` : cacheKey
  }

  async upsert(
    collection: CollectionSlug,
    where: Where,
    data: Record<string, unknown>,
    opts: { createOnly?: Record<string, unknown>; dates?: string[]; cacheKey?: string; context?: Record<string, unknown> } = {},
  ): Promise<{ action: Action; id: number }> {
    const existing = await this.findOne(collection, where)
    const dates = new Set(opts.dates ?? [])
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
    if (opts.context) Object.assign(this.req.context, opts.context)
    try {
      if (!existing) {
        if (PER_PT_IMPORT.has(collection) && !this.companyId) throw new Error(`PT belum dipilih untuk ${collection}`)
        const company = COMPANY_ON_CREATE.has(collection) ? { company: this.companyId } : {}
        const doc = await this.req.payload.create({ collection, data: { ...clean, ...company, ...(opts.createOnly ?? {}) } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: go-live import */, req: this.req })
        if (opts.cacheKey) this.cache.set(this.scopedKey(collection, opts.cacheKey), doc.id as number)
        return { action: 'created', id: doc.id as number }
      }
      const patch: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(clean)) {
        if (JSON.stringify(norm(v, dates.has(k))) !== JSON.stringify(norm(existing[k], dates.has(k)))) patch[k] = v
      }
      if (opts.cacheKey) this.cache.set(this.scopedKey(collection, opts.cacheKey), existing.id as number)
      if (Object.keys(patch).length === 0) return { action: 'unchanged', id: existing.id as number }
      await this.req.payload.update({ collection, id: existing.id as number, data: patch as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: go-live import */, req: this.req })
      return { action: 'updated', id: existing.id as number }
    } finally {
      if (opts.context) for (const k of Object.keys(opts.context)) delete this.req.context[k]
    }
  }
}

function tally(rep: MasterReport, a: Action | 'skipped') {
  rep[a === 'skipped' ? 'skipped' : a]++
}

async function atRow<T>(sheet: string, row: number | undefined, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof RowError) throw e
    throw new RowError(sheet, row, errorText(e))
  }
}

// ------------------------------------------------------------------ masters (dependency order)

type MasterFn = (x: Exec, rep: MasterReport, issues: Issue[]) => Promise<void>

/** `when` (default: the sheet is in the file) decides whether a master step runs. */
const MASTERS: Array<{ key: SheetKey; rows: (d: ImportData) => number; run: MasterFn; when?: (d: ImportData) => boolean }> = [
  {
    // MC2-5: target PTs. Existing PTs (by short code) are never modified here (identity = Master
    // Perusahaan, group admin); a new PT is created active with the default numbering + approval rules.
    key: 'perusahaan',
    rows: (d) => d.companies.length,
    run: async (x, rep) => {
      for (const c of x.data.companies) {
        const r = await atRow(rep.sheet, c._row, async () => {
          const found = await x.req.payload.find({ collection: 'companies', where: { shortCode: { equals: c.code } }, limit: 1, depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ: import PT */, req: x.req })
          if (found.docs[0]) {
            x.cache.set(`companies:shortCode:${c.code}`, found.docs[0].id as number)
            return 'unchanged' as const
          }
          const doc = await x.req.payload.create({
            collection: 'companies',
            data: { shortCode: c.code, name: c.name, legalName: c.legalName, address: c.address, phone: c.phone, timezone: process.env.TZ || DEFAULT_TZ, active: true } as never,
            depth: 0,
            overrideAccess: true, // SYSTEM-WRITE: go-live import (new PT)
            // the import applies the built-in defaults below (+ `nomor_pb_mulai`), not a copy of DRMS
            context: { [SKIP_COMPANY_DEFAULTS]: true },
            req: x.req,
          })
          const id = doc.id as number
          x.cache.set(`companies:shortCode:${c.code}`, id)
          x.companyId = id
          // same defaults as the seed per PT (ADR 0007 / 0013): every document type numbered, default rules
          for (const seq of DEFAULT_SEQUENCES) {
            await x.upsert('document-sequences', { docType: { equals: seq.docType } }, {}, { createOnly: { ...seq, timezone: process.env.TZ || DEFAULT_TZ, active: true } })
          }
          for (const rule of DEFAULT_APPROVAL_RULES) await x.upsert('approval-rules', { name: { equals: rule.name } }, {}, { createOnly: { ...rule } })
          return 'created' as const
        })
        tally(rep, r)
      }
    },
  },
  {
    key: 'bank',
    rows: (d) => d.banks.length,
    run: async (x, rep) => {
      for (const b of x.data.banks) tally(rep, (await atRow(rep.sheet, b._row, () => x.upsert('banks', { code: { equals: b.code } }, { code: b.code, name: b.name }, { cacheKey: `banks:code:${b.code}` }))).action)
    },
  },
  {
    key: 'satuan',
    rows: (d) => d.uoms.length,
    run: async (x, rep) => {
      for (const u of x.data.uoms) {
        tally(rep, (await atRow(rep.sheet, u._row, () => x.upsert('uoms', { code: { equals: u.code } }, { code: u.code, name: u.name, category: u.category }, { cacheKey: `uoms:code:${u.code}` }))).action)
      }
    },
  },
  {
    key: 'kategori',
    rows: (d) => d.categories.length,
    run: async (x, rep) => {
      for (const c of x.data.categories) {
        const r = await atRow(rep.sheet, c._row, async () => {
          await x.use(c)
          const allowed: number[] = []
          for (const u of c.allowedUoms) allowed.push((await x.idOf('uoms', 'code', u))!)
          return x.upsert(
            'expense-categories',
            { code: { equals: c.code } },
            { code: c.code, name: c.name, coaCode: c.coaCode, defaultUom: await x.idOf('uoms', 'code', c.defaultUom), allowedUoms: allowed, requiresVehicle: c.requiresVehicle, active: c.active },
            { cacheKey: `expense-categories:code:${c.code}` },
          )
        })
        tally(rep, r.action)
      }
    },
  },
  {
    key: 'karyawan',
    rows: (d) => d.employees.length,
    run: async (x, rep) => {
      for (const e of x.data.employees) {
        const r = await atRow(rep.sheet, e._row, async () =>
          x.use(e).then(() => x.upsert('employees', { code: { equals: e.code } }, { code: e.code, name: e.name, nickname: e.nickname, position: e.position, phone: e.phone, active: e.active }, { cacheKey: `employees:code:${e.code}` })),
        )
        tally(rep, r.action)
      }
    },
  },
  {
    key: 'pengguna',
    rows: (d) => d.users.length,
    run: async (x, rep) => {
      for (const u of x.data.users) {
        const plan = x.users.get(u.username)!
        if (plan.action === 'pending') {
          tally(rep, 'skipped')
          continue
        }
        const r = await atRow(rep.sheet, u._row, async () => {
          const data: Record<string, unknown> = { name: u.name, phone: u.phone, active: u.active }
          const where: Where = plan.sub ? { keycloakSub: { equals: plan.sub } } : { email: { equals: plan.email } }
          const existing = await x.findOne('users', where)
          const wasActive = existing ? existing.active !== false : null
          if (wasActive !== false && !u.active) x.kcFollowUp.push({ username: u.username, email: plan.email, keycloakSub: (existing?.keycloakSub as string | null | undefined) ?? plan.sub, action: 'disable_logout' })
          if (wasActive === false && u.active) x.kcFollowUp.push({ username: u.username, email: plan.email, keycloakSub: (existing?.keycloakSub as string | null | undefined) ?? plan.sub, action: 'enable' })
          // never replace a real email by the placeholder of an email-less row
          const email = effectiveEmail(u)
          if (!existing || !isPlaceholderEmail(email) || isPlaceholderEmail(String(existing.email ?? ''))) data.email = email
          const res = await x.upsert('users', where, data, { createOnly: { keycloakSub: plan.sub }, context: { skipKeycloakSync: true } })
          x.cache.set(`users:email:${plan.email}`, res.id)
          // ADR 0016 §2 / MC2-5: roles + employee link = membership of the row's PT (`kode_pt`);
          // further PTs come from sheet AksesPT. No role here = no membership from this row.
          if (u.roles.length > 0) {
            const company = await x.use(u)
            await x.upsert(
              'company-memberships',
              { and: [{ user: { equals: res.id } }, { company: { equals: company } }] },
              { user: res.id, company, roles: u.roles, employee: await x.idOf('employees', 'code', u.employeeCode), active: u.active },
            )
          }
          return res
        })
        tally(rep, r.action)
      }
    },
  },
  {
    // MC2-5: memberships in further PTs (username × PT); pending users (no Keycloak account) are skipped
    key: 'aksesPt',
    rows: (d) => d.access.length,
    run: async (x, rep) => {
      for (const a of x.data.access) {
        const plan = x.users.get(a.username)
        if (!plan || plan.action === 'pending') {
          tally(rep, 'skipped')
          continue
        }
        const r = await atRow(rep.sheet, a._row, async () => {
          const user = (await x.idOf('users', 'email', plan.email))!
          const company = await x.use(a)
          return x.upsert(
            'company-memberships',
            { and: [{ user: { equals: user } }, { company: { equals: company } }] },
            { user, company, roles: a.roles, employee: await x.idOf('employees', 'code', a.employeeCode), active: a.active },
          )
        })
        tally(rep, r.action)
      }
    },
  },
  {
    key: 'rekening',
    rows: (d) => d.bankAccounts.length,
    run: async (x, rep) => {
      for (const a of x.data.bankAccounts) {
        const r = await atRow(rep.sheet, a._row, async () => {
          await x.use(a)
          const bank = await x.idOf('banks', 'code', a.bankCode)
          const employee = await x.idOf('employees', 'code', a.employeeCode)
          const where: Where = { and: [{ bank: { equals: bank } }, { accountNo: { equals: a.accountNo } }] }
          const existing = await x.findOne('employee-bank-accounts', where)
          if (existing && existing.employee !== employee) throw new Error(`Rekening ${a.bankCode} ${a.accountNo} sudah terdaftar untuk karyawan lain di RR Teams.`)
          return x.upsert(
            'employee-bank-accounts',
            where,
            { employee, bank, accountNo: a.accountNo, accountHolder: a.accountHolder, isDefault: a.isDefault, active: a.active },
            { createOnly: { verificationStatus: 'unverified' } },
          )
        })
        tally(rep, r.action)
      }
    },
  },
  {
    key: 'pusatBiaya',
    rows: (d) => d.costCenters.length,
    run: async (x, rep) => {
      for (const c of x.data.costCenters) {
        const r = await atRow(rep.sheet, c._row, async () => {
          await x.use(c)
          return x.upsert(
            'cost-centers',
            { code: { equals: c.code } },
            { code: c.code, name: c.name, type: c.type, manager: await x.userId(c.manager), lat: c.lat, lng: c.lng, radiusM: c.radiusM, active: c.active },
            { cacheKey: `cost-centers:code:${c.code}` },
          )
        })
        tally(rep, r.action)
      }
    },
  },
  {
    // ADR 0023: sites (kantor cabang). Runs after PusatBiaya (default cost center) and before Project / Penugasan /
    // AkunKas (their kode_site). Karyawan is imported earlier (users → cost-center managers depend on it), so the
    // employees' "Site penempatan" (Karyawan.kode_site) is linked here — also when the file has no sheet Site and
    // names existing sites. An empty kode_site never clears a link.
    key: 'site',
    when: (d) => d.present.includes('site') || d.employees.some((e) => e.siteCode !== null),
    rows: (d) => d.sites.length,
    run: async (x, rep) => {
      for (const st of x.data.sites) {
        const r = await atRow(rep.sheet, st._row, async () => {
          await x.use(st)
          return x.upsert(
            'sites',
            { code: { equals: st.code } },
            { code: st.code, name: st.name, address: st.address, lat: st.lat, lng: st.lng, radiusM: st.radiusM, costCenter: st.costCenterCode ? await x.idOf('cost-centers', 'code', st.costCenterCode) : undefined, active: st.active },
            { cacheKey: `sites:code:${st.code}` },
          )
        })
        tally(rep, r.action)
      }
      for (const e of x.data.employees.filter((e) => e.siteCode !== null)) {
        await atRow(SHEET_BY_KEY.karyawan.name, e._row, async () => {
          await x.use(e)
          return x.upsert('employees', { code: { equals: e.code } }, { homeSite: await x.idOf('sites', 'code', e.siteCode) })
        })
      }
    },
  },
  {
    key: 'project',
    rows: (d) => d.projects.length,
    run: async (x, rep) => {
      for (const p of x.data.projects) {
        const r = await atRow(rep.sheet, p._row, async () => {
          await x.use(p)
          let client: number | null = null
          if (p.client) {
            const found = await x.findOne('clients', { name: { equals: p.client } })
            client = found ? (found.id as number) : ((await x.req.payload.create({ collection: 'clients', data: { name: p.client, active: true, company: x.companyId }, depth: 0, overrideAccess: true /* SYSTEM-WRITE: go-live import */, req: x.req })).id as number)
          }
          const lines = x.data.budgetLines.filter((b) => b.projectCode === p.code && ptOf(b, x.defaultPt) === ptOf(p, x.defaultPt))
          const budget = p.budget ?? (lines.length > 0 ? lines.reduce((s, b) => s + b.amount, 0) : undefined)
          return x.upsert(
            'projects',
            { code: { equals: p.code } },
            {
              code: p.code,
              name: p.name,
              client,
              address: p.address,
              pm: await x.userId(p.pm),
              site: p.siteCode ? await x.idOf('sites', 'code', p.siteCode) : undefined,
              lat: p.lat,
              lng: p.lng,
              radiusM: p.radiusM,
              budget,
              startDate: dateValue(p.startDate),
              targetDate: dateValue(p.targetDate),
              status: p.status,
            },
            { dates: ['startDate', 'targetDate'], cacheKey: `projects:code:${p.code}` },
          )
        })
        tally(rep, r.action)
      }
    },
  },
  {
    key: 'tahapan',
    rows: (d) => d.stages.length,
    run: async (x, rep, issues) => {
      const byProject = new Map<string, ImportData['stages']>()
      for (const s of x.data.stages) {
        const k = `${ptOf(s, x.defaultPt) ?? ''}\u0000${s.projectCode}`
        byProject.set(k, [...(byProject.get(k) ?? []), s])
      }
      for (const stages of byProject.values()) {
        const first = stages[0]!._row
        const code = stages[0]!.projectCode
        const projectId = (await atRow(rep.sheet, first, async () => {
          await x.use(stages[0]!)
          return x.idOf('projects', 'code', code)
        }))!
        x.req.context[CTX_STAGE_EDITOR] = true // whole set validated (Σ = 100 %) by the parser, G11
        try {
          const existing = await projectStages(x.req, projectId)
          let changed = false
          const seen = new Set<number>()
          for (const s of [...stages].sort((a, b) => a.sequence - b.sequence)) {
            const cur = existing.find((e) => e.sequence === s.sequence && !seen.has(e.id))
            const r = await atRow(rep.sheet, s._row, async () => {
              if (!cur) {
                const doc = await x.req.payload.create({ collection: 'project-stages', data: { project: projectId, name: s.name, weightPct: s.weightPct, sequence: s.sequence, active: true } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: go-live import */, req: x.req })
                seen.add(doc.id as number)
                return 'created' as const
              }
              seen.add(cur.id)
              if (cur.name === s.name && Math.round(cur.weightPct * 100) === Math.round(s.weightPct * 100) && cur.active) return 'unchanged' as const
              await x.req.payload.update({ collection: 'project-stages', id: cur.id, data: { name: s.name, weightPct: s.weightPct, active: true } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: go-live import */, req: x.req })
              return 'updated' as const
            })
            if (r !== 'unchanged') changed = true
            tally(rep, r)
          }
          for (const e of existing.filter((e) => e.active && !seen.has(e.id))) {
            await atRow(rep.sheet, first, () => x.req.payload.update({ collection: 'project-stages', id: e.id, data: { active: false } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: go-live import */, req: x.req }))
            issues.push({ level: 'warning', sheet: rep.sheet, row: first, message: `Tahapan lama "${e.name}" (urutan ${e.sequence}) project ${code} tidak ada di file → dinonaktifkan.` })
            changed = true
          }
          if (changed) await atRow(rep.sheet, first, () => recalcProjectProgress(x.req, projectId))
        } finally {
          delete x.req.context[CTX_STAGE_EDITOR]
        }
      }
    },
  },
  {
    key: 'rab',
    rows: (d) => d.budgetLines.length,
    run: async (x, rep) => {
      for (const b of x.data.budgetLines) {
        const r = await atRow(rep.sheet, b._row, async () => {
          await x.use(b)
          const project = await x.idOf('projects', 'code', b.projectCode)
          const category = await x.idOf('expense-categories', 'code', b.categoryCode)
          return x.upsert('budget-lines', { and: [{ project: { equals: project } }, { category: { equals: category } }] }, { amount: b.amount }, { createOnly: { project, category } })
        })
        tally(rep, r.action)
      }
    },
  },
  {
    key: 'kendaraan',
    rows: (d) => d.vehicles.length,
    run: async (x, rep) => {
      for (const v of x.data.vehicles) {
        const r = await atRow(rep.sheet, v._row, async () => {
          await x.use(v)
          return x.upsert(
            'vehicles',
            { plateNo: { equals: v.plateNo } },
            { plateNo: v.plateNo, type: v.type, brandModel: v.brandModel, costCenter: await x.idOf('cost-centers', 'code', v.costCenterCode), project: await x.idOf('projects', 'code', v.projectCode), active: v.active },
          )
        })
        tally(rep, r.action)
      }
    },
  },
  {
    key: 'penugasan',
    rows: (d) => d.assignments.length,
    run: async (x, rep) => {
      for (const a of x.data.assignments) {
        const r = await atRow(rep.sheet, a._row, async () => {
          await x.use(a)
          const employee = await x.idOf('employees', 'code', a.employeeCode)
          const project = await x.idOf('projects', 'code', a.projectCode)
          const costCenter = await x.idOf('cost-centers', 'code', a.costCenterCode)
          const site = await x.idOf('sites', 'code', a.siteCode)
          const loc: Where = project ? { project: { equals: project } } : costCenter ? { costCenter: { equals: costCenter } } : { site: { equals: site } }
          const where: Where = { and: [{ employee: { equals: employee } }, loc] }
          return x.upsert(
            'team-assignments',
            where,
            { roleInProject: a.role, startDate: dateValue(a.startDate), endDate: dateValue(a.endDate) },
            { createOnly: { employee, project, costCenter, site }, dates: ['startDate', 'endDate'] },
          )
        })
        tally(rep, r.action)
      }
    },
  },
  {
    key: 'akunKas',
    rows: (d) => d.cashAccounts.length,
    run: async (x, rep) => {
      for (const a of x.data.cashAccounts) {
        const r = await atRow(rep.sheet, a._row, async () => {
          await x.use(a)
          return x.upsert('cash-accounts', { name: { equals: a.name } }, {
            name: a.name,
            kind: a.kind,
            bank: await x.idOf('banks', 'code', a.bankCode),
            accountNo: a.accountNo,
            accountHolder: a.accountHolder,
            openingBalance: a.openingBalance,
            openingBalanceDate: x.data.settings!.goLiveDate,
            odooJournalCode: a.odooJournalCode,
            site: a.siteCode ? await x.idOf('sites', 'code', a.siteCode) : undefined,
            active: a.active,
          })
        })
        tally(rep, r.action)
      }
    },
  },
]

// ------------------------------------------------------------------ cut-over

export function previousPeriod(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number]
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

async function runCutover(x: Exec, rep: MasterReport, issues: Issue[], reason: string, ptCode: string): Promise<CutoverReport> {
  const s0 = x.data.settings!
  // MC2-5: one cut-over per PT of the file; PB start per PT (sheet Perusahaan) else the Pengaturan value
  const own = x.data.companies.find((c) => c.code === ptCode)?.pbStartAt
  const s = { ...s0, pbStartAt: own ?? s0.pbStartAt }
  const req = x.req
  const tx = await getRequestTx(req)
  const sheet = SHEET_BY_KEY.pengaturan.name
  const pt = await companySettings(req, await x.ptId(ptCode))
  x.companyId = pt.companyId
  // (1) PB sequence (Q-17). Owner decision 2026-10-11: PB resets MONTHLY from 1 → `nomor_pb_mulai` is the first
  // number of the GO-LIVE MONTH only (its counter row is created at that value), never the sequence's startAt
  // (that would restart every month there). A sequence on reset "never" (Admin choice) keeps the Q-17 startAt rule.
  const { startAt: _default, ...dflt } = DEFAULT_SEQUENCES.find((d) => d.docType === 'expense_request')!
  const where: Where = { and: [{ company: { equals: pt.companyId } }, { docType: { equals: 'expense_request' } }] }
  const existing = await x.findOne('document-sequences', where)
  const never = (existing?.resetPolicy ?? dflt.resetPolicy) === 'never'
  const seq = await atRow(sheet, undefined, () =>
    x.upsert('document-sequences', where, never ? { startAt: s.pbStartAt, active: true } : { active: true }, { createOnly: { ...dflt, startAt: never ? s.pbStartAt : 1, company: pt.companyId, timezone: 'Asia/Makassar' } }),
  )
  tally(rep, seq.action)
  const cfg = (await x.findOne('document-sequences', { id: { equals: seq.id } }))!
  const key = periodKey(cfg.resetPolicy as ResetPolicy, parseBusinessDate(s.goLiveDate))
  const cur = (await tx.execute(sql`SELECT next_value::int AS n FROM document_sequence_counters WHERE company_id = ${pt.companyId} AND doc_type = 'expense_request' AND period_key = ${key}`)) as unknown as { rows: Array<{ n: number }> }
  let before = cur.rows[0]?.n ?? null
  if (before === null && !never && s.pbStartAt > 1) {
    // the go-live month's counter starts at nomor_pb_mulai (audited below like a raise)
    await tx.execute(sql`INSERT INTO document_sequence_counters (company_id, doc_type, period_key, next_value) VALUES (${pt.companyId}, 'expense_request', ${key}, 1) ON CONFLICT DO NOTHING`)
    before = 1
  }
  let after = before
  if (before !== null && before < s.pbStartAt) {
    // only upward (DB trigger pk_counter_monotonic) — "set next value" of ADR 0007 §1, audited
    await tx.execute(sql`UPDATE document_sequence_counters SET next_value = ${s.pbStartAt} WHERE company_id = ${pt.companyId} AND doc_type = 'expense_request' AND period_key = ${key}`)
    await writeAudit(req, [{ action: 'update', docType: 'document_sequence', docId: String(seq.id), field: 'nextValue', oldValue: before, newValue: s.pbStartAt, reason, companyId: pt.companyId }])
    after = s.pbStartAt
    rep.updated++
  } else if (before !== null && before > s.pbStartAt) {
    issues.push({ level: 'warning', sheet, message: `PT ${ptCode}: nomor PB sudah berjalan: nomor berikutnya ${before} (> ${s.pbStartAt}); counter tidak diubah (nomor tidak pernah mundur).` })
  }
  const settings = pt
  const firstPbNumber = formatDocNo(
    { pattern: String(cfg.pattern), padding: Number(cfg.padding ?? 0), docCode: (cfg.docCode as string) ?? undefined },
    Math.max(after ?? s.pbStartAt, s.pbStartAt),
    parseBusinessDate(s.goLiveDate),
    settings.shortCode ?? '',
  )
  if (!settings.shortCode) issues.push({ level: 'warning', sheet, message: `PT ${ptCode}: kode singkat PT kosong — nomor dokumen belum dapat diterbitkan sebelum Admin mengisinya.` })

  // (2) period before go-live closed (ADR 0005 §6) — the go-live month stays open
  let closedPeriod: string | null = null
  let closeNote = 'tidak diminta (tutup_periode_sebelum_golive = Tidak)'
  if (s.closePrevPeriod) {
    const period = previousPeriod(s.goLiveDate)
    // MC2-5: per PT (`kode_pt`); MC1 = the only / first active PT
    const cid = settings.companyId
    const rows = await req.payload.find({ collection: 'period-closings', where: { and: [{ company: { equals: cid } }, { period: { equals: period } }] }, depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ: cut-over */, req })
    const lock = (await tx.execute(sql`SELECT pk_cash_lock_date(${cid}::integer)::text AS d`)) as unknown as { rows: Array<{ d: string | null }> }
    const lockDate = lock.rows[0]?.d ?? null
    if (rows.docs.some((d) => (d as { status?: string }).status === 'closed')) closeNote = `periode ${period} sudah ditutup`
    else if (rows.docs.length > 0) {
      closeNote = `periode ${period} pernah dibuka kembali — tidak ditutup otomatis`
      issues.push({ level: 'warning', sheet, message: `PT ${ptCode}: periode ${period} berstatus dibuka kembali; tutup manual bila memang perlu.` })
    } else if (lockDate && lockDate >= periodEnd(period)) closeNote = `sudah terkunci s/d ${lockDate}`
    else {
      const doc = await atRow(sheet, undefined, () =>
        req.payload.create({ collection: 'period-closings', data: { company: cid, period, status: 'closed', note: `Cut-over go-live ${s.goLiveDate} (impor data)` } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: cut-over period close */, req }),
      )
      await writeAudit(req, [{ action: 'period_close', docType: 'period_closing', docId: String(doc.id), docNo: period, field: 'period', newValue: { period, lockDate: periodEnd(period) }, reason }])
      closedPeriod = period
      closeNote = `periode ${period} ditutup`
      rep.created++
    }
  }
  return { pt: ptCode, goLiveDate: s.goLiveDate, pbStartAt: s.pbStartAt, pbCounterBefore: before, pbCounterAfter: after, firstPbNumber, closedPeriod, closeNote }
}

// ------------------------------------------------------------------ orchestration

function keycloakUsers(data: ImportData, users: Map<string, UserPlan>): KeycloakUserRow[] {
  return data.users
    .filter((u) => users.get(u.username)?.action === 'pending')
    .map((u) => ({ username: u.username, email: u.email ?? '', firstName: u.name, enabled: u.active, realmRoles: u.roles, employeeCode: u.employeeCode ?? '' }))
}

type PassResult = { masters: MasterReport[]; cutovers: CutoverReport[]; issues: Issue[]; kcFollowUp: KeycloakFollowUpRow[] }

type PassOpts = { dryRun: boolean; reason: string; runId: string; fileName: string; sha256: string; defaultPt: string | null; pts: string[] }

async function executePass(payload: Payload, data: ImportData, users: Map<string, UserPlan>, opts: PassOpts): Promise<PassResult> {
  const context = { auditSource: 'system', auditReason: opts.reason }
  const masters: MasterReport[] = []
  const issues: Issue[] = []
  const kcFollowUp: KeycloakFollowUpRow[] = []
  const cutovers: CutoverReport[] = []
  const steps: Array<{ key: SheetKey | 'cutover'; sheet: string; rows: number; run: (x: Exec, rep: MasterReport) => Promise<void> }> = [
    ...MASTERS.filter((m) => (m.when ? m.when(data) : data.present.includes(m.key))).map((m) => ({ key: m.key, sheet: SHEET_BY_KEY[m.key].name, rows: m.rows(data), run: (x: Exec, rep: MasterReport) => m.run(x, rep, issues) })),
    {
      key: 'cutover' as const,
      sheet: SHEET_BY_KEY.pengaturan.name,
      rows: 0,
      run: async (x: Exec, rep: MasterReport) => {
        cutovers.length = 0
        for (const pt of opts.pts) cutovers.push(await runCutover(x, rep, issues, opts.reason, pt))
      },
    },
  ]
  const audit = async (req: PayloadRequest, rep: MasterReport) => {
    if (rep.created + rep.updated === 0) return
    await writeAudit(req, [
      { action: 'import', docType: 'import', docId: opts.runId, docNo: opts.fileName.slice(0, 120), field: rep.sheet, newValue: { rows: rep.rows, created: rep.created, updated: rep.updated, unchanged: rep.unchanged, skipped: rep.skipped, sha256: opts.sha256 }, reason: opts.reason },
    ])
  }
  const summary = async (req: PayloadRequest) =>
    writeAudit(req, [
      {
        action: 'import',
        docType: 'import',
        docId: opts.runId,
        docNo: opts.fileName.slice(0, 120),
        field: 'selesai',
        newValue: { sha256: opts.sha256, masters: masters.map((m) => ({ sheet: m.sheet, created: m.created, updated: m.updated, unchanged: m.unchanged, skipped: m.skipped })), cutover: cutovers[0] ?? null, cutovers },
        reason: opts.reason,
      },
    ])

  if (opts.dryRun) {
    try {
      await withSystemTransaction(
        payload,
        null,
        async (req) => {
          const x = new Exec(req, data, users, opts.defaultPt)
          for (const st of steps) {
            const rep: MasterReport = { key: st.key, sheet: st.sheet, rows: st.rows, created: 0, updated: 0, unchanged: 0, skipped: 0 }
            await st.run(x, rep)
            masters.push(rep)
          }
          kcFollowUp.push(...x.kcFollowUp)
          throw new DryRunRollback()
        },
        context,
      )
    } catch (e) {
      if (!(e instanceof DryRunRollback)) throw e
    }
    return { masters, cutovers, issues, kcFollowUp }
  }
  // commit: one transaction per master, in dependency order (a later failure keeps earlier masters;
  // re-running the fixed file is idempotent)
  const cache = new Map<string, number>()
  for (const st of steps) {
    const rep: MasterReport = { key: st.key, sheet: st.sheet, rows: st.rows, created: 0, updated: 0, unchanged: 0, skipped: 0 }
    let stepFollowUp: KeycloakFollowUpRow[] = []
    await withSystemTransaction(
      payload,
      null,
      async (req) => {
        const x = new Exec(req, data, users, opts.defaultPt)
        for (const [k, v] of cache) x.cache.set(k, v)
        await st.run(x, rep)
        await audit(req, rep)
        if (st.key === 'cutover') {
          masters.push(rep)
          await summary(req)
        }
        for (const [k, v] of x.cache) cache.set(k, v)
        stepFollowUp = x.kcFollowUp
      },
      context,
    )
    // only what was committed (a failed master rolls back its (de)activations too)
    kcFollowUp.push(...stepFollowUp)
    if (st.key !== 'cutover') masters.push(rep)
  }
  return { masters, cutovers, issues, kcFollowUp }
}

export async function runImport(payload: Payload, input: ImportInput): Promise<ImportReport> {
  const startedAt = (input.now ?? new Date()).toISOString()
  const sha256 = createHash('sha256').update(input.bytes).digest('hex')
  const runId = randomUUID()
  const reason = `Impor data go-live ${input.fileName} (sha256 ${sha256.slice(0, 12)})${input.operator ? ` oleh ${input.operator}` : ''}`.slice(0, 1000)
  const report: ImportReport = { mode: input.mode, runId, file: input.fileName, sha256, startedAt, finishedAt: startedAt, ok: false, committed: false, issues: [], masters: [], cutover: null, cutovers: [], keycloakUsers: [], keycloakFollowUp: [] }
  const done = () => {
    report.finishedAt = new Date().toISOString()
    report.ok = !hasErrors(report.issues)
    return report
  }

  let parsed
  try {
    parsed = parseWorkbook(readXlsx(input.bytes))
  } catch (e) {
    if (!(e instanceof XlsxError)) throw e
    report.issues.push({ level: 'error', sheet: '(file)', message: e.message })
    return done()
  }
  report.issues.push(...parsed.issues)
  const data = parsed.data
  const resolved = resolveReferences(data, await loadDbKeys(payload), input.kcMap ?? new Map(), { pmRequired: true })
  report.issues.push(...resolved.issues)
  report.keycloakUsers = keycloakUsers(data, resolved.users)
  if (hasErrors(report.issues) || !data.settings) return done()

  const passOpts = { reason, runId, fileName: input.fileName, sha256, defaultPt: resolved.defaultPt, pts: resolved.pts.length > 0 ? resolved.pts : resolved.defaultPt ? [resolved.defaultPt] : [] }
  try {
    const check = await executePass(payload, data, resolved.users, { ...passOpts, dryRun: true })
    report.masters = check.masters
    report.cutovers = check.cutovers
    report.cutover = check.cutovers[0] ?? null
    report.issues.push(...check.issues)
    report.keycloakFollowUp = check.kcFollowUp
  } catch (e) {
    if (!(e instanceof RowError)) throw e
    report.issues.push({ level: 'error', sheet: e.sheet, row: e.row, message: e.message })
    return done()
  }
  if (input.mode === 'dry-run') return done()

  // commit: the validation pass succeeded; now for real (warnings of the pass are already reported)
  try {
    const real = await executePass(payload, data, resolved.users, { ...passOpts, dryRun: false })
    report.masters = real.masters
    report.cutovers = real.cutovers
    report.cutover = real.cutovers[0] ?? null
    report.keycloakFollowUp = real.kcFollowUp
    report.committed = true
  } catch (e) {
    if (!(e instanceof RowError)) throw e
    report.issues.push({ level: 'error', sheet: e.sheet, row: e.row, message: `COMMIT BERHENTI (master sebelumnya sudah tersimpan; perbaiki lalu jalankan ulang): ${e.message}` })
  }
  return done()
}
