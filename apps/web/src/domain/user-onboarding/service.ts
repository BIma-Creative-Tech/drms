import { APIError, ValidationError, type CollectionSlug, type PayloadRequest, type Where } from 'payload'

import { companyContextOf, hasRole, isGroupAdmin, isRole, relId, userId as callerId, type Role } from '@/access/roles'
import { canUseMatrix, employeeChoices, matrixColumns, viewerOf, type MatrixCompany, type Viewer } from '@/admin/components/access/role-matrix'
import { writeAudit } from '@/audit/writer'
import { attendanceTypeOf, type AttendanceType } from '@/domain/attendance/area'
import { membershipOf, membershipOfEmployee } from '@/domain/employee-user-link'
import { CTX_KC_NEW_USER, CTX_TEMP_PASSWORD } from '@/domain/users-sync'
import { isDbGuardError, pgCode } from '@/lib/pg-error'

import {
  assignmentPatch,
  changedFields,
  errorPath,
  generateTemporaryPassword,
  membershipChange,
  normalizeAccountNo,
  ownerAfterSave,
  savedAssignmentErrors,
  selfGuardErrors,
  validateOnboarding,
  type AssignmentInput,
  type BankAccountInput,
  type CompanyInput,
  type EmployeeInput,
  type FieldError,
  type OnboardingInput,
  type StoredAssignment,
  type StoredCompany,
} from './rules'

/**
 * DRMS 13/10 Wave 3 — "Pengguna" tabbed onboarding (ADR 0003 revision 2026-10-13): load and save the account, its
 * access per PT, the employee of each PT, that employee's bank accounts and (DRMS 15/10) its team assignments in ONE
 * transaction (the caller — the endpoint — owns it and compensates Keycloak on failure).
 *
 * Every write goes through the existing collections with the CALLER's access (`overrideAccess: false`): Users
 * (create = Admin; identity update = accounts only in the caller's Admin PTs, Keycloak-first sync + deactivation
 * cascade in users-sync.ts), company-memberships (Admin of THAT PT or group admin; same-PT employee; audit
 * `role_change`), employees (Admin of the PT; per-PT code; `reasonOnDeactivate`), employee-bank-accounts (Admin /
 * Finance; verification status Admin / Finance; reason on number / holder / bank change), team-assignments (Admin /
 * PM of the PT; PT from the employee; exactly one location; end ≥ start; a PM only for its team and never role pm;
 * reason on role / end-date change; no delete). Nothing here bypasses them; the checks below only answer earlier and
 * name the field. Reads are SYSTEM-READs only where noted.
 */

export class OnboardingError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly errors: FieldError[] = [],
  ) {
    super(detail)
  }
}

export type OnboardingCompany = {
  id: number
  shortCode: string
  name: string
  canManageEmployees: boolean
  membership: { id: number; roles: Role[]; active: boolean } | null
  employee: { id: number; code: string; name: string; nickname: string | null; position: string | null; phone: string | null; attendanceType: AttendanceType; active: boolean } | null
  bankAccounts: Array<{ id: number; bank: number | null; bankName: string | null; accountNo: string; accountHolder: string; isDefault: boolean; verificationStatus: 'unverified' | 'verified'; active: boolean }>
  employeeChoices: Array<{ id: number; code: string; name: string; active: boolean }>
  canManageAssignments: boolean
  assignments: Array<{ id: number; kind: LocationKind | null; label: string; roleInProject: string; startDate: string | null; endDate: string | null }>
  /** Locations of a NEW assignment: active records of this PT the caller can read. ADR 0032: `sites` always empty (kept for APK ≤ 0.11.1). */
  assignmentChoices: Record<'projects' | 'costCenters' | 'sites', LocationChoice[]>
}

/** `site` = a legacy ADR 0023 assignment (ADR 0032: shown, never created). */
export type LocationKind = 'project' | 'costCenter' | 'site'
export type LocationChoice = { id: number; code: string; name: string }

export type OnboardingDetail = {
  user: { id: number; email: string; name: string | null; phone: string | null; active: boolean; groupAdmin: boolean; identityEditable: boolean } | null
  companies: OnboardingCompany[]
  banks: Array<{ id: number; name: string }>
}

/** Project statuses that take no new assignment (the picker and the save agree). */
const CLOSED_PROJECT = ['selesai', 'arsip', 'dibatalkan'] as const

/** The locations of a team assignment (exactly one per row — TeamAssignments guard + DB CHECK; `site` = legacy rows only). */
const LOCATIONS = [
  { key: 'project', collection: 'projects', label: 'Project' },
  { key: 'costCenter', collection: 'cost-centers', label: 'Pusat biaya' },
  { key: 'site', collection: 'sites', label: 'Site' },
] as const satisfies ReadonlyArray<{ key: LocationKind; collection: CollectionSlug; label: string }>

/** Who may use the form: the same as the Akses PT matrix (Admin of a PT or group admin). */
export function onboardingViewer(req: Pick<PayloadRequest, 'user'>): Viewer {
  return viewerOf(req.user)
}

export function mayOnboard(req: Pick<PayloadRequest, 'user'>): boolean {
  return canUseMatrix(onboardingViewer(req))
}

/** May the caller change memberships of `company`? (= company-memberships access / the matrix batch rule) */
export function mayManageCompany(req: Pick<PayloadRequest, 'user'>, company: number): boolean {
  return isGroupAdmin(req) || hasRole(req, 'pk-admin', company)
}

/** PTs of the form: active PTs the caller administers, narrowed to the PT switcher selection (as the matrix). */
export async function onboardingCompanies(req: PayloadRequest): Promise<MatrixCompany[]> {
  const ctx = companyContextOf(req.user)
  const res = await req.payload.find({ collection: 'companies', where: { active: { equals: true } }, sort: 'shortCode', pagination: false, select: { shortCode: true, name: true }, user: req.user, overrideAccess: false, req, depth: 0 })
  const all: MatrixCompany[] = res.docs.map((c) => ({ id: c.id as number, shortCode: String(c.shortCode), name: String(c.name ?? '') }))
  const memberIds = (ctx?.memberships ?? []).map((m) => m.company)
  const narrowed = ctx && ctx.selected.length < memberIds.length ? ctx.selected : null
  return matrixColumns(all, onboardingViewer(req), narrowed)
}

/**
 * Users `update` access evaluated for ONE account (the collection's own rule: own row, or accounts whose active
 * memberships are all in the caller's Admin PTs; never a group admin unless the caller is one).
 */
export async function canUpdateUser(req: PayloadRequest, id: number): Promise<boolean> {
  const access = req.payload.collections.users.config.access.update
  const res = await access({ req, id })
  if (res === true) return true
  if (!res) return false
  const n = await req.payload.count({ collection: 'users', where: { and: [res as Where, { id: { equals: id } }] }, overrideAccess: true /* SYSTEM-READ: evaluates the caller's update rule for this id */, req })
  return n.totalDocs > 0
}

type Row = Record<string, unknown>
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/** The form's data (create: `userId` null). Reads run with the caller's access. */
export async function loadUserOnboarding(req: PayloadRequest, userId: number | null): Promise<OnboardingDetail> {
  const companies = await onboardingCompanies(req)
  const colIds = companies.map((c) => c.id)
  const asCaller = { user: req.user, req, depth: 0 } as const

  let user: OnboardingDetail['user'] = null
  if (userId !== null) {
    const u = (await req.payload.findByID({ collection: 'users', id: userId, ...asCaller, overrideAccess: false, disableErrors: true })) as Row | null
    if (!u) throw new OnboardingError(404, 'Pengguna tidak ditemukan atau bukan pengguna PT Anda.')
    user = {
      id: userId,
      email: str(u.email),
      name: strOrNull(u.name),
      phone: strOrNull(u.phone),
      active: u.active !== false,
      groupAdmin: u.groupAdmin === true,
      identityEditable: await canUpdateUser(req, userId),
    }
  }

  const [cellsRes, employeesRes, banksRes] = await Promise.all([
    colIds.length ? req.payload.find({ collection: 'company-memberships', where: { company: { in: colIds } }, pagination: false, select: { user: true, company: true, roles: true, employee: true, active: true }, ...asCaller, overrideAccess: false }) : { docs: [] },
    colIds.length ? req.payload.find({ collection: 'employees', where: { company: { in: colIds } }, sort: 'code', pagination: false, select: { code: true, name: true, nickname: true, position: true, phone: true, attendanceType: true, active: true, company: true }, ...asCaller, overrideAccess: false }) : { docs: [] },
    req.payload.find({ collection: 'banks', where: { active: { not_equals: false } }, sort: 'name', pagination: false, select: { name: true }, ...asCaller, overrideAccess: false }),
  ])
  const cells = (cellsRes.docs as unknown as Row[]).map((m) => ({
    id: m.id as number,
    user: relId(m.user) ?? 0,
    company: relId(m.company) ?? 0,
    roles: (Array.isArray(m.roles) ? m.roles.filter(isRole) : []) as Role[],
    employee: relId(m.employee) ?? null,
    active: m.active !== false,
  }))
  const employees = (employeesRes.docs as unknown as Row[]).map((e) => ({
    id: e.id as number,
    company: relId(e.company) ?? 0,
    code: str(e.code),
    name: str(e.name),
    nickname: strOrNull(e.nickname),
    position: strOrNull(e.position),
    phone: strOrNull(e.phone),
    attendanceType: attendanceTypeOf(e.attendanceType),
    active: e.active !== false,
  }))
  const banks = (banksRes.docs as unknown as Row[]).map((b) => ({ id: b.id as number, name: str(b.name) }))
  const bankName = new Map(banks.map((b) => [b.id, b.name]))

  const mine = cells.filter((c) => userId !== null && c.user === userId)
  const linked = mine.map((c) => c.employee).filter((e): e is number => e !== null)
  const [accountsRes, assignRes, projectsRes, costCentersRes] = await Promise.all([
    linked.length ? req.payload.find({ collection: 'employee-bank-accounts', where: { employee: { in: linked } }, sort: 'id', pagination: false, select: { employee: true, bank: true, accountNo: true, accountHolder: true, isDefault: true, verificationStatus: true, active: true }, ...asCaller, overrideAccess: false }) : { docs: [] },
    linked.length ? req.payload.find({ collection: 'team-assignments', where: { employee: { in: linked } }, sort: '-startDate', pagination: false, ...asCaller, overrideAccess: false, depth: 1 }) : { docs: [] },
    // DRMS 15/10: locations of a new assignment — the caller's own read access (a PM reads its team's only)
    colIds.length ? req.payload.find({ collection: 'projects', where: { and: [{ company: { in: colIds } }, { status: { not_in: [...CLOSED_PROJECT] } }] }, sort: 'code', pagination: false, select: { code: true, name: true, company: true }, ...asCaller, overrideAccess: false }) : { docs: [] },
    colIds.length ? req.payload.find({ collection: 'cost-centers', where: { and: [{ company: { in: colIds } }, { active: { not_equals: false } }] }, sort: 'code', pagination: false, select: { code: true, name: true, company: true }, ...asCaller, overrideAccess: false }) : { docs: [] },
  ])
  const choicesOf = (docs: unknown[], company: number): LocationChoice[] =>
    (docs as Row[]).filter((d) => relId(d.company) === company).map((d) => ({ id: d.id as number, code: str(d.code), name: str(d.name) }))

  return {
    user,
    banks,
    companies: companies.map((c) => {
      const m = mine.find((x) => x.company === c.id) ?? null
      const emp = m?.employee != null ? (employees.find((e) => e.id === m.employee) ?? null) : null
      const canManageAssignments = hasRole(req, ['pk-admin', 'pk-pm'], c.id)
      return {
        id: c.id,
        shortCode: c.shortCode,
        name: c.name,
        canManageEmployees: hasRole(req, 'pk-admin', c.id),
        membership: m ? { id: m.id, roles: m.roles, active: m.active } : null,
        employee: emp ? { id: emp.id, code: emp.code, name: emp.name, nickname: emp.nickname, position: emp.position, phone: emp.phone, attendanceType: emp.attendanceType, active: emp.active } : null,
        bankAccounts: emp
          ? (accountsRes.docs as unknown as Row[])
              .filter((a) => relId(a.employee) === emp.id)
              .map((a) => ({
                id: a.id as number,
                bank: relId(a.bank) ?? null,
                bankName: bankName.get(relId(a.bank) ?? -1) ?? null,
                accountNo: str(a.accountNo),
                accountHolder: str(a.accountHolder),
                isDefault: a.isDefault === true,
                verificationStatus: a.verificationStatus === 'verified' ? ('verified' as const) : ('unverified' as const),
                active: a.active !== false,
              }))
          : [],
        employeeChoices: employeeChoices(employees, cells, c.id, userId ?? -1, emp?.id ?? null).map((e) => ({ id: e.id, code: e.code, name: e.name, active: e.active })),
        canManageAssignments,
        assignments: emp
          ? (assignRes.docs as unknown as Row[])
              .filter((a) => relId(a.employee) === emp.id)
              .map((a) => ({
                id: a.id as number,
                kind: LOCATIONS.find((l) => relId(a[l.key]) !== undefined)?.key ?? null,
                label: [a.project, a.costCenter, a.site].map((x) => (x && typeof x === 'object' ? str((x as Row).name) : '')).find((x) => x !== '') ?? '—',
                roleInProject: str(a.roleInProject),
                startDate: strOrNull(a.startDate),
                endDate: strOrNull(a.endDate),
              }))
          : [],
        assignmentChoices: canManageAssignments
          ? { projects: choicesOf(projectsRes.docs, c.id), costCenters: choicesOf(costCentersRes.docs, c.id), sites: [] }
          : { projects: [], costCenters: [], sites: [] },
      }
    }),
  }
}

// ---- save ------------------------------------------------------------------------------------------------------

/**
 * Collection / DB error of one write → the body path it belongs to (memberships batch pattern). Errors of nested
 * Payload operations already rolled the transaction back (killTransaction) — nothing continues after them.
 */
export function writeError(err: unknown, prefix: string): OnboardingError | null {
  if (err instanceof OnboardingError) return err
  if (err instanceof ValidationError) {
    const list = ((err.data as { errors?: Array<{ path?: string; message?: string }> } | undefined)?.errors ?? []).map((e) => ({ path: errorPath(prefix, e.path), message: e.message ?? 'Tidak valid.' }))
    const status = (err as { status?: number }).status === 403 ? 403 : 400
    return new OnboardingError(status, list.map((e) => e.message).join(' ') || 'Data tidak valid.', list.length ? list : [{ path: prefix, message: 'Data tidak valid.' }])
  }
  if (err instanceof APIError && err.status < 500) {
    const message = err.isPublic ? err.message : err.status === 403 ? 'Anda tidak berhak mengubah data ini.' : err.status === 404 ? 'Data tidak ditemukan.' : 'Ditolak.'
    const status = err.status === 403 || err.status === 404 || err.status === 409 ? err.status : 400
    return new OnboardingError(status, message, [{ path: prefix, message }])
  }
  // QA-05: drizzle wraps the pg error — pgCode unwraps it. 23503 = a referenced row (bank, employee …) does not exist.
  if (pgCode(err) === '23503') return new OnboardingError(400, 'Data terkait tidak ditemukan.', [{ path: prefix, message: 'Data terkait tidak ditemukan.' }])
  if (isDbGuardError(err)) {
    const message = 'Ditolak oleh aturan integritas data (mis. email sudah terdaftar, atau karyawan sudah terhubung ke akun lain di PT ini).'
    return new OnboardingError(409, message, [{ path: prefix, message }])
  }
  return null
}

async function at<T>(prefix: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw writeError(err, prefix) ?? err
  }
}

const EMPLOYEE_FIELDS = ['code', 'name', 'nickname', 'position', 'phone', 'attendanceType', 'active'] as const
const BANK_FIELDS = ['bank', 'accountNo', 'accountHolder', 'isDefault', 'verificationStatus', 'active'] as const

function employeeData(e: EmployeeInput): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of EMPLOYEE_FIELDS) if (e[k] !== undefined) out[k] = e[k]
  return out
}

function bankData(b: BankAccountInput): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of BANK_FIELDS) if (b[k] !== undefined) out[k] = k === 'accountNo' ? normalizeAccountNo(String(b[k])) : b[k]
  return out
}

export type SaveResult = { userId: number; created: boolean; temporaryPassword: string | null; linkedExistingAccount: boolean }

/**
 * One save of the form. MUST run inside one DB transaction on `req` (the endpoint's), and the caller compensates
 * Keycloak (`compensateKeycloak(req)`) when it throws. `userId` null = create.
 */
export async function saveUserOnboarding(req: PayloadRequest, input: OnboardingInput, userId: number | null): Promise<SaveResult> {
  if (!req.transactionID) throw new Error('saveUserOnboarding needs a transaction on req')
  if (!mayOnboard(req)) throw new OnboardingError(403, 'Hanya Admin PT (atau Admin grup) yang dapat mengelola pengguna.')
  const mode = userId === null ? 'create' : 'update'
  const companies = input.companies ?? []

  // PT rule of the matrix batch: every PT of the save must be one the caller administers
  const forbidden = companies.flatMap((c, i) => (mayManageCompany(req, c.company) ? [] : [{ path: `companies.${i}.company`, message: 'Anda bukan Admin PT ini.' }]))
  if (forbidden.length) throw new OnboardingError(403, 'Anda tidak berhak mengubah akses di salah satu PT.', forbidden)

  // current state per PT (edit): the account's memberships (SYSTEM-READ by membershipOf; the PTs are the caller's)
  const stored = new Map<number, StoredCompany>()
  if (userId !== null) {
    const u = await req.payload.findByID({ collection: 'users', id: userId, depth: 0, user: req.user, overrideAccess: false, req, disableErrors: true })
    if (!u) throw new OnboardingError(404, 'Pengguna tidak ditemukan atau bukan pengguna PT Anda.')
    for (const c of companies) {
      const m = await membershipOf(req, userId, c.company)
      const full = m ? await req.payload.findByID({ collection: 'company-memberships', id: m.id, depth: 0, select: { roles: true }, overrideAccess: true /* SYSTEM-READ: roles of a membership of a PT the caller administers (checked above) */, req }) : null
      stored.set(c.company, { membership: m ? { id: m.id, roles: ((full as { roles?: string[] | null } | null)?.roles ?? []).filter(isRole), active: m.active } : null, employee: m?.employee ?? null })
    }
  }

  // saved assignments named in the body, read with the caller's access (unreadable = not found, like other refs)
  const storedAssignments = await loadStoredAssignments(req, companies)
  const missing = companies.flatMap((c, i) => (c.assignments ?? []).flatMap((a, j) => (a.id !== undefined && !storedAssignments.has(a.id) ? [{ path: `companies.${i}.assignments.${j}`, message: 'Penugasan tidak ditemukan.' }] : [])))
  if (missing.length) throw new OnboardingError(404, 'Penugasan tidak ditemukan.', missing)

  const errors = validateOnboarding(input, mode, stored)
  if (userId !== null && userId === callerId(req)) errors.push(...selfGuardErrors(input, stored))
  const owners = new Map(companies.map((c) => [c.company, ownerAfterSave(c.employee, stored.get(c.company)?.employee ?? null)] as const))
  if (!errors.length) errors.push(...savedAssignmentErrors(input, storedAssignments, owners))
  if (errors.length) throw new OnboardingError(400, errors.map((e) => e.message).filter((m, i, a) => a.indexOf(m) === i).slice(0, 3).join(' '), errors)

  if (input.reason && input.reason.trim()) req.context.auditReason = input.reason.trim()
  const asCaller = { depth: 0, user: req.user, req } as const

  // 1. the account (Keycloak-first inside the Users hooks)
  let uid: number
  let temporaryPassword: string | null = null
  let linkedExistingAccount = false
  if (userId === null) {
    const u = input.user!
    const password = generateTemporaryPassword()
    req.context[CTX_TEMP_PASSWORD] = password
    try {
      const doc = await at('user', () =>
        req.payload.create({ collection: 'users', data: { email: u.email!, name: u.name ?? null, phone: u.phone ?? null, active: u.active !== false } as never, ...asCaller, overrideAccess: false }),
      )
      uid = doc.id as number
      const fresh = typeof req.context[CTX_KC_NEW_USER] === 'string' && req.context[CTX_KC_NEW_USER] === (doc as { keycloakSub?: unknown }).keycloakSub
      temporaryPassword = fresh ? password : null
      linkedExistingAccount = !fresh
    } finally {
      delete req.context[CTX_TEMP_PASSWORD]
    }
    if (temporaryPassword) {
      // ADR 0006: the fact (never the value) that a temporary password was set, in the same transaction
      await writeAudit(req, [{ action: 'update', docType: 'user', docId: String(uid), field: 'password', reason: 'Kata sandi sementara dibuat saat pengguna didaftarkan (wajib diganti saat login pertama).' }])
    }
  } else {
    uid = userId
    if (input.user) {
      const current = (await req.payload.findByID({ collection: 'users', id: uid, ...asCaller, overrideAccess: false })) as unknown as Row
      const patch = changedFields({ ...current, email: str(current.email).toLowerCase() }, { ...input.user, ...(input.user.email ? { email: input.user.email.trim().toLowerCase() } : {}) }, ['email', 'name', 'phone', 'active'])
      if (Object.keys(patch).length) await at('user', () => req.payload.update({ collection: 'users', id: uid, data: patch as never, ...asCaller, overrideAccess: false }))
    }
  }

  // 2. per PT: employee (create / update / link), membership (roles + link), bank accounts
  for (const [i, c] of companies.entries()) await savePt(req, uid, c, i, stored.get(c.company) ?? { membership: null, employee: null }, storedAssignments)

  return { userId: uid, created: userId === null, temporaryPassword, linkedExistingAccount }
}

async function loadStoredAssignments(req: PayloadRequest, companies: readonly CompanyInput[]): Promise<Map<number, StoredAssignment>> {
  const ids = [...new Set(companies.flatMap((c) => (c.assignments ?? []).flatMap((a) => (a.id !== undefined ? [a.id] : []))))]
  if (!ids.length) return new Map()
  const res = await req.payload.find({ collection: 'team-assignments', where: { id: { in: ids } }, depth: 0, pagination: false, select: { employee: true, roleInProject: true, startDate: true, endDate: true }, user: req.user, req, overrideAccess: false })
  return new Map(
    (res.docs as unknown as Row[]).map((a) => [a.id as number, { id: a.id as number, employee: relId(a.employee) ?? null, roleInProject: str(a.roleInProject), startDate: strOrNull(a.startDate), endDate: strOrNull(a.endDate) }]),
  )
}

/**
 * The location of a NEW assignment: readable by the caller (a PM reads its team's only), of THIS PT and active —
 * otherwise "not found" (a foreign / unknown id answers the same). The collection guard still decides the rest.
 */
async function checkLocation(req: PayloadRequest, company: number, a: AssignmentInput, path: string): Promise<void> {
  for (const l of LOCATIONS) {
    const id = a[l.key]
    if (id === undefined) continue
    let doc: Row | null = null
    try {
      doc = (await req.payload.findByID({ collection: l.collection as CollectionSlug, id, depth: 0, select: { company: true, status: true, active: true } as never, user: req.user, req, overrideAccess: false, disableErrors: true })) as unknown as Row | null
    } catch (err) {
      if (!(err instanceof APIError && (err.status === 403 || err.status === 404))) throw err
    }
    if (!doc || relId(doc.company) !== company) {
      const message = `${l.label} tidak ditemukan di PT ini.`
      throw new OnboardingError(400, message, [{ path: `${path}.${l.key}`, message }])
    }
    const closed = l.key === 'project' ? (CLOSED_PROJECT as readonly string[]).includes(str(doc.status)) : doc.active === false
    if (closed) {
      const message = l.key === 'project' ? 'Project sudah selesai / diarsipkan — pilih project lain.' : `${l.label} tidak aktif — pilih yang lain.`
      throw new OnboardingError(400, message, [{ path: `${path}.${l.key}`, message }])
    }
  }
}

async function savePt(req: PayloadRequest, uid: number, c: CompanyInput, i: number, stored: StoredCompany, storedAssignments: ReadonlyMap<number, StoredAssignment>): Promise<void> {
  const prefix = `companies.${i}`
  const asCaller = { depth: 0, user: req.user, req } as const

  // employee of this PT after the save: undefined = unchanged, null = none
  let employee: number | null | undefined
  const e = c.employee
  if (e === null) employee = null
  else if (e !== undefined) {
    if (e.id === undefined) {
      const doc = await at(`${prefix}.employee`, () => req.payload.create({ collection: 'employees', data: { ...employeeData(e), company: c.company } as never, ...asCaller, overrideAccess: false }))
      employee = doc.id as number
    } else {
      const id = e.id
      const current = (await at(`${prefix}.employee`, () => req.payload.findByID({ collection: 'employees', id, ...asCaller, overrideAccess: false }))) as unknown as Row
      if (relId(current.company) !== c.company) throw new OnboardingError(400, 'Karyawan harus dari PT yang sama.', [{ path: `${prefix}.employee`, message: 'Karyawan harus dari PT yang sama.' }])
      if (id !== stored.employee) {
        const other = await membershipOfEmployee(req, id)
        if (other && other.user !== uid) {
          const message = 'Satu karyawan hanya boleh terhubung ke satu akun per PT — karyawan ini sudah terhubung ke akun lain.'
          throw new OnboardingError(409, message, [{ path: `${prefix}.employee`, message }])
        }
      }
      const patch = changedFields(current, employeeData(e), EMPLOYEE_FIELDS)
      if (Object.keys(patch).length) await at(`${prefix}.employee`, () => req.payload.update({ collection: 'employees', id, data: patch as never, ...asCaller, overrideAccess: false }))
      employee = id
    }
  }

  const change = membershipChange(stored.membership, c.roles, employee, stored.employee)
  if (change) {
    if (stored.membership) {
      const id = stored.membership.id
      await at(`${prefix}.roles`, () => req.payload.update({ collection: 'company-memberships', id, data: change as never, ...asCaller, overrideAccess: false }))
    } else {
      await at(`${prefix}.roles`, () => req.payload.create({ collection: 'company-memberships', data: { ...change, user: uid, company: c.company, employee: employee ?? null } as never, ...asCaller, overrideAccess: false }))
    }
  }

  const owner = employee === undefined ? stored.employee : employee
  for (const [j, b] of (c.bankAccounts ?? []).entries()) {
    const bat = `${prefix}.bankAccounts.${j}`
    if (owner === null) throw new OnboardingError(400, 'Rekening butuh data karyawan.', [{ path: bat, message: 'Rekening butuh data karyawan.' }])
    if (b.id === undefined) {
      await at(bat, () => req.payload.create({ collection: 'employee-bank-accounts', data: { ...bankData(b), employee: owner } as never, ...asCaller, overrideAccess: false }))
      continue
    }
    const id = b.id
    const current = (await at(bat, () => req.payload.findByID({ collection: 'employee-bank-accounts' as CollectionSlug, id, ...asCaller, overrideAccess: false }))) as unknown as Row
    if (relId(current.employee) !== owner) throw new OnboardingError(400, 'Rekening ini bukan milik karyawan PT ini.', [{ path: bat, message: 'Rekening ini bukan milik karyawan PT ini.' }])
    const patch = changedFields({ ...current, bank: relId(current.bank) ?? null }, bankData(b), BANK_FIELDS)
    if (Object.keys(patch).length) await at(bat, () => req.payload.update({ collection: 'employee-bank-accounts', id, data: patch as never, ...asCaller, overrideAccess: false }))
  }

  // DRMS 15/10: team assignments of the PT's employee — after the employee, so a NEW employee's id is used
  for (const [j, a] of (c.assignments ?? []).entries()) {
    const aat = `${prefix}.assignments.${j}`
    if (owner === null) throw new OnboardingError(400, 'Penugasan butuh data karyawan.', [{ path: aat, message: 'Penugasan butuh data karyawan.' }])
    if (a.id === undefined) {
      await checkLocation(req, c.company, a, aat)
      const loc = LOCATIONS.find((l) => a[l.key] !== undefined)!
      const data = { employee: owner, [loc.key]: a[loc.key], roleInProject: a.roleInProject, ...(a.startDate ? { startDate: a.startDate } : {}), ...(a.endDate ? { endDate: a.endDate } : {}) }
      await at(aat, () => req.payload.create({ collection: 'team-assignments', data: data as never, ...asCaller, overrideAccess: false }))
      continue
    }
    const id = a.id
    const patch = assignmentPatch(storedAssignments.get(id)!, a)
    if (Object.keys(patch).length) await at(aat, () => req.payload.update({ collection: 'team-assignments', id, data: patch as never, ...asCaller, overrideAccess: false }))
  }
}
