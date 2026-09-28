import { describe, expect, it } from 'vitest'

import {
  canEditCompany,
  canUseMatrix,
  cellKey,
  coverageWarnings,
  duplicateEmployees,
  effectiveCells,
  employeeChoices,
  forbiddenOps,
  isChanged,
  matrixColumns,
  newCell,
  pendingOps,
  reasonOk,
  setEmployee,
  toggleRole,
  type CellDraft,
  type MatrixCell,
  type MatrixCompany,
  type MatrixEmployee,
} from '@/admin/components/access/role-matrix'
import { MODULES, resolveModules } from '@/admin/modules/registry'

/**
 * MC2-4 role matrix (/admin/akses-pt, wireframe §2): permission logic (Admin of the PT / group
 * admin), drafts → REST ops, "no role = inactive", employee choices per PT, coverage warnings.
 * Fictional PTs: DRMS (1), CS1 (2), CS2 (3).
 */
const PTS: MatrixCompany[] = [
  { id: 1, shortCode: 'DRMS', name: 'PT Contoh Induk' },
  { id: 2, shortCode: 'CS1', name: 'PT Contoh Satu' },
  { id: 3, shortCode: 'CS2', name: 'PT Contoh Dua' },
]
const adminCs1 = { groupAdmin: false, adminOf: [2] }
const group = { groupAdmin: true, adminOf: [] }

describe('permissions', () => {
  it('Admin edits only the PTs where they are Admin; group admin all; others see nothing', () => {
    expect(canEditCompany(adminCs1, 2)).toBe(true)
    expect(canEditCompany(adminCs1, 1)).toBe(false)
    expect(canEditCompany(group, 3)).toBe(true)
    expect(canUseMatrix({ groupAdmin: false, adminOf: [] })).toBe(false)
    expect(canUseMatrix(adminCs1)).toBe(true)
  })

  it('columns = manageable PTs, narrowed by the switcher selection', () => {
    expect(matrixColumns(PTS, adminCs1, null).map((c) => c.shortCode)).toEqual(['CS1'])
    expect(matrixColumns(PTS, group, null).map((c) => c.shortCode)).toEqual(['DRMS', 'CS1', 'CS2'])
    expect(matrixColumns(PTS, group, [1, 3]).map((c) => c.shortCode)).toEqual(['DRMS', 'CS2'])
    expect(matrixColumns(PTS, adminCs1, [1])).toEqual([])
  })

  it('ops in a PT outside the rights are refused before anything is sent', () => {
    const stored = new Map<string, MatrixCell>()
    const drafts = new Map<string, CellDraft>([
      [cellKey(7, 2), toggleRole(newCell(7, 2), 'pk-staff')],
      [cellKey(7, 1), toggleRole(newCell(7, 1), 'pk-finance')],
    ])
    const ops = pendingOps(drafts, stored)
    expect(forbiddenOps(ops, adminCs1).map((o) => o.company)).toEqual([1])
    expect(forbiddenOps(ops, group)).toEqual([])
  })

  it('menu: "Akses PT (matriks)" for Admins only', () => {
    const canSee = () => true
    const labelOf = (_k: string, s: string) => s
    const items = (roles: ('pk-admin' | 'pk-owner')[]) =>
      resolveModules({ roles, staffOnly: false, canSee, labelOf }, MODULES)
        .flatMap((m) => m.sections.flatMap((s) => s.items))
        .map((i) => i.href)
    expect(items(['pk-admin'])).toContain('/admin/akses-pt')
    expect(items(['pk-owner'])).not.toContain('/admin/akses-pt')
  })
})

describe('drafts → REST operations', () => {
  const stored = new Map<string, MatrixCell>([[cellKey(5, 2), { id: 40, user: 5, company: 2, roles: ['pk-staff'], employee: 11, active: true }]])

  it('toggling roles; clearing every role deactivates, ticking one reactivates', () => {
    const s = { ...stored.get(cellKey(5, 2))! }
    const off = toggleRole(s, 'pk-staff')
    expect(off).toMatchObject({ roles: [], active: false })
    const on = toggleRole(toggleRole(off, 'pk-admin'), 'pk-pm')
    expect(on).toMatchObject({ roles: ['pk-pm', 'pk-admin'], active: true }) // canonical order
  })

  it('update = PATCH with roles/employee/active; unchanged drafts produce nothing', () => {
    const d = new Map([[cellKey(5, 2), toggleRole({ ...stored.get(cellKey(5, 2))! }, 'pk-finance')]])
    expect(pendingOps(d, stored)).toEqual([{ kind: 'update', key: '5:2', company: 2, id: 40, body: { roles: ['pk-staff', 'pk-finance'], employee: 11, active: true } }])
    const back = new Map([[cellKey(5, 2), toggleRole(toggleRole({ ...stored.get(cellKey(5, 2))! }, 'pk-pm'), 'pk-pm')]])
    expect(pendingOps(back, stored)).toEqual([])
    const unlink = new Map([[cellKey(5, 2), setEmployee({ ...stored.get(cellKey(5, 2))! }, null)]])
    expect(pendingOps(unlink, stored)[0]).toMatchObject({ kind: 'update', body: { employee: null, active: true } })
    const deact = new Map([[cellKey(5, 2), toggleRole({ ...stored.get(cellKey(5, 2))! }, 'pk-staff')]])
    expect(pendingOps(deact, stored)[0]).toMatchObject({ kind: 'update', body: { roles: [], active: false } })
  })

  it('a new cell is sent (POST, active) only once it has a role', () => {
    const empty = new Map([[cellKey(9, 3), newCell(9, 3)]])
    expect(pendingOps(empty, stored)).toEqual([])
    expect(isChanged(newCell(9, 3), undefined)).toBe(false)
    const withRole = new Map([[cellKey(9, 3), setEmployee(toggleRole(newCell(9, 3), 'pk-finance'), 31)]])
    expect(pendingOps(withRole, stored)).toEqual([{ kind: 'create', key: '9:3', company: 3, body: { user: 9, company: 3, roles: ['pk-finance'], employee: 31, active: true } }])
  })

  it('reason: at least 3 characters', () => {
    expect(reasonOk('  ab ')).toBe(false)
    expect(reasonOk('mutasi')).toBe(true)
  })

  it('effective cells = stored overlaid by drafts', () => {
    const d = new Map([[cellKey(5, 2), toggleRole({ ...stored.get(cellKey(5, 2))! }, 'pk-pm')]])
    expect(effectiveCells(stored, d).get('5:2')!.roles).toEqual(['pk-staff', 'pk-pm'])
  })
})

describe('employee link per PT', () => {
  const EMP: MatrixEmployee[] = [
    { id: 11, company: 2, code: 'CS1-001', name: 'Budi Uji', active: true },
    { id: 12, company: 2, code: 'CS1-002', name: 'Dewi Uji', active: true },
    { id: 13, company: 2, code: 'CS1-003', name: 'Lama Uji', active: false },
    { id: 21, company: 1, code: 'DRMS-001', name: 'Budi Uji', active: true },
  ]
  const cells: CellDraft[] = [
    { id: 1, user: 5, company: 2, roles: ['pk-staff'], employee: 11, active: true },
    { id: 2, user: 6, company: 2, roles: ['pk-staff'], employee: null, active: true },
  ]

  it('only active employees of THAT PT not linked to another account; the current one stays', () => {
    expect(employeeChoices(EMP, cells, 2, 6, null).map((e) => e.id)).toEqual([12])
    expect(employeeChoices(EMP, cells, 2, 5, 11).map((e) => e.id)).toEqual([11, 12])
    expect(employeeChoices(EMP, cells, 1, 6, null).map((e) => e.id)).toEqual([21])
    expect(employeeChoices(EMP, cells, 2, 7, 13).map((e) => e.id)).toEqual([12, 13]) // inactive current kept
  })

  it('duplicate links in one PT are flagged (unique (company, employee))', () => {
    expect(duplicateEmployees([...cells, { user: 6, company: 2, roles: ['pk-pm'], employee: 11, active: true }])).toEqual(['2:11'])
    expect(duplicateEmployees([...cells, { user: 6, company: 2, roles: [], employee: 11, active: false }])).toEqual([])
  })
})

describe('coverage warnings (wireframe §2 "Peringatan")', () => {
  it('a PT without an active Direktur / Finance (active accounts only) is named', () => {
    const cells: CellDraft[] = [
      { id: 1, user: 1, company: 1, roles: ['pk-owner', 'pk-finance'], employee: null, active: true },
      { id: 2, user: 2, company: 2, roles: ['pk-owner'], employee: null, active: true },
      { id: 3, user: 3, company: 2, roles: ['pk-finance'], employee: null, active: false },
      { id: 4, user: 4, company: 3, roles: ['pk-finance', 'pk-owner'], employee: null, active: true },
    ]
    const w = coverageWarnings(PTS, cells, new Set([1, 2, 3]))
    expect(w).toEqual([
      'PT CS1 tidak punya Finance aktif — pengajuan CS1 tidak bisa diajukan (409).',
      'PT CS2 tidak punya Direktur dan Finance aktif — pengajuan CS2 tidak bisa diajukan (409).',
    ])
  })
})
