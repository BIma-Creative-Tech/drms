import { ValidationError } from 'payload'
import { describe, expect, it } from 'vitest'

import { buildBody, draftFromDetail, errorTarget, hasEmployee, mapErrors, newAssignment, showsSavedAssignments } from '@/admin/components/users/user-onboarding-form'
import { UserOnboardingCreate, UserOnboardingUpdate } from '@/api/v1/schemas-users'
import {
  ASSIGNMENT_FIXED_MESSAGE,
  ASSIGNMENT_OWNER_MESSAGE,
  ASSIGNMENT_REASON_MESSAGE,
  assignmentPatch,
  dayOf,
  END_BEFORE_START_MESSAGE,
  NEED_EMPLOYEE_ASSIGNMENT_MESSAGE,
  NO_ROLE_MESSAGE,
  ONE_LOCATION_MESSAGE,
  ownerAfterSave,
  SITE_ASSIGNMENT_MESSAGE,
  savedAssignmentErrors,
  validateOnboarding,
  type AssignmentInput,
  type StoredAssignment,
  type StoredCompany,
} from '@/domain/user-onboarding/rules'
import { writeError, type OnboardingDetail } from '@/domain/user-onboarding/service'

/**
 * DRMS 15/10 (owner: "mendaftarkan Data karyawan, rekening dan penugasan secara langsung tanpa harus keluar menu"):
 * team assignments in the "Pengguna" form — validation, the saved-row rules, the body and the error mapping.
 */

const member = (employee: number | null): StoredCompany => ({ membership: { id: 1, roles: ['pk-staff'], active: true }, employee })

describe('rules: assignments in validateOnboarding', () => {
  it('a new assignment needs an employee of the PT (draft or stored) and a role when the PT is new', () => {
    expect(validateOnboarding({ companies: [{ company: 1, roles: ['pk-staff'], assignments: [{ project: 5, roleInProject: 'staff' }] }] }, 'update')).toEqual([
      { path: 'companies.0.assignments.0', message: NEED_EMPLOYEE_ASSIGNMENT_MESSAGE },
    ])
    // a NEW employee in the same save is enough
    expect(validateOnboarding({ companies: [{ company: 1, roles: ['pk-staff'], employee: { code: 'K1', name: 'X' }, assignments: [{ project: 5, roleInProject: 'staff' }] }] }, 'create')).toEqual([])
    // the stored employee too; unlinking it in the same save is not
    const stored = new Map([[1, member(9)]])
    expect(validateOnboarding({ companies: [{ company: 1, roles: ['pk-staff'], assignments: [{ costCenter: 3, roleInProject: 'mandor' }] }] }, 'update', stored)).toEqual([])
    expect(validateOnboarding({ companies: [{ company: 1, roles: ['pk-staff'], employee: null, assignments: [{ costCenter: 3, roleInProject: 'mandor' }] }] }, 'update', stored).map((e) => e.path)).toEqual(['companies.0.assignments.0'])
    // a PT without membership and without a role cannot carry assignments
    expect(validateOnboarding({ companies: [{ company: 2, roles: [], employee: { id: 4 }, assignments: [{ project: 5, roleInProject: 'staff' }] }] }, 'update')).toContainEqual({ path: 'companies.0.roles', message: NO_ROLE_MESSAGE })
  })

  it('exactly one location; end not before start', () => {
    const s = new Map([[1, member(9)]])
    const v = (a: Partial<AssignmentInput>) => validateOnboarding({ companies: [{ company: 1, roles: ['pk-staff'], assignments: [{ roleInProject: 'staff', ...a }] }] }, 'update', s)
    expect(v({})).toEqual([{ path: 'companies.0.assignments.0.location', message: ONE_LOCATION_MESSAGE }])
    expect(v({ project: 1, costCenter: 2 })).toEqual([{ path: 'companies.0.assignments.0.location', message: ONE_LOCATION_MESSAGE }])
    expect(v({ costCenter: 2, startDate: '2026-10-15', endDate: '2026-10-14' })).toEqual([{ path: 'companies.0.assignments.0.endDate', message: END_BEFORE_START_MESSAGE }])
    expect(v({ costCenter: 2, startDate: '2026-10-15', endDate: '2026-10-15' })).toEqual([])
    // ADR 0032: no new site assignment (an old APK may still send one)
    expect(v({ site: 2, endDate: '2026-10-01' })).toEqual([{ path: 'companies.0.assignments.0.location', message: SITE_ASSIGNMENT_MESSAGE }])
  })

  it('a saved row (id) changes only role and end date', () => {
    const s = new Map([[1, member(9)]])
    expect(validateOnboarding({ companies: [{ company: 1, roles: ['pk-staff'], assignments: [{ id: 7, roleInProject: 'pm', endDate: '2026-12-31' }] }] }, 'update', s)).toEqual([])
    for (const extra of [{ project: 3 }, { startDate: '2026-01-01' }]) {
      expect(validateOnboarding({ companies: [{ company: 1, roles: ['pk-staff'], assignments: [{ id: 7, roleInProject: 'staff', ...extra }] }] }, 'update', s)).toEqual([{ path: 'companies.0.assignments.0', message: ASSIGNMENT_FIXED_MESSAGE }])
    }
  })
})

describe('rules: saved assignments', () => {
  const saved: StoredAssignment = { id: 7, employee: 9, roleInProject: 'staff', startDate: '2026-10-01T00:00:00.000Z', endDate: null }
  const stored = new Map([[7, saved]])

  it('dayOf / assignmentPatch compare by day; only role + end date', () => {
    expect(dayOf('2026-10-01T00:00:00.000Z')).toBe('2026-10-01')
    expect(dayOf('')).toBeNull()
    expect(dayOf(null)).toBeNull()
    expect(assignmentPatch(saved, { id: 7, roleInProject: 'staff' })).toEqual({})
    expect(assignmentPatch(saved, { id: 7, roleInProject: 'mandor', endDate: '2026-10-31' })).toEqual({ roleInProject: 'mandor', endDate: '2026-10-31' })
    expect(assignmentPatch({ ...saved, endDate: '2026-10-31T00:00:00.000Z' }, { id: 7, roleInProject: 'staff', endDate: '2026-10-31' })).toEqual({})
    expect(assignmentPatch({ ...saved, endDate: '2026-10-31T00:00:00.000Z' }, { id: 7, roleInProject: 'staff', endDate: null })).toEqual({ endDate: null })
  })

  it('ownerAfterSave: unchanged / unlinked / linked / new', () => {
    expect(ownerAfterSave(undefined, 9)).toBe(9)
    expect(ownerAfterSave(null, 9)).toBeNull()
    expect(ownerAfterSave({ id: 4 }, 9)).toBe(4)
    expect(ownerAfterSave({ code: 'K', name: 'N' }, 9)).toBe('new')
  })

  it('reason required when a saved row changes; owner must be the PT employee after the save; end ≥ stored start', () => {
    const owners = new Map<number, number | null | 'new'>([[1, 9]])
    const body = (a: Partial<AssignmentInput>, reason?: string) => ({ companies: [{ company: 1, roles: ['pk-staff'], assignments: [{ id: 7, roleInProject: 'staff' as const, ...a }] }], ...(reason ? { reason } : {}) })
    expect(savedAssignmentErrors(body({}), stored, owners)).toEqual([])
    expect(savedAssignmentErrors(body({ endDate: '2026-10-31' }), stored, owners)).toEqual([{ path: 'reason', message: ASSIGNMENT_REASON_MESSAGE }])
    expect(savedAssignmentErrors(body({ roleInProject: 'pm' }, 'ok'), stored, owners)).toEqual([{ path: 'reason', message: ASSIGNMENT_REASON_MESSAGE }]) // < 3 characters
    expect(savedAssignmentErrors(body({ endDate: '2026-10-31' }, 'selesai proyek'), stored, owners)).toEqual([])
    expect(savedAssignmentErrors(body({ endDate: '2026-09-30' }, 'selesai proyek'), stored, owners)).toEqual([{ path: 'companies.0.assignments.0.endDate', message: END_BEFORE_START_MESSAGE }])
    expect(savedAssignmentErrors(body({ endDate: '2026-10-31' }, 'x y z'), stored, new Map([[1, 'new' as const]]))).toEqual([{ path: 'companies.0.assignments.0', message: ASSIGNMENT_OWNER_MESSAGE }])
    expect(savedAssignmentErrors(body({}), new Map(), owners)).toEqual([{ path: 'companies.0.assignments.0', message: 'Penugasan tidak ditemukan.' }])
  })
})

describe('api schemas: assignments', () => {
  const base = { user: { email: 'rina@example.test', name: 'Rina' } }
  it('optional (older callers keep working), strict, role enum, YYYY-MM-DD dates', () => {
    expect(UserOnboardingCreate.safeParse({ ...base, companies: [{ company: 1, roles: ['pk-staff'] }] }).success).toBe(true)
    expect(UserOnboardingCreate.safeParse({ ...base, companies: [{ company: 1, roles: ['pk-staff'], employee: { code: 'K', name: 'R' }, assignments: [{ project: 3, roleInProject: 'staff', startDate: '2026-10-15', endDate: null }] }] }).success).toBe(true)
    expect(UserOnboardingUpdate.safeParse({ reason: 'mutasi', companies: [{ company: 1, roles: ['pk-staff'], assignments: [{ id: 4, roleInProject: 'mandor', endDate: '2026-10-31' }] }] }).success).toBe(true)
    expect(UserOnboardingUpdate.safeParse({ companies: [{ company: 1, roles: [], assignments: [{ project: 3 }] }] }).success).toBe(false) // role required
    expect(UserOnboardingUpdate.safeParse({ companies: [{ company: 1, roles: [], assignments: [{ project: 3, roleInProject: 'owner' }] }] }).success).toBe(false)
    expect(UserOnboardingUpdate.safeParse({ companies: [{ company: 1, roles: [], assignments: [{ project: 3, roleInProject: 'staff', company: 2 }] }] }).success).toBe(false)
    const bad = UserOnboardingUpdate.safeParse({ companies: [{ company: 1, roles: [], assignments: [{ project: 3, roleInProject: 'staff', startDate: '15/10/2026' }] }] })
    expect(bad.error?.issues[0]?.message).toBe('Tanggal harus berformat YYYY-MM-DD.')
  })
})

describe('service: collection errors of an assignment → body paths', () => {
  it('cross-PT location / reason of the collection', () => {
    const v = new ValidationError({ collection: 'team-assignments', errors: [{ path: 'project', message: 'Data harus dari PT yang sama (cross-company reference).' }, { path: 'changeReason', message: ASSIGNMENT_REASON_MESSAGE }] })
    expect(writeError(v, 'companies.0.assignments.1')!.errors).toEqual([
      { path: 'companies.0.assignments.1.project', message: 'Data harus dari PT yang sama (cross-company reference).' },
      { path: 'reason', message: ASSIGNMENT_REASON_MESSAGE },
    ])
  })
})

// ---- client form state ----------------------------------------------------------------------------------------

const choices = { projects: [{ id: 51, code: 'P-01', name: 'Gedung A' }], costCenters: [{ id: 61, code: 'CC-1', name: 'Ops' }], sites: [] }
const detail: OnboardingDetail = {
  user: { id: 7, email: 'rina@example.test', name: 'Rina', phone: null, active: true, groupAdmin: false, identityEditable: true },
  banks: [],
  companies: [
    {
      id: 1,
      shortCode: 'DRMS',
      name: 'PT Satu',
      canManageEmployees: true,
      membership: { id: 11, roles: ['pk-staff'], active: true },
      employee: { id: 21, code: 'K-01', name: 'Rina', nickname: null, position: null, phone: null, attendanceType: 'onsite', active: true },
      bankAccounts: [],
      employeeChoices: [{ id: 21, code: 'K-01', name: 'Rina', active: true }],
      canManageAssignments: true,
      assignments: [{ id: 81, kind: 'project', label: 'Gedung A', roleInProject: 'staff', startDate: '2026-10-01T00:00:00.000Z', endDate: null }],
      assignmentChoices: choices,
    },
    { id: 2, shortCode: 'CS1', name: 'PT Dua', canManageEmployees: true, membership: null, employee: null, bankAccounts: [], employeeChoices: [], canManageAssignments: true, assignments: [], assignmentChoices: choices },
  ],
}

describe('form: assignments draft → body', () => {
  it('draftFromDetail mirrors saved rows by day; nothing changed → nothing sent', () => {
    const d = draftFromDetail(detail)
    expect(d.companies['1']!.asg).toEqual([{ key: 'a81', id: 81, kind: 'project', location: null, label: 'Gedung A', roleInProject: 'staff', startDate: '2026-10-01', endDate: '' }])
    expect(d.companies['2']!.asg).toEqual([])
    const r = buildBody(detail, d, 'update')
    expect(r).toMatchObject({ changed: false, needsReason: false, body: {} })
  })

  it('edit: a new row + ending a saved one (reason needed), with their order', () => {
    const d = draftFromDetail(detail)
    d.companies['1']!.asg[0]!.endDate = '2026-10-31'
    d.companies['1']!.asg.push({ ...newAssignment('n1', '2026-11-01'), kind: 'costCenter', location: 61, roleInProject: 'mandor' })
    const r = buildBody(detail, d, 'update')
    expect(r.needsReason).toBe(true)
    expect(r.body.companies).toEqual([
      { company: 1, roles: ['pk-staff'], assignments: [{ id: 81, roleInProject: 'staff', endDate: '2026-10-31' }, { costCenter: 61, roleInProject: 'mandor', startDate: '2026-11-01' }] },
    ])
    expect(r.order.asg).toEqual({ 0: ['a81', 'n1'] })
    // clearing the end date again = unchanged
    d.companies['1']!.asg[0]!.endDate = ''
    expect(buildBody(detail, d, 'update').needsReason).toBe(false)
  })

  it('create: user + new employee + new assignment in one body; an unpicked location is still sent (server names it)', () => {
    const empty: OnboardingDetail = { ...detail, user: null, companies: detail.companies.map((c) => ({ ...c, membership: null, employee: null, assignments: [] })) }
    const d = draftFromDetail(empty)
    d.user = { email: 'budi@example.test', name: 'Budi', phone: '', active: true }
    d.companies['1']!.roles = ['pk-staff']
    d.companies['1']!.emp = { mode: 'new', id: null, code: 'K-09', name: 'Budi', nickname: '', position: '', phone: '', attendanceType: 'onsite', active: true }
    expect(hasEmployee(d.companies['1']!.emp)).toBe(true)
    d.companies['1']!.asg = [{ ...newAssignment('n1', '2026-10-15'), location: 51 }, newAssignment('n2', '2026-10-15')]
    const r = buildBody(empty, d, 'create')
    expect(r.body.companies).toEqual([
      {
        company: 1,
        roles: ['pk-staff'],
        employee: { code: 'K-09', name: 'Budi', nickname: null, position: null, phone: null, attendanceType: 'onsite', active: true },
        assignments: [
          { project: 51, roleInProject: 'staff', startDate: '2026-10-15' },
          { roleInProject: 'staff', startDate: '2026-10-15' },
        ],
      },
    ])
    expect(r.needsReason).toBe(false)
  })

  it('saved rows belong to the linked employee: another / no employee → not sent; no right → nothing sent', () => {
    const d = draftFromDetail(detail)
    d.companies['1']!.asg[0]!.roleInProject = 'pm'
    d.companies['1']!.emp = { ...d.companies['1']!.emp, mode: 'pick', id: 22 }
    expect(showsSavedAssignments(detail.companies[0]!, d.companies['1']!.emp)).toBe(false)
    expect(buildBody(detail, d, 'update').body.companies).toEqual([{ company: 1, roles: ['pk-staff'], employee: { id: 22 } }])
    const noRight = { ...detail, companies: detail.companies.map((c) => ({ ...c, canManageAssignments: false })) }
    const e = draftFromDetail(noRight)
    e.companies['1']!.asg.push({ ...newAssignment('n1', '2026-10-15'), location: 51 })
    expect(buildBody(noRight, e, 'update').changed).toBe(false)
    expect(hasEmployee({ ...d.companies['1']!.emp, mode: 'pick', id: null })).toBe(false)
  })
})

describe('form: assignment errors → fields and the Penugasan tab', () => {
  const order = { companies: [1], banks: { 0: [] }, asg: { 0: ['a81', 'n1'] } }
  it('row, field and location paths', () => {
    expect(errorTarget('companies.0.assignments.1.location', order)).toEqual({ key: 'c.1.asg.n1.location', tab: 'penugasan' })
    expect(errorTarget('companies.0.assignments.1.project', order)).toEqual({ key: 'c.1.asg.n1.location', tab: 'penugasan' })
    expect(errorTarget('companies.0.assignments.1.site', order)).toEqual({ key: 'c.1.asg.n1.location', tab: 'penugasan' })
    expect(errorTarget('companies.0.assignments.0.endDate', order)).toEqual({ key: 'c.1.asg.a81.endDate', tab: 'penugasan' })
    expect(errorTarget('companies.0.assignments.0', order)).toEqual({ key: 'c.1.asg.a81', tab: 'penugasan' })
    expect(errorTarget('companies.0.assignments', order)).toEqual({ key: 'c.1.asg', tab: 'penugasan' })
    expect(errorTarget('companies.0.assignments.0', { companies: [1], banks: {} })).toEqual({ key: 'c.1.asg.?', tab: 'penugasan' })
  })

  it('mapErrors opens Penugasan for an assignment error', () => {
    const m = mapErrors({ errors: [{ path: 'companies.0.assignments.1.location', message: ONE_LOCATION_MESSAGE }, { path: 'reason', message: ASSIGNMENT_REASON_MESSAGE }] }, order)
    expect(m.tab).toBe('penugasan')
    expect(m.byKey.get('c.1.asg.n1.location')).toBe(ONE_LOCATION_MESSAGE)
    expect(m.byKey.get('reason')).toBe(ASSIGNMENT_REASON_MESSAGE)
  })
})
