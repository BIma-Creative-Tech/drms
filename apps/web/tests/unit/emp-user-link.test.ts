import type { SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { withCompanyContext, type Membership } from '@/access/roles'
import {
  adminCreatePrefill,
  applyUserAccount,
  decideLink,
  linkErrorMessage,
  mayLinkAccounts,
  mayReadLink,
  readUserAccount,
  USER_ACCOUNT,
  userAccountOptions,
  userAccountReadAccess,
  validateUserAccount,
  wantedUser,
  type LinkMembership,
} from '@/domain/employee-user-link'

/**
 * Owner decision 2026-10-10: "Akun pengguna" on the employee form (virtual; stored only as
 * company-memberships.employee). Pure decision + access helpers and the config wiring; the DB paths
 * are covered by tests/integration/emp-user-link.int.test.ts.
 */
let config: SanitizedConfig
beforeAll(async () => {
  process.env.PK_SKIP_ENV_CHECK = 'true'
  config = await (await import('@/payload.config')).default
})

const ms = (id: number, user: number, employee: number | null, active = true): LinkMembership => ({ id, user, employee, active })
const req = (memberships: Membership[], groupAdmin = false) => ({ user: withCompanyContext({ id: 99 }, memberships, null, groupAdmin) })

describe('wantedUser', () => {
  it('maps the input to "untouched" / unlink / id / invalid', () => {
    expect(wantedUser(undefined)).toBeUndefined()
    expect(wantedUser(null)).toBeNull()
    expect(wantedUser('')).toBeNull()
    expect(wantedUser(7)).toBe(7)
    expect(wantedUser({ id: 7, email: 'a@b' })).toBe(7)
    expect(wantedUser('12')).toBe(12)
    expect(wantedUser('x')).toBeNaN()
    expect(wantedUser(-1)).toBeNaN()
    expect(wantedUser(1.5)).toBeNaN()
  })
})

describe('decideLink', () => {
  it('no change when the wanted account is the linked one (or both empty)', () => {
    expect(decideLink({ wanted: 5, current: ms(1, 5, 10), target: ms(1, 5, 10), employeeId: 10 })).toEqual({ change: false })
    expect(decideLink({ wanted: null, current: null, target: null, employeeId: 10 })).toEqual({ change: false })
  })
  it('unlink clears the current membership only', () => {
    expect(decideLink({ wanted: null, current: ms(1, 5, 10), target: null, employeeId: 10 })).toEqual({ change: true, clear: 1, set: null })
  })
  it('link: no membership → no_access; inactive → inactive; linked elsewhere → linked_other', () => {
    expect(decideLink({ wanted: 6, current: null, target: null, employeeId: 10 })).toEqual({ change: true, error: 'no_access' })
    expect(decideLink({ wanted: 6, current: null, target: ms(2, 6, null, false), employeeId: 10 })).toEqual({ change: true, error: 'inactive' })
    expect(decideLink({ wanted: 6, current: null, target: ms(2, 6, 11), employeeId: 10 })).toEqual({ change: true, error: 'linked_other', otherEmployee: 11 })
    expect(decideLink({ wanted: 6, current: null, target: ms(2, 6, 11), employeeId: undefined })).toMatchObject({ error: 'linked_other' })
    expect(decideLink({ wanted: Number.NaN, current: null, target: null, employeeId: 10 })).toEqual({ change: true, error: 'invalid' })
  })
  it('link: sets the target; switching accounts clears the old membership first', () => {
    expect(decideLink({ wanted: 6, current: null, target: ms(2, 6, null), employeeId: undefined })).toEqual({ change: true, clear: null, set: 2 })
    expect(decideLink({ wanted: 6, current: ms(1, 5, 10), target: ms(2, 6, null), employeeId: 10 })).toEqual({ change: true, clear: 1, set: 2 })
  })
})

describe('messages', () => {
  it('Indonesian field errors; the other employee is named by code + name', () => {
    expect(linkErrorMessage('no_access')).toBe('Akun ini belum punya akses di PT ini — tambahkan aksesnya di Akses PT dulu.')
    expect(linkErrorMessage('linked_other', { code: 'K-07', name: 'Budi' })).toBe('Akun ini sudah tertaut ke karyawan K-07 Budi.')
    expect(linkErrorMessage('linked_other', null)).toBe('Akun ini sudah tertaut ke karyawan lain.')
  })
})

describe('access helpers', () => {
  const adminA: Membership = { company: 1, roles: ['pk-admin'], employee: null }
  const ownerA: Membership = { company: 1, roles: ['pk-owner'], employee: 40 }
  it('link = Admin of the employee PT, group admin or a system write', () => {
    expect(mayLinkAccounts(req([adminA]) as never, 1)).toBe(true)
    expect(mayLinkAccounts(req([adminA]) as never, 2)).toBe(false)
    expect(mayLinkAccounts(req([ownerA]) as never, 1)).toBe(false)
    expect(mayLinkAccounts(req([ownerA], true) as never, 1)).toBe(true)
    expect(mayLinkAccounts({ user: null } as never, undefined)).toBe(true)
    expect(mayLinkAccounts(req([adminA]) as never, undefined)).toBe(false)
  })
  it('read = membership readers: Admin of the PT, group admin, the linked person; create form: Admin of any PT', () => {
    expect(mayReadLink(req([adminA]) as never, { id: 10, company: 1 })).toBe(true)
    expect(mayReadLink(req([adminA]) as never, { id: 10, company: 2 })).toBe(false)
    expect(mayReadLink(req([ownerA]) as never, { id: 10, company: 1 })).toBe(false)
    expect(mayReadLink(req([ownerA]) as never, { id: 40, company: 1 })).toBe(true) // own employee record
    expect(mayReadLink(req([ownerA], true) as never, { id: 10, company: 3 })).toBe(true)
    expect(mayReadLink(req([adminA]) as never, {})).toBe(true)
    expect(mayReadLink(req([ownerA]) as never, undefined)).toBe(false)
  })
})

describe('adminCreatePrefill', () => {
  it('only the admin create route of that collection, positive integers only', () => {
    const r = (url: string) => ({ url })
    expect(adminCreatePrefill(r('http://x/admin/collections/employees/create?company=3&user=7'), 'employees', 'company')).toBe(3)
    expect(adminCreatePrefill(r('http://x/admin/collections/employees/create?company=3&user=7'), 'employees', 'user')).toBe(7)
    expect(adminCreatePrefill(r('http://x/api/employees?company=3'), 'employees', 'company')).toBeUndefined()
    expect(adminCreatePrefill(r('http://x/admin/collections/projects/create?company=3'), 'employees', 'company')).toBeUndefined()
    expect(adminCreatePrefill(r('http://x/admin/collections/employees/create?company=0'), 'employees', 'company')).toBeUndefined()
    expect(adminCreatePrefill(r('http://x/admin/collections/employees/create?company=abc'), 'employees', 'company')).toBeUndefined()
    expect(adminCreatePrefill(null, 'employees', 'company')).toBeUndefined()
    expect(adminCreatePrefill({ url: '' }, 'employees', 'company')).toBeUndefined()
  })
})

describe('config wiring', () => {
  it('employees.userAccount: virtual relationship to users, editable, hidden from list/bulk, hooks + access wired', () => {
    const emp = config.collections.find((c) => c.slug === 'employees')!
    const f = emp.flattenedFields.find((x) => x.name === USER_ACCOUNT) as unknown as Record<string, unknown> & { admin: Record<string, unknown>; hooks: { afterRead: unknown[] }; access: { read: unknown } }
    expect(f).toMatchObject({ type: 'relationship', relationTo: 'users', virtual: true, label: 'Akun pengguna' })
    expect(f.admin).toMatchObject({ readOnly: false, allowCreate: false, disableBulkEdit: true, disableListColumn: true, disableListFilter: true })
    expect(f.filterOptions).toBe(userAccountOptions)
    expect(f.hooks.afterRead).toContain(readUserAccount)
    expect(f.access.read).toBe(userAccountReadAccess)
    expect(emp.hooks.beforeChange).toContain(validateUserAccount)
    expect(emp.hooks.afterChange).toContain(applyUserAccount)
    // validation after the company hook (needs the resolved PT)
    expect(emp.hooks.beforeChange.indexOf(validateUserAccount)).toBeGreaterThan(0)
    // never audited as an employee field (the membership row carries the audit)
    expect((emp.custom as { pkAudit: { tracked: string[] } }).pkAudit.tracked).not.toContain(USER_ACCOUNT)
  })
  it('users: read-only "Karyawan per PT" panel (ui field, server component)', () => {
    const users = config.collections.find((c) => c.slug === 'users')!
    const f = users.fields.find((x) => 'name' in x && x.name === 'employeeLinks') as unknown as { type: string; admin: { components: { Field: string } } }
    expect(f.type).toBe('ui')
    expect(f.admin.components.Field).toBe('@/admin/components/users/EmployeeLinksPanel#EmployeeLinksPanel')
  })
})
