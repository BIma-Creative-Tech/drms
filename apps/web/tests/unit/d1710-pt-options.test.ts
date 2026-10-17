import type { PayloadRequest, SanitizedConfig } from 'payload'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { withCompanyContext, type Role } from '@/access/roles'
import { lineMasterOptions, LINE_PICK_COMPANY_FIRST } from '@/admin/components/lines/line-form'
import { sameCompanyAsProject } from '@/collections/ContractUnits'
import {
  andCompany,
  COMPANY_LOCKED_FIELD,
  formCompanyOptions,
  formOrSoleCompany,
  lockedUntilCompany,
  parentCompanyOptions,
  pickerSameCompany,
  sameCompanyOptions,
  siteOptions,
} from '@/fields/company'
import { codeFrom, ptLabel, ptOptions, spansSeveralPts } from '@/lib/pt-options'

/**
 * DRMS UI feedback 17/10 #4 — "duplicate" options for multi-PT users: per-PT masters carry the same name in every PT.
 * (a) narrow to the form's PT, (b) `[CS1]` tag while a list spans several PTs, (c) unique ids. Pure helper + the
 * Payload picker filters + the locked-picker field component (SSR, mocked Payload UI).
 */

const ui = vi.hoisted(() => ({ company: null as number | null, employee: null as number | null }))
vi.mock('@payloadcms/ui', () => ({
  RelationshipField: (p: { field: { name: string; admin?: { placeholder?: string } }; readOnly?: boolean }) =>
    createElement('div', { 'data-picker': p.field.name, 'data-ro': p.readOnly ? '1' : '0', 'data-placeholder': p.field.admin?.placeholder ?? '' }),
  useFormFields: (sel: (a: [Record<string, { value: unknown }>]) => unknown) => sel([{ company: { value: ui.company }, employee: { value: ui.employee } }]),
}))

let config: SanitizedConfig
beforeAll(async () => {
  process.env.PK_SKIP_ENV_CHECK = 'true'
  config = await (await import('@/payload.config')).default
})

/** PT 1: Admin, PT 2: Admin; `selection` = PT switcher (null = all). */
const user = (selection: number[] | null) =>
  withCompanyContext(
    { id: 1 },
    [
      { company: 1, roles: ['pk-admin'] as Role[], employee: null },
      { company: 2, roles: ['pk-admin'] as Role[], employee: null },
    ],
    selection,
    false,
  )
const FORM = { active: true } // a create form always carries defaults; the list view filter passes {}
const code = codeFrom({ 1: 'DRMS', 2: 'CS1' })

describe('lib/pt-options: one rule for every option list', () => {
  const material = [
    { id: 11, label: 'Material', companyId: 1 },
    { id: 21, label: 'Material', companyId: 2 },
    { id: 22, label: 'Upah', companyId: 2 },
    { id: 21, label: 'Material', companyId: 2 }, // duplicate row (e.g. a merged list)
  ]

  it('ptLabel / codeFrom / spansSeveralPts', () => {
    expect(ptLabel('CS1', 'Material')).toBe('[CS1] Material')
    expect(code(2)).toBe('CS1')
    expect(code(9)).toBe('#9')
    expect(spansSeveralPts(material)).toBe(true)
    expect(spansSeveralPts([{ companyId: 2 }, { companyId: 2 }, { companyId: null }])).toBe(false)
  })

  it('(a) the form PT known → only its options, no tag; (c) ids unique', () => {
    expect(ptOptions(material, { code, company: 2 })).toEqual([
      { id: 21, label: 'Material', companyId: 2 },
      { id: 22, label: 'Upah', companyId: 2 },
    ])
    expect(ptOptions(material, { code, company: 2, multi: true }).map((o) => o.label)).toEqual(['Material', 'Upah'])
  })

  it('(b) several PTs listed → `[CS1] Material`; one PT → plain labels; `multi` decides when given', () => {
    expect(ptOptions(material, { code }).map((o) => o.label)).toEqual(['[DRMS] Material', '[CS1] Material', '[CS1] Upah'])
    expect(ptOptions(material.slice(1), { code }).map((o) => o.label)).toEqual(['Material', 'Upah'])
    expect(ptOptions(material, { code, multi: false }).map((o) => o.label)).toEqual(['Material', 'Material', 'Upah'])
    expect(ptOptions(material.slice(1), { code, multi: true }).map((o) => o.label)).toEqual(['[CS1] Material', '[CS1] Upah'])
    // options without a PT are never tagged; the input list is not mutated
    expect(ptOptions([{ id: 'x', label: 'Tanpa PT', companyId: null }, ...material], { code })[0]).toEqual({ id: 'x', label: 'Tanpa PT', companyId: null })
    expect(material[0]!.label).toBe('Material')
  })

  it('line dialog (LinesTableField): Kategori / Kendaraan of the request PT only; none before a PT', () => {
    expect(lineMasterOptions(material, 1)).toEqual([{ id: 11, label: 'Material', companyId: 1 }])
    expect(lineMasterOptions(material, 2).map((o) => o.id)).toEqual([21, 22])
    expect(lineMasterOptions(material, null)).toEqual([])
    expect(LINE_PICK_COMPANY_FIRST).toBe('Pilih PT terlebih dahulu')
  })
})

describe('Payload pickers: no every-PT list before the PT is known', () => {
  it('formCompanyOptions: chosen PT, else the only selected PT, else nothing; list filter + system calls unchanged', () => {
    expect(formCompanyOptions({ data: { ...FORM, company: 2 }, user: user(null) })).toEqual({ company: { equals: 2 } })
    expect(formCompanyOptions({ data: FORM, user: user([1]) })).toEqual({ company: { equals: 1 } })
    expect(formCompanyOptions({ data: FORM, user: user(null) })).toBe(false)
    expect(formCompanyOptions({ data: {}, user: user(null) })).toBe(true)
    expect(formCompanyOptions({ data: FORM })).toBe(true) // seed / job: not a picker
    expect(formOrSoleCompany({ company: { id: 2 } }, user(null))).toBe(2)
    expect(formOrSoleCompany({}, user(null))).toBeUndefined()
  })

  it('pickerSameCompany modes: default = form PT, decidesCompany = old behaviour, parent = async parent lookup', () => {
    expect(pickerSameCompany().filterOptions).toBe(formCompanyOptions)
    expect(pickerSameCompany({ decidesCompany: true }).filterOptions).toBe(sameCompanyOptions)
    expect(typeof pickerSameCompany({ parent: { field: 'employee', collection: 'employees' } }).filterOptions).toBe('function')
    expect(pickerSameCompany({ required: true }).validate(null)).toBe('Wajib diisi.')
  })

  it('andCompany / siteOptions: the fixed condition AND the form PT', () => {
    const op = andCompany({ type: { equals: 'operational' } })
    expect(op({ data: { ...FORM, company: 2 }, user: user(null) })).toEqual({ and: [{ company: { equals: 2 } }, { type: { equals: 'operational' } }] })
    expect(op({ data: FORM, user: user(null) })).toBe(false)
    expect(op({ data: {}, user: user(null) })).toEqual({ type: { equals: 'operational' } })
    expect(siteOptions({ data: FORM, user: user([2]) })).toEqual({ and: [{ company: { equals: 2 } }, { active: { not_equals: false } }] })
  })

  it('parentCompanyOptions: the PT of the parent picked in the form (caller access), else stored / sole PT, else nothing', async () => {
    const calls: unknown[] = []
    const req = {
      user: user(null),
      payload: {
        find: async (args: { where: { id: { equals: number } }; overrideAccess: boolean }) => {
          calls.push(args)
          return { docs: args.where.id.equals === 7 ? [{ id: 7, company: 2 }] : [] }
        },
      },
    } as unknown as PayloadRequest
    const f = parentCompanyOptions({ field: 'employee', collection: 'employees' })
    expect(await f({ data: { ...FORM, employee: 7 }, user: req.user, req })).toEqual({ company: { equals: 2 } })
    expect(calls[0]).toMatchObject({ collection: 'employees', overrideAccess: false })
    expect(await f({ data: { ...FORM, employee: { value: 7, relationTo: 'employees' } }, user: req.user, req })).toEqual({ company: { equals: 2 } })
    expect(await f({ data: FORM, user: req.user, req })).toBe(false) // no employee yet, two PTs selected
    expect(await f({ data: { ...FORM, employee: 99, company: 1 }, user: req.user, req })).toEqual({ company: { equals: 1 } }) // stored document
    expect(await f({ data: FORM, user: user([1]), req: { ...req, user: user([1]) } as never })).toEqual({ company: { equals: 1 } })
    expect(await f({ data: {}, user: req.user, req })).toBe(true)
    expect(await f({ data: FORM, req: { payload: req.payload } as never })).toBe(true) // system write: never rejected
  })

  it('contract units: own units of the chosen project PT (sameCompanyAsProject)', async () => {
    const req = { user: user(null), payload: { find: async () => ({ docs: [{ id: 5, company: 1 }] }) } } as unknown as PayloadRequest
    expect(await sameCompanyAsProject({ data: { project: 5 }, user: req.user, req })).toEqual({ and: [{ company: { equals: 1 } }, { owner: { equals: 'sendiri' } }] })
    expect(await sameCompanyAsProject({ data: { notes: '' }, user: req.user, req })).toBe(false)
  })

  it('collections: the per-PT pickers of the plan are scoped and wait for the PT (or their parent)', () => {
    type F = { name?: string; filterOptions?: unknown; custom?: Record<string, unknown>; admin?: { components?: { Field?: unknown } } }
    const field = (slug: string, name: string) => config.collections.find((c) => c.slug === slug)!.flattenedFields.find((x) => x.name === name) as F
    const locked = [
      ['vehicles', 'costCenter'],
      ['vehicles', 'project'],
      ['approval-rules', 'category'],
      ['approval-rules', 'project'],
      ['approval-rules', 'costCenter'],
      ['projects', 'site'],
      ['projects', 'costCenter'],
      ['sites', 'defaultWorkSchedule'],
      ['sites', 'costCenter'],
      ['employees', 'workSchedule'],
      ['employees', 'homeSite'],
      ['cash-accounts', 'site'],
    ] as const
    for (const [slug, name] of locked) {
      const f = field(slug, name)
      expect(f.admin?.components?.Field, `${slug}.${name}`).toBe(COMPANY_LOCKED_FIELD)
      expect(typeof f.filterOptions, `${slug}.${name}`).toBe('function')
      expect((f.filterOptions as (a: unknown) => unknown)({ data: FORM, user: user(null) }), `${slug}.${name}`).toBe(false)
    }
    expect(field('vehicles', 'project').filterOptions).toBe(formCompanyOptions)
    for (const name of ['project', 'costCenter', 'site']) expect(field('team-assignments', name).custom, name).toMatchObject({ pkWaitFor: 'employee', pkWaitLabel: 'karyawan' })
    expect(field('budget-lines', 'category').custom).toMatchObject({ pkWaitFor: 'project' })
    expect(field('contract-units', 'unit').filterOptions).toBe(sameCompanyAsProject)
    expect(field('contract-units', 'unit').custom).toMatchObject({ pkWaitFor: 'project' })
    // the parent pickers of derived forms keep every readable row until the document has a PT
    for (const [slug, name] of [['team-assignments', 'employee'], ['employee-bank-accounts', 'employee'], ['vendor-bank-accounts', 'vendor'], ['project-stages', 'project'], ['budget-lines', 'project']] as const) {
      expect(field(slug, name).filterOptions, `${slug}.${name}`).toBe(sameCompanyOptions)
    }
    // Klien / Pelanggan (drawer "+"): the form PT's clients only
    expect(field('projects', 'client').filterOptions).toBe(formCompanyOptions)
    expect(typeof field('receipts', 'vendor').filterOptions).toBe('function')
  })

  it('lockedUntilCompany keeps the field and its admin options', () => {
    const f = lockedUntilCompany({ name: 'x', type: 'relationship', relationTo: 'projects', admin: { placeholder: 'Pilih…' } }, { field: 'employee', label: 'karyawan' })
    expect(f).toMatchObject({ name: 'x', admin: { placeholder: 'Pilih…', components: { Field: COMPANY_LOCKED_FIELD } }, custom: { pkWaitFor: 'employee', pkWaitLabel: 'karyawan' } })
  })
})

describe('CompanyLockedField (SSR, mocked Payload UI)', () => {
  async function render(selection: number[] | null, custom?: Record<string, unknown>) {
    const { CompanyLockedField } = await import('@/admin/components/companies/CompanyLockedField')
    const props = { field: { name: 'project', custom }, clientField: { name: 'project', type: 'relationship', admin: {} }, path: 'project', req: { user: user(selection) } }
    return renderToString(createElement(CompanyLockedField as never, props))
  }

  it('several PTs, none chosen: read-only picker with "Pilih PT terlebih dahulu"', async () => {
    Object.assign(ui, { company: null, employee: null })
    const html = await render(null)
    expect(html).toContain('data-pk-needs-company="project"')
    expect(html).toContain('data-ro="1"')
    expect(html).toContain('Pilih PT terlebih dahulu…')
  })

  it('PT chosen → the normal picker; one selected PT → never locked', async () => {
    Object.assign(ui, { company: 2 })
    expect(await render(null)).not.toContain('data-pk-needs-company')
    Object.assign(ui, { company: null })
    expect(await render([1])).not.toContain('data-pk-needs-company')
  })

  it('derived form: waits for the parent ("Pilih karyawan terlebih dahulu")', async () => {
    Object.assign(ui, { company: null, employee: null })
    const html = await render(null, { pkWaitFor: 'employee', pkWaitLabel: 'karyawan' })
    expect(html).toContain('data-pk-wait-for="employee"')
    expect(html).toContain('Pilih karyawan terlebih dahulu…')
    Object.assign(ui, { employee: 4 })
    expect(await render(null, { pkWaitFor: 'employee', pkWaitLabel: 'karyawan' })).not.toContain('data-pk-needs-company')
  })
})
