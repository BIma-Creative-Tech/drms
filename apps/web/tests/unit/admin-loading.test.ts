import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { exclusionFor, installMutationTracker, isTrackedMutation, MUTATION_EXCLUSIONS, requestMethod } from '@/admin/loading/mutation-tracker'
import { createVisibilityController, DEFAULT_TIMING, isAdminNavigation, isAdminUrlChange } from '@/admin/loading/visibility'

/**
 * Admin loader (src/admin/loading): the global mutation tracker (window.fetch wrapper), its
 * exclusion list, the anti-flash visibility timing and the navigation intent filter.
 */
const ORIGIN = 'https://drms.example.test'

describe('mutation classification', () => {
  const tracked = (url: string, init?: RequestInit) => isTrackedMutation(url, init, ORIGIN)

  it('counts unsafe methods on same-origin /api/ (Payload REST + /api/v1)', () => {
    expect(tracked('/api/expense-requests/12?depth=0', { method: 'PATCH' })).toBe(true) // Payload Save
    expect(tracked('/api/expense-requests', { method: 'post' })).toBe(true) // create (lower-case, Payload requests.post)
    expect(tracked('/api/expense-requests/12', { method: 'delete' })).toBe(true) // delete
    expect(tracked('/api/expense-requests?where[id][in][0]=1', { method: 'DELETE' })).toBe(true) // bulk delete
    expect(tracked('/api/expense-requests/12/duplicate', { method: 'POST' })).toBe(true)
    expect(tracked('/api/globals/company-settings?draft=true', { method: 'POST' })).toBe(true)
    expect(tracked(`${ORIGIN}/api/v1/approvals/5/approve`, { method: 'POST' })).toBe(true)
    expect(tracked('/api/v1/cash-entries', { method: 'POST' })).toBe(true)
    expect(tracked('/api/v1/media/receipts', { method: 'POST' })).toBe(true)
    expect(tracked('/api/v1/notifications/read-all', { method: 'POST' })).toBe(true)
    expect(tracked('/api/v1/devices/3', { method: 'DELETE' })).toBe(true)
  })

  it('ignores GET / HEAD / OPTIONS (default method = GET)', () => {
    expect(tracked('/api/expense-requests')).toBe(false)
    expect(tracked('/api/v1/notifications', { method: 'GET' })).toBe(false)
    expect(tracked('/api/v1/health', { method: 'HEAD' })).toBe(false)
    expect(tracked('/api/v1/x', { method: 'OPTIONS' })).toBe(false)
    expect(exclusionFor('/api/x', undefined, ORIGIN)).toBe('safe-method')
  })

  it('reads the method from a Request object (init wins)', () => {
    const req = new Request(`${ORIGIN}/api/v1/cash-entries`, { method: 'POST' })
    expect(requestMethod(req)).toBe('POST')
    expect(requestMethod(req, { method: 'get' })).toBe('GET')
    expect(isTrackedMutation(req, undefined, ORIGIN)).toBe(true)
    expect(isTrackedMutation(new URL(`${ORIGIN}/api/v1/cash-entries`), { method: 'POST' }, ORIGIN)).toBe(true)
  })

  it('ignores Payload POST-as-GET queries (X-Payload-HTTP-Method-Override: GET) in every header shape', () => {
    const h = { 'X-Payload-HTTP-Method-Override': 'GET' }
    expect(tracked('/api/users', { method: 'POST', headers: h })).toBe(false)
    expect(tracked('/api/users', { method: 'POST', headers: new Headers(h) })).toBe(false)
    expect(tracked('/api/users', { method: 'POST', headers: [['x-payload-http-method-override', 'get']] })).toBe(false)
    expect(exclusionFor('/api/users', { method: 'POST', headers: h }, ORIGIN)).toBe('method-override-get')
  })

  it('ignores cross-origin, non-/api paths (server actions, RSC) and malformed URLs', () => {
    expect(tracked('https://sso.example.test/api/x', { method: 'POST' })).toBe(false)
    expect(tracked('/admin/collections/users/1', { method: 'POST' })).toBe(false) // Next server action / Payload server function
    expect(tracked('/auth/logout', { method: 'POST' })).toBe(false)
    expect(tracked('/apix/y', { method: 'POST' })).toBe(false)
    expect(tracked('http://[bad', { method: 'POST' })).toBe(false)
  })

  it.each([
    ['/api/expense-requests/12?autosave=true&draft=true&depth=0', 'PATCH', 'autosave'],
    ['/api/payload-preferences/expense-requests-list', 'POST', 'preferences'],
    ['/api/payload-locked-documents/9', 'PATCH', 'document-locks'],
    ['/api/payload-locked-documents/9', 'DELETE', 'document-locks'],
    ['/api/expense-requests/access/12', 'POST', 'access-probe'],
    ['/api/expense-requests/access?locale=id', 'POST', 'access-probe'],
    ['/api/globals/company-settings/access', 'POST', 'access-probe'],
    ['/api/users/login', 'POST', 'auth-session'],
    ['/api/users/logout', 'POST', 'auth-session'],
    ['/api/users/refresh-token?refresh', 'POST', 'auth-session'],
    ['/api/users/forgot-password', 'POST', 'auth-session'],
    ['/api/users/first-register', 'POST', 'auth-session'],
    ['/api/v1/notifications/abc-123/read', 'POST', 'notification-read'],
  ])('excludes %s %s (%s)', (url, method, id) => {
    expect(exclusionFor(url, { method }, ORIGIN)).toBe(id)
  })

  it('every exclusion documents why', () => {
    for (const e of MUTATION_EXCLUSIONS) expect(e.why.length).toBeGreaterThan(20)
    expect(new Set(MUTATION_EXCLUSIONS.map((e) => e.id)).size).toBe(MUTATION_EXCLUSIONS.length)
  })

  it('does not exclude real data routes that merely look similar', () => {
    expect(tracked('/api/users/7', { method: 'PATCH' })).toBe(true) // user role edit
    expect(tracked('/api/v1/users/7/roles', { method: 'PATCH' })).toBe(true)
    expect(tracked('/api/accessories', { method: 'POST' })).toBe(true)
    expect(tracked('/api/expense-requests/12?draft=true', { method: 'PATCH' })).toBe(true) // save draft (not autosave)
  })
})

describe('installMutationTracker (window.fetch wrapper)', () => {
  type Deferred = { resolve: (r: Response) => void; reject: (e: unknown) => void }
  let pending: Deferred[]
  let host: { fetch: typeof fetch; location: { origin: string } }
  let original: typeof fetch

  beforeEach(() => {
    vi.useFakeTimers()
    pending = []
    original = vi.fn(
      () =>
        new Promise<Response>((resolve, reject) => {
          pending.push({ resolve, reject })
        }),
    ) as unknown as typeof fetch
    host = { fetch: original, location: { origin: ORIGIN } }
  })
  afterEach(() => vi.useRealTimers())

  it('counts in-flight mutations up and down, GETs never count, responses pass through', async () => {
    const seen: number[] = []
    const off = installMutationTracker(host, (n) => seen.push(n))
    expect(host.fetch).not.toBe(original)
    const a = host.fetch('/api/v1/cash-entries', { method: 'POST' })
    const b = host.fetch('/api/expense-requests/1', { method: 'PATCH' })
    const g = host.fetch('/api/expense-requests')
    expect(seen).toEqual([0, 1, 2])
    const res = new Response('{}', { status: 201 })
    pending[0]!.resolve(res)
    await expect(a).resolves.toBe(res)
    pending[2]!.resolve(new Response('[]'))
    await g
    expect(seen).toEqual([0, 1, 2, 1])
    pending[1]!.reject(new TypeError('network'))
    await expect(b).rejects.toThrow('network')
    expect(seen.at(-1)).toBe(0)
    expect(original).toHaveBeenCalledTimes(3)
    off()
    expect(host.fetch).toBe(original)
  })

  it('excluded requests are passed straight through', () => {
    const seen: number[] = []
    installMutationTracker(host, (n) => seen.push(n))
    void host.fetch('/api/payload-preferences/x', { method: 'POST' })
    void host.fetch('/api/users/refresh-token', { method: 'POST' })
    expect(seen).toEqual([0])
    expect(original).toHaveBeenCalledTimes(2)
  })

  it('a request pending longer than the timeout stops counting (loader can never stick)', async () => {
    const seen: number[] = []
    installMutationTracker(host, (n) => seen.push(n), { timeoutMs: 15_000 })
    const p = host.fetch('/api/v1/transfers/1/pay', { method: 'POST' })
    expect(seen.at(-1)).toBe(1)
    vi.advanceTimersByTime(14_999)
    expect(seen.at(-1)).toBe(1)
    vi.advanceTimersByTime(1)
    expect(seen.at(-1)).toBe(0)
    pending[0]!.resolve(new Response(null, { status: 204 })) // late settle: no double decrement
    await p
    expect(seen).toEqual([0, 1, 0])
  })

  it('synchronous throw from fetch releases the count', () => {
    const seen: number[] = []
    host.fetch = (() => {
      throw new TypeError('bad init')
    }) as unknown as typeof fetch
    installMutationTracker(host, (n) => seen.push(n))
    expect(() => host.fetch('/api/v1/x', { method: 'POST' })).toThrow('bad init')
    expect(seen).toEqual([0, 1, 0])
  })

  it('is idempotent (StrictMode double mount): one wrapper, restored after the last uninstall', () => {
    const l1 = vi.fn()
    const l2 = vi.fn()
    const off1 = installMutationTracker(host, l1)
    const wrapped = host.fetch
    const off2 = installMutationTracker(host, l2)
    expect(host.fetch).toBe(wrapped)
    void host.fetch('/api/v1/x', { method: 'POST' })
    expect(l1).toHaveBeenLastCalledWith(1)
    expect(l2).toHaveBeenLastCalledWith(1)
    off1()
    expect(host.fetch).toBe(wrapped)
    off2()
    expect(host.fetch).toBe(original)
  })

  it('does not clobber a fetch wrapped on top of ours', () => {
    const off = installMutationTracker(host, () => {})
    const outer = vi.fn() as unknown as typeof fetch
    host.fetch = outer
    off()
    expect(host.fetch).toBe(outer)
  })
})

describe('createVisibilityController (anti-flash timing)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const setup = () => {
    const seen: boolean[] = []
    const c = createVisibilityController((v) => seen.push(v))
    return { c, seen }
  }

  it('defaults: 180 ms delay, 300 ms minimum, 15 s maximum', () => {
    expect(DEFAULT_TIMING).toEqual({ showDelayMs: 180, minVisibleMs: 300, maxVisibleMs: 15_000 })
  })

  it('fast work (< delay) never shows the loader', () => {
    const { c, seen } = setup()
    c.update(true)
    vi.advanceTimersByTime(179)
    c.update(false)
    vi.advanceTimersByTime(1000)
    expect(seen).toEqual([])
  })

  it('shows after the delay and stays at least the minimum time', () => {
    const { c, seen } = setup()
    c.update(true)
    vi.advanceTimersByTime(180)
    expect(seen).toEqual([true])
    vi.advanceTimersByTime(50)
    c.update(false)
    vi.advanceTimersByTime(249)
    expect(c.isVisible()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(seen).toEqual([true, false])
  })

  it('hides immediately when busy ended after the minimum', () => {
    const { c, seen } = setup()
    c.update(true)
    vi.advanceTimersByTime(180 + 1000)
    c.update(false)
    vi.advanceTimersByTime(0)
    expect(seen).toEqual([true, false])
  })

  it('busy again during the minimum window keeps it visible without blinking', () => {
    const { c, seen } = setup()
    c.update(true)
    vi.advanceTimersByTime(200)
    c.update(false)
    vi.advanceTimersByTime(100)
    c.update(true)
    vi.advanceTimersByTime(1000)
    expect(seen).toEqual([true])
    c.update(false)
    vi.advanceTimersByTime(0)
    expect(seen).toEqual([true, false])
  })

  it('safety timeout hides a stuck loader and it stays hidden until busy drops', () => {
    const { c, seen } = setup()
    c.update(true)
    vi.advanceTimersByTime(180 + 15_000)
    expect(seen).toEqual([true, false])
    c.update(true) // still the same busy period
    vi.advanceTimersByTime(60_000)
    expect(seen).toEqual([true, false])
    c.update(false)
    c.update(true)
    vi.advanceTimersByTime(180)
    expect(seen).toEqual([true, false, true])
  })

  it('dispose cancels pending timers', () => {
    const { c, seen } = setup()
    c.update(true)
    c.dispose()
    vi.advanceTimersByTime(1000)
    expect(seen).toEqual([])
  })
})

describe('navigation intent', () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false }
  const here = `${ORIGIN}/admin/kas?bulan=2026-09`
  const nav = (href: string, over: Partial<typeof click> = {}, a: { target?: string; hasDownload?: boolean } = {}) =>
    isAdminNavigation({ ...click, ...over }, { href, ...a }, here)

  it('admin links to another page/module/query navigate', () => {
    expect(nav('/admin')).toBe(true) // launcher
    expect(nav(`${ORIGIN}/admin/persetujuan`)).toBe(true) // module menu
    expect(nav('/admin/collections/expense-requests/12')).toBe(true) // link inside a view / breadcrumb
    expect(nav('/admin/kas?bulan=2026-08')).toBe(true) // same view, other query
  })

  it('same page, hash jumps, other origins and non-admin paths do not', () => {
    expect(nav('/admin/kas?bulan=2026-09')).toBe(false)
    expect(nav('/admin/kas/?bulan=2026-09#row-3')).toBe(false)
    expect(nav('https://other.example.test/admin')).toBe(false)
    expect(nav('/api/v1/reports/kas.pdf')).toBe(false) // PDF / export links
    expect(nav('/auth/login')).toBe(false)
    expect(nav('/administrator')).toBe(false)
    expect(nav('mailto:finance@example.test')).toBe(false)
  })

  it('new tab / window, downloads, non-primary buttons and prevented clicks do not', () => {
    for (const k of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) expect(nav('/admin', { [k]: true })).toBe(false)
    expect(nav('/admin', { button: 1 })).toBe(false)
    expect(nav('/admin', { defaultPrevented: true })).toBe(false)
    expect(nav('/admin', {}, { target: '_blank' })).toBe(false)
    expect(nav('/admin', {}, { target: '_self' })).toBe(true)
    expect(nav('/admin', {}, { hasDownload: true })).toBe(false)
  })

  it('isAdminUrlChange handles GET filter-form targets and bad input', () => {
    expect(isAdminUrlChange(`${ORIGIN}/admin/kas?bulan=2026-07`, here)).toBe(true)
    expect(isAdminUrlChange(`${ORIGIN}/admin/kas?bulan=2026-09`, here)).toBe(false)
    expect(isAdminUrlChange('/x', 'not a url')).toBe(false)
  })
})
