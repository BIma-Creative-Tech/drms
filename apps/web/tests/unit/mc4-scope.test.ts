import { sql } from '@payloadcms/db-postgres'
import { PgDialect } from '@payloadcms/db-postgres/drizzle/pg-core'
import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'

import { mappedCompanies, withCompanyContext } from '@/access/roles'
import { foreignPtParam } from '@/admin/views/pt'
import { auditRowVisible, flagVisibleSql, flagVisibleWhere, mayViewFlag, SHARED_FLAG_WHERE, withFlagVisibility } from '@/domain/expense/flag-visibility'
import { computeFlags, type FlagInput } from '@/domain/expense/flags'

/**
 * PT scope rule (owner decision 2026-10-02, ADR 0016 "Scope rule") — pure parts: "mapped PTs" of a
 * caller and the duplicate-flag visibility (QA-MC4-06). Integration: tests/integration/mc4-scope.int.test.ts.
 */
const reqOf = (memberships: number[] | null, selection: number[] | null = null): PayloadRequest =>
  ({
    user:
      memberships === null
        ? null
        : withCompanyContext({ id: 7 }, memberships.map((company) => ({ company, roles: ['pk-finance' as const], employee: null })), selection, false),
  }) as unknown as PayloadRequest

describe('mappedCompanies', () => {
  it('= every active membership, independent of the PT switcher selection', () => {
    expect(mappedCompanies(reqOf([1, 3], [3]))).toEqual([1, 3])
    expect(mappedCompanies(reqOf([2]))).toEqual([2])
  })

  it('system request (no user) → null; a user object without company context → [] (fail closed)', () => {
    expect(mappedCompanies(reqOf(null))).toBeNull()
    expect(mappedCompanies({ user: { id: 1 } } as unknown as PayloadRequest)).toEqual([])
  })
})

describe('QA-MC4-06 duplicate flags: detection result carries the other PT', () => {
  const base: FlagInput = {
    type: 'reimburse',
    requestDate: '2026-10-02',
    lines: [{ id: 'L1', lineNo: 1, total: 100_000 }],
    receipts: [{ id: 5, lineId: 'L1', receiptDate: '2026-10-01', amount: 100_000 }],
    categories: new Map(),
    uomNames: new Map(),
    duplicates: [],
    tolerance: 1000,
    maxAgeDays: 30,
  }

  it('cross-PT hit → relatedCompanyId; same-PT hit → none', () => {
    const cross = computeFlags({ ...base, duplicates: [{ receiptId: 5, otherRequestId: 9, otherDocNo: '1/PB-SK2/01/X/2026', via: 'fields', otherCompanyId: 2 }] })
    expect(cross).toEqual([expect.objectContaining({ kind: 'duplicate', relatedRequestId: 9, relatedCompanyId: 2 })])
    const same = computeFlags({ ...base, duplicates: [{ receiptId: 5, otherRequestId: 8, otherDocNo: null, via: 'image', otherCompanyId: null }] })
    expect(same[0]).not.toHaveProperty('relatedCompanyId')
    expect(same[0]!.message).toContain('#8')
  })
})

describe('QA-MC4-06 duplicate flags: visibility per viewer', () => {
  it('Where: flags without relatedCompany OR relatedCompany in the mapped PTs; system → no filter', () => {
    expect(flagVisibleWhere(reqOf([1, 2]))).toEqual({ or: [{ relatedCompany: { exists: false } }, { relatedCompany: { in: [1, 2] } }] })
    expect(flagVisibleWhere(reqOf([], null))).toEqual({ relatedCompany: { exists: false } })
    expect(flagVisibleWhere(reqOf(null))).toBeNull()
    expect(withFlagVisibility(reqOf(null), { id: { equals: 1 } })).toEqual({ id: { equals: 1 } })
    expect(withFlagVisibility(reqOf([1]), { id: { equals: 1 } })).toEqual({ and: [{ id: { equals: 1 } }, { or: [{ relatedCompany: { exists: false } }, { relatedCompany: { in: [1] } }] }] })
    expect(SHARED_FLAG_WHERE).toEqual({ relatedCompany: { exists: false } })
  })

  it('single flag: mapped to the related PT → visible; else hidden', () => {
    expect(mayViewFlag(reqOf([1]), { relatedCompany: null })).toBe(true)
    expect(mayViewFlag(reqOf([1]), { relatedCompany: 2 })).toBe(false)
    expect(mayViewFlag(reqOf([1, 2]), { relatedCompany: { id: 2 } })).toBe(true)
    expect(mayViewFlag(reqOf(null), { relatedCompany: 2 })).toBe(true)
  })

  it('SQL predicate binds the mapped PTs as parameters', () => {
    const q = new PgDialect().sqlToQuery(flagVisibleSql(reqOf([1, 3]), sql`f.related_company_id`))
    expect(q.sql).toBe('(f.related_company_id IS NULL OR f.related_company_id IN ($1, $2))')
    expect(q.params).toEqual([1, 3])
    expect(new PgDialect().sqlToQuery(flagVisibleSql(reqOf([]), sql`f.related_company_id`)).sql).toBe('f.related_company_id IS NULL')
    expect(new PgDialect().sqlToQuery(flagVisibleSql(reqOf(null), sql`f.related_company_id`)).sql).toBe('TRUE')
  })

  it('Riwayat: flag audit rows of a cross-PT duplicate only for viewers mapped to it', () => {
    const row = { action: 'flag_raised', newValue: { level: 'warning', message: 'x', relatedCompanyId: 2 } }
    expect(auditRowVisible(reqOf([1]), row)).toBe(false)
    expect(auditRowVisible(reqOf([1, 2]), row)).toBe(true)
    expect(auditRowVisible(reqOf([1]), { action: 'flag_raised', newValue: { level: 'warning', message: 'x' } })).toBe(true)
    expect(auditRowVisible(reqOf([1]), { action: 'flag_reviewed', newValue: { status: 'reviewed', relatedCompanyId: 2 } })).toBe(false)
    expect(auditRowVisible(reqOf([1]), { action: 'update', newValue: { relatedCompanyId: 2 } })).toBe(true)
  })
})

describe('QA-MC4-14: foreignPtParam (panel views answer a foreign ?pt= with a denial)', () => {
  it('true when any id is outside the selection; malformed / absent → false (nothing to deny)', () => {
    const req = reqOf([1, 3], [3])
    expect(foreignPtParam(req, undefined)).toBe(false)
    expect(foreignPtParam(req, { pt: '3' })).toBe(false)
    expect(foreignPtParam(req, { pt: '1' })).toBe(true) // mapped but not selected (same as /api/v1 ?company=)
    expect(foreignPtParam(req, { pt: ['3', '2'] })).toBe(true)
    expect(foreignPtParam(req, { pt: '3,9' })).toBe(true)
    expect(foreignPtParam(req, { pt: 'abc' })).toBe(false)
  })
})
