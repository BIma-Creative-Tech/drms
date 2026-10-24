import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { FundCheck } from '@/api/v1/schemas-flow'
import { migrations } from '@/migrations'
import { blockedDecisionText, effectiveAvailable, fundInsufficientMessage, fundRoute, fundRouteText } from '@/domain/fundcheck/rules'

/** ADR 0031 amendment (user 2026-10-22, "PB dulu, lalu PT"): the fund check of a mapped project's request. */
describe('d2210 fund check: Pusat Biaya first, then PT', () => {
  it('the case that triggered it: PT LAS short, CSR SEPASO free 51 jt → a 17 jt request passes from its Pusat Biaya', () => {
    const pt = 196_000_000 - 286_431_562
    const pb = 51_171_150
    expect(effectiveAvailable(pt, pb)).toBe(pb)
    expect(fundRoute(17_000_000, pt, pb)).toBe('pusat_biaya')
  })

  it('Pusat Biaya short but the PT covers it → another account pays (automatic loan)', () => {
    expect(fundRoute(30, 100, 10)).toBe('other_account')
    expect(effectiveAvailable(100, 10)).toBe(100)
    expect(fundRouteText('other_account', 'CSR BERAU', 20)).toBe(
      'Dana pusat biaya CSR BERAU kurang Rp 20, tetapi dana PT cukup — Finance membayar dari akun lain di PT ini (tercatat sebagai pinjaman antar project otomatis).',
    )
  })

  it('both short → short; no Pusat Biaya → per PT (ADR 0029 unchanged)', () => {
    expect(fundRoute(200, 100, 50)).toBe('short')
    expect(fundRoute(50, 100, null)).toBe('pt')
    expect(fundRoute(150, 100, null)).toBe('short')
    expect(effectiveAvailable(-5, null)).toBe(-5)
    expect(fundRouteText('pt', null, 0)).toBeNull()
    expect(fundRouteText('short', 'X', 1)).toBeNull()
    expect(fundRouteText('pusat_biaya', 'CSR SEPASO/KUTIM', 0)).toBe('Dana pusat biaya CSR SEPASO/KUTIM cukup — Finance membayar dari akun ini.')
  })

  it('refusal texts name the Pusat Biaya when there is one; the per-PT texts are unchanged', () => {
    expect(blockedDecisionText(5_000)).toBe('Dana PT tidak cukup — kurang Rp 5.000. Tolak, atau perintahkan pinjaman antar-PT.')
    expect(blockedDecisionText(5_000, 'CSR BERAU')).toBe('Dana pusat biaya CSR BERAU maupun dana PT tidak cukup — kurang Rp 5.000. Tolak, atau perintahkan pinjaman antar-PT.')
    expect(fundInsufficientMessage('LAS', { available: 10, needed: 30, pbName: 'CSR BERAU' })).toMatch(/^Dana pusat biaya CSR BERAU maupun dana PT LAS tidak cukup: tersedia Rp 10, dibutuhkan Rp 30, kurang Rp 20\./)
  })

  it('FundCheck carries route / routeText / pusatBiaya (with project_loan commitments)', () => {
    const base = {
      companyId: 2,
      company: { id: 2, shortCode: 'LAS', name: 'PT Contoh' },
      enabled: true,
      applies: true,
      status: 'ok',
      blocked: false,
      blockedText: null,
      balance: 196,
      commitments: 286,
      available: -90,
      needed: 17,
      gap: 0,
      route: 'pusat_biaya',
      routeText: 'Dana pusat biaya CSR SEPASO/KUTIM cukup — Finance membayar dari akun ini.',
      pusatBiaya: { accountId: 6, name: 'CSR SEPASO/KUTIM', balance: 51, commitments: 0, available: 51, commitmentItems: [{ kind: 'project_loan', id: 1, docNo: 'PJ/LAS/2610/0001', amount: 5, status: 'approved' }] },
      accountCount: 5,
      excludedSiteAccounts: { count: 0, balance: 0 },
      waitingAtOwner: { count: 0, amount: 0 },
      commitmentItems: [],
      loans: [],
    }
    expect(FundCheck.safeParse(base).success).toBe(true)
    expect(FundCheck.safeParse({ ...base, route: 'elsewhere' }).success).toBe(false)
  })

  it('migration wiring: in timestamp order after the 0.19.0 migrations, every name once', () => {
    const names = migrations.map((m) => m.name)
    expect(names.indexOf('20261022_100000_d2210_pb_fund')).toBeGreaterThan(names.indexOf('20261021_100200_d2110_pb_guard'))
    expect([...names].sort()).toEqual(names)
    expect(new Set(names).size).toBe(names.length)
  })

  it('the DB backstop compares with pk_request_fund_available (same rule as the service)', () => {
    const m = readFileSync(join(__dirname, '../../src/migrations/20261022_100000_d2210_pb_fund.ts'), 'utf8')
    expect(m).toContain('avail := pk_request_fund_available(NEW.company_id, NEW.project_id);')
    expect(m).toMatch(/greatest\(pk_fund_available\(cid\), pk_pb_balance\(x\.aid\) - pk_pb_commitments\(x\.aid\)\)/)
    // per-PT lock unchanged (ADR 0029 lock order)
    expect(m).toContain(`hashtextextended('pk:fund:' || NEW.company_id::text, 0)`)
    const svc = readFileSync(join(__dirname, '../../src/domain/fundcheck/service.ts'), 'utf8')
    expect(svc).toContain('pk_pb_balance(${account.id}::integer)')
  })
})
