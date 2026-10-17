import { randomUUID } from 'node:crypto'

import React, { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createLocalReq, type AdminViewServerProps } from 'payload'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@payloadcms/next/templates', () => ({ DefaultTemplate: ({ children }: { children: ReactNode }) => children }))
vi.mock('@payloadcms/ui', () => ({ Gutter: ({ children }: { children: ReactNode }) => React.createElement('div', { 'data-gutter': '' }, children) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }), usePathname: () => '/admin' }))

import { AddendumDetail, AddendumEdit } from '@/admin/views/Addendum'
import { KasEdit, KasNew } from '@/admin/views/Kas'
import { LoanDetail, LoanEdit } from '@/admin/views/Loans'
import { resetRateLimits } from '@/lib/rate-limit'

import { api, makeWorld, type FlowUser, type World } from './flow-world'
import { getTestPayload, installLocalJwks, sqlAs } from './helpers'

/**
 * UI feedback 17/10 #5 ("edit = add", user decision 2026-10-17) — the edit pages of Kas, Addendum RAB and Pinjaman
 * antar project rendered server-side with REAL data and the caller's access: the same layout as the create page (form
 * card 8 + the help card 4: "Aturan" / "Alur"), the fields that cannot change after creation in their create widget
 * but DISABLED, and the detail pages link to the edit page instead of embedding a second form. The write rules are
 * the unchanged API (covered by e2-kas-ui / e5-addendum / d1010-loans). Fictional data only.
 */
let w: World
let today = ''

type Props = AdminViewServerProps

async function propsFor(user: FlowUser, segments: string[], searchParams: Record<string, string> = {}): Promise<Props> {
  const req = await createLocalReq({ user: { ...user, collection: 'users' } as never }, await getTestPayload())
  return { initPageResult: { req, locale: undefined, permissions: {}, visibleEntities: { collections: [], globals: [] } }, params: { segments }, searchParams } as unknown as Props
}

async function resolve(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolve))
  if (!isValidElement(node)) return node
  const el = node as ReactElement<{ children?: ReactNode }>
  if (typeof el.type === 'function' && el.type.constructor.name === 'AsyncFunction') return resolve(await (el.type as (p: unknown) => Promise<ReactNode>)(el.props))
  if (el.props && 'children' in el.props && el.props.children !== undefined) return cloneElement(el, undefined, ...([] as ReactNode[]).concat(await resolve(el.props.children)))
  return el
}

async function render(view: (p: Props) => Promise<ReactNode>, user: FlowUser, segments: string[], sp: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(React.createElement(React.Fragment, null, await resolve(await view(await propsFor(user, segments, sp)))))
}

/** `<tag … attr="value" …>` carries `disabled` (attribute order free). */
const disabledEl = (html: string, attr: string) => {
  const m = html.match(new RegExp(`<(?:select|input)[^>]*${attr.replace(/[[\]]/g, '\\$&')}[^>]*>`))
  return m !== null && m[0].includes('disabled=""')
}
/** Card ids of the page, in order. */
const cards = (html: string) => [...html.matchAll(/data-pk-card="([^"]+)"/g)].map((m) => m[1])
/** Width class of a card (`pk-card s8`). */
const spanOf = (html: string, id: string) => html.match(new RegExp(`class="pk-card s(\\d+)[^"]*"[^>]*data-pk-card="${id}"`))?.[1]

beforeAll(async () => {
  await installLocalJwks()
  w = await makeWorld('EDA')
  today = (await sqlAs('app', "SELECT to_char(now() AT TIME ZONE 'Asia/Makassar', 'YYYY-MM-DD') AS d")).rows[0].d
})

beforeEach(() => resetRateLimits())

describe('Kas: /kas/:id/ubah = the "Catat kas" layout', () => {
  it('form 8 + "Aturan" 4 like KasNew; Tanggal / Akun kas / Nominal = date input / account select / Rupiah field, disabled', async () => {
    const r = await api('POST', '/api/v1/cash-entries', w.users.finance, { direction: 'in', entryDate: today, cashAccountId: w.cashAccount, amount: 1_750_000, description: 'Setoran uji edit (fiktif)', cashInSourceId: w.cashInSource }, { 'Idempotency-Key': randomUUID() })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const created = await render(KasNew, w.users.finance, ['kas', 'baru'], { arah: 'masuk' })
    const edit = await render(KasEdit, w.users.finance, ['kas', String(r.body.id), 'ubah'])
    expect(cards(edit)).toEqual(cards(created))
    expect(cards(edit)).toEqual(['kas-form', 'kas-help'])
    expect([spanOf(edit, 'kas-form'), spanOf(edit, 'kas-help')]).toEqual(['8', '4'])
    expect(edit).toContain('data-pk-form="cash-edit"')
    expect(disabledEl(edit, 'type="date"')).toBe(true)
    expect(disabledEl(edit, 'data-pk-field="cashAccountId"')).toBe(true)
    expect(edit).toMatch(new RegExp(`<option value="${w.cashAccount}" selected=""`)) // the entry's account, shown in the select
    expect(disabledEl(edit, 'data-pk-field="amount"')).toBe(true)
    expect(edit).toContain('value="1.750.000"')
    expect(edit).not.toContain('type="text" value="Rp') // no text-input stand-ins any more
    expect(edit.indexOf('Alasan perubahan')).toBeGreaterThan(edit.indexOf('Bukti (opsional)')) // edit-only field last
    expect(edit).toContain('Simpan perubahan')
  })
})

describe('Addendum RAB: /addendum/:id/ubah = the "Ajukan addendum RAB" layout', () => {
  it('detail links "Ubah draft" (no embedded form); the edit page: form 8 + "Alur" 4, project disabled, "Simpan perubahan" / "Batal"', async () => {
    const d = await api('POST', '/api/v1/budget-addenda', w.users.pm, { projectId: w.project, addition: 3_000_000, reason: 'Tambah pekerjaan drainase (uji)' })
    expect(d.status, JSON.stringify(d.body)).toBe(201)
    const id = d.body.id as number
    const detail = await render(AddendumDetail, w.users.pm, ['addendum', 'detail', String(id)])
    expect(detail).toContain(`href="/admin/addendum/${id}/ubah"`)
    expect(detail).not.toContain('data-pk-form="addendum"')
    const edit = await render(AddendumEdit, w.users.pm, ['addendum', String(id), 'ubah'])
    expect(cards(edit)).toEqual(['addendum-form', 'addendum-help'])
    expect([spanOf(edit, 'addendum-form'), spanOf(edit, 'addendum-help')]).toEqual(['8', '4'])
    expect(disabledEl(edit, 'data-pk-field="project"')).toBe(true)
    expect(edit).toContain('value="3.000.000"')
    expect(edit).toContain('Simpan perubahan')
    expect(edit).toContain(`href="/admin/addendum/detail/${id}"`)
    // not the PM's draft → refused page, no form
    const other = await render(AddendumEdit, w.users.finance, ['addendum', String(id), 'ubah'])
    expect(other).not.toContain('data-pk-form="addendum"')
  })
})

describe('Pinjaman antar project: /pinjaman/:id/ubah = the "Ajukan pinjaman" layout', () => {
  it('detail links "Ubah draft" (no embedded form); the edit page: form 8 + "Alur" 4, borrower disabled', async () => {
    const d = await api('POST', '/api/v1/project-loans', w.users.pm, { borrowerProjectId: w.project, lenderProjectId: w.otherProject, kind: 'dana', amount: 4_000_000, reason: 'Pinjam dana material (uji)', loanDate: today, dueDate: today })
    expect(d.status, JSON.stringify(d.body)).toBe(201)
    const id = d.body.id as number
    const detail = await render(LoanDetail, w.users.pm, ['pinjaman', 'detail', String(id)])
    expect(detail).toContain(`href="/admin/pinjaman/${id}/ubah"`)
    expect(detail).not.toContain('data-pk-form="loan"')
    const edit = await render(LoanEdit, w.users.pm, ['pinjaman', String(id), 'ubah'])
    expect(cards(edit)).toEqual(['loan-form', 'loan-help'])
    expect([spanOf(edit, 'loan-form'), spanOf(edit, 'loan-help')]).toEqual(['8', '4'])
    expect(disabledEl(edit, 'data-pk-field="borrower"')).toBe(true)
    expect(disabledEl(edit, 'data-pk-field="lender"')).toBe(false)
    expect(edit).toContain('value="4.000.000"')
    expect(edit).toContain('Simpan perubahan')
    const other = await render(LoanEdit, w.users.otherPm, ['pinjaman', String(id), 'ubah'])
    expect(other).not.toContain('data-pk-form="loan"')
  })
})
