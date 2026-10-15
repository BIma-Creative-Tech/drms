import { describe, expect, it } from 'vitest'

import type { Role } from '@/access/roles'
import { ruleMatches, selectRule, type RuleInput } from '@/domain/expense/rules'
import { FINANCE_RULE } from '@/migrations/20261015_150000_d1510_finance_rule_data'
import { DEFAULT_APPROVAL_RULES, DIREKTUR_RULE_NAME, FINANCE_RULE_NAME, INTERCOMPANY_FINANCE_RULE_NAME, OWNER_RULE_NAME, VENDOR_FINANCE_RULE_NAME } from '@/seed/data'

/** Owner decision 2026-10-15: Finance's own employee request (Reimburse + Pengajuan Baru) → Direktur → Owner, no PM step. */

const seeded = (name: string, id: number): RuleInput => ({ ...(DEFAULT_APPROVAL_RULES.find((x) => x.name === name) as unknown as RuleInput), id })
const DEFAULT_NAME = 'Default — PM project lalu Direktur (semua nominal)'
const rules = [seeded(DEFAULT_NAME, 1), seeded(OWNER_RULE_NAME, 2), seeded(DIREKTUR_RULE_NAME, 3), seeded(FINANCE_RULE_NAME, 4), seeded(VENDOR_FINANCE_RULE_NAME, 5), seeded(INTERCOMPANY_FINANCE_RULE_NAME, 6)]
const facts = (type: 'advance' | 'reimburse', payeeType: 'karyawan' | 'vendor' | 'pt_grup', roles: Role[][]) => ({ type, grandTotal: 2_500_000, categoryIds: [], projectId: 3, payeeType, requesterRoles: roles })

describe('"Pengajuan Finance — Direktur lalu Owner"', () => {
  it('seed: Jenis penerima Karyawan, every request type, Peran pemohon Finance, Direktur then Owner, no Diketahui, priority 20', () => {
    const r = seeded(FINANCE_RULE_NAME, 4)
    expect(r).toMatchObject({ docType: 'expense_request', requestType: 'any', payeeType: 'karyawan', requesterRoles: ['pk-finance'], acknowledge: 'none', priority: 20, active: true })
    expect(r.steps).toEqual([
      { level: 1, approverRole: 'pk-owner' },
      { level: 2, approverRole: 'pk-principal' },
    ])
    expect(FINANCE_RULE).toBe(FINANCE_RULE_NAME) // the data migration seeds the same name (frozen copy)
  })

  it('Finance: Reimburse and Pengajuan Baru take it (no PM step); vendor / PT grup keep their own rules', () => {
    expect(selectRule(rules, facts('reimburse', 'karyawan', [['pk-finance']]))?.name).toBe(FINANCE_RULE_NAME)
    expect(selectRule(rules, facts('advance', 'karyawan', [['pk-finance']]))?.name).toBe(FINANCE_RULE_NAME)
    expect(selectRule(rules, facts('advance', 'karyawan', [['pk-finance', 'pk-staff']]))?.name).toBe(FINANCE_RULE_NAME)
    expect(selectRule(rules, facts('advance', 'vendor', [['pk-finance']]))?.name).toBe(VENDOR_FINANCE_RULE_NAME)
    expect(selectRule(rules, facts('advance', 'pt_grup', [['pk-finance']]))?.name).toBe(INTERCOMPANY_FINANCE_RULE_NAME)
    expect(ruleMatches(seeded(FINANCE_RULE_NAME, 4), facts('advance', 'vendor', [['pk-finance']]))).toBe(false)
  })

  it('everyone else unchanged: Staff / PM / Admin → default, Direktur (also with Finance) → Pengajuan Direktur, Owner → Pengajuan Owner', () => {
    expect(selectRule(rules, facts('reimburse', 'karyawan', [['pk-staff']]))?.name).toBe(DEFAULT_NAME)
    expect(selectRule(rules, facts('reimburse', 'karyawan', [['pk-pm']]))?.name).toBe(DEFAULT_NAME)
    expect(selectRule(rules, facts('reimburse', 'karyawan', [['pk-admin']]))?.name).toBe(DEFAULT_NAME)
    expect(selectRule(rules, facts('reimburse', 'karyawan', [['pk-owner', 'pk-finance']]))?.name).toBe(DIREKTUR_RULE_NAME)
    expect(selectRule(rules, facts('reimburse', 'karyawan', [['pk-principal', 'pk-finance']]))?.name).toBe(OWNER_RULE_NAME)
    // a request for several requesters takes the Finance rule only when every requester is Finance
    expect(selectRule(rules, facts('advance', 'karyawan', [['pk-finance'], ['pk-staff']]))?.name).toBe(DEFAULT_NAME)
  })
})
