import { describe, expect, it } from 'vitest'

import { buildOpenApiDocument } from '@/api/v1/openapi'
import { AdminDashboard, FinanceDashboard, OwnerDashboard, PmDashboard, StaffDashboard } from '@/api/v1/schemas-reports'

/**
 * DRMS 13/10 Wave 3 — dashboard parity APK ↔ web: the contract of the four blocks the web view used to load on its
 * own (SLA transfer, inter-project loans, RAP monitoring, projects with a RAB but no RAP) and their role visibility
 * (Direktur all four, Finance SLA + loans, PM loans + team RAP nudge, Staff/Admin none — Staff never sees money).
 */
const NEW = ['sla', 'loans', 'rapMonitoring', 'rapMissing'] as const
const keys = (s: { shape: Record<string, unknown> }) => NEW.filter((k) => k in s.shape)

describe('dashboard blocks per role (schemas-reports)', () => {
  it('Direktur: all four; Finance: SLA + loans; PM: loans + RAP nudge; Staff / Admin: none', () => {
    expect(keys(OwnerDashboard)).toEqual(['sla', 'loans', 'rapMonitoring', 'rapMissing'])
    expect(keys(FinanceDashboard)).toEqual(['sla', 'loans'])
    expect(keys(PmDashboard)).toEqual(['loans', 'rapMissing'])
    expect(keys(StaffDashboard)).toEqual([])
    expect(keys(AdminDashboard)).toEqual([])
  })

  it('a sample payload validates (Rupiah integers, nullable plan/percent)', () => {
    const blocks = {
      sla: { month: '2026-10', count: 4, pctWithin: 75, avgHours: 30.5, avgText: '1 hr 6 jam', late: 1, slaHours: [24], text: '75%' },
      loans: {
        totals: { count: 2, amount: 7_500_000, repaid: 0, outstanding: 7_500_000, overdue: 0, overdueCount: 0, pending: 1, byCompany: [{ companyId: 1, count: 2, amount: 7_500_000, repaid: 0, outstanding: 7_500_000 }] },
        projects: [{ projectId: 3, companyId: 1, code: 'P1', name: 'Gudang', borrowed: 7_500_000, lent: 0, outstandingBorrowed: 7_500_000, outstandingLent: 0, overdueBorrowed: 0, overdueCount: 0 }],
        waitingForMe: 1,
      },
      rapMonitoring: {
        projects: 1,
        overProjects: 0,
        rows: [{ projectId: 3, companyId: 1, code: 'P1', name: 'Gudang', status: 'berjalan', planned: null, realised: 0, transferred: 0, verified: 0, remaining: null, percent: null, overBudget: false, items: 1, activeItems: 1, overBudgetItems: 0 }],
      },
      rapMissing: { team: false, total: 1, rows: [{ id: 9, companyId: 1, code: 'P9', name: 'Trading', kind: 'trading', kindLabel: 'Trading', budget: 9_000_000, pm: null }] },
    }
    for (const [k, v] of Object.entries(blocks)) expect(OwnerDashboard.shape[k as (typeof NEW)[number]].safeParse(v).success, k).toBe(true)
    expect(OwnerDashboard.shape.loans.safeParse({ ...blocks.loans, waitingForMe: 0.5 }).success).toBe(false)
  })

  it('OpenAPI documents the blocks on the owner / finance / pm responses', () => {
    const doc = JSON.stringify(buildOpenApiDocument('0.0.0'))
    for (const k of ['avgText', 'outstandingBorrowed', 'overBudgetItems', 'kindLabel', 'waitingForMe']) expect(doc).toContain(`"${k}"`)
  })
})
