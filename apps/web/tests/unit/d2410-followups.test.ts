import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { migrations } from '@/migrations'
import { patchDefinition, SITE_FILTER_PATCHES } from '@/migrations/20261024_500000_d2410_site_accounts_fund'

/**
 * DRMS 24/10 follow-ups after the five d2410 merges (user decisions): A. funds without the site exclusion. Pure parts
 * only; the DB behaviour is covered by tests/integration/d2410-followups.int.test.ts. Fictional data only.
 */
const dir = join(process.cwd(), 'src/migrations')
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('A. funds without the site exclusion (migration 20261024_500000)', () => {
  const guard = readFileSync(join(dir, '20261015_100200_d1310_fundcheck_guard.ts'), 'utf8')
  const fundBalance = `CREATE OR REPLACE FUNCTION public.pk_fund_balance(cid integer)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
      SELECT coalesce(sum(1), 0) FROM cash_accounts a
       WHERE a.company_id = cid AND a.active IS NOT FALSE AND a.site_id IS NULL
    $function$`

  it('the patched fragments exist in the 20261015_100200 bodies (pk_fund_balance, pk_icl_transfer_guard)', () => {
    for (const [, withSite] of SITE_FILTER_PATCHES) expect(guard.includes(withSite), withSite).toBe(true)
    expect(guard.split('is not an active account without site of PT %').length - 1).toBe(1)
  })

  it('up drops the filter, down puts it back; a second up is a no-op; an unexpected body is refused', () => {
    const up = patchDefinition('pk_fund_balance', fundBalance, 'up')
    expect(up).toContain('a.active IS NOT FALSE\n')
    expect(up).not.toContain('site_id')
    expect(patchDefinition('pk_fund_balance', up, 'up')).toBe(up)
    expect(patchDefinition('pk_fund_balance', up, 'down')).toBe(fundBalance)
    expect(() => patchDefinition('pk_fund_balance', 'CREATE FUNCTION x() AS $$ SELECT 1 $$', 'up')).toThrow(/not found exactly once/)
  })

  it('the transfer guard: source account = any active account of the paying PT, message without "site"', () => {
    const body = `IF NOT EXISTS (SELECT 1 FROM cash_accounts a WHERE a.id = NEW.from_cash_account_id AND a.company_id = NEW.from_company_id AND a.active IS NOT FALSE AND a.site_id IS NULL) THEN
        RAISE EXCEPTION 'intercompany_loan_transfers: source account % is not an active account without site of PT %', NEW.from_cash_account_id, NEW.from_company_id USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM cash_accounts a WHERE a.id = NEW.to_cash_account_id AND a.company_id = NEW.to_company_id AND a.active IS NOT FALSE AND coalesce(a.intercompany_receiving, false)) THEN`
    const up = patchDefinition('pk_icl_transfer_guard', body, 'up')
    expect(up).not.toContain('site')
    expect(up).toContain('coalesce(a.intercompany_receiving, false)) THEN') // the destination check is untouched
    expect(patchDefinition('pk_icl_transfer_guard', up, 'down')).toBe(body)
  })

  it('wiring: after the d2410 loan guard, every name once; data audited per account, reversible', () => {
    const names = migrations.map((m) => m.name)
    expect(names.indexOf('20261024_500000_d2410_site_accounts_fund')).toBe(names.indexOf('20261024_400300_d2410_loan_guard') + 1)
    expect(new Set(names).size).toBe(names.length)
    const m = readFileSync(join(dir, '20261024_500000_d2410_site_accounts_fund.ts'), 'utf8')
    expect(m).toContain("'cash_account', ${String(a.id)}, 'update', 'site'")
    expect(m).toContain("'system'")
    expect(m).toContain('RAISE NOTICE')
    expect(m).toContain('UPDATE cash_accounts c SET site_id = m.site_id')
  })

  it('service, inter-PT loans and the panels no longer exclude / mention site accounts', () => {
    const fund = src('src/domain/fundcheck/service.ts')
    expect(fund).toContain('excludedSiteAccounts: { count: 0, balance: 0 }')
    expect(fund).not.toMatch(/site_id === null/)
    expect(src('src/domain/intercompany/loans.ts')).not.toContain('Akun site tidak dapat dipakai')
    expect(src('src/admin/views/IntercompanyLoans.tsx')).not.toContain('site: { exists: false }')
    expect(src('src/admin/components/request/FundPanel.tsx')).not.toContain('site lama')
    expect(src('src/admin/components/icloans/IcLoanMoneyForm.tsx')).not.toContain('(site) tidak dapat dipakai')
  })
})
