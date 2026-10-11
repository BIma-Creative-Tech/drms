import type { CollectionConfig, PayloadRequest, SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { withCompanyContext, type Role } from '@/access/roles'
import { companyFieldOf } from '@/admin/company-list'
import { publicFlags } from '@/api/v1/endpoints/app'
import { buildOpenApiDocument } from '@/api/v1/openapi'
import { AddendumCreate } from '@/api/v1/schemas-addendum'
import { CashEntryCreate, ExpenseRequestCreate } from '@/api/v1/schemas-flow'
import { ProgressReportCreate } from '@/api/v1/schemas-progress'
import { NotificationTemplates } from '@/collections/NotificationTemplates'
import { settingDefaults } from '@/domain/company-defaults'
import { locationScopeSql, narrowAttScope, type AttScope } from '@/domain/attendance/queries'
import { fromCompanies, ledgerScopeSql, requestScopeSql, type ReportScope } from '@/domain/reports/scope'
import { LIST_COMPANY_SLUGS } from '@/migrations/20260930_120000_mc4_list_company_column'
import { renderReportPdf } from '@/pdf/report-render'

import { pdfFlatText } from '../fixtures/pdf-text'
import { signatureImage } from '../fixtures/receipt-image'

/**
 * MC4 code gaps (docs/proyekkas/mc/mc4-progress.md): pure rules. Integration evidence:
 * tests/integration/mc4-code.int.test.ts.
 */

/** Flattens a drizzle `sql` fragment to text (params → `?`) — test-only, no drizzle import. */
function sqlText(x: unknown): string {
  if (x === null || x === undefined) return ''
  if (typeof x === 'string') return x
  if (typeof x !== 'object') return '?'
  const o = x as { queryChunks?: unknown[]; value?: unknown }
  if (Array.isArray(o.queryChunks)) return o.queryChunks.map(sqlText).join('')
  if (Array.isArray(o.value)) return o.value.join('')
  return '?'
}

describe('MC4 item 3 — public GET /app/config flags = OR over the active PTs', () => {
  it('one PT → exactly its values (released APK unchanged)', () => {
    expect(publicFlags([{ syncExpenseDraftsEnabled: true, syncAttendanceEnabled: false, syncProgressReportsEnabled: false }])).toEqual({ syncExpenseDraftsEnabled: true, syncAttendanceEnabled: false, syncProgressReportsEnabled: false })
    expect(publicFlags([{ syncExpenseDraftsEnabled: false, syncAttendanceEnabled: true, syncProgressReportsEnabled: true }])).toEqual({ syncExpenseDraftsEnabled: false, syncAttendanceEnabled: true, syncProgressReportsEnabled: true })
  })

  it('several PTs → a feature is advertised when ANY PT has it on (defaults: drafts/progress on, attendance off)', () => {
    const off = { syncExpenseDraftsEnabled: false, syncAttendanceEnabled: false, syncProgressReportsEnabled: false }
    expect(publicFlags([off, { ...off, syncAttendanceEnabled: true }])).toEqual({ ...off, syncAttendanceEnabled: true })
    expect(publicFlags([off, off])).toEqual(off)
    expect(publicFlags([{}, off])).toEqual({ syncExpenseDraftsEnabled: true, syncAttendanceEnabled: false, syncProgressReportsEnabled: true })
    expect(publicFlags([])).toEqual(off) // no active PT: nothing advertised
  })

  it('the answer carries only booleans (no PT id / name / count leaves the public endpoint)', () => {
    const flags = publicFlags([{ syncAttendanceEnabled: true }, { syncAttendanceEnabled: false }])
    expect(Object.values(flags).every((v) => typeof v === 'boolean')).toBe(true)
    const doc = buildOpenApiDocument('0.0.0') as { components: { schemas: Record<string, { properties?: Record<string, unknown> }> } }
    expect(Object.keys(doc.components.schemas.AppConfig!.properties!).sort()).toEqual(
      ['android', 'downloadUrl', 'features', 'latestVersion', 'minSupportedVersion', 'releaseNotes', 'serverTime', 'sync', 'timezone', 'updateAvailable', 'updateRequired'].sort(),
    )
  })
})

describe('MC4 item 2 — optional body `company` on /api/v1 creates (released APK bodies stay valid)', () => {
  const cases: Array<[string, { safeParse: (v: unknown) => { success: boolean } }, Record<string, unknown>]> = [
    ['ExpenseRequestCreate', ExpenseRequestCreate, { type: 'advance', title: 'x' }],
    ['ProgressReportCreate', ProgressReportCreate, { projectId: 1, stageId: 2, pctAfter: 10, work: 'Pekerjaan' }],
    ['BudgetAddendumCreate', AddendumCreate, { projectId: 1, addition: 1000, reason: 'alasan' }],
    ['CashEntryCreate', CashEntryCreate, { direction: 'out', cashAccountId: 1, amount: 1000, description: 'x', categoryId: 2 }],
  ]
  for (const [name, schema, body] of cases) {
    it(`${name}: without company (0.2.x / 0.3.0 body) and with a positive id; never a string / 0`, () => {
      expect(schema.safeParse(body).success).toBe(true)
      expect(schema.safeParse({ ...body, company: 3 }).success).toBe(true)
      expect(schema.safeParse({ ...body, company: 0 }).success).toBe(false)
      expect(schema.safeParse({ ...body, company: '3' }).success).toBe(false)
    })
  }

  it('OpenAPI: `company` optional on every create that used to infer the PT', () => {
    const doc = buildOpenApiDocument('0.0.0') as { components: { schemas: Record<string, { properties?: Record<string, unknown>; required?: string[] }> } }
    for (const id of ['ExpenseRequestCreate', 'ProgressReportCreate', 'BudgetAddendumCreate', 'CashEntryCreate']) {
      const s = doc.components.schemas[id]!
      expect(s.properties?.company, id).toBeDefined()
      expect(s.required ?? [], id).not.toContain('company')
    }
  })
})

describe('MC4 extra (a)/(b) — per-PT fields documented for the APK', () => {
  it('dashboards, inbox and K-09 rows carry their PT and thresholds', () => {
    const doc = buildOpenApiDocument('0.0.0') as unknown as { paths: Record<string, unknown> }
    const json = JSON.stringify(doc)
    for (const k of ['warnPctByCompany', 'waitingForMeByCompany', 'completenessByCompany', 'cashByCompany', 'lastClosedByCompany', 'teamMonthByCompany', 'badGapPct']) expect(json, k).toContain(`"${k}"`)
    const owner = JSON.stringify(doc.paths['/dashboard/owner'])
    expect(owner).toContain('"companies"')
    expect(owner).toContain('"byCompany"')
  })
})

describe('MC4 extra (c) — company-blind scope literals match nothing (any kind)', () => {
  it('ReportScope literal without companies → SQL FALSE for all / team / own', () => {
    for (const s of [{ kind: 'all' }, { kind: 'team', projects: [1, 2], costCenters: [3] }, { kind: 'own', userId: 5, employeeId: 6 }] as ReportScope[]) {
      expect(sqlText(requestScopeSql(s)), JSON.stringify(s)).toBe('FALSE')
      expect(sqlText(ledgerScopeSql(s)), JSON.stringify(s)).toBe('FALSE')
    }
  })

  it('a per-PT scope binds every predicate to its company', () => {
    const q = sqlText(requestScopeSql(fromCompanies([{ company: 2, kind: 'team', projects: [7], costCenters: [] }])))
    expect(q).toContain('er.company_id')
    expect(q).toContain('er.project_id')
  })

  it('AttScope literal without parts → SQL FALSE; narrowing never revives it', () => {
    const legacy: AttScope = { kind: 'team', projects: [1], costCenters: [2] }
    expect(sqlText(locationScopeSql(legacy, 'a'))).toBe('FALSE')
    expect(sqlText(locationScopeSql({ kind: 'all' }, 'a'))).toBe('FALSE')
    expect(narrowAttScope(legacy, 1)).toEqual({ kind: 'team', projects: [], costCenters: [], parts: [] })
  })
})

describe('MC4 item 5 — notification templates: group admin writes, PT Admin / Direktur read', () => {
  const req = (roles: Role[], groupAdmin: boolean) => ({ user: withCompanyContext({ id: 1 }, [{ company: 1, roles, employee: null }], null, groupAdmin) }) as unknown as PayloadRequest
  const access = NotificationTemplates.access!

  it('create / update: group admin only (a PT Admin is refused)', async () => {
    expect(await access.create!({ req: req(['pk-admin'], false) } as never)).toBe(false)
    expect(await access.update!({ req: req(['pk-admin'], false) } as never)).toBe(false)
    expect(await access.create!({ req: req([], true) } as never)).toBe(true)
    expect(await access.update!({ req: req(['pk-staff'], true) } as never)).toBe(true)
    expect(await access.delete!({ req: req(['pk-admin'], true) } as never)).toBe(false)
  })

  it('read: PT Admin / Direktur and the group admin; Finance / PM / Staff not', async () => {
    expect(await access.read!({ req: req(['pk-admin'], false) } as never)).toBe(true)
    expect(await access.read!({ req: req(['pk-owner'], false) } as never)).toBe(true)
    expect(await access.read!({ req: req([], true) } as never)).toBe(true)
    for (const r of ['pk-finance', 'pk-pm', 'pk-staff'] as Role[]) expect(await access.read!({ req: req([r], false) } as never), r).toBe(false)
  })
})

describe('MC4 item 1 — copy defaults: setting fields', () => {
  it('every named per-PT setting is copied except the schedule relation (copied as a row)', () => {
    const names = settingDefaults().map((s) => s.name)
    expect(names).toContain('budgetWarnPct')
    expect(names).toContain('syncAttendanceEnabled')
    expect(names).toContain('reminderRevisionDays')
    expect(names).not.toContain('defaultWorkSchedule')
    expect(new Set(names).size).toBe(names.length)
    expect(settingDefaults().find((s) => s.name === 'budgetWarnPct')!.defaultValue).toBe(85)
  })
})

describe('MC4 extra (d) — saved list columns get the PT column once (migration)', () => {
  let config: SanitizedConfig
  beforeAll(async () => {
    process.env.PK_SKIP_ENV_CHECK = 'true'
    config = await (await import('@/payload.config')).default
  })

  it('the migration names exactly the collections with a PT list column (+ collections created after it)', () => {
    // collections created after that released data migration had no saved list preferences to fix
    // (withCompanyListUi puts `company` into their defaultColumns from the start)
    const AFTER_MC4 = ['contract-units', 'service-reports', 'unit-timesheets', 'aftersales-activities', 'urgency-levels', 'rap-items', 'rap-templates', 'resource-types', 'daily-reports', 'daily-report-lines']
    const got = config.collections.filter((c) => companyFieldOf(c as unknown as CollectionConfig)).map((c) => c.slug).sort()
    expect([...LIST_COMPANY_SLUGS, ...AFTER_MC4].sort()).toEqual(got)
    for (const s of AFTER_MC4) expect(LIST_COMPANY_SLUGS as readonly string[]).not.toContain(s)
  })

  it('companies: copy-defaults fields are virtual (no column) and create-only', () => {
    const companies = config.collections.find((c) => c.slug === 'companies')!
    const flat = JSON.stringify(companies.fields, (k, v) => (typeof v === 'function' ? 'fn' : v))
    for (const name of ['copyDefaults', 'copyDefaultsFrom']) {
      const f = (companies.flattenedFields as Array<{ name: string; virtual?: unknown }>).find((x) => x.name === name)
      expect(f?.virtual, name).toBe(true)
    }
    expect(flat).toContain('copyDefaultsFrom')
  })

  it('companies: copy-defaults fields are readable by the group admin only (else hidden in the create form, MC4-02)', () => {
    const companies = config.collections.find((c) => c.slug === 'companies')!
    const req = (groupAdmin: boolean) => ({ user: withCompanyContext({ id: 1 }, [{ company: 1, roles: ['pk-admin'], employee: null }], null, groupAdmin) }) as unknown as PayloadRequest
    for (const name of ['copyDefaults', 'copyDefaultsFrom']) {
      const f = (companies.flattenedFields as Array<{ name: string; access?: { read?: (a: { req: PayloadRequest }) => boolean } }>).find((x) => x.name === name)
      expect(f?.access?.read?.({ req: req(true) }), name).toBe(true)
      expect(f?.access?.read?.({ req: req(false) }), name).toBe(false)
    }
  })

  it('companies: copy-defaults fields are editable in the create form (virtual ⇒ readOnly unless admin.readOnly: false; UAT UI-CO)', () => {
    const companies = config.collections.find((c) => c.slug === 'companies')!
    for (const name of ['copyDefaults', 'copyDefaultsFrom']) {
      const f = (companies.flattenedFields as Array<{ name: string; admin?: { readOnly?: boolean } }>).find((x) => x.name === name)
      expect(f?.admin?.readOnly, name).toBe(false)
    }
  })
})

describe('MC4 item 4 — report PDF letterhead logo', () => {
  const base = { kop: ['PT Contoh Satu', 'Jl. Contoh 1'], title: 'Rekap Kas', meta: ['Periode: 09/2026'], tables: [{ title: 'Ringkasan', columns: [{ label: 'Akun', type: 'text' as const, width: 60 }, { label: 'Saldo', type: 'money' as const, width: 40 }], rows: [['Kas', '1.000']] }], notes: [] }

  it('with a logo → one embedded image; without → text only; the kop text stays', async () => {
    const withLogo = await renderReportPdf({ ...base, logo: { data: await signatureImage(3), format: 'png' } })
    const without = await renderReportPdf({ ...base, logo: null })
    expect(withLogo.toString('latin1')).toMatch(/\/Subtype\s*\/Image/)
    expect(without.toString('latin1')).not.toMatch(/\/Subtype\s*\/Image/)
    expect(pdfFlatText(withLogo)).toContain('PT Contoh Satu')
    expect(pdfFlatText(without)).toContain('PT Contoh Satu')
  }, 30_000)
})
