import { describe, expect, it } from 'vitest'

import { friendlyProblem } from '@/admin/components/kas/client'
import { itemCompany } from '@/admin/views/pt'
import { breakdown } from '@/admin/views/pt-breakdown'
import { attScopeOf, narrowAttScope, narrowAttToCompanies, type AttScope } from '@/domain/attendance/queries'

/**
 * MC2 integration of the admin UI with the backend helpers (`mc2-contract.md`): attendance filters
 * narrow PER PT (the old company-less `narrow()` of Absensi.tsx matched a project id of another PT),
 * queue / row PT ids, per-PT breakdown sums, the friendly "PT wajib dipilih" message.
 * Fictional PTs: A = 1, B = 2.
 */
const office = (company: number) => ({ company, all: true, projects: [], costCenters: [] })
const team = (company: number, projects: number[], costCenters: number[] = []) => ({ company, all: false, projects, costCenters })

describe('attendance scope narrowing per PT (mc2-contract §0.1/§5)', () => {
  const officeA = attScopeOf([office(1)])!

  it('office user of PT A filtering by a project id of PT B keeps the PT A predicate', () => {
    const n = narrowAttScope(officeA, 900) // 900 = project of PT B
    expect(n.parts).toEqual([{ company: 1, all: false, projects: [900], costCenters: [] }])
    // the SQL predicate is `company_id = 1 AND project_id IN (900)` → no row of PT B can match
    expect(n.parts!.every((p) => p.company === 1)).toBe(true)
  })

  it('PM: an id outside the team yields an empty part (never another PT, never widened)', () => {
    const s = attScopeOf([team(1, [10, 11]), office(2)])!
    const n = narrowAttScope(s, 12)
    expect(n.parts).toEqual([
      { company: 1, all: false, projects: [], costCenters: [] },
      { company: 2, all: false, projects: [12], costCenters: [] },
    ])
  })

  it('PT filter: keeps only the chosen PTs; foreign ids → matches nothing; empty → unchanged', () => {
    const s = attScopeOf([office(1), team(2, [20])])!
    expect(narrowAttToCompanies(s, [2]).parts).toEqual([team(2, [20])])
    expect(narrowAttToCompanies(s, [2]).kind).toBe('team')
    expect(narrowAttToCompanies(s, [3]).parts).toEqual([])
    expect(narrowAttToCompanies(s, []).parts).toEqual(s.parts)
    // MC4: a company-blind literal is never passed through (empty scope, matches nothing)
    const legacy: AttScope = { kind: 'team', projects: [1], costCenters: [] }
    expect(narrowAttToCompanies(legacy, [1])).toEqual({ kind: 'team', projects: [], costCenters: [], parts: [] })
  })
})

describe('PT ids on rows (mc2-contract §3/§4)', () => {
  it('queue `company` ref, a plain id, or a row `companyId`', () => {
    expect(itemCompany({ company: { id: 2 } })).toBe(2)
    expect(itemCompany({ company: 3 })).toBe(3)
    expect(itemCompany({ company: null, companyId: 4 })).toBe(4)
    expect(itemCompany({})).toBeNull()
  })

  it('per-PT breakdown: sorted by PT code, Σ = combined total (contract §2 invariant)', () => {
    const ref = (id: number | null | undefined) => (id === 1 ? { id: 1, shortCode: 'DRMS' } : id === 2 ? { id: 2, shortCode: 'CS1' } : null)
    const rows = [
      { companyId: 1, total: 48_250_000, monthIn: 0, monthOut: 0 },
      { companyId: 2, total: 13_150_000, monthIn: 0, monthOut: 0 },
    ]
    const b = breakdown({ ref }, rows, (r) => r.total)
    expect(b.list.map((x) => x.code)).toEqual(['CS1', 'DRMS'])
    expect(b.total).toBe(61_400_000)
  })
})

describe('Tutup buku: ambiguous PT (400 "PT wajib dipilih")', () => {
  it('is turned into an instruction; other messages pass through', () => {
    expect(friendlyProblem(400, 'PT wajib dipilih. — company: Pilih PT yang ditutup bukunya.')).toMatch(/lebih dari satu PT.*belum ada yang disimpan/)
    expect(friendlyProblem(409, 'Periode 2026-08 sudah ditutup.')).toBe('Periode 2026-08 sudah ditutup.')
  })
})
