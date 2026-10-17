import type { SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { withCompanyContext, type Role } from '@/access/roles'
import { opensRow } from '@/admin/components/list/ClickableRow'
import { bankAccountOptions, REQUEST_CREATE_ROLES, requesterOptions } from '@/collections/ExpenseRequests'
import { companyField, companyScopedOptions, creatableCompanies, formCompany, formCompanyOptions, isListFilter, pickerSameCompany, sameCompanyOptions } from '@/fields/company'
import { TIMELINE_STATE_LABELS } from '@/domain/expense/approval-timeline'

/** DRMS 13/10 Wave 1: expense-request form PT scoping (Pengajuan #1–#3, #5) and approval-page cleanups (Persetujuan). */

let config: SanitizedConfig
beforeAll(async () => {
  process.env.PK_SKIP_ENV_CHECK = 'true'
  config = await (await import('@/payload.config')).default
})

/** PT 1: Staff, PT 2: PM, PT 3: Operator only (no create role); `selection` = PT switcher (null = all). */
const user = (selection: number[] | null) =>
  withCompanyContext(
    { id: 1 },
    [
      { company: 1, roles: ['pk-staff'] as Role[], employee: 11 },
      { company: 2, roles: ['pk-pm'] as Role[], employee: 22 },
      { company: 3, roles: ['pk-operator'] as Role[], employee: 33 },
    ],
    selection,
    false,
  )
const FORM = { status: 'draft' } // a create form always carries defaults; the list view filter passes {}

describe('Pengajuan #1/#2: PT picker = PT switcher selection ∩ create roles', () => {
  it('creatableCompanies / formCompany', () => {
    expect(creatableCompanies(user(null), REQUEST_CREATE_ROLES)).toEqual([1, 2])
    expect(creatableCompanies(user([2, 3]), REQUEST_CREATE_ROLES)).toEqual([2])
    expect(creatableCompanies(user([3]), REQUEST_CREATE_ROLES)).toEqual([])
    expect(formCompany({ company: 5 }, user(null), REQUEST_CREATE_ROLES)).toBe(5) // chosen PT wins
    expect(formCompany(FORM, user(null), REQUEST_CREATE_ROLES)).toBeUndefined() // two PTs: must choose
    expect(formCompany(FORM, user([2, 3]), REQUEST_CREATE_ROLES)).toBe(2) // the only one (prefilled)
    expect(formCompany(FORM, user([2]))).toBeUndefined() // without roles: only the chosen PT
    expect(isListFilter({})).toBe(true)
    expect(isListFilter(FORM)).toBe(false)
    expect(isListFilter(undefined)).toBe(false)
  })

  it('expense-requests.company: picker options, read-only prefill marker, no save-time filterOptions check', async () => {
    const f = config.collections.find((c) => c.slug === 'expense-requests')!.fields.find((x) => 'name' in x && x.name === 'company') as {
      filterOptions: (a: unknown) => unknown
      validate: (v: unknown, o: unknown) => unknown
      custom?: { pkCreateRoles?: unknown }
    }
    expect(f.custom?.pkCreateRoles).toEqual(REQUEST_CREATE_ROLES)
    expect(f.filterOptions({ data: FORM, user: user(null) })).toEqual({ id: { in: [1, 2] } })
    expect(f.filterOptions({ data: FORM, user: user([3]) })).toBe(false)
    expect(f.filterOptions({ data: {}, user: user([3]) })).toBe(true) // list view filter unchanged
    // a PT outside the switcher selection is not rejected by the picker filter (company hook: role in that PT)
    const req = { payload: { collections: {}, db: { defaultIDType: 'number' } }, t: (k: string) => k, user: user([2]) }
    expect(await f.validate(1, { req, relationTo: 'companies', data: FORM, filterOptions: f.filterOptions })).toBe(true)
  })

  it('expense-requests.company: the only creatable PT is the default (initial form state, not a client effect)', () => {
    const f = config.collections.find((c) => c.slug === 'expense-requests')!.fields.find((x) => 'name' in x && x.name === 'company') as {
      defaultValue: (a: { user?: unknown }) => unknown
    }
    expect(f.defaultValue({ user: user([2, 3]) })).toBe(2) // one creatable PT → prefilled
    expect(f.defaultValue({ user: user([1]) })).toBe(1)
    expect(f.defaultValue({ user: user(null) })).toBeUndefined() // two PTs: must choose
    expect(f.defaultValue({ user: user([3]) })).toBeUndefined() // no create role
    expect(f.defaultValue({ user: undefined })).toBeUndefined() // system write: company hook decides
  })

  it('other forms keep the plain picker (opt-in only)', () => {
    const plain = companyField() as { filterOptions?: unknown; custom?: unknown }
    expect(plain.filterOptions).toBeUndefined()
    expect(plain.custom).toBeUndefined()
    expect((plain as { defaultValue?: unknown }).defaultValue).toBeUndefined()
    expect(companyField({ derived: true, createRoles: REQUEST_CREATE_ROLES }).filterOptions).toBeUndefined()
  })
})

describe('Pengajuan #3/#5: dependent pickers are empty until the PT is known', () => {
  it('companyScopedOptions: chosen PT, the only creatable PT, else nothing; list filter unchanged', () => {
    const opts = companyScopedOptions(REQUEST_CREATE_ROLES)
    expect(opts({ data: { ...FORM, company: 2 }, user: user(null) })).toEqual({ company: { equals: 2 } })
    expect(opts({ data: FORM, user: user(null) })).toBe(false) // urgency levels of every PT no longer listed
    expect(opts({ data: FORM, user: user([1]) })).toEqual({ company: { equals: 1 } }) // Staff with one PT: prefilled
    expect(opts({ data: {}, user: user(null) })).toBe(true)
    // the parent picker of a derived-PT form (team assignments → employee) keeps every readable row until a PT exists;
    // DRMS UI 17/10 #4: the default of a chosen-PT master form now waits for the PT too (formCompanyOptions)
    expect(sameCompanyOptions({ data: FORM })).toBe(true)
    expect(pickerSameCompany({ decidesCompany: true }).filterOptions).toBe(sameCompanyOptions)
    expect(pickerSameCompany().filterOptions).toBe(formCompanyOptions)
  })

  it('expense-requests: project + urgency use the scoped filter and the "Pilih PT terlebih dahulu" field', () => {
    const fields = config.collections.find((c) => c.slug === 'expense-requests')!.flattenedFields
    for (const name of ['project', 'urgencyLevel', 'requesters', 'bankAccount']) {
      const f = fields.find((x) => x.name === name) as { filterOptions: (a: unknown) => unknown; admin?: { components?: { Field?: unknown } } }
      // DRMS 16/10 (b): Pemohon = the "+ Karyawan baru" wrapper, which renders CompanyScopedField (`lock`)
      if (name === 'requesters') expect(f.admin?.components?.Field, name).toEqual({ path: '@/admin/components/relationship/CreatableRelationshipField#CreatableRelationshipField', clientProps: { pkCreate: { company: 'form', lock: true } } })
      else expect(f.admin?.components?.Field, name).toBe('@/admin/components/companies/CompanyScopedField#CompanyScopedField')
      expect(f.filterOptions({ data: FORM, user: user(null) }), name).toBe(false)
    }
    const urgency = fields.find((x) => x.name === 'urgencyLevel') as { filterOptions: (a: unknown) => unknown }
    expect(urgency.filterOptions({ data: { ...FORM, company: 1 }, user: user(null) })).toEqual({ company: { equals: 1 } })
  })

  it('requesterOptions / bankAccountOptions wait for the PT', () => {
    expect(requesterOptions({ data: FORM, user: user(null) as never })).toBe(false)
    // Staff in its only selected PT: own employee, PT prefilled
    expect(requesterOptions({ data: FORM, user: user([1]) as never })).toEqual({ and: [{ company: { equals: 1 } }, { id: { in: [11] } }] })
    expect(requesterOptions({ data: { ...FORM, company: 2 }, user: user(null) as never })).toEqual({ company: { equals: 2 } })
    expect(bankAccountOptions({ data: FORM, user: user(null) as never })).toBe(false)
    expect(bankAccountOptions({ data: FORM, user: user([1]) as never })).toEqual({ and: [{ employee: { in: [11] } }, { active: { not_equals: false } }] })
    expect(bankAccountOptions({ data: { ...FORM, company: 2, requesters: [5] }, user: user(null) as never })).toEqual({ and: [{ employee: { in: [5] } }, { active: { not_equals: false } }] })
  })
})

describe('Persetujuan #1: the inbox row opens the request; inner controls keep working', () => {
  /** Minimal DOM stand-in: a node chain with tag names (closest / contains). */
  type N = { tag: string; parent: N | null; attrs?: Record<string, string> }
  const el = (n: N) =>
    ({
      closest(sel: string) {
        const tags = sel.split(',').map((s) => s.trim())
        for (let c: N | null = n; c; c = c.parent) {
          if (tags.includes(c.tag) || (c.attrs && tags.some((t) => t.startsWith('[') && t.slice(1, -1).split('=')[0]! in c.attrs!))) return el(c)
        }
        return null
      },
      contains(other: { node: N }) {
        for (let c: N | null = other.node; c; c = c.parent) if (c === n) return true
        return false
      },
      node: n,
    }) as unknown as Element & { node: N }
  const tr: N = { tag: 'tr', parent: null }
  const td: N = { tag: 'td', parent: tr }
  const text: N = { tag: 'div', parent: td }
  const button: N = { tag: 'button', parent: td }
  const link: N = { tag: 'a', parent: td }
  const portal: N = { tag: 'button', parent: { tag: 'dialog', parent: null } }
  it('cell text opens; buttons, links and portalled dialogs do not', () => {
    expect(opensRow(el(text), el(tr))).toBe(true)
    expect(opensRow(el(td), el(tr))).toBe(true)
    expect(opensRow(el(button), el(tr))).toBe(false)
    expect(opensRow(el(link), el(tr))).toBe(false)
    expect(opensRow(el(portal), el(tr))).toBe(false)
    expect(opensRow(null, el(tr))).toBe(false)
  })
})

describe('Persetujuan #9: no "Giliran" in the approval UI', () => {
  it('timeline state label', () => {
    expect(TIMELINE_STATE_LABELS.current).toBe('Saat ini')
    expect(Object.values(TIMELINE_STATE_LABELS).join(' ')).not.toMatch(/Giliran/)
  })
})
