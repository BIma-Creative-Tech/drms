import type { Where } from 'payload'

import { companyContextOf, isRole, relId, ROLE_LABELS, ROLES, type Role } from '@/access/roles'
import {
  canUseMatrix,
  coverageWarnings,
  matrixColumns,
  REASON_MIN,
  ROLE_SHORT,
  type MatrixCell,
  type MatrixCompany,
  type MatrixEmployee,
  type MatrixUser,
  type Viewer,
} from '@/admin/components/access/role-matrix'

import { HttpError, json, v1 } from '../http'

/**
 * User 2026-10-19 (APK ↔ web parity, phase 6): the web "Akses PT (matriks)" (admin/views/AksesPt.tsx + RoleMatrix) as
 * JSON — same viewer gate (Admin of a PT / group admin), same columns (Admin PTs, narrowed to the PT selection), users
 * page (q, nonaktif=1, hal; 40 per page), every membership + employee of the column PTs (cell editor choices, "already
 * linked"), active holders (coverage warnings). All reads as the caller (overrideAccess: false). Save = the existing
 * POST /company-memberships/batch {reason (≥ 3), items[{user, company, roles, employee?, active?}]}.
 */
const PAGE_SIZE = 40
const READ_LIMIT: [number, number] = [60, 60_000]

export const membershipMatrixEndpoint = v1({
  path: '/company-memberships/matrix',
  method: 'get',
  rateLimit: READ_LIMIT,
  handler: async ({ req }) => {
    const ctx = companyContextOf(req.user)
    const viewer: Viewer = {
      groupAdmin: ctx?.groupAdmin === true,
      adminOf: (ctx?.memberships ?? []).filter((m) => m.roles.includes('pk-admin')).map((m) => m.company),
    }
    if (!canUseMatrix(viewer)) throw new HttpError(403, 'Forbidden', { detail: 'Akses PT hanya untuk Admin PT atau Admin grup.' })
    const sp = req.searchParams
    const q = (sp.get('q') ?? '').trim().slice(0, 80)
    const withInactive = sp.get('nonaktif') === '1'
    const page = Math.max(1, Number.parseInt(sp.get('hal') ?? '', 10) || 1)
    const user = req.user

    const companiesRes = await req.payload.find({ collection: 'companies', where: { active: { equals: true } }, sort: 'shortCode', pagination: false, select: { shortCode: true, name: true }, user, overrideAccess: false, req, depth: 0 })
    const all: MatrixCompany[] = companiesRes.docs.map((c) => ({ id: c.id as number, shortCode: String(c.shortCode), name: String(c.name ?? '') }))
    const memberIds = (ctx?.memberships ?? []).map((m) => m.company)
    const narrowed = ctx && ctx.selected.length < memberIds.length ? ctx.selected : null
    const columns = matrixColumns(all, viewer, narrowed)
    const colIds = columns.map((c) => c.id)

    const and: Where[] = []
    if (!withInactive) and.push({ active: { equals: true } })
    if (q) and.push({ or: [{ name: { like: q } }, { email: { like: q } }] })
    const usersRes = await req.payload.find({ collection: 'users', where: and.length ? { and } : {}, sort: 'name', limit: PAGE_SIZE, page, select: { name: true, email: true, active: true }, user, overrideAccess: false, req, depth: 0 })
    const users: MatrixUser[] = usersRes.docs.map((u) => ({ id: u.id as number, name: String(u.name ?? ''), email: String(u.email ?? ''), active: u.active !== false }))

    const cellsRes = colIds.length
      ? await req.payload.find({ collection: 'company-memberships', where: { company: { in: colIds } }, pagination: false, select: { user: true, company: true, roles: true, employee: true, active: true }, user, overrideAccess: false, req, depth: 0 })
      : { docs: [] }
    const cells: MatrixCell[] = (cellsRes.docs as unknown as Array<Record<string, unknown>>).map((m) => ({
      id: m.id as number,
      user: relId(m.user) ?? 0,
      company: relId(m.company) ?? 0,
      roles: (Array.isArray(m.roles) ? m.roles.filter(isRole) : []) as Role[],
      employee: relId(m.employee) ?? null,
      active: m.active !== false,
    }))
    const holderIds = [...new Set(cells.map((c) => c.user))]
    const holdersRes = holderIds.length
      ? await req.payload.find({ collection: 'users', where: { and: [{ id: { in: holderIds } }, { active: { equals: true } }] }, pagination: false, select: { active: true }, user, overrideAccess: false, req, depth: 0 })
      : { docs: [] }
    const activeUserIds = holdersRes.docs.map((u) => u.id as number)

    const employeesRes = colIds.length
      ? await req.payload.find({ collection: 'employees', where: { company: { in: colIds } }, sort: 'code', pagination: false, select: { code: true, name: true, active: true, company: true }, user, overrideAccess: false, req, depth: 0 })
      : { docs: [] }
    const employees: MatrixEmployee[] = (employeesRes.docs as unknown as Array<Record<string, unknown>>).map((e) => ({
      id: e.id as number,
      company: relId(e.company) ?? 0,
      code: String(e.code ?? ''),
      name: String(e.name ?? ''),
      active: e.active !== false,
    }))

    return json({
      viewer,
      narrowed: narrowed !== null,
      // ADR 0026: the Owner role (pk-principal) only for a group admin; a PT admin sees it where held, locked
      roles: ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r], short: ROLE_SHORT[r] })),
      reasonMin: REASON_MIN,
      companies: columns,
      users: { items: users, page: usersRes.page ?? page, totalPages: usersRes.totalPages, totalDocs: usersRes.totalDocs },
      cells,
      employees,
      activeUserIds,
      // the warnings of the STORED state (the web recomputes them while editing; the APK can too: same rule)
      warnings: coverageWarnings(columns, cells, new Set(activeUserIds)),
    })
  },
})
