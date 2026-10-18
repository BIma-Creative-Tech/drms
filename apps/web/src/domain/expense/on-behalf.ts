import type { PayloadRequest } from 'payload'

import { hasRole, relId } from '@/access/roles'
import { employeesOnProjects, resolveScope } from '@/access/scope'

/**
 * ADR 0024 / 0026: employees whose ACTIVE account holds Direktur (`pk-owner`) or Owner (`pk-principal`) — they file
 * their own requests only (the APK marks them `direktur` in the employees masters).
 */
export async function direkturEmployees(req: PayloadRequest, employeeIds: number[]): Promise<Set<number>> {
  if (employeeIds.length === 0) return new Set()
  const res = await req.payload.find({
    collection: 'company-memberships',
    where: { and: [{ employee: { in: employeeIds } }, { roles: { in: ['pk-owner', 'pk-principal'] } }, { active: { equals: true } }] },
    depth: 0,
    pagination: false,
    select: { employee: true, user: true },
    overrideAccess: true, // SYSTEM-READ: Direktur marker of employees the caller may already read
    req,
  })
  const rows = res.docs as unknown as Array<{ employee?: unknown; user?: unknown }>
  const users = [...new Set(rows.map((r) => relId(r.user)).filter((x): x is number => x !== undefined))]
  if (users.length === 0) return new Set()
  const active = await req.payload.find({ collection: 'users', where: { and: [{ id: { in: users } }, { active: { equals: true } }] }, depth: 0, pagination: false, select: { email: true }, overrideAccess: true /* SYSTEM-READ: active accounts */, req })
  const ok = new Set(active.docs.map((d) => d.id as number))
  return new Set(rows.filter((r) => ok.has(relId(r.user) ?? -1)).map((r) => relId(r.employee)).filter((x): x is number => x !== undefined))
}

export const PM_ON_BEHALF_MESSAGE = 'PM hanya boleh mengajukan atas nama karyawan yang ditugaskan di project yang dipimpinnya (bukan Direktur/Owner).'

/**
 * D1810 (owner decision 2026-10-18, replaces the Q-09 default for the PM): the PM of the request's project files on
 * behalf of employees with an active team assignment to THAT project, so the transfer goes to the requester's
 * account. Not for a cost-center request, nor for a Direktur / Owner requester (ADR 0024 / 0026: they file their own).
 * `own` (the PM's own employee) may be a co-requester. `undefined` = the caller is no PM of the request's PT.
 */
export async function pmMayFileFor(req: PayloadRequest, c: { company: number | undefined; projectId: number | null | undefined; requesters: number[]; own: number | undefined }): Promise<boolean | undefined> {
  if (c.company === undefined || !hasRole(req, 'pk-pm', c.company)) return undefined
  if (!c.projectId || !(await resolveScope(req, c.company)).teamProjects.includes(c.projectId)) return false
  const others = c.requesters.filter((e) => e !== c.own)
  const members = new Set(await employeesOnProjects(req, [c.projectId]))
  if (!others.every((e) => members.has(e))) return false
  return (await direkturEmployees(req, others)).size === 0
}
