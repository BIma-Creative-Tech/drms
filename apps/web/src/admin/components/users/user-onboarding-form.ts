import type { LocationKind, OnboardingDetail } from '@/domain/user-onboarding/service'

/**
 * DRMS 13/10 Wave 3 — "Pengguna" tabbed form: pure state of the client form (unit-tested). The form keeps one draft
 * (identity + per PT: roles, employee, bank accounts, team assignments — DRMS 15/10) and sends ONE body to `POST /api/v1/user-onboarding` (create)
 * or `PATCH /api/v1/user-onboarding/{id}` (only what changed). Server errors (`errors[].path` = body paths with
 * array indexes) are mapped back to the draft keys and their tab. No React here.
 */

export type TabId = 'detail' | 'akses' | 'karyawan' | 'rekening' | 'penugasan'

export const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'detail', label: 'Detail Pengguna' },
  { id: 'akses', label: 'Akses & Peran' },
  { id: 'karyawan', label: 'Data Karyawan' },
  { id: 'rekening', label: 'Rekening Karyawan' },
  { id: 'penugasan', label: 'Penugasan Proyek' },
]

/** Employee of one PT: none / the linked one (editable) / pick an existing unlinked one / create a new one. */
export type EmpMode = 'none' | 'linked' | 'pick' | 'new'
/** `attendanceType` (DRMS 13/10 A2 "Tipe absensi"): onsite = any registered location of the PT, non_onsite = head office + branches. */
export type EmpDraft = { mode: EmpMode; id: number | null; code: string; name: string; nickname: string; position: string; phone: string; attendanceType: 'onsite' | 'non_onsite'; active: boolean }
export type BankDraft = { key: string; id?: number; bank: number | null; accountNo: string; accountHolder: string; isDefault: boolean; verificationStatus: 'unverified' | 'verified'; active: boolean }
/**
 * Team assignment row (DRMS 15/10). Saved (`id`): only the role and the end date are editable (no delete — the
 * collection denies it; end it instead). New: one location (`kind` + `location`), role, start, end.
 */
export type AsgRole = 'pm' | 'staff' | 'mandor'
export type AsgDraft = { key: string; id?: number; kind: LocationKind; location: number | null; label: string; roleInProject: AsgRole; startDate: string; endDate: string }
export type CompanyDraft = { roles: string[]; emp: EmpDraft; banks: BankDraft[]; asg: AsgDraft[] }
export type Draft = {
  user: { email: string; name: string; phone: string; active: boolean }
  companies: Record<string, CompanyDraft>
  reason: string
}

export const ASG_ROLES: ReadonlyArray<{ value: AsgRole; label: string }> = [
  { value: 'pm', label: 'PM' },
  { value: 'staff', label: 'Staff' },
  { value: 'mandor', label: 'Mandor' },
]

export const LOCATION_KINDS: ReadonlyArray<{ value: LocationKind; label: string; choices: 'projects' | 'costCenters' | 'sites' }> = [
  { value: 'project', label: 'Project', choices: 'projects' },
  { value: 'costCenter', label: 'Pusat biaya', choices: 'costCenters' },
  { value: 'site', label: 'Site', choices: 'sites' },
]

const asgRole = (v: string): AsgRole => (v === 'pm' || v === 'mandor' ? v : 'staff')
const day = (v: string | null | undefined): string => (v ? v.slice(0, 10) : '')

const EMPTY_EMP: EmpDraft = { mode: 'none', id: null, code: '', name: '', nickname: '', position: '', phone: '', attendanceType: 'onsite', active: true }

export function draftFromDetail(detail: OnboardingDetail): Draft {
  const u = detail.user
  const companies: Record<string, CompanyDraft> = {}
  for (const c of detail.companies) {
    const e = c.employee
    companies[String(c.id)] = {
      roles: c.membership ? [...c.membership.roles] : [],
      emp: e ? { mode: 'linked', id: e.id, code: e.code, name: e.name, nickname: e.nickname ?? '', position: e.position ?? '', phone: e.phone ?? '', attendanceType: e.attendanceType, active: e.active } : { ...EMPTY_EMP },
      banks: c.bankAccounts.map((b) => ({ key: `b${b.id}`, id: b.id, bank: b.bank, accountNo: b.accountNo, accountHolder: b.accountHolder, isDefault: b.isDefault, verificationStatus: b.verificationStatus, active: b.active })),
      asg: c.assignments.map((a) => ({ key: `a${a.id}`, id: a.id, kind: a.kind ?? 'project', location: null, label: a.label, roleInProject: asgRole(a.roleInProject), startDate: day(a.startDate), endDate: day(a.endDate) })),
    }
  }
  return { user: { email: u?.email ?? '', name: u?.name ?? '', phone: u?.phone ?? '', active: u?.active ?? true }, companies, reason: '' }
}

/** A new, empty bank-account row (holder prefilled with the employee / account name). */
export function newBank(key: string, holder: string): BankDraft {
  return { key, bank: null, accountNo: '', accountHolder: holder, isDefault: false, verificationStatus: 'unverified', active: true }
}

/** A new assignment row: Staff from `today` (local `YYYY-MM-DD`), location still to pick. */
export function newAssignment(key: string, today: string): AsgDraft {
  return { key, kind: 'project', location: null, label: '', roleInProject: 'staff', startDate: today, endDate: '' }
}

/** Does the draft hold an employee for the PT (linked / picked / new)? Bank accounts and assignments need one. */
export function hasEmployee(e: EmpDraft): boolean {
  return e.mode === 'linked' || e.mode === 'new' || (e.mode === 'pick' && e.id !== null)
}

/** Saved assignments are those of the linked employee — shown (and editable) only while it stays linked. */
export function showsSavedAssignments(c: OnboardingDetail['companies'][number], e: EmpDraft): boolean {
  return e.mode === 'linked' && c.employee !== null && e.id === c.employee.id
}

/** PTs shown on the employee / bank-account tabs: with a role in the draft or an existing membership. */
export function activeCompanies(detail: OnboardingDetail, draft: Draft): OnboardingDetail['companies'] {
  return detail.companies.filter((c) => (draft.companies[String(c.id)]?.roles.length ?? 0) > 0 || c.membership !== null)
}

const sameSet = (a: readonly string[], b: readonly string[]) => [...a].sort().join() === [...b].sort().join()
const opt = (v: string): string | null => (v.trim() === '' ? null : v.trim())

type Body = {
  user?: Record<string, unknown>
  companies?: Array<Record<string, unknown>>
  reason?: string
}

/** Index maps of a sent body, to place the server's `companies.<i>.bankAccounts.<j>` / `.assignments.<j>` errors. */
export type BodyOrder = { companies: number[]; banks: Record<number, string[]>; asg?: Record<number, string[]> }

function employeePart(stored: OnboardingDetail['companies'][number]['employee'], e: EmpDraft): Record<string, unknown> | null | undefined {
  if (e.mode === 'none') return stored ? null : undefined
  if (e.mode === 'pick') return e.id !== null && e.id !== stored?.id ? { id: e.id } : undefined
  if (e.mode === 'new') {
    return { code: e.code.trim(), name: e.name.trim(), nickname: opt(e.nickname), position: opt(e.position), phone: opt(e.phone), attendanceType: e.attendanceType, active: e.active }
  }
  // linked: only the changed fields
  if (!stored || e.id !== stored.id) return e.id !== null ? { id: e.id } : undefined
  const out: Record<string, unknown> = {}
  if (e.code.trim() !== stored.code) out.code = e.code.trim()
  if (e.name.trim() !== stored.name) out.name = e.name.trim()
  if (opt(e.nickname) !== stored.nickname) out.nickname = opt(e.nickname)
  if (opt(e.position) !== stored.position) out.position = opt(e.position)
  if (opt(e.phone) !== stored.phone) out.phone = opt(e.phone)
  if (e.attendanceType !== stored.attendanceType) out.attendanceType = e.attendanceType
  if (e.active !== stored.active) out.active = e.active
  return Object.keys(out).length ? { id: stored.id, ...out } : undefined
}

function bankPart(stored: OnboardingDetail['companies'][number]['bankAccounts'], b: BankDraft): Record<string, unknown> | null {
  if (b.id === undefined) {
    if (b.bank === null && b.accountNo.trim() === '') return null // untouched new row (the holder is prefilled)
    return { ...(b.bank !== null ? { bank: b.bank } : {}), accountNo: b.accountNo.trim(), accountHolder: b.accountHolder.trim(), isDefault: b.isDefault, verificationStatus: b.verificationStatus, active: b.active }
  }
  const s = stored.find((x) => x.id === b.id)
  if (!s) return null
  const out: Record<string, unknown> = {}
  if (b.bank !== s.bank && b.bank !== null) out.bank = b.bank
  if (b.accountNo.trim() !== s.accountNo) out.accountNo = b.accountNo.trim()
  if (b.accountHolder.trim() !== s.accountHolder) out.accountHolder = b.accountHolder.trim()
  if (b.isDefault !== s.isDefault) out.isDefault = b.isDefault
  if (b.verificationStatus !== s.verificationStatus) out.verificationStatus = b.verificationStatus
  if (b.active !== s.active) out.active = b.active
  return Object.keys(out).length ? { id: b.id, ...out } : null
}

/** One assignment row of the body (null = saved and unchanged). Saved rows send the role + a changed end date. */
function asgPart(stored: OnboardingDetail['companies'][number]['assignments'], a: AsgDraft): Record<string, unknown> | null {
  if (a.id === undefined) {
    return { ...(a.location !== null ? { [a.kind]: a.location } : {}), roleInProject: a.roleInProject, ...(a.startDate ? { startDate: a.startDate } : {}), ...(a.endDate ? { endDate: a.endDate } : {}) }
  }
  const s = stored.find((x) => x.id === a.id)
  if (!s) return null
  const roleChanged = a.roleInProject !== asgRole(s.roleInProject)
  const endChanged = a.endDate !== day(s.endDate)
  if (!roleChanged && !endChanged) return null
  return { id: a.id, roleInProject: a.roleInProject, ...(endChanged ? { endDate: a.endDate || null } : {}) }
}

/**
 * The body of one save + its index order. Create: the whole identity and every PT with a role. Edit: only changed
 * identity fields (when the caller may change them) and the PTs where something changed (roles always sent with
 * the PT — the server compares).
 */
export function buildBody(detail: OnboardingDetail, draft: Draft, mode: 'create' | 'update'): { body: Body; order: BodyOrder; changed: boolean; needsReason: boolean } {
  const body: Body = {}
  const order: BodyOrder = { companies: [], banks: {}, asg: {} }
  let needsReason = false
  const u = draft.user
  if (mode === 'create') {
    body.user = { email: u.email.trim(), name: u.name.trim(), phone: opt(u.phone), active: u.active }
  } else if (detail.user?.identityEditable) {
    const s = detail.user
    const out: Record<string, unknown> = {}
    if (u.email.trim().toLowerCase() !== s.email) out.email = u.email.trim()
    if (u.name.trim() !== (s.name ?? '')) out.name = u.name.trim()
    if (opt(u.phone) !== s.phone) out.phone = opt(u.phone)
    if (u.active !== s.active) out.active = u.active
    if (Object.keys(out).length) body.user = out
  }
  const companies: Array<Record<string, unknown>> = []
  for (const c of detail.companies) {
    const d = draft.companies[String(c.id)]
    if (!d) continue
    const rolesChanged = !sameSet(d.roles, c.membership?.roles ?? [])
    const employee = c.canManageEmployees ? employeePart(c.employee, d.emp) : undefined
    const keys: string[] = []
    const banks: Array<Record<string, unknown>> = []
    if (c.canManageEmployees) {
      for (const b of d.banks) {
        const part = bankPart(c.bankAccounts, b)
        if (part) {
          banks.push(part)
          keys.push(b.key)
        }
      }
    }
    const asgKeys: string[] = []
    const asg: Array<Record<string, unknown>> = []
    if (c.canManageAssignments) {
      const saved = showsSavedAssignments(c, d.emp)
      for (const a of d.asg) {
        if (a.id !== undefined && !saved) continue
        const part = asgPart(c.assignments, a)
        if (part) {
          asg.push(part)
          asgKeys.push(a.key)
          // TeamAssignments reasonOnChange: a changed role / end date of a saved row needs the reason
          if (a.id !== undefined) needsReason = true
        }
      }
    }
    if (!rolesChanged && employee === undefined && banks.length === 0 && asg.length === 0) continue
    if (!c.membership && d.roles.length === 0 && employee === undefined && banks.length === 0 && asg.length === 0) continue
    order.banks[companies.length] = keys
    order.asg![companies.length] = asgKeys
    order.companies.push(c.id)
    companies.push({ company: c.id, roles: [...d.roles], ...(employee !== undefined ? { employee } : {}), ...(banks.length ? { bankAccounts: banks } : {}), ...(asg.length ? { assignments: asg } : {}) })
  }
  if (companies.length || mode === 'create') body.companies = companies
  if (draft.reason.trim()) body.reason = draft.reason.trim()
  const changed = mode === 'create' || body.user !== undefined || companies.length > 0
  return { body, order, changed, needsReason }
}

/** Draft key of one server error path + the tab that shows it. */
export function errorTarget(path: string, order: BodyOrder): { key: string; tab: TabId | null } {
  if (path === 'reason') return { key: 'reason', tab: null }
  if (path.startsWith('user')) return { key: path, tab: 'detail' }
  const m = /^companies\.(\d+)(?:\.(.*))?$/.exec(path)
  if (!m) return { key: path, tab: path === 'companies' ? 'akses' : null }
  const cid = order.companies[Number(m[1])]
  const rest = m[2] ?? 'roles'
  const base = cid === undefined ? `c?` : `c.${cid}`
  const bm = /^bankAccounts\.(\d+)(?:\.(.*))?$/.exec(rest)
  if (bm) {
    const key = order.banks[Number(m[1])]?.[Number(bm[1])] ?? '?'
    return { key: `${base}.bank.${key}${bm[2] ? `.${bm[2]}` : ''}`, tab: 'rekening' }
  }
  if (rest === 'bankAccounts') return { key: `${base}.bank`, tab: 'rekening' }
  const am = /^assignments\.(\d+)(?:\.(.*))?$/.exec(rest)
  if (am) {
    const key = order.asg?.[Number(m[1])]?.[Number(am[1])] ?? '?'
    // the collection names the location field (project / costCenter / site) — the form has one picker for it
    const f = am[2] === 'project' || am[2] === 'costCenter' || am[2] === 'site' ? 'location' : am[2]
    return { key: `${base}.asg.${key}${f ? `.${f}` : ''}`, tab: 'penugasan' }
  }
  if (rest === 'assignments') return { key: `${base}.asg`, tab: 'penugasan' }
  if (rest.startsWith('employee')) return { key: `${base}.${rest}`, tab: 'karyawan' }
  return { key: `${base}.${rest === 'company' ? 'roles' : rest}`, tab: 'akses' }
}

/** Errors of a refused save by draft key (several messages of one key joined) + the first tab with an error. */
export function mapErrors(data: unknown, order: BodyOrder): { byKey: Map<string, string>; tab: TabId | null } {
  const errs = ((data ?? {}) as { errors?: Array<{ path?: unknown; message?: unknown }> }).errors ?? []
  const byKey = new Map<string, string>()
  let tab: TabId | null = null
  for (const e of errs) {
    if (typeof e.path !== 'string') continue
    const t = errorTarget(e.path, order)
    const msg = typeof e.message === 'string' && e.message ? e.message : 'Tidak valid.'
    byKey.set(t.key, byKey.has(t.key) ? `${byKey.get(t.key)}; ${msg}` : msg)
    tab ??= t.tab
  }
  return { byKey, tab }
}
