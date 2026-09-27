import type { CollectionSlug, Payload, PayloadRequest, Where } from 'payload'
import { z } from 'zod'

import { relId, type Role } from '@/access/roles'
import { withSystemTransaction } from '@/lib/system-tx'

/**
 * UAT seed (staging only): prepares a manual end-to-end test on top of the base seed
 * (src/seed/seed.ts must have run: bank MANDIRI + cost center OPS-PB are required).
 *
 * Input `UAT_USERS` = JSON array of { email, name, role, keycloakSub } — EXISTING Keycloak users
 * (one Staff, one PM, up to two Finance and two Direktur = `pk-owner`, ADR 0013)
 * (created by infra); nothing is written to Keycloak (context `skipKeycloakSync`). Every step is
 * idempotent (natural keys) and never overwrites data it did not create, except:
 * - an existing user (same keycloakSub) gets its missing UAT role added and, when unlinked, the UAT employee;
 * - cost center OPS-PB gets manager = PM user ONLY when it has no manager yet.
 * All writes: Local API as the system actor (audit source=system), one transaction per step.
 */
export const UAT_ROLES = ['pk-staff', 'pk-pm', 'pk-finance', 'pk-owner'] as const satisfies readonly Role[]
export type UatRole = (typeof UAT_ROLES)[number]

export const UAT_EMPLOYEE_CODE: Record<UatRole, string> = {
  'pk-staff': 'UJI-STAFF',
  'pk-pm': 'UJI-PM',
  'pk-finance': 'UJI-FIN',
  'pk-owner': 'UJI-OWN',
}

/** How many UAT users per role (ADR 0013: a second Direktur / Finance tests the G1-2 fallback). */
export const UAT_ROLE_MAX: Record<UatRole, number> = { 'pk-staff': 1, 'pk-pm': 1, 'pk-finance': 2, 'pk-owner': 2 }
const UAT_MAX_USERS = Object.values(UAT_ROLE_MAX).reduce((a, b) => a + b, 0)

/** Employee code of the n-th (1-based) UAT user of `role`: UJI-FIN, UJI-FIN-2, … */
export function uatEmployeeCode(role: UatRole, n: number): string {
  return n <= 1 ? UAT_EMPLOYEE_CODE[role] : `${UAT_EMPLOYEE_CODE[role]}-${n}`
}

export const UAT_FIXTURE = {
  costCenterCode: 'OPS-PB',
  bankCode: 'MANDIRI',
  accountNo: '9990001112223',
  project: { code: 'UJI-PRJ', name: 'Proyek Uji', budget: 50_000_000, status: 'berjalan' as const },
}

export const UatUsersSchema = z
  .array(
    z.strictObject({
      email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
      name: z.string().trim().min(1).max(128),
      role: z.enum(UAT_ROLES),
      keycloakSub: z.string().trim().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'keycloakSub must be the Keycloak user id (UUID)'),
    }),
  )
  .min(2)
  .max(UAT_MAX_USERS)
  .superRefine((list, ctx) => {
    const dup = (key: 'email' | 'keycloakSub') => {
      const seen = new Set<string>()
      list.forEach((u, i) => {
        const v = u[key].toLowerCase()
        if (seen.has(v)) ctx.addIssue({ code: 'custom', path: [i, key], message: `duplicate ${key}` })
        seen.add(v)
      })
    }
    dup('email')
    dup('keycloakSub')
    // ADR 0013: up to two Direktur (pk-owner) and two Finance users so that the G1-2 skip rule and
    // "another Direktur/Finance decides" can be tested; Staff and PM stay single.
    const count = new Map<UatRole, number>()
    list.forEach((u, i) => {
      const n = (count.get(u.role) ?? 0) + 1
      count.set(u.role, n)
      if (n > UAT_ROLE_MAX[u.role]) ctx.addIssue({ code: 'custom', path: [i, 'role'], message: `duplicate role (max ${UAT_ROLE_MAX[u.role]} × ${u.role})` })
    })
    for (const r of ['pk-staff', 'pk-pm'] as const) {
      if (!list.some((u) => u.role === r)) ctx.addIssue({ code: 'custom', path: [], message: `a ${r} user is required` })
    }
  })

export type UatUser = z.infer<typeof UatUsersSchema>[number]

/** Parses + validates `UAT_USERS`. Errors name the path only, never echo the input. */
export function parseUatUsers(raw: string | undefined): UatUser[] {
  if (!raw?.trim()) throw new Error('UAT_USERS is required (JSON array of {email,name,role,keycloakSub})')
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error('UAT_USERS is not valid JSON')
  }
  const r = UatUsersSchema.safeParse(json)
  if (!r.success) {
    const where = r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    throw new Error(`UAT_USERS is invalid — ${where}`)
  }
  return r.data
}

export type UatReport = Record<string, { created: number; linked: number; skipped: number }>

export async function seedUat(payload: Payload, users: UatUser[]): Promise<UatReport> {
  const report: UatReport = {}
  const tally = (k: string, what: 'created' | 'linked' | 'skipped') => {
    report[k] ??= { created: 0, linked: 0, skipped: 0 }
    report[k][what]++
  }
  const step = <T>(fn: (req: PayloadRequest) => Promise<T>) => withSystemTransaction(payload, null, fn, { auditSource: 'system', skipKeycloakSync: true })
  const findOne = async (req: PayloadRequest, collection: CollectionSlug, where: Where) =>
    (await payload.find({ collection, where, limit: 1, depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ: UAT seed */, req })).docs[0] as
      | (Record<string, unknown> & { id: number })
      | undefined
  const create = async (req: PayloadRequest, collection: CollectionSlug, data: Record<string, unknown>) =>
    (await payload.create({ collection, data: data as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: UAT seed */, context: { skipKeycloakSync: true }, req })).id as number
  const update = (req: PayloadRequest, collection: CollectionSlug, id: number, data: Record<string, unknown>) =>
    payload.update({ collection, id, data: data as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: UAT seed */, context: { skipKeycloakSync: true }, req })

  // Prerequisites from the base seed.
  const pre = await step(async (req) => ({
    bank: (await findOne(req, 'banks', { code: { equals: UAT_FIXTURE.bankCode } }))?.id,
    costCenter: await findOne(req, 'cost-centers', { code: { equals: UAT_FIXTURE.costCenterCode } }),
  }))
  if (pre.bank === undefined || !pre.costCenter) {
    throw new Error(`base seed missing: bank ${UAT_FIXTURE.bankCode} and cost center ${UAT_FIXTURE.costCenterCode} are required (run src/seed/index.ts first)`)
  }

  // 1 + 2: employee + user per entry.
  const userIds = new Map<UatRole, number>()
  const empIds = new Map<UatRole, number>()
  const seenRole = new Map<UatRole, number>()
  for (const u of users) {
    const nth = (seenRole.get(u.role) ?? 0) + 1
    seenRole.set(u.role, nth)
    await step(async (req) => {
      const code = uatEmployeeCode(u.role, nth)
      let emp = (await findOne(req, 'employees', { code: { equals: code } }))?.id
      if (emp === undefined) {
        emp = await create(req, 'employees', { code, name: u.name, active: true })
        tally('employees', 'created')
      } else tally('employees', 'skipped')
      if (nth === 1) empIds.set(u.role, emp)

      const bySub = await findOne(req, 'users', { keycloakSub: { equals: u.keycloakSub } })
      if (!bySub) {
        const byEmail = await findOne(req, 'users', { email: { equals: u.email } })
        if (byEmail) throw new Error(`users: ${u.role} email already belongs to another account (different keycloakSub) — fix manually`)
        if (await findOne(req, 'users', { employee: { equals: emp } })) throw new Error(`employees: ${code} is already linked to another user — fix manually`)
        const created = await create(req, 'users', { email: u.email, name: u.name, keycloakSub: u.keycloakSub, roles: [u.role], employee: emp, active: true })
        if (nth === 1) userIds.set(u.role, created)
        tally('users', 'created')
        return
      }
      if (nth === 1) userIds.set(u.role, bySub.id)
      const roles = Array.isArray(bySub.roles) ? (bySub.roles as string[]) : []
      const patch: Record<string, unknown> = {}
      if (!roles.includes(u.role)) patch.roles = [...roles, u.role]
      if (relId(bySub.employee) === undefined) {
        if (await findOne(req, 'users', { employee: { equals: emp } })) throw new Error(`employees: ${code} is already linked to another user — fix manually`)
        patch.employee = emp
      }
      if (Object.keys(patch).length > 0) {
        await update(req, 'users', bySub.id, patch)
        tally('users', 'linked')
      } else tally('users', 'skipped')
    })
  }
  const staffEmp = empIds.get('pk-staff')!
  const pmUser = userIds.get('pk-pm')!
  const pmEmp = empIds.get('pk-pm')!

  // 3: OPS-PB manager — only when empty (never overwrite a real manager).
  await step(async (req) => {
    const cc = await findOne(req, 'cost-centers', { code: { equals: UAT_FIXTURE.costCenterCode } })
    if (cc && relId(cc.manager) === undefined) {
      await update(req, 'cost-centers', cc.id, { manager: pmUser })
      tally('cost-centers.manager', 'linked')
    } else tally('cost-centers.manager', 'skipped')
  })

  // 4: fictional bank account of the staff employee.
  const staffName = users.find((u) => u.role === 'pk-staff')!.name
  await step(async (req) => {
    const found = await findOne(req, 'employee-bank-accounts', { and: [{ accountNo: { equals: UAT_FIXTURE.accountNo } }, { bank: { equals: pre.bank } }] })
    if (found) return tally('employee-bank-accounts', 'skipped')
    await create(req, 'employee-bank-accounts', {
      employee: staffEmp,
      bank: pre.bank,
      accountNo: UAT_FIXTURE.accountNo,
      accountHolder: staffName,
      isDefault: true,
      verificationStatus: 'unverified',
      active: true,
    })
    tally('employee-bank-accounts', 'created')
  })

  // 5: fictional project + team assignments (Staff → project + OPS-PB; PM → project as pm).
  const project = await step(async (req) => {
    const found = await findOne(req, 'projects', { code: { equals: UAT_FIXTURE.project.code } })
    if (found) {
      tally('projects', 'skipped')
      return found.id
    }
    const { code, name, budget, status } = UAT_FIXTURE.project
    const id = await create(req, 'projects', { code, name, pm: pmUser, budget, status })
    tally('projects', 'created')
    return id
  })
  const assignments: Array<{ employee: number; project?: number; costCenter?: number; roleInProject: 'staff' | 'pm' }> = [
    { employee: staffEmp, project, roleInProject: 'staff' },
    { employee: staffEmp, costCenter: pre.costCenter.id, roleInProject: 'staff' },
    { employee: pmEmp, project, roleInProject: 'pm' },
  ]
  for (const a of assignments) {
    await step(async (req) => {
      const target: Where = a.project !== undefined ? { project: { equals: a.project } } : { costCenter: { equals: a.costCenter } }
      if (await findOne(req, 'team-assignments', { and: [{ employee: { equals: a.employee } }, target] })) return tally('team-assignments', 'skipped')
      await create(req, 'team-assignments', a)
      tally('team-assignments', 'created')
    })
  }
  return report
}
