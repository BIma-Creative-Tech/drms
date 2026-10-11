import { describe, expect, it } from 'vitest'

import { capabilitiesOf, legacyCompanyOf } from '@/api/v1/endpoints/me'
import { SyncBatch } from '@/api/v1/schemas-sync'
import { MASTER_TYPES, SHARED_MASTER_TYPES, companyFilterParam } from '@/api/v1/schemas'

/** MC3-1 pure rules of the /api/v1 multi-company contract (integration: tests/integration/mc3-api.int.test.ts). */
describe('MC3 — /me deprecated single-PT fields (released APK)', () => {
  const m = (company: number, employee: number | null) => ({ company, roles: ['pk-staff' as const], employee })

  it('one PT → that PT (identical to the pre-MC3 answer)', () => {
    expect(legacyCompanyOf([m(3, 30)])).toBe(3)
    expect(legacyCompanyOf([m(3, null)])).toBe(3)
  })

  it('several PTs → the lowest selected PT with an employee, else the lowest; none → null', () => {
    expect(legacyCompanyOf([m(5, 50), m(2, null), m(4, 40)])).toBe(4)
    expect(legacyCompanyOf([m(5, null), m(2, null)])).toBe(2)
    expect(legacyCompanyOf([])).toBeNull()
  })

  it('capabilities per role set (same rule for the legacy union and for each PT)', () => {
    const noField = { serviceReportCreate: false, unitTimesheetCreate: false, aftersalesActivityCreate: false, dailyReportCreate: false }
    expect(capabilitiesOf(['pk-staff'])).toEqual({ approvalInbox: false, teamMonitor: false, progressReportCreate: false, ...noField })
    // ADR 0021: the PM project approves its requests first → approval inbox
    expect(capabilitiesOf(['pk-pm'])).toEqual({ approvalInbox: true, teamMonitor: true, progressReportCreate: true, ...noField })
    expect(capabilitiesOf(['pk-owner'])).toEqual({ approvalInbox: true, teamMonitor: false, progressReportCreate: true, ...noField })
    expect(capabilitiesOf(['pk-finance'])).toEqual({ approvalInbox: true, teamMonitor: false, progressReportCreate: false, ...noField })
    // Admin = Direktur parity for progress reports (owner 2026-10-09); field reports read-only (owner 2026-10-10)
    expect(capabilitiesOf(['pk-admin'])).toEqual({ approvalInbox: false, teamMonitor: false, progressReportCreate: true, ...noField })
    // FR1 (ADR 0020 §2) + P3: with the PT flag on, Staff / PM / Direktur may create field reports; Finance / Admin only read
    const field = { serviceReportCreate: true, unitTimesheetCreate: true, aftersalesActivityCreate: true, dailyReportCreate: true }
    for (const r of ['pk-staff', 'pk-pm', 'pk-owner'] as const) expect(capabilitiesOf([r], { fieldReportsEnabled: true }), r).toMatchObject(field)
    expect(capabilitiesOf(['pk-finance', 'pk-admin'], { fieldReportsEnabled: true })).toMatchObject(noField)
    expect(capabilitiesOf(['pk-staff'], { fieldReportsEnabled: true }).progressReportCreate).toBe(false) // E4 unchanged
  })
})

describe('MC3 — contract schemas', () => {
  it('sync items accept an optional positive company_id; the old envelope stays valid', () => {
    const item = { client_uuid: '0192f0c4-7b1a-7c3e-8f00-000000000001', type: 'expense_request.draft_delete', schema_version: 1, offline: true, device_time: '2026-09-28T08:00:00+08:00', elapsed_ms: 1, payload: {} }
    const batch = (items: unknown[]) => ({ batch_id: '0192f0c4-7b1a-7c3e-8f00-000000000002', device_id: '0192f0c4-7b1a-7c3e-8f00-000000000003', clock: { device_time: '2026-09-28T08:00:00+08:00', elapsed_ms: 1, boot_id: 'b' }, items })
    expect(SyncBatch.safeParse(batch([item])).success).toBe(true)
    expect(SyncBatch.safeParse(batch([{ ...item, company_id: 3 }])).success).toBe(true)
    expect(SyncBatch.safeParse(batch([{ ...item, company_id: 0 }])).success).toBe(false)
    expect(SyncBatch.safeParse(batch([{ ...item, company_id: '3' }])).success).toBe(false)
  })

  it('?company= filter: comma separated positive ids only', () => {
    for (const ok of ['1', '1,3', '12,400']) expect(companyFilterParam.safeParse(ok).success).toBe(true)
    for (const bad of ['0', '1,', 'a', '1;2', '-1', ' 1']) expect(companyFilterParam.safeParse(bad).success).toBe(false)
  })

  it('shared masters = banks, UoM, holidays (ADR 0016 D2); all are known master types', () => {
    expect([...SHARED_MASTER_TYPES].sort()).toEqual(['banks', 'holidays', 'uoms'])
    for (const t of SHARED_MASTER_TYPES) expect(MASTER_TYPES).toContain(t)
    expect(MASTER_TYPES).toEqual(expect.arrayContaining(['vendors', 'cash-in-sources']))
  })
})
