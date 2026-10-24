import { randomInt } from 'node:crypto'

/**
 * DRMS 13/10 Wave 3 — "Pengguna" tabbed onboarding: pure rules of ONE save (unit-tested). The collection hooks and
 * access rules stay the guards (Users / company-memberships / employees / employee-bank-accounts / team-assignments,
 * run with the caller's access by service.ts); these checks only give the form field-level answers BEFORE anything is
 * written (cross-field rules the collections cannot see: one entry per PT, a bank account or an assignment needs an
 * employee …).
 * No Payload import.
 */

export type FieldError = { path: string; message: string }

export type EmployeeInput = { id?: number; code?: string; name?: string; nickname?: string | null; position?: string | null; phone?: string | null; attendanceType?: 'onsite' | 'non_onsite'; active?: boolean }
export type BankAccountInput = { id?: number; bank?: number; accountNo?: string; accountHolder?: string; isDefault?: boolean; verificationStatus?: 'unverified' | 'verified'; active?: boolean }
export type AssignmentRole = 'pm' | 'staff' | 'mandor'
export type AssignmentInput = { id?: number; project?: number; costCenter?: number; site?: number; roleInProject: AssignmentRole; startDate?: string | null; endDate?: string | null }
export type CompanyInput = { company: number; roles: string[]; employee?: EmployeeInput | null; bankAccounts?: BankAccountInput[]; assignments?: AssignmentInput[] }
export type UserInput = { email?: string; name?: string; phone?: string | null; active?: boolean }
export type OnboardingInput = { user?: UserInput; companies?: CompanyInput[]; reason?: string }

/** Stored state of one PT of the account (edit), as the rules need it. */
export type StoredCompany = { membership: { id: number; roles: string[]; active: boolean } | null; employee: number | null }
/** A saved team assignment, as the rules need it (dates as stored: ISO, compared by day). */
export type StoredAssignment = { id: number; employee: number | null; roleInProject: string; startDate: string | null; endDate: string | null }

export const NO_ROLE_MESSAGE = 'Pilih minimal satu peran di PT ini.'
export const NEED_EMPLOYEE_MESSAGE = 'Rekening butuh data karyawan di PT ini — pilih atau buat data karyawan dulu (tab Data Karyawan).'
export const SELF_DEACTIVATE_MESSAGE = 'Anda tidak dapat menonaktifkan akun Anda sendiri.'
export const SELF_ADMIN_MESSAGE = 'Anda tidak dapat mencabut peran Admin Anda sendiri di PT ini (minta Admin lain).'
export const NEED_EMPLOYEE_ASSIGNMENT_MESSAGE = 'Penugasan butuh data karyawan di PT ini — pilih atau buat data karyawan dulu (tab Data Karyawan).'
export const ONE_LOCATION_MESSAGE = 'Pilih tepat satu lokasi: project ATAU pusat biaya.'
/** ADR 0032: no new site assignment (an APK ≤ 0.11.1 may still send `site`). */
export const SITE_ASSIGNMENT_MESSAGE = 'Penugasan ke site tidak tersedia lagi. Pilih project atau pusat biaya.'
export const END_BEFORE_START_MESSAGE = 'Tanggal selesai tidak boleh sebelum tanggal mulai.'
export const ASSIGNMENT_FIXED_MESSAGE = 'Lokasi dan tanggal mulai penugasan yang tersimpan tidak dapat diubah — akhiri penugasan ini lalu tambah penugasan baru.'
/** Same text as the collection rule (TeamAssignments reasonOnChange). */
export const ASSIGNMENT_REASON_MESSAGE = 'Alasan wajib diisi saat mengubah peran atau mengakhiri penugasan.'
export const ASSIGNMENT_OWNER_MESSAGE = 'Penugasan ini bukan milik karyawan PT ini.'

/** Account number as the collection stores it (EmployeeBankAccounts beforeValidate): spaces, dots, dashes removed. */
export function normalizeAccountNo(v: string): string {
  return v.replace(/[\s.-]/g, '')
}

const ACCOUNT_NO = /^[0-9]{5,34}$/

/**
 * Cross-field checks of one save. `stored` = the account's current state per PT (edit; empty map on create).
 * Paths follow the body (`companies.<i>.…`) so the form marks the field.
 */
export function validateOnboarding(input: OnboardingInput, mode: 'create' | 'update', stored: ReadonlyMap<number, StoredCompany> = new Map()): FieldError[] {
  const errors: FieldError[] = []
  const companies = input.companies ?? []
  const seen = new Set<number>()
  if (mode === 'create' && !companies.some((c) => c.roles.length > 0)) errors.push({ path: 'companies', message: 'Pilih minimal satu PT dan peran.' })
  companies.forEach((c, i) => {
    const at = `companies.${i}`
    if (seen.has(c.company)) errors.push({ path: `${at}.company`, message: 'PT yang sama dua kali dalam satu simpan.' })
    seen.add(c.company)
    const s = stored.get(c.company)
    const member = s?.membership ?? null
    if (!member && c.roles.length === 0 && (c.employee || (c.bankAccounts?.length ?? 0) > 0 || (c.assignments?.length ?? 0) > 0)) errors.push({ path: `${at}.roles`, message: NO_ROLE_MESSAGE })
    const emp = c.employee
    if (emp && emp.id === undefined) {
      if (!emp.code) errors.push({ path: `${at}.employee.code`, message: 'Kode karyawan wajib diisi.' })
      if (!emp.name) errors.push({ path: `${at}.employee.name`, message: 'Nama karyawan wajib diisi.' })
    }
    const hasEmployee = emp === undefined ? (s?.employee ?? null) !== null : emp !== null
    ;(c.bankAccounts ?? []).forEach((b, j) => {
      const bat = `${at}.bankAccounts.${j}`
      if (!hasEmployee) {
        errors.push({ path: bat, message: NEED_EMPLOYEE_MESSAGE })
        return
      }
      if (b.id === undefined) {
        if (b.bank === undefined) errors.push({ path: `${bat}.bank`, message: 'Bank wajib dipilih.' })
        if (!b.accountNo) errors.push({ path: `${bat}.accountNo`, message: 'Nomor rekening wajib diisi.' })
        if (!b.accountHolder) errors.push({ path: `${bat}.accountHolder`, message: 'Atas nama wajib diisi.' })
      }
      if (b.accountNo && !ACCOUNT_NO.test(normalizeAccountNo(b.accountNo))) errors.push({ path: `${bat}.accountNo`, message: 'Nomor rekening hanya angka (5–34 digit).' })
    })
    ;(c.assignments ?? []).forEach((a, j) => {
      const aat = `${at}.assignments.${j}`
      if (!hasEmployee) {
        errors.push({ path: aat, message: NEED_EMPLOYEE_ASSIGNMENT_MESSAGE })
        return
      }
      const locations = [a.project, a.costCenter, a.site].filter((x) => x !== undefined).length
      if (a.id !== undefined) {
        // a saved row: only the role and the end date change here (TeamAssignments guard: a PM cannot move it either)
        if (locations > 0 || a.startDate !== undefined) errors.push({ path: aat, message: ASSIGNMENT_FIXED_MESSAGE })
        return
      }
      if (a.site !== undefined) errors.push({ path: `${aat}.location`, message: SITE_ASSIGNMENT_MESSAGE })
      else if (locations !== 1) errors.push({ path: `${aat}.location`, message: ONE_LOCATION_MESSAGE })
      if (a.startDate && a.endDate && a.endDate < a.startDate) errors.push({ path: `${aat}.endDate`, message: END_BEFORE_START_MESSAGE })
    })
  })
  return errors
}

/** Day part (`YYYY-MM-DD`) of a stored date / a body date (the house convention: `slice(0, 10)`). */
export function dayOf(v: string | null | undefined): string | null {
  return typeof v === 'string' && v !== '' ? v.slice(0, 10) : null
}

/** Changes of a saved assignment (role / end date only; `undefined` in the body = unchanged). */
export function assignmentPatch(stored: StoredAssignment, a: AssignmentInput): { roleInProject?: AssignmentRole; endDate?: string | null } {
  const out: { roleInProject?: AssignmentRole; endDate?: string | null } = {}
  if (a.roleInProject !== stored.roleInProject) out.roleInProject = a.roleInProject
  if (a.endDate !== undefined && dayOf(a.endDate) !== dayOf(stored.endDate)) out.endDate = dayOf(a.endDate)
  return out
}

/** Employee of one PT after the save, as far as known before writing (`'new'` = created by this save). */
export function ownerAfterSave(e: EmployeeInput | null | undefined, storedEmployee: number | null): number | null | 'new' {
  if (e === undefined) return storedEmployee
  if (e === null) return null
  return e.id ?? 'new'
}

/**
 * Checks of the SAVED assignments named in the body (`stored` = those rows read with the caller's access; a row the
 * caller cannot read is missing): same employee as the PT's after the save, end date not before the stored start,
 * and the reason the collection asks for when the role or the end date changes (TeamAssignments reasonOnChange).
 */
export function savedAssignmentErrors(input: OnboardingInput, stored: ReadonlyMap<number, StoredAssignment>, owners: ReadonlyMap<number, number | null | 'new'>): FieldError[] {
  const errors: FieldError[] = []
  let changed = false
  ;(input.companies ?? []).forEach((c, i) => {
    ;(c.assignments ?? []).forEach((a, j) => {
      if (a.id === undefined) return
      const aat = `companies.${i}.assignments.${j}`
      const s = stored.get(a.id)
      if (!s) {
        errors.push({ path: aat, message: 'Penugasan tidak ditemukan.' })
        return
      }
      if (s.employee === null || s.employee !== owners.get(c.company)) {
        errors.push({ path: aat, message: ASSIGNMENT_OWNER_MESSAGE })
        return
      }
      const patch = assignmentPatch(s, a)
      const start = dayOf(s.startDate)
      if (patch.endDate && start && patch.endDate < start) errors.push({ path: `${aat}.endDate`, message: END_BEFORE_START_MESSAGE })
      if (Object.keys(patch).length) changed = true
    })
  })
  if (changed && (input.reason ?? '').trim().length < 3) errors.push({ path: 'reason', message: ASSIGNMENT_REASON_MESSAGE })
  return errors
}

/**
 * Lock-out guard of the onboarding form (DRMS 13/10 W3): an Admin editing their OWN account cannot deactivate it nor
 * drop their own Admin role in a PT here (another Admin does that — or the Akses PT matrix, unchanged).
 */
export function selfGuardErrors(input: OnboardingInput, stored: ReadonlyMap<number, StoredCompany>): FieldError[] {
  const errors: FieldError[] = []
  if (input.user?.active === false) errors.push({ path: 'user.active', message: SELF_DEACTIVATE_MESSAGE })
  ;(input.companies ?? []).forEach((c, i) => {
    const m = stored.get(c.company)?.membership
    if (m && m.active && m.roles.includes('pk-admin') && !c.roles.includes('pk-admin')) errors.push({ path: `companies.${i}.roles`, message: SELF_ADMIN_MESSAGE })
  })
  return errors
}

/** Fields of `next` whose value differs from `current` (`undefined` in `next` = not part of the save). */
export function changedFields<T extends Record<string, unknown>>(current: Record<string, unknown>, next: T, keys: ReadonlyArray<keyof T & string>): Partial<T> {
  const out: Partial<T> = {}
  for (const k of keys) {
    const v = next[k]
    if (v === undefined) continue
    const a = current[k] ?? null
    const b = v ?? null
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = v
  }
  return out
}

/** Membership change of one PT (null = nothing to write). Matrix semantics: no role left = inactive. */
export function membershipChange(stored: StoredCompany['membership'], roles: readonly string[], employee: number | null | undefined, storedEmployee: number | null): { roles?: string[]; active?: boolean; employee?: number | null } | null {
  const sorted = [...new Set(roles)].sort()
  if (!stored) return sorted.length === 0 ? null : { roles: sorted, active: true, ...(employee !== undefined ? { employee } : {}) }
  const out: { roles?: string[]; active?: boolean; employee?: number | null } = {}
  if ([...stored.roles].sort().join() !== sorted.join()) out.roles = sorted
  const active = sorted.length > 0
  if (active !== stored.active) out.active = active
  if (employee !== undefined && employee !== storedEmployee) out.employee = employee
  return Object.keys(out).length ? out : null
}

/** Path of a collection field error inside the body (`changeReason` → the top-level `reason`). */
export function errorPath(prefix: string, field: string | undefined): string {
  if (field === 'changeReason') return 'reason'
  return field ? `${prefix}.${field}` : prefix
}

// Unambiguous characters (no 0/O, 1/l/I) — read aloud / typed from a screen.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWER = 'abcdefghijkmnopqrstuvwxyz'
const DIGIT = '23456789'
// Keyboard-row symbols that survive copy / WhatsApp / typing on a phone (no quotes, backslash, space or look-alikes)
const SPECIAL = '!@#$%*?-+='
const ALL = UPPER + LOWER + DIGIT + SPECIAL

/**
 * Temporary password of a new account (shown once to the Admin, Keycloak `temporary: true`): 14 characters with at
 * least one upper case letter, one lower case letter, one digit and one special character — the realm policy
 * (`upperCase(1) lowerCase(1) digits(1) specialChars(1)`, /opt/infra realm-export) refuses anything less — crypto random.
 */
export function generateTemporaryPassword(length = 14, rnd: (max: number) => number = randomInt): string {
  const n = Math.max(10, length)
  const chars = [UPPER[rnd(UPPER.length)]!, LOWER[rnd(LOWER.length)]!, DIGIT[rnd(DIGIT.length)]!, SPECIAL[rnd(SPECIAL.length)]!]
  while (chars.length < n) chars.push(ALL[rnd(ALL.length)]!)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rnd(i + 1)
    ;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
  }
  return chars.join('')
}
