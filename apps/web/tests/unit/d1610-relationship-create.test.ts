import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { SanitizedConfig } from 'payload'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { PARTNER_REDIRECT_VIEW, PARTNER_REDIRECT_VIEWS, partnerRedirectTarget } from '@/admin/partner-routes'
import {
  CREATABLE_RELATIONSHIP_FIELD,
  CREATE_TARGETS,
  creatableRelationship,
  createButtonState,
  createTargetOf,
  drawerInitialData,
  NEEDS_COMPANY_TEXT,
  relationId,
  valueWithCreated,
} from '@/admin/relationship-create'
import { QUICK_CREATE_DEFS } from '@/admin/shell/quick-create'

/**
 * DRMS 16/10 (owner 2026-10-16, "konsep no. 1" part b): "+ <Klien|Vendor|Karyawan> baru" beside relationship pickers
 * (side drawer, the parent form's PT, the new id put into the picker), the "+ Buat" items to the tabbed Klien / Vendor
 * pages and the redirect of Payload's client / vendor document pages to them.
 */
const src = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8')

// --- component mocks (SSR of the field) ---------------------------------------------------------------------------
const ui = vi.hoisted(() => ({
  create: true as unknown,
  company: null as number | null,
  value: null as unknown,
}))
vi.mock('@payloadcms/ui', () => ({
  RelationshipField: (p: { field: { name: string }; readOnly?: boolean }) => createElement('div', { 'data-picker': p.field.name, 'data-ro': p.readOnly ? '1' : '0' }),
  Drawer: ({ children, slug }: { children?: unknown; slug: string }) => createElement('div', { 'data-drawer': slug }, children as never),
  useAuth: () => ({ permissions: { collections: { clients: { create: ui.create }, vendors: { create: ui.create }, employees: { create: ui.create } } } }),
  useField: () => ({ value: ui.value, setValue: () => undefined }),
  useFormFields: (sel: (a: [Record<string, { value: unknown }>]) => unknown) => sel([{ company: { value: ui.company } }]),
  useModal: () => ({ openModal: () => undefined, closeModal: () => undefined, isModalOpen: () => false }),
  useDrawerSlug: (s: string) => `${s}-1`,
  useDocumentDrawer: () => [() => createElement('div', { 'data-doc-drawer': '1' }), () => null, { openDrawer: () => undefined, closeDrawer: () => undefined }],
}))
vi.mock('@/admin/components/partners/PartnerForm', () => ({ PartnerFormLoader: () => createElement('div', { 'data-partner-form': '1' }) }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  },
  useRouter: () => ({}),
}))

let config: SanitizedConfig
beforeAll(async () => {
  process.env.PK_SKIP_ENV_CHECK = 'true'
  config = await (await import('@/payload.config')).default
})

type FieldLike = { name?: string; type?: string; relationTo?: unknown; hasMany?: boolean; admin?: { allowCreate?: boolean; components?: { Field?: unknown } }; fields?: FieldLike[]; tabs?: Array<{ fields: FieldLike[] }> }
function walk(fields: FieldLike[], out: FieldLike[] = []): FieldLike[] {
  for (const f of fields) {
    out.push(f)
    if (f.fields) walk(f.fields, out)
    if (f.tabs) for (const t of f.tabs) walk(t.fields, out)
  }
  return out
}
const creatableIn = () =>
  config.collections.flatMap((c) =>
    walk(c.fields as FieldLike[])
      .filter((f) => (f.admin?.components?.Field as { path?: string } | undefined)?.path === CREATABLE_RELATIONSHIP_FIELD)
      .map((f) => ({ at: `${c.slug}.${f.name}`, f, opts: (f.admin!.components!.Field as { clientProps: { pkCreate: unknown } }).clientProps.pkCreate })),
  )

describe('which pickers get the drawer "+"', () => {
  it('the owner list + Kendaraan › Pelanggan, each with the PT rule of its form', () => {
    const got = Object.fromEntries(creatableIn().map((x) => [x.at, x.opts]))
    expect(got).toEqual({
      'projects.client': { company: 'form' },
      'expense-requests.vendor': { company: 'form', lock: true },
      'expense-requests.requesters': { company: 'form', lock: true },
      'vendor-bank-accounts.vendor': { company: 'record' },
      'team-assignments.employee': { company: 'record' },
      'employee-bank-accounts.employee': { company: 'record' },
      'vehicles.client': { company: 'form' },
    })
  })

  it("Payload's own \"+\" is off on them (no PT carried over); targets are known collections", () => {
    const slugs = new Set(config.collections.map((c) => c.slug))
    for (const { at, f } of creatableIn()) {
      expect(f.admin?.allowCreate, at).toBe(false)
      expect(createTargetOf(f.relationTo), at).not.toBeNull()
    }
    for (const t of Object.values(CREATE_TARGETS)) expect(slugs.has(t.slug)).toBe(true)
  })

  it('`form` pickers sit in a form whose PT is chosen there; `record` pickers in a form whose PT follows the picker', () => {
    for (const { at, opts } of creatableIn()) {
      const coll = config.collections.find((c) => c.slug === at.split('.')[0])!
      const company = coll.fields.find((x) => 'name' in x && x.name === 'company') as { access?: { create?: () => boolean } } | undefined
      const derived = company?.access?.create?.() === false
      expect(derived, at).toBe((opts as { company: string }).company === 'record')
    }
  })

  it('Klien / Vendor → the tabbed partner form; Karyawan → the plain employee form (its user link creates no account)', () => {
    expect(CREATE_TARGETS.clients).toMatchObject({ drawer: 'partner', partnerKind: 'client' })
    expect(CREATE_TARGETS.vendors).toMatchObject({ drawer: 'partner', partnerKind: 'vendor' })
    expect(CREATE_TARGETS.employees).toMatchObject({ drawer: 'document' })
    const employees = config.collections.find((c) => c.slug === 'employees')!
    const user = walk(employees.fields as FieldLike[]).find((f) => f.type === 'relationship' && f.relationTo === 'users')
    expect(user?.admin?.allowCreate).toBe(false)
  })

  it('creatableRelationship keeps the other admin options and refuses an unknown target', () => {
    const f = creatableRelationship({ name: 'client', type: 'relationship', relationTo: 'clients', admin: { placeholder: 'Pilih…', description: 'd' } }, { company: 'form' })
    expect(f.admin).toMatchObject({ placeholder: 'Pilih…', description: 'd', allowCreate: false, components: { Field: { path: CREATABLE_RELATIONSHIP_FIELD, clientProps: { pkCreate: { company: 'form' } } } } })
    expect(() => creatableRelationship({ name: 'x', type: 'relationship', relationTo: 'banks' }, { company: 'form' })).toThrow()
    expect(() => creatableRelationship({ name: 'x', type: 'relationship', relationTo: ['clients', 'vendors'] }, { company: 'form' })).toThrow()
  })

  it('the import map resolves the field and the redirect view', () => {
    const map = src('src/app/(payload)/admin/importMap.js')
    expect(map).toContain(`"${CREATABLE_RELATIONSHIP_FIELD}"`)
    expect(map).toContain(`"${PARTNER_REDIRECT_VIEW}"`)
  })
})

describe('the "+" state and the value after a save', () => {
  it('hidden without the create permission or read-only; waits for the PT in `form` mode', () => {
    expect(createButtonState({ canCreate: false, readOnly: false, mode: 'form', company: 1 })).toBe('hidden')
    expect(createButtonState({ canCreate: true, readOnly: true, mode: 'form', company: 1 })).toBe('hidden')
    expect(createButtonState({ canCreate: true, readOnly: false, mode: 'form', company: null })).toBe('needs-company')
    expect(createButtonState({ canCreate: true, readOnly: false, mode: 'form', company: 2 })).toBe('ready')
    expect(createButtonState({ canCreate: true, readOnly: false, mode: 'record', company: null })).toBe('ready')
  })

  it('single picker gets the new id; hasMany appends it once', () => {
    expect(valueWithCreated(3, 9, false)).toBe(9)
    expect(valueWithCreated(null, 9, true)).toEqual([9])
    expect(valueWithCreated([1, 2], 9, true)).toEqual([1, 2, 9])
    expect(valueWithCreated([1, 9], 9, true)).toEqual([1, 9])
    expect(valueWithCreated([{ value: 9, relationTo: 'employees' }], 9, true)).toHaveLength(1)
  })

  it('drawer start data: the form PT in `form` mode only; relation ids of every shape', () => {
    expect(drawerInitialData('form', 4)).toEqual({ company: 4 })
    expect(drawerInitialData('form', null)).toBeUndefined()
    expect(drawerInitialData('record', 4)).toBeUndefined()
    expect([relationId(5), relationId('6'), relationId({ value: 7 }), relationId({ id: 8 }), relationId('x'), relationId(null)]).toEqual([5, 6, 7, 8, null, null])
  })

  it('"Pilih PT terlebih dahulu" is the wording of the locked pickers', () => {
    expect(src('src/admin/components/companies/CompanyScopedField.tsx')).toContain(`PICK_COMPANY_FIRST = '${NEEDS_COMPANY_TEXT}'`)
  })
})

describe('CreatableRelationshipField (SSR, mocked Payload UI)', () => {
  async function render(field: { name: string; relationTo: string; hasMany?: boolean }, pkCreate: unknown, readOnly = false) {
    const { CreatableRelationshipField } = await import('@/admin/components/relationship/CreatableRelationshipField')
    return renderToString(createElement(CreatableRelationshipField as never, { field: { ...field, type: 'relationship' }, path: field.name, readOnly, pkCreate }))
  }

  it('ready: picker + "+ Klien baru" + the partner drawer (form mounted only when open)', async () => {
    Object.assign(ui, { create: true, company: 1 })
    const html = await render({ name: 'client', relationTo: 'clients' }, { company: 'form' })
    expect(html).toContain('data-picker="client"')
    expect(html).toMatch(/<button[^>]*data-pk-relcreate-btn="ready"/)
    expect(html).toContain('Klien baru')
    expect(html).toContain('data-drawer="pk-create-client-1"')
    expect(html).not.toContain('data-partner-form')
    expect(html).not.toContain('disabled')
  })

  it('no PT in the form yet: disabled "+" with "Pilih PT terlebih dahulu"', async () => {
    Object.assign(ui, { create: true, company: null })
    const html = await render({ name: 'vendor', relationTo: 'vendors' }, { company: 'form', lock: true })
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="[^"]+"|<button[^>]*aria-describedby="[^"]+"[^>]*disabled=""/)
    expect(html).toContain(NEEDS_COMPANY_TEXT)
    // `lock`: the CompanyScopedField picker (read-only until the PT is known)
    expect(html).toContain('data-pk-needs-company="vendor"')
  })

  it('no create permission or read-only: the plain picker only', async () => {
    Object.assign(ui, { create: undefined, company: 1 })
    expect(await render({ name: 'employee', relationTo: 'employees' }, { company: 'record' })).not.toContain('data-pk-relcreate')
    Object.assign(ui, { create: { permission: true } })
    expect(await render({ name: 'employee', relationTo: 'employees' }, { company: 'record' }, true)).not.toContain('data-pk-relcreate')
  })

  it('Karyawan: Payload document drawer, ready without a form PT (`record`)', async () => {
    Object.assign(ui, { create: true, company: null })
    const html = await render({ name: 'requesters', relationTo: 'employees', hasMany: true }, { company: 'record' })
    expect(html).toContain('Karyawan baru')
    expect(html).toContain('data-doc-drawer')
    expect(html).not.toContain('data-drawer=')
  })
})

describe('"+ Buat" and Payload document pages → the tabbed Klien / Vendor pages', () => {
  it('quick-create items', () => {
    expect(QUICK_CREATE_DEFS.find((d) => d.key === 'klien')!.href).toBe('/admin/klien/baru')
    expect(QUICK_CREATE_DEFS.find((d) => d.key === 'vendor')!.href).toBe('/admin/vendor/baru')
  })

  it('redirect targets: create → baru, id → id; other routes untouched', () => {
    expect(partnerRedirectTarget(['collections', 'clients', 'create'])).toBe('/admin/klien/baru')
    expect(partnerRedirectTarget(['collections', 'clients', '12'])).toBe('/admin/klien/12')
    expect(partnerRedirectTarget(['collections', 'vendors', 'create'])).toBe('/admin/vendor/baru')
    expect(partnerRedirectTarget(['collections', 'vendors', '7'], '/panel')).toBe('/panel/vendor/7')
    expect(partnerRedirectTarget(['collections', 'vendors'])).toBeNull()
    expect(partnerRedirectTarget(['collections', 'vendors', '7', 'versions'])).toBeNull()
    expect(partnerRedirectTarget(['collections', 'projects', '7'])).toBeNull()
    expect(partnerRedirectTarget(['globals', 'clients', '7'])).toBeNull()
  })

  it('Clients / Vendors register the page-level view (path /:id, exact) — the edit view of the drawer stays Payload\'s', () => {
    for (const slug of ['clients', 'vendors']) {
      const c = config.collections.find((x) => x.slug === slug)!
      const views = c.admin.components?.views as Record<string, unknown>
      expect(views.partnerPage, slug).toEqual(PARTNER_REDIRECT_VIEWS.partnerPage)
      expect((views.edit as { default?: unknown } | undefined)?.default, slug).toBeUndefined()
      expect((views.list as { Component?: unknown }).Component, slug).toBe('@/admin/pk-list/PkListView#PkListView')
    }
  })

  it('the view redirects with the configured admin route', async () => {
    const { PartnerRedirect } = await import('@/admin/views/PartnerRedirect')
    const props = (segments: string[]) => ({ params: { segments }, initPageResult: { req: { payload: { config: { routes: { admin: '/admin' } } } } } }) as never
    expect(() => PartnerRedirect(props(['collections', 'clients', 'create']))).toThrow('NEXT_REDIRECT /admin/klien/baru')
    expect(() => PartnerRedirect(props(['collections', 'vendors', '42']))).toThrow('NEXT_REDIRECT /admin/vendor/42')
  })
})
