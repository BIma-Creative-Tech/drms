import type { PayloadRequest } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { withCompanyContext, type Membership } from '@/access/roles'
import {
  allState,
  canApply,
  cookieValue,
  isAll,
  normalizeSelection,
  requestBody,
  selectionDescription,
  switcherLabel,
  toggleAll,
  toggleCompany,
  type SwitcherCompany,
} from '@/admin/shell/company-switcher'
import { loadSwitcher } from '@/admin/shell/modules-server'
import { resetRateLimits } from '@/lib/rate-limit'

const audit = vi.hoisted(() => ({ rows: [] as unknown[] }))
vi.mock('@/lib/env', () => ({ getEnv: () => ({ AUTH_COOKIE_INSECURE: false }) }))
vi.mock('@/audit/writer', () => ({ writeAuditDetached: async (_req: unknown, rows: unknown[]) => void audit.rows.push(...rows) }))

const { meCompaniesEndpoint } = await import('@/api/v1/endpoints/me-companies')

/** MC2-4 PT switcher (wireframe mc/wireframes.md §1a): state helpers, cookie endpoint, nav data. */
const OPTS: SwitcherCompany[] = [
  { id: 1, shortCode: 'DRMS', name: 'PT Contoh Induk', roles: ['Direktur'] },
  { id: 2, shortCode: 'CS1', name: 'PT Contoh Satu', roles: ['Finance'] },
  { id: 3, shortCode: 'CS2', name: 'PT Contoh Dua', roles: ['Finance'] },
]

describe('switcher state', () => {
  it('normalises to option order, drops foreign ids and duplicates', () => {
    expect(normalizeSelection(OPTS, [3, 1, 3, 99])).toEqual([1, 3])
    expect(isAll(OPTS, [3, 2, 1])).toBe(true)
    expect(isAll([], [])).toBe(false)
  })

  it('labels: Semua PT / PT: CODE / PT: CODE +n; compact = codes only', () => {
    expect(switcherLabel(OPTS, [1, 2, 3])).toBe('Semua PT')
    expect(switcherLabel(OPTS, [2])).toBe('PT: CS1')
    expect(switcherLabel(OPTS, [3, 1])).toBe('PT: DRMS +1')
    expect(switcherLabel(OPTS, [1, 2, 3], true)).toBe('Semua')
    expect(switcherLabel(OPTS, [1, 2], true)).toBe('DRMS+1')
    expect(switcherLabel([OPTS[1]!], [2])).toBe('PT: CS1') // single membership: never "Semua PT"
    expect(switcherLabel([], [])).toBe('')
    expect(selectionDescription(OPTS, [1, 3])).toBe('PT dipilih: DRMS, CS2')
    expect(selectionDescription(OPTS, [1, 2, 3])).toBe('Semua PT (3) dipilih')
  })

  it('toggles single PTs and "Semua PT saya" (tri-state)', () => {
    expect(toggleCompany(OPTS, [1], 2)).toEqual([1, 2])
    expect(toggleCompany(OPTS, [1, 2], 1)).toEqual([2])
    expect(toggleCompany(OPTS, [1], 42)).toEqual([1]) // unknown id ignored
    expect(allState(OPTS, [])).toBe('none')
    expect(allState(OPTS, [2])).toBe('some')
    expect(allState(OPTS, [1, 2, 3])).toBe('all')
    expect(toggleAll(OPTS, [2])).toEqual([1, 2, 3])
    expect(toggleAll(OPTS, [1, 2, 3])).toEqual([])
  })

  it('Terapkan needs ≥ 1 PT and a change; all = null body (cookie cleared)', () => {
    expect(canApply(OPTS, [], [1])).toBe(false)
    expect(canApply(OPTS, [1], [1])).toBe(false)
    expect(canApply(OPTS, [2, 1], [1, 2])).toBe(false) // same set, other order
    expect(canApply(OPTS, [1, 2], [1])).toBe(true)
    expect(requestBody(OPTS, [1, 2, 3])).toEqual({ companyIds: null })
    expect(requestBody(OPTS, [3, 1])).toEqual({ companyIds: [1, 3] })
  })

  it('cookie value: sorted member ids; all / none / foreign-only → no cookie', () => {
    expect(cookieValue([1, 2, 3], [3, 1])).toBe('1,3')
    expect(cookieValue([1, 2, 3], [1, 2, 3])).toBeNull()
    expect(cookieValue([1, 2, 3], null)).toBeNull()
    expect(cookieValue([1, 2], [9])).toBeNull()
  })
})

// ---- POST /api/v1/me/companies ------------------------------------------------------------------

const RINA: Membership[] = [
  { company: 1, roles: ['pk-owner'], employee: 11 },
  { company: 2, roles: ['pk-finance'], employee: null },
]
const call = async (body: unknown, ms: Membership[] = RINA, headers: Record<string, string> = {}) => {
  const req = {
    user: withCompanyContext({ id: 7, collection: 'users' }, ms, null, false),
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json', ...headers }),
    context: {},
    routeParams: {},
    text: async () => JSON.stringify(body),
    payload: { logger: { error: () => {}, warn: () => {} } },
  } as unknown as PayloadRequest
  return meCompaniesEndpoint.handler(req)
}

beforeEach(() => {
  resetRateLimits()
  audit.rows.length = 0
})

describe('POST /api/v1/me/companies', () => {
  it('stores a narrowing selection in the __Host- cookie (HttpOnly, Secure, Lax)', async () => {
    const res = await call({ companyIds: [2] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ selected: [2], all: false })
    const c = res.headers.get('set-cookie') ?? ''
    expect(c).toMatch(/^__Host-pk-company-ids=2; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/)
  })

  it('"Semua PT" (null or every membership) clears the cookie', async () => {
    for (const body of [{ companyIds: null }, { companyIds: [2, 1] }]) {
      const res = await call(body)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ selected: [1, 2], all: true })
      expect(res.headers.get('set-cookie')).toMatch(/^__Host-pk-company-ids=; .*Max-Age=0/)
    }
  })

  it('a PT without membership → 403 COMPANY_NOT_ALLOWED, audited, no cookie', async () => {
    const res = await call({ companyIds: [1, 3] })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'COMPANY_NOT_ALLOWED' })
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(audit.rows).toMatchObject([{ action: 'access_denied', docType: 'company' }])
  })

  it('rejects empty / malformed bodies and users without membership', async () => {
    expect((await call({ companyIds: [] })).status).toBe(400)
    expect((await call({ companyIds: ['1'] })).status).toBe(400)
    expect((await call({ companyIds: [1], extra: true })).status).toBe(400)
    expect((await call({ companyIds: [1] }, [])).status).toBe(409)
  })
})

// ---- nav data ------------------------------------------------------------------------------------

describe('loadSwitcher (module bar data)', () => {
  it('memberships with codes, names and per-PT role labels; selection from the context', async () => {
    const find = vi.fn(async () => ({ docs: [{ id: 2, shortCode: 'CS1', name: 'PT Contoh Satu' }, { id: 1, shortCode: 'DRMS', name: 'PT Contoh Induk' }] }))
    const user = withCompanyContext({ id: 7, collection: 'users' }, RINA, [2], false)
    const s = await loadSwitcher({ find } as never, user as never)
    expect(s.options).toEqual([
      { id: 2, shortCode: 'CS1', name: 'PT Contoh Satu', roles: ['Finance'] },
      { id: 1, shortCode: 'DRMS', name: 'PT Contoh Induk', roles: ['Direktur'] },
    ])
    expect(s.selected).toEqual([2])
  })

  it('no membership → no switcher; a failing lookup falls back to ids', async () => {
    expect(await loadSwitcher({ find: vi.fn() } as never, withCompanyContext({ id: 1 }, [], null, false) as never)).toEqual({ options: [], selected: [] })
    const s = await loadSwitcher({ find: async () => Promise.reject(new Error('db')) } as never, withCompanyContext({ id: 7 }, RINA, null, false) as never)
    expect(s.options.map((o) => o.shortCode)).toEqual(['#1', '#2'])
    expect(s.selected).toEqual([1, 2])
  })
})
