import { APIError, ValidationError } from 'payload'
import { describe, expect, it } from 'vitest'

import { setRoles, viewerOf, type CellDraft } from '@/admin/components/access/role-matrix'
import { multiLabels, multiSummary } from '@/admin/components/list/MultiSelect'
import { activeCompanies, buildBody, draftFromDetail, ensureEmployee, errorTarget, mapErrors, newBank, TABS, withAutoStaff, withoutAutoStaff } from '@/admin/components/users/user-onboarding-form'
import { moduleForPath, MODULES, resolveModules } from '@/admin/modules/registry'
import { customEditOf } from '@/admin/pk-list/edit-view'
import { withCompanyContext } from '@/access/roles'
import { UserOnboardingCreate, UserOnboardingUpdate } from '@/api/v1/schemas-users'
import { createHttpKeycloakAdmin, KeycloakPasswordPolicyError, passwordPolicyError } from '@/auth/keycloak-admin'
import {
  changedFields,
  errorPath,
  generateTemporaryPassword,
  membershipChange,
  NEED_EMPLOYEE_MESSAGE,
  NO_ROLE_MESSAGE,
  normalizeAccountNo,
  SELF_ADMIN_MESSAGE,
  SELF_DEACTIVATE_MESSAGE,
  selfGuardErrors,
  validateOnboarding,
  type StoredCompany,
} from '@/domain/user-onboarding/rules'
import { OnboardingError, writeError, type OnboardingDetail } from '@/domain/user-onboarding/service'

/**
 * DRMS 13/10 Wave 3 — "Pengguna" tabbed onboarding: validation, mapping (draft → body → errors), the temporary
 * password, the Keycloak reset-password call, the list wiring and the role checklist of the matrix.
 */

describe('rules: validateOnboarding', () => {
  it('create needs at least one PT with a role', () => {
    expect(validateOnboarding({ user: { email: 'a@x.test', name: 'A' }, companies: [] }, 'create')).toEqual([{ path: 'companies', message: 'Pilih minimal satu PT dan peran.' }])
    expect(validateOnboarding({ companies: [{ company: 1, roles: [] }] }, 'create').map((e) => e.path)).toEqual(['companies'])
    expect(validateOnboarding({ companies: [{ company: 1, roles: ['pk-staff'] }] }, 'create')).toEqual([])
  })

  it('one entry per PT; a new PT with employee / bank data needs a role', () => {
    const e = validateOnboarding({ companies: [{ company: 1, roles: ['pk-staff'] }, { company: 1, roles: ['pk-pm'] }, { company: 2, roles: [], employee: { code: 'E1', name: 'X' } }] }, 'update')
    expect(e).toEqual([
      { path: 'companies.1.company', message: 'PT yang sama dua kali dalam satu simpan.' },
      { path: 'companies.2.roles', message: NO_ROLE_MESSAGE },
    ])
    // an existing (even inactive) membership may keep no role
    const stored = new Map<number, StoredCompany>([[2, { membership: { id: 9, roles: [], active: false }, employee: null }]])
    expect(validateOnboarding({ companies: [{ company: 2, roles: [], employee: { code: 'E1', name: 'X' } }] }, 'update', stored)).toEqual([])
  })

  it('a new employee needs code + name; an existing one (id) does not', () => {
    expect(validateOnboarding({ companies: [{ company: 1, roles: ['pk-staff'], employee: {} }] }, 'update').map((e) => e.path)).toEqual(['companies.0.employee.code', 'companies.0.employee.name'])
    expect(validateOnboarding({ companies: [{ company: 1, roles: ['pk-staff'], employee: { id: 4 } }] }, 'update')).toEqual([])
  })

  it('bank accounts need an employee of the PT (draft or stored) and complete new rows with a digit account number', () => {
    const noEmp = validateOnboarding({ companies: [{ company: 1, roles: ['pk-staff'], bankAccounts: [{ bank: 1, accountNo: '12345', accountHolder: 'A' }] }] }, 'update')
    expect(noEmp).toEqual([{ path: 'companies.0.bankAccounts.0', message: NEED_EMPLOYEE_MESSAGE }])
    const unlink = validateOnboarding({ companies: [{ company: 1, roles: ['pk-staff'], employee: null, bankAccounts: [{ id: 3, active: false }] }] }, 'update', new Map([[1, { membership: { id: 1, roles: ['pk-staff'], active: true }, employee: 5 }]]))
    expect(unlink.map((e) => e.path)).toEqual(['companies.0.bankAccounts.0'])
    const stored = new Map<number, StoredCompany>([[1, { membership: { id: 1, roles: ['pk-staff'], active: true }, employee: 5 }]])
    expect(validateOnboarding({ companies: [{ company: 1, roles: ['pk-staff'], bankAccounts: [{}] }] }, 'update', stored).map((e) => e.path)).toEqual([
      'companies.0.bankAccounts.0.bank',
      'companies.0.bankAccounts.0.accountNo',
      'companies.0.bankAccounts.0.accountHolder',
    ])
    expect(validateOnboarding({ companies: [{ company: 1, roles: ['pk-staff'], bankAccounts: [{ bank: 1, accountNo: '12a45', accountHolder: 'A' }] }] }, 'update', stored)).toEqual([
      { path: 'companies.0.bankAccounts.0.accountNo', message: 'Nomor rekening hanya angka (5–34 digit).' },
    ])
    expect(validateOnboarding({ companies: [{ company: 1, roles: ['pk-staff'], bankAccounts: [{ bank: 1, accountNo: '123.456-78 9', accountHolder: 'A' }] }] }, 'update', stored)).toEqual([])
    expect(normalizeAccountNo('123.456-78 9')).toBe('123456789')
  })
})

describe('rules: own account, membership change, diffs', () => {
  const stored = new Map<number, StoredCompany>([
    [1, { membership: { id: 1, roles: ['pk-admin', 'pk-finance'], active: true }, employee: null }],
    [2, { membership: { id: 2, roles: ['pk-staff'], active: true }, employee: null }],
  ])

  it('no self-deactivation, no removal of the own Admin role', () => {
    expect(selfGuardErrors({ user: { active: false } }, stored)).toEqual([{ path: 'user.active', message: SELF_DEACTIVATE_MESSAGE }])
    expect(selfGuardErrors({ companies: [{ company: 1, roles: ['pk-finance'] }, { company: 2, roles: [] }] }, stored)).toEqual([{ path: 'companies.0.roles', message: SELF_ADMIN_MESSAGE }])
    expect(selfGuardErrors({ user: { active: true }, companies: [{ company: 1, roles: ['pk-admin'] }] }, stored)).toEqual([])
  })

  it('membershipChange follows the matrix: no role = inactive, a role reactivates, only changed keys', () => {
    expect(membershipChange(null, [], undefined, null)).toBeNull()
    expect(membershipChange(null, ['pk-pm', 'pk-staff'], 7, null)).toEqual({ roles: ['pk-pm', 'pk-staff'], active: true, employee: 7 })
    const m = { id: 1, roles: ['pk-staff'], active: true }
    expect(membershipChange(m, ['pk-staff'], undefined, 3)).toBeNull()
    expect(membershipChange(m, ['pk-staff'], 3, 3)).toBeNull()
    expect(membershipChange(m, [], undefined, 3)).toEqual({ roles: [], active: false })
    expect(membershipChange({ ...m, active: false }, ['pk-staff'], null, 3)).toEqual({ active: true, employee: null })
  })

  it('changedFields keeps only differing, given keys (null = empty)', () => {
    expect(changedFields({ name: 'A', phone: null, active: true }, { name: 'A', phone: '', active: false, code: undefined }, ['name', 'phone', 'active', 'code'])).toEqual({ phone: '', active: false })
    expect(changedFields({ nickname: null }, { nickname: null }, ['nickname'])).toEqual({})
  })

  it('errorPath maps the collection reason field to the body reason', () => {
    expect(errorPath('companies.0.bankAccounts.1', 'accountNo')).toBe('companies.0.bankAccounts.1.accountNo')
    expect(errorPath('companies.0.bankAccounts.1', 'changeReason')).toBe('reason')
    expect(errorPath('user', undefined)).toBe('user')
  })
})

describe('temporary password', () => {
  it('14 characters, upper + lower + digit, unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const p = generateTemporaryPassword()
      expect(p).toHaveLength(14)
      expect(p).toMatch(/[A-Z]/)
      expect(p).toMatch(/[a-z]/)
      expect(p).toMatch(/[2-9]/)
      expect(p).not.toMatch(/[0O1lI]/)
    }
    expect(generateTemporaryPassword(4)).toHaveLength(10) // never shorter than 10
  })

  it('uses the injected random source (deterministic)', () => {
    expect(generateTemporaryPassword(10, () => 0)).toBe(generateTemporaryPassword(10, () => 0))
  })
})

describe('keycloak admin: resetPassword (temporary)', () => {
  const uid = '0b6a1c1e-1111-4222-8333-444455556666'
  it('PUT /users/<id>/reset-password with temporary=true; a 400 becomes a policy error without the password', async () => {
    const seen: Array<{ url: string; body: unknown }> = []
    let answer = 204
    const f = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/protocol/openid-connect/token')) return Response.json({ access_token: 't', expires_in: 300 })
      seen.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return answer === 204 ? new Response(null, { status: 204 }) : Response.json({ error: 'invalidPasswordMinLengthMessage', error_description: 'Invalid password: minimum length 12.' }, { status: 400 })
    }) as typeof fetch
    const kc = createHttpKeycloakAdmin({ baseUrl: 'https://kc.test', realm: 'drms', clientId: 'c', clientSecret: 'x'.repeat(20), fetchImpl: f })
    await kc.resetPassword(uid, 'Abcdefgh2345', true)
    expect(seen[0]).toEqual({ url: `https://kc.test/admin/realms/drms/users/${uid}/reset-password`, body: { type: 'password', value: 'Abcdefgh2345', temporary: true } })
    answer = 400
    const err = await kc.resetPassword(uid, 'short-secret', true).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(KeycloakPasswordPolicyError)
    expect(err).toMatchObject({ status: 400, policy: 'invalidPasswordMinLengthMessage', param: 12 })
    expect(String((err as Error).message)).not.toContain('short-secret')
    await expect(kc.resetPassword('../x', 'p', true)).rejects.toThrow(/unsafe/)
  })

  it('passwordPolicyError keeps only a key-shaped error', () => {
    expect(passwordPolicyError({ error: 'x y <script>' })).toMatchObject({ policy: 'unknown', param: null })
    expect(passwordPolicyError(null)).toMatchObject({ policy: 'unknown' })
  })
})

describe('api schemas', () => {
  it('create: strict, roles enum, at least one PT', () => {
    const ok = UserOnboardingCreate.safeParse({ user: { email: 'rina@example.test', name: 'Rina' }, companies: [{ company: 1, roles: ['pk-staff', 'pk-operator'] }] })
    expect(ok.success).toBe(true)
    expect(UserOnboardingCreate.safeParse({ user: { email: 'rina@example.test', name: 'Rina', groupAdmin: true }, companies: [{ company: 1, roles: ['pk-staff'] }] }).success).toBe(false)
    expect(UserOnboardingCreate.safeParse({ user: { email: 'rina@example.test', name: 'Rina' }, companies: [{ company: 1, roles: ['root'] }] }).success).toBe(false)
    const none = UserOnboardingCreate.safeParse({ user: { email: 'rina@example.test', name: 'Rina' }, companies: [] })
    expect(none.success).toBe(false)
    expect(none.error?.issues[0]?.message).toBe('Pilih minimal satu PT dan peran.')
    expect(UserOnboardingCreate.safeParse({ user: { email: 'not-an-email', name: 'Rina' }, companies: [{ company: 1, roles: [] }] }).error?.issues[0]?.message).toBe('Email tidak valid.')
  })

  it('update: everything optional, still strict (no keycloakSub / groupAdmin through here)', () => {
    expect(UserOnboardingUpdate.safeParse({}).success).toBe(true)
    expect(UserOnboardingUpdate.safeParse({ user: { name: 'X' } }).success).toBe(true)
    expect(UserOnboardingUpdate.safeParse({ user: { keycloakSub: 'x' } }).success).toBe(false)
    expect(UserOnboardingUpdate.safeParse({ companies: [{ company: 1, roles: [], bankAccounts: [{ id: 2, verificationStatus: 'verified', iban: 'x' }] }] }).success).toBe(false)
  })
})

describe('service: writeError (collection / DB errors → body paths)', () => {
  it('ValidationError → 400 with prefixed paths, changeReason → reason', () => {
    const v = new ValidationError({ collection: 'employee-bank-accounts', errors: [{ path: 'changeReason', message: 'Alasan wajib diisi saat mengubah data rekening.' }, { path: 'accountNo', message: 'Nomor rekening hanya angka (5–34 digit).' }] })
    const e = writeError(v, 'companies.0.bankAccounts.1')!
    expect(e.status).toBe(400)
    expect(e.errors).toEqual([
      { path: 'reason', message: 'Alasan wajib diisi saat mengubah data rekening.' },
      { path: 'companies.0.bankAccounts.1.accountNo', message: 'Nomor rekening hanya angka (5–34 digit).' },
    ])
  })

  it('public APIError keeps its message and status class; a pg guard is 409; others are not mapped', () => {
    expect(writeError(new APIError('Anda bukan Admin PT ini.', 403, null, true), 'companies.1.roles')).toMatchObject({ status: 403, errors: [{ path: 'companies.1.roles', message: 'Anda bukan Admin PT ini.' }] })
    expect(writeError(new APIError('Tidak valid', 422), 'user')).toMatchObject({ status: 400, errors: [{ path: 'user' }] })
    expect(writeError(new APIError('Data tidak ditemukan', 404), 'companies.0.employee')).toMatchObject({ status: 404 })
    expect(writeError(Object.assign(new Error('Failed query'), { cause: { code: '23505' } }), 'user')).toMatchObject({ status: 409 })
    expect(writeError(Object.assign(new Error('Failed query'), { cause: { code: '23503' } }), 'companies.0.bankAccounts.0')).toMatchObject({ status: 400, errors: [{ path: 'companies.0.bankAccounts.0' }] })
    expect(writeError(new Error('boom'), 'user')).toBeNull()
    const own = new OnboardingError(404, 'x')
    expect(writeError(own, 'user')).toBe(own)
  })
})

// ---- client form state ----------------------------------------------------------------------------------------

const detail: OnboardingDetail = {
  user: { id: 7, email: 'rina@example.test', name: 'Rina', phone: null, active: true, groupAdmin: false, identityEditable: true },
  banks: [{ id: 1, name: 'Bank Satu' }],
  companies: [
    {
      id: 1,
      shortCode: 'DRMS',
      name: 'PT Satu',
      canManageEmployees: true,
      membership: { id: 11, roles: ['pk-staff'], active: true },
      employee: { id: 21, code: 'K-01', name: 'Rina', nickname: null, position: 'Staf', phone: null, attendanceType: 'onsite', active: true },
      bankAccounts: [{ id: 31, bank: 1, bankName: 'Bank Satu', accountNo: '1234567', accountHolder: 'Rina', isDefault: true, verificationStatus: 'unverified', active: true }],
      employeeChoices: [{ id: 21, code: 'K-01', name: 'Rina', active: true }],
      canManageAssignments: true,
      assignments: [],
      assignmentChoices: { projects: [], costCenters: [], sites: [] },
    },
    { id: 2, shortCode: 'CS1', name: 'PT Dua', canManageEmployees: true, membership: null, employee: null, bankAccounts: [], employeeChoices: [{ id: 22, code: 'K-02', name: 'Budi', active: true }], canManageAssignments: true, assignments: [], assignmentChoices: { projects: [], costCenters: [], sites: [] } },
  ],
}

describe('form: draft → body', () => {
  it('draftFromDetail mirrors the stored state; nothing changed → no body, no save', () => {
    const d = draftFromDetail(detail)
    expect(d.companies['1']!.emp).toMatchObject({ mode: 'linked', id: 21, code: 'K-01', position: 'Staf' })
    expect(d.companies['2']!.emp.mode).toBe('none')
    expect(d.companies['1']!.banks[0]).toMatchObject({ key: 'b31', id: 31 })
    const r = buildBody(detail, d, 'update')
    expect(r.changed).toBe(false)
    expect(r.body).toEqual({})
    expect(activeCompanies(detail, d).map((c) => c.id)).toEqual([1])
  })

  it('edit: only changed identity fields, changed PTs with their roles, employee diff, bank rows', () => {
    const d = draftFromDetail(detail)
    d.user.phone = '0811000000'
    d.companies['1']!.emp.position = 'Kepala staf'
    d.companies['1']!.banks[0]!.accountNo = '7654321'
    d.companies['1']!.banks.push(newBank('n1', 'Rina'))
    d.companies['2']!.roles = ['pk-pm']
    d.companies['2']!.emp = { ...d.companies['2']!.emp, mode: 'pick', id: 22 }
    d.reason = 'rekening baru'
    const r = buildBody(detail, d, 'update')
    expect(r.body).toEqual({
      user: { phone: '0811000000' },
      companies: [
        { company: 1, roles: ['pk-staff'], employee: { id: 21, position: 'Kepala staf' }, bankAccounts: [{ id: 31, accountNo: '7654321' }] },
        { company: 2, roles: ['pk-pm'], employee: { id: 22 } },
      ],
      reason: 'rekening baru',
    })
    expect(r.order).toEqual({ companies: [1, 2], banks: { 0: ['b31'], 1: [] }, asg: { 0: [], 1: [] } })
    expect(activeCompanies(detail, d).map((c) => c.id)).toEqual([1, 2])
  })

  it('create: whole identity + PTs with a role; new employee; unlink on edit sends null', () => {
    const empty: OnboardingDetail = { ...detail, user: null, companies: detail.companies.map((c) => ({ ...c, membership: null, employee: null, bankAccounts: [] })) }
    const d = draftFromDetail(empty)
    d.user = { email: ' Rina@Example.test ', name: 'Rina', phone: '', active: true }
    d.companies['1']!.roles = ['pk-staff']
    d.companies['1']!.emp = { mode: 'new', id: null, code: 'K-09', name: 'Rina', nickname: '', position: '', phone: '', attendanceType: 'non_onsite', active: true }
    const r = buildBody(empty, d, 'create')
    expect(r.body).toEqual({
      user: { email: 'Rina@Example.test', name: 'Rina', phone: null, active: true },
      companies: [{ company: 1, roles: ['pk-staff'], employee: { code: 'K-09', name: 'Rina', nickname: null, position: null, phone: null, attendanceType: 'non_onsite', active: true } }],
    })
    const e = draftFromDetail(detail)
    e.companies['1']!.emp = { ...e.companies['1']!.emp, mode: 'none' }
    expect(buildBody(detail, e, 'update').body.companies).toEqual([{ company: 1, roles: ['pk-staff'], employee: null }])
  })

  it('DRMS 16/10: an employee added in a PT without a role ticks Staff (create body valid), undone with the employee', () => {
    const empty: OnboardingDetail = { ...detail, user: null, companies: detail.companies.map((c) => ({ ...c, membership: null, employee: null, bankAccounts: [] })) }
    const d = draftFromDetail(empty)
    d.user = { email: 'rina@example.test', name: ' Rina ', phone: '0811', active: true }
    expect(activeCompanies(empty, d)).toEqual([])
    const c2 = empty.companies[1]!
    const withEmp = ensureEmployee(c2, d.companies['2']!, d.user)
    expect(withEmp.emp).toMatchObject({ mode: 'new', id: null, code: '', name: 'Rina', phone: '0811' })
    expect(withEmp).toMatchObject({ roles: ['pk-staff'], autoStaff: true })
    d.companies['2'] = { ...withEmp, emp: { ...withEmp.emp, code: 'K-10' }, banks: [{ ...newBank('n1', 'Rina'), bank: 1, accountNo: '1234567' }] }
    expect(activeCompanies(empty, d).map((c) => c.id)).toEqual([2])
    expect(buildBody(empty, d, 'create').body.companies).toEqual([
      {
        company: 2,
        roles: ['pk-staff'],
        employee: { code: 'K-10', name: 'Rina', nickname: null, position: null, phone: '0811', attendanceType: 'onsite', active: true },
        bankAccounts: [{ bank: 1, accountNo: '1234567', accountHolder: 'Rina', isDefault: false, verificationStatus: 'unverified', active: true }],
      },
    ])
    // an existing employee is kept, a role chosen by the admin is never replaced, a membership is never touched
    expect(ensureEmployee(c2, d.companies['2']!, d.user).emp.code).toBe('K-10')
    expect(withAutoStaff(c2, { ...d.companies['2']!, roles: ['pk-pm'], autoStaff: false }).roles).toEqual(['pk-pm'])
    expect(withAutoStaff(detail.companies[0]!, { ...d.companies['1']!, roles: [] }).roles).toEqual([])
    // undo only while Staff is still the sole automatic role
    expect(withoutAutoStaff(d.companies['2']!)).toMatchObject({ roles: [], autoStaff: false })
    expect(withoutAutoStaff({ ...d.companies['2']!, roles: ['pk-staff', 'pk-pm'] }).roles).toEqual(['pk-staff', 'pk-pm'])
    expect(withoutAutoStaff({ ...d.companies['2']!, autoStaff: false }).roles).toEqual(['pk-staff'])
  })

  it('identity locked (account also in a foreign PT): no user part even if the draft differs', () => {
    const locked = { ...detail, user: { ...detail.user!, identityEditable: false } }
    const d = draftFromDetail(locked)
    d.user.name = 'Lain'
    expect(buildBody(locked, d, 'update').body.user).toBeUndefined()
  })
})

describe('form: server errors → fields and tabs', () => {
  const order = { companies: [1, 2], banks: { 0: ['b31', 'n1'] } }
  it('errorTarget maps body paths to draft keys + tab', () => {
    expect(errorTarget('user.email', order)).toEqual({ key: 'user.email', tab: 'detail' })
    expect(errorTarget('companies.1.roles', order)).toEqual({ key: 'c.2.roles', tab: 'akses' })
    expect(errorTarget('companies.1.company', order)).toEqual({ key: 'c.2.roles', tab: 'akses' })
    expect(errorTarget('companies.0.employee.code', order)).toEqual({ key: 'c.1.employee.code', tab: 'karyawan' })
    expect(errorTarget('companies.0.bankAccounts.1.accountNo', order)).toEqual({ key: 'c.1.bank.n1.accountNo', tab: 'rekening' })
    expect(errorTarget('companies.0.bankAccounts.0', order)).toEqual({ key: 'c.1.bank.b31', tab: 'rekening' })
    expect(errorTarget('companies', order)).toEqual({ key: 'companies', tab: 'akses' })
    expect(errorTarget('reason', order)).toEqual({ key: 'reason', tab: null })
  })

  it('mapErrors joins messages per key and opens the first tab with an error', () => {
    const m = mapErrors({ errors: [{ path: 'reason', message: 'Alasan wajib.' }, { path: 'companies.0.employee.code', message: 'Kode sudah dipakai.' }, { path: 'companies.0.employee.code', message: 'Lagi.' }] }, order)
    expect(m.tab).toBe('karyawan')
    expect(m.byKey.get('c.1.employee.code')).toBe('Kode sudah dipakai.; Lagi.')
    expect(m.byKey.get('reason')).toBe('Alasan wajib.')
    expect(mapErrors(null, order)).toEqual({ byKey: new Map(), tab: null })
  })

  it('the four client tabs + Penugasan Proyek', () => {
    expect(TABS.map((t) => t.label)).toEqual(['Detail Pengguna', 'Akses & Peran', 'Data Karyawan', 'Rekening Karyawan', 'Penugasan Proyek'])
  })
})

describe('multiple dropdown instead of checkboxes', () => {
  const opts = [
    { value: 'pk-staff', label: 'Staff' },
    { value: 'pk-pm', label: 'PM' },
    { value: 'pk-owner', label: 'Direktur' },
  ]
  it('form mode shows the chosen labels in option order; filter mode unchanged', () => {
    expect(multiLabels(opts, ['pk-owner', 'pk-staff'], 'Pilih peran…')).toBe('Staff, Direktur')
    expect(multiLabels(opts, [], 'Pilih peran…')).toBe('Pilih peran…')
    expect(multiSummary(opts, ['pk-owner', 'pk-staff'])).toBe('2 dipilih')
  })

  it('matrix cell: setRoles keeps ROLES order, no role = inactive, a role reactivates', () => {
    const cell: CellDraft = { id: 1, user: 1, company: 1, roles: ['pk-staff'], employee: null, active: true }
    expect(setRoles(cell, ['pk-admin', 'pk-staff', 'nope'])).toEqual({ ...cell, roles: ['pk-staff', 'pk-admin'], active: true })
    expect(setRoles(cell, [])).toEqual({ ...cell, roles: [], active: false })
    expect(setRoles({ ...cell, active: false, roles: [] }, ['pk-pm']).active).toBe(true)
  })
})

describe('entry points: users list + module menu', () => {
  const admin = withCompanyContext({ id: 1 }, [{ company: 3, roles: ['pk-admin'], employee: null }], null, false)
  const finance = withCompanyContext({ id: 2 }, [{ company: 3, roles: ['pk-finance'], employee: null }], null, false)
  const group = withCompanyContext({ id: 3 }, [], null, true)

  it('viewerOf: Admin PTs (any membership) + group admin flag', () => {
    expect(viewerOf(admin)).toEqual({ groupAdmin: false, adminOf: [3] })
    expect(viewerOf(group)).toEqual({ groupAdmin: true, adminOf: [] })
    expect(viewerOf(null)).toEqual({ groupAdmin: false, adminOf: [] })
  })

  it('users list: create + row open the Pengguna view for Admins / group admins only', () => {
    const c = customEditOf('users', admin)!
    expect(c.createHref).toBe('/admin/pengguna/baru')
    expect(c.rowHref(12)).toBe('/admin/pengguna/12')
    expect(customEditOf('users', group)).not.toBeNull()
    expect(customEditOf('users', finance)).toBeNull()
    expect(customEditOf('employees', admin)).toBeNull()
  })

  it('/admin/pengguna/<id> belongs to the Pengguna & Akses module; "+ Pengguna baru" only for Admins', () => {
    expect(moduleForPath('/admin/pengguna/12')).toBe('pengguna')
    expect(moduleForPath('/admin/pengguna/baru')).toBe('pengguna')
    const base = { canSee: () => true, labelOf: (_k: 'collection' | 'global', s: string) => s }
    const hrefs = (roles: Array<'pk-admin' | 'pk-finance'>) => resolveModules({ ...base, roles, staffOnly: false }, MODULES).find((m) => m.id === 'pengguna')!.sections.flatMap((s) => s.items.map((i) => i.href))
    expect(hrefs(['pk-admin'])).toContain('/admin/pengguna/baru')
    expect(hrefs(['pk-finance'])).not.toContain('/admin/pengguna/baru')
  })
})
