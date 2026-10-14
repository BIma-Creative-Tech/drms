import { randomInt } from 'node:crypto'

/**
 * DRMS 13/10 Wave 3 — "Pengguna" tabbed onboarding: pure rules of ONE save (unit-tested). The collection hooks and
 * access rules stay the guards (Users / company-memberships / employees / employee-bank-accounts, run with the
 * caller's access by service.ts); these checks only give the form field-level answers BEFORE anything is written
 * (cross-field rules the collections cannot see: one entry per PT, a bank account needs an employee …).
 * No Payload import.
 */

export type FieldError = { path: string; message: string }

export type EmployeeInput = { id?: number; code?: string; name?: string; nickname?: string | null; position?: string | null; phone?: string | null; attendanceType?: 'onsite' | 'non_onsite'; active?: boolean }
export type BankAccountInput = { id?: number; bank?: number; accountNo?: string; accountHolder?: string; isDefault?: boolean; verificationStatus?: 'unverified' | 'verified'; active?: boolean }
export type CompanyInput = { company: number; roles: string[]; employee?: EmployeeInput | null; bankAccounts?: BankAccountInput[] }
export type UserInput = { email?: string; name?: string; phone?: string | null; active?: boolean }
export type OnboardingInput = { user?: UserInput; companies?: CompanyInput[]; reason?: string }

/** Stored state of one PT of the account (edit), as the rules need it. */
export type StoredCompany = { membership: { id: number; roles: string[]; active: boolean } | null; employee: number | null }

export const NO_ROLE_MESSAGE = 'Pilih minimal satu peran di PT ini.'
export const NEED_EMPLOYEE_MESSAGE = 'Rekening butuh data karyawan di PT ini — pilih atau buat data karyawan dulu (tab Data Karyawan).'
export const SELF_DEACTIVATE_MESSAGE = 'Anda tidak dapat menonaktifkan akun Anda sendiri.'
export const SELF_ADMIN_MESSAGE = 'Anda tidak dapat mencabut peran Admin Anda sendiri di PT ini (minta Admin lain).'

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
    if (!member && c.roles.length === 0 && (c.employee || (c.bankAccounts?.length ?? 0) > 0)) errors.push({ path: `${at}.roles`, message: NO_ROLE_MESSAGE })
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
  })
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
const ALL = UPPER + LOWER + DIGIT

/**
 * Temporary password of a new account (shown once to the Admin, Keycloak `temporary: true`): 14 characters with at
 * least one upper case letter, one lower case letter and one digit (any common realm policy), crypto random.
 */
export function generateTemporaryPassword(length = 14, rnd: (max: number) => number = randomInt): string {
  const n = Math.max(10, length)
  const chars = [UPPER[rnd(UPPER.length)]!, LOWER[rnd(LOWER.length)]!, DIGIT[rnd(DIGIT.length)]!]
  while (chars.length < n) chars.push(ALL[rnd(ALL.length)]!)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rnd(i + 1)
    ;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
  }
  return chars.join('')
}
