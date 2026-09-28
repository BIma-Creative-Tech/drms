import { describe, expect, it } from 'vitest'

import { companyCookieName, parseCompanyIds } from '@/access/company-context'
import { byRole, byRoleAny, fieldRoles, PENDING_CREATE_ROLES, rolesAllowed, teamProjects } from '@/access/policies'
import {
  companiesWithRole,
  employeeIn,
  hasRole,
  hasRoleAny,
  isGroupAdmin,
  isStaffOnly,
  memberCompanies,
  ownEmployees,
  rolesIn,
  rolesOf,
  soleCompany,
  withCompanyContext,
  type Membership,
} from '@/access/roles'
import { tokenAllowsLogin } from '@/auth/strategies'

/**
 * MC1 (ADR 0016 §5): access context = active memberships ∩ selection; per-PT role checks; per-PT
 * `byRole`. User "Rina": Finance in PT 1 (employee 11), Staff in PT 2 (employee 21).
 */
const RINA: Membership[] = [
  { company: 1, roles: ['pk-finance'], employee: 11 },
  { company: 2, roles: ['pk-staff'], employee: 21 },
]
const user = (selection: number[] | null = null, ms: Membership[] = RINA, groupAdmin = false) => withCompanyContext({ id: 7 }, ms, selection, groupAdmin)
const req = (u: unknown) => ({ user: u, context: {}, payload: {} }) as never

describe('company context (ADR 0016 §5)', () => {
  it('parses X-Company-Ids / cookie values; anything odd is invalid (fail closed)', () => {
    expect(parseCompanyIds(undefined)).toBeNull()
    expect(parseCompanyIds('  ')).toBeNull()
    expect(parseCompanyIds('1,3, 3')).toEqual([1, 3])
    expect(parseCompanyIds('1;DROP')).toBe('invalid')
    expect(parseCompanyIds('0')).toBe('invalid')
    expect(parseCompanyIds('-1')).toBe('invalid')
    expect(parseCompanyIds('1'.repeat(300))).toBe('invalid')
    expect(companyCookieName(true)).toBe('pk-company-ids')
    expect(companyCookieName(false)).toBe('__Host-pk-company-ids')
  })

  it('selection only narrows: derived roles/employee = union of the SELECTED memberships', () => {
    const all = user()
    expect(rolesOf(all).sort()).toEqual(['pk-finance', 'pk-staff'])
    expect(memberCompanies(req(all))).toEqual([1, 2])
    const only2 = user([2])
    expect(rolesOf(only2)).toEqual(['pk-staff'])
    expect(only2.employee).toBe(21)
    expect(memberCompanies(req(only2))).toEqual([2])
    expect(soleCompany(req(only2))).toBe(2)
    expect(soleCompany(req(all))).toBeUndefined()
    // a foreign id in the selection is dropped (never grants anything)
    expect(memberCompanies(req(user([2, 99])))).toEqual([2])
    expect(isStaffOnly(only2)).toBe(true)
    expect(isStaffOnly(all)).toBe(false)
  })

  it('hasRole needs the company; mutations use the role IN THE DOCUMENT PT, independent of the selection', () => {
    const only2 = req(user([2]))
    expect(hasRole(only2, 'pk-finance', 1)).toBe(true) // membership, not selection
    expect(hasRole(only2, 'pk-finance', 2)).toBe(false)
    expect(hasRole(only2, ['pk-staff', 'pk-pm'], 2)).toBe(true)
    expect(hasRole(only2, 'pk-finance', undefined)).toBe(false)
    expect(hasRole(only2, 'pk-finance', 99)).toBe(false)
    expect(hasRoleAny(only2, 'pk-finance')).toBe(false) // any SELECTED PT
    expect(rolesIn(only2, 1)).toEqual(['pk-finance'])
    expect(employeeIn(only2, 1)).toBe(11)
    expect(employeeIn(only2, 3)).toBeUndefined()
    expect(ownEmployees(only2)).toEqual([11, 21])
    expect(companiesWithRole(req(user()), ['pk-finance'])).toEqual([1])
    expect(companiesWithRole(req(user([2])), ['pk-finance'])).toEqual([])
    expect(companiesWithRole(req(user([2])), ['pk-finance'], { all: true })).toEqual([1])
    expect(isGroupAdmin(req(user(null, RINA, true)))).toBe(true)
    expect(isGroupAdmin(req({ id: 1, roles: ['pk-admin'] }))).toBe(false) // no context → never group admin
  })

  it('a user object without context (no membership) holds no per-PT role', () => {
    const plain = req({ id: 1, roles: ['pk-admin'] })
    expect(hasRole(plain, 'pk-admin', 1)).toBe(false)
    expect(rolesIn(plain, 1)).toEqual([])
  })
})

describe('byRole per PT (ADR 0016 §5)', () => {
  const access = byRole({ 'pk-finance': true, 'pk-staff': ({ req: r }) => ({ createdBy: { equals: (r.user as { id: number }).id } }) })

  it('"see all" = all rows of the PTs where the role is held; scoped rules are AND-ed with their PT', async () => {
    expect(await access({ req: req(user()) } as never)).toEqual({
      or: [{ company: { in: [1] } }, { and: [{ company: { equals: 2 } }, { createdBy: { equals: 7 } }] }],
    })
    expect(await access({ req: req(user([1])) } as never)).toEqual({ company: { in: [1] } })
    expect(await access({ req: req(user([2])) } as never)).toEqual({ and: [{ company: { equals: 2 } }, { createdBy: { equals: 7 } }] })
    expect(await access({ req: req(user([], RINA)) } as never)).toBe(false)
  })

  it('scope rules get the scope of THAT PT (resolveScope per company)', async () => {
    const seen: Array<number | null> = []
    const a = byRole({
      'pk-staff': async (ctx) => {
        seen.push(ctx.companyId)
        return (teamProjects() as Exclude<ReturnType<typeof teamProjects>, true>)(ctx)
      },
    })
    const fake = { user: user(), context: { pkScope: { '7:2': { userId: 7, companyId: 2, employeeId: 21, employeeIds: [21], teamProjects: [5], assignedProjects: [5], teamCostCenters: [], assignedCostCenters: [] } } }, payload: {} } as never
    expect(await a({ req: fake } as never)).toEqual({ and: [{ company: { equals: 2 } }, { project: { in: [5] } }] })
    expect(seen).toEqual([2])
  })

  it('byRoleAny (shared masters / per-user rows): roles of any selected PT, no company filter', async () => {
    const a = byRoleAny({ 'pk-finance': true })
    expect(await a({ req: req(user()) } as never)).toBe(true)
    expect(await a({ req: req(user([2])) } as never)).toBe(false)
  })

  it('create access: with data.company → role in THAT PT; without → any PT + pending check for the company hook', () => {
    const create = rolesAllowed('pk-finance')
    expect(create({ req: req(user()), data: { company: 1 } } as never)).toBe(true)
    expect(create({ req: req(user()), data: { company: 2 } } as never)).toBe(false)
    const r = req(user()) as { context: Record<string, unknown> }
    expect(create({ req: r, data: {} } as never)).toBe(true)
    expect(r.context[PENDING_CREATE_ROLES]).toEqual(['pk-finance'])
    expect(create({ req: req(user([2])), data: {} } as never)).toBe(false)
  })

  it('field access uses the document PT when known', () => {
    const f = fieldRoles('pk-finance')
    expect(f({ req: req(user()), doc: { company: 1 } } as never)).toBe(true)
    expect(f({ req: req(user()), doc: { company: 2 } } as never)).toBe(false)
    expect(f({ req: req(user()), siblingData: { company: 2 } } as never)).toBe(false)
  })
})

describe('login gate (ADR 0016 §2, MC1 transition)', () => {
  it('pk-user or a legacy pk-* realm role lets the token in; token roles are never permissions', () => {
    expect(tokenAllowsLogin(['offline_access', 'pk-user'])).toBe(true)
    expect(tokenAllowsLogin(['pk-staff'])).toBe(true) // legacy marker until the infra assigns pk-user
    expect(tokenAllowsLogin(['offline_access', 'default-roles-drms'])).toBe(false)
    expect(tokenAllowsLogin(undefined)).toBe(false)
  })
})
