import type { CollectionConfig, SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { withCompanyContext } from '@/access/roles'
import { COMPANY_CELL, COMPANY_LIST_FILTER, companyFieldOf, withCompanyListUi } from '@/admin/company-list'
import { activeCompanyFilter, companyFilterHref, hasOtherFilter } from '@/admin/components/companies/list-filter'
import { COMPANY_SETTING_FIELDS, COMPANY_SETTING_TABS, companySettingKey } from '@/collections/Companies'
import { pickerSameCompany, requireCompanyWhenAmbiguous, sameCompanyOptions } from '@/fields/company'

/**
 * MC2-4 admin UI (ADR 0016 §11, wireframes §3–§4): PT column + filter on every list with a company,
 * company master tabs, employee ↔ PT mapping helpers.
 */
let config: SanitizedConfig
beforeAll(async () => {
  process.env.PK_SKIP_ENV_CHECK = 'true'
  config = await (await import('@/payload.config')).default
})

/** The 30 per-PT collections of ADR 0016 §4 + memberships + PT-tagged notifications / audit logs. */
const WITH_COMPANY = [
  'projects', 'project-stages', 'stage-templates', 'budget-lines', 'cost-centers', 'clients', 'vendors', 'expense-categories',
  'cash-in-sources', 'cash-accounts', 'vehicles', 'work-schedules', 'approval-rules', 'document-sequences', 'employees',
  'employee-bank-accounts', 'team-assignments', 'period-closings', 'expense-requests', 'expense-line-snapshots', 'approvals',
  'receipts', 'receipt-flags', 'transfers', 'cash-entries', 'settlements', 'budget-addenda', 'progress-reports', 'attendances',
  'attendance-corrections', 'company-memberships', 'notifications', 'audit-logs',
  // per-PT collections added after MC2
  'urgency-levels',
  // FR1 (ADR 0020)
  'contract-units', 'service-reports', 'unit-timesheets', 'aftersales-activities',
].sort()

describe('PT column + PT filter on list views', () => {
  it('every collection with a company column gets the PT chip cell, company first in defaultColumns, the PT filter', () => {
    const got = config.collections.filter((c) => companyFieldOf(c as unknown as CollectionConfig)).map((c) => c.slug).sort()
    expect(got).toEqual(WITH_COMPANY)
    for (const c of config.collections.filter((x) => WITH_COMPANY.includes(x.slug))) {
      const f = companyFieldOf(c as unknown as CollectionConfig) as { admin?: { components?: { Cell?: unknown } } }
      expect(f.admin?.components?.Cell, c.slug).toBe(COMPANY_CELL)
      expect(c.admin.defaultColumns?.[0] === 'company' || c.admin.defaultColumns?.includes('company'), c.slug).toBe(true)
      expect([c.admin.components?.beforeListTable].flat(), c.slug).toContain(COMPANY_LIST_FILTER)
    }
  })

  it('collections without a company column are untouched; the wrapper is idempotent', () => {
    const banks = { slug: 'banks', fields: [{ name: 'code', type: 'text' }], admin: { defaultColumns: ['code'] } } as CollectionConfig
    expect(withCompanyListUi([banks])[0]).toBe(banks)
    const per = { slug: 'x', fields: [{ name: 'company', type: 'relationship', relationTo: 'companies' }], admin: { defaultColumns: ['code'] } } as CollectionConfig
    const once = withCompanyListUi([per])
    const twice = withCompanyListUi(once)
    expect(twice[0]!.admin!.defaultColumns).toEqual(['company', 'code'])
    expect(twice[0]!.admin!.components!.beforeListTable).toEqual([COMPANY_LIST_FILTER])
  })

  it('PT chips: detect the chip filter, keep sort/limit/search, drop page + other where', () => {
    const sp = { 'where[or][0][and][0][company][equals]': '2', sort: '-updatedAt', page: '3', limit: '25' }
    expect(activeCompanyFilter(sp)).toBe(2)
    expect(hasOtherFilter(sp)).toBe(false)
    expect(activeCompanyFilter({ 'where[company][in][0]': '5' })).toBe(5)
    const mixed = { 'where[or][0][and][0][company][equals]': '2', 'where[or][0][and][1][status][equals]': 'draft' }
    expect(activeCompanyFilter(mixed)).toBeNull()
    expect(hasOtherFilter(mixed)).toBe(true)
    expect(activeCompanyFilter({ 'where[or][0][and][0][company][equals]': '2 OR 1=1' })).toBeNull()
    const base = '/admin/collections/expense-requests'
    expect(companyFilterHref(base, sp, 1)).toBe(`${base}?sort=-updatedAt&limit=25&where%5Bor%5D%5B0%5D%5Band%5D%5B0%5D%5Bcompany%5D%5Bequals%5D=1`)
    expect(companyFilterHref(base, sp, null)).toBe(`${base}?sort=-updatedAt&limit=25`)
    expect(companyFilterHref(base, {}, null)).toBe(base)
  })
})

describe('Master Perusahaan (companies)', () => {
  it('every per-PT setting field sits in exactly one tab', () => {
    const keys = COMPANY_SETTING_FIELDS.map(companySettingKey)
    const tabs = [...COMPANY_SETTING_TABS.OPERATIONAL, ...COMPANY_SETTING_TABS.ATTENDANCE, ...COMPANY_SETTING_TABS.REMINDERS]
    expect([...keys].sort()).toEqual([...tabs].sort())
  })

  it('list: Kode · Nama · Zona waktu · Anggota · Status · Dibuat; create/deactivate = group admin only', async () => {
    const c = config.collections.find((x) => x.slug === 'companies')!
    expect(c.admin.defaultColumns).toEqual(['shortCode', 'name', 'timezone', 'memberCount', 'active', 'createdAt', 'rowActions'])
    const req = (groupAdmin: boolean) => ({ user: withCompanyContext({ id: 1 }, [{ company: 1, roles: ['pk-admin'], employee: null }], null, groupAdmin), context: {} })
    expect(await c.access.create!({ req: req(false) } as never)).toBe(false)
    expect(await c.access.create!({ req: req(true) } as never)).toBe(true)
    const active = c.flattenedFields.find((f) => f.name === 'active') as { access?: { update?: (a: unknown) => boolean } }
    expect(active.access?.update?.({ req: req(false) })).toBe(false)
    expect(active.access?.update?.({ req: req(true) })).toBe(true)
  })
})

describe('employee ↔ PT mapping', () => {
  const user = (selection: number[] | null) =>
    withCompanyContext({ id: 7 }, [{ company: 1, roles: ['pk-admin'], employee: null }, { company: 2, roles: ['pk-admin'], employee: null }], selection, false)

  it('PT required on employee create only when the selection is ambiguous', () => {
    expect(requireCompanyWhenAmbiguous(undefined, { operation: 'create', req: { user: user(null) } })).toMatch(/PT wajib dipilih/)
    expect(requireCompanyWhenAmbiguous(undefined, { operation: 'create', req: { user: user([2]) } })).toBe(true)
    expect(requireCompanyWhenAmbiguous(2, { operation: 'create', req: { user: user(null) } })).toBe(true)
    expect(requireCompanyWhenAmbiguous(undefined, { operation: 'update', req: { user: user(null) } })).toBe(true)
    expect(requireCompanyWhenAmbiguous(undefined, { operation: 'create', req: {} })).toBe(true) // system write
  })

  it('employees: beforeValidate turns the ambiguous PT into a field error on `company`', async () => {
    const hook = config.collections.find((c) => c.slug === 'employees')!.hooks.beforeValidate[0]!
    const call = (data: Record<string, unknown>, selection: number[] | null) => hook({ data, operation: 'create', req: { user: user(selection), t: (k: string) => k } } as never)
    await expect(Promise.resolve().then(() => call({ code: 'K-1' }, null))).rejects.toMatchObject({ data: { errors: [{ path: 'company' }] } })
    expect(await call({ code: 'K-1' }, [2])).toEqual({ code: 'K-1' })
    expect(await call({ code: 'K-1', company: 1 }, null)).toEqual({ code: 'K-1', company: 1 })
  })

  it('pickers show only the document PT; save never re-reads with the caller access', () => {
    expect(sameCompanyOptions({ data: { company: 2 } })).toEqual({ company: { equals: 2 } })
    expect(sameCompanyOptions({ data: { company: { id: 3 } } })).toEqual({ company: { equals: 3 } })
    expect(sameCompanyOptions({ data: {} })).toBe(true)
    expect(pickerSameCompany().validate(undefined)).toBe(true)
    expect(pickerSameCompany({ required: true }).validate([])).toBe('Wajib diisi.')
    expect(pickerSameCompany({ required: true }).validate(4)).toBe(true)
    for (const [slug, field] of [['employees', 'workSchedule'], ['team-assignments', 'employee'], ['employee-bank-accounts', 'employee']] as const) {
      const f = config.collections.find((c) => c.slug === slug)!.flattenedFields.find((x) => x.name === field) as { filterOptions?: unknown }
      expect(f.filterOptions, `${slug}.${field}`).toBe(sameCompanyOptions)
    }
    // QA-15: "Diajukan Oleh" = the PT filter + own employee only for Staff-only users (tests/unit/qa-flow.test.ts)
    const req = config.collections.find((c) => c.slug === 'expense-requests')!.flattenedFields.find((x) => x.name === 'requesters') as { filterOptions?: (a: unknown) => unknown }
    expect(req.filterOptions!({ data: { company: 2 }, user: { roles: ['pk-pm'] } })).toEqual({ company: { equals: 2 } })
  })
})
