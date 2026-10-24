import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MODULES } from '@/admin/modules/registry'
import { ActionEnum, OptionalReasonBody } from '@/api/v1/schemas-flow'
import { ACTIONS, allowedActions, type ActorContext } from '@/domain/expense/state'
import { isDeletableDraft } from '@/domain/soft-delete/service'
import { migrations } from '@/migrations'
import { patchDefinition, SITE_FILTER_PATCHES } from '@/migrations/20261024_500000_d2410_site_accounts_fund'

/**
 * DRMS 24/10 follow-ups after the five d2410 merges (user decisions): A. funds without the site exclusion, B. "Hapus
 * draft", C. web on-behalf for the PM (team-scoped). Pure parts
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

describe('B. "Hapus draft"', () => {
  const ctx = (over: Partial<ActorContext>): ActorContext => ({
    type: 'advance',
    status: 'draft',
    roles: ['pk-staff'],
    isCreator: true,
    isRequester: false,
    hasDecision: false,
    isAcknowledger: false,
    matchesCurrentStep: false,
    alreadyDecided: false,
    ...over,
  })

  it('action + contract: delete_draft is an action, in the API enum; the body takes an optional reason only', () => {
    expect(ACTIONS).toContain('delete_draft')
    expect(ActionEnum.options).toContain('delete_draft')
    expect(OptionalReasonBody.safeParse({}).success).toBe(true)
    expect(OptionalReasonBody.safeParse({ reason: 'tidak jadi' }).success).toBe(true)
    expect(OptionalReasonBody.safeParse({ reason: 'x'.repeat(1001) }).success).toBe(false)
    expect(OptionalReasonBody.safeParse({ other: 1 }).success).toBe(false)
  })

  it('offered on an own undecided Draft only (numbered or not); the soft-delete rule matches', () => {
    expect(allowedActions(ctx({}))).toContain('delete_draft')
    expect(allowedActions(ctx({ hasDecision: true }))).not.toContain('delete_draft')
    expect(allowedActions(ctx({ status: 'pending_ack' }))).not.toContain('delete_draft')
    expect(allowedActions(ctx({ isCreator: false }))).not.toContain('delete_draft')
    expect(isDeletableDraft({ status: 'draft', docNo: null }, false)).toBe(true)
    expect(isDeletableDraft({ status: 'draft', docNo: 'PB/DRMS/2610/0001' }, false)).toBe(true) // withdrawn, undecided
    expect(isDeletableDraft({ status: 'draft', docNo: 'PB/DRMS/2610/0001' }, true)).toBe(false)
    expect(isDeletableDraft({ status: 'pending_approval', docNo: null }, false)).toBe(false)
  })

  it('invoice uniqueness ignores deleted drafts (services + migration 20261024_510000); sync deletes numbered drafts', () => {
    const names = migrations.map((m) => m.name)
    expect(names.indexOf('20261024_510000_d2410_delete_draft_invoice')).toBe(names.indexOf('20261024_500000_d2410_site_accounts_fund') + 1)
    const m = readFileSync(join(dir, '20261024_510000_d2410_delete_draft_invoice.ts'), 'utf8')
    expect(m.split("AND status NOT IN ('cancelled', 'rejected') AND is_deleted IS NOT TRUE;").length - 1).toBe(2)
    expect(src('src/domain/expense/drafts.ts')).toContain("AND vendor_id = ${vendorId} AND id <> ${requestId ?? -1} AND is_deleted IS NOT TRUE")
    expect(src('src/domain/intercompany/service.ts')).toContain('AND payee_company_id = ${payeeCompanyId} AND id <> ${requestId ?? -1} AND is_deleted IS NOT TRUE')
    const sync = src('src/domain/sync/service.ts')
    expect(sync).toContain('if (doc.docNo) await deleteDraft(req, doc.id, reason)')
    expect(sync).not.toContain("reject('NOT_EDITABLE', `Draft ${doc.docNo} sudah pernah diajukan")
  })

  it('web: "Hapus draft" in the requester panel through the confirm popup (danger), optional reason, back to the list', () => {
    const panel = src('src/admin/components/RequesterActions.tsx')
    expect(panel).toContain('url={`${url}/delete-draft`}')
    expect(panel).toContain('reasonOptional')
    expect(src('src/admin/components/WorkflowPanel.tsx')).toContain("'delete_draft'")
  })
})

describe('C. web "Absenkan karyawan" for the PM (team-scoped)', () => {
  it('menu item, endpoints and the web write path admit the PM; the PM part is team-scoped', () => {
    const items = MODULES.flatMap((m) => m.sections.flatMap((s) => s.items)) as Array<{ view?: string; roles?: readonly string[] }>
    expect(items.find((i) => i.view === '/absensi/absenkan')?.roles).toEqual(['pk-admin-staff', 'pk-pm'])
    const ep = src('src/api/v1/endpoints/attendance.ts')
    expect(ep.split("roles: ['pk-admin-staff', 'pk-pm'],").length - 1).toBe(2)
    const rec = src('src/domain/attendance/record.ts')
    expect(rec).toContain("pmAllowed: true, field: 'employee_id'")
    expect(rec).toContain("actor.source === 'pm' && !(await pmTeam(req, locCompany!)).employees.includes(actor.employee)")
    const opts = src('src/domain/attendance/on-behalf.ts')
    expect(opts).toContain('pmOnBehalfCompanies(req, companies)')
    expect(opts).toContain("(l.kind === 'project' ? team.projects : team.costCenters).includes(l.id)")
  })
})
