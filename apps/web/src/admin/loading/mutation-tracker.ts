/**
 * Admin loader — data-mutation tracker (pure, no React; tested by tests/unit/admin-loading.test.ts).
 *
 * One central mechanism instead of editing every call site: the admin client provider
 * (LoadingProvider.tsx) wraps `window.fetch` once and counts in-flight **same-origin, unsafe-method
 * requests to `/api/`**. This covers
 * - Payload's built-in views: document Save / Publish / Unpublish (forms/Form → `requests.post|patch`
 *   = fetch), Delete / Restore / Permanently delete, bulk Delete / Publish / Unpublish / Edit-many,
 *   Duplicate, row reorder, folder moves (all `fetch` in @payloadcms/ui 3.90.1, verified);
 * - our custom views: every `/api/v1` POST/PATCH/DELETE (ActionButton, kas/client, addendum,
 *   attendance, StageEditor, MoneyForm, RequesterActions, …).
 *
 * Not counted (see MUTATION_EXCLUSIONS for the reasons): GET/HEAD/OPTIONS, Payload POST-as-GET
 * queries (`X-Payload-HTTP-Method-Override: GET`), cross-origin requests, anything outside `/api/`
 * (Next server actions / Payload server functions such as form-state rebuilds, RSC refreshes),
 * autosave, preferences, document locks, permission probes, auth/session endpoints and
 * notification read-marks.
 */

/** A request still pending after this long no longer counts (the loader can never stick). */
export const MUTATION_TIMEOUT_MS = 15_000

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export type MutationExclusion = { id: string; why: string; test: (url: URL) => boolean }

/** Unsafe-method `/api/` requests that must NOT show the loader. Keep in sync with the ADR 0014 note. */
export const MUTATION_EXCLUSIONS: readonly MutationExclusion[] = [
  {
    id: 'autosave',
    why: 'Payload drafts autosave in the background while typing (would flicker constantly).',
    test: (u) => u.searchParams.get('autosave') === 'true',
  },
  {
    id: 'preferences',
    why: 'Payload UI preferences (list columns, sort, nav/group state) — not user data.',
    test: (u) => u.pathname.startsWith('/api/payload-preferences'),
  },
  {
    id: 'document-locks',
    why: 'Payload document-lock heartbeat / release on the edit view.',
    test: (u) => u.pathname.startsWith('/api/payload-locked-documents'),
  },
  {
    id: 'access-probe',
    why: 'Payload POSTs the draft to /api/<slug>/access[/<id>] to compute permissions (a read).',
    test: (u) => /^\/api\/(globals\/)?[^/]+\/access(\/|$)/.test(u.pathname),
  },
  {
    id: 'auth-session',
    why: 'Login / logout / token refresh / password flows — the login page keeps its own UI and refresh runs in the background.',
    test: (u) => /^\/api\/[^/]+\/(login|logout|refresh-token|forgot-password|reset-password|first-register|unlock|verify)(\/|$)/.test(u.pathname),
  },
  {
    id: 'notification-read',
    why: 'Opening a notification marks it read in the background (the navigation that follows shows the loader); "read-all" still counts.',
    test: (u) => /^\/api\/v1\/notifications\/[^/]+\/read$/.test(u.pathname),
  },
]

type HeaderBag = HeadersInit | undefined

function headerFrom(bag: HeaderBag, name: string): string | null {
  if (!bag) return null
  const lower = name.toLowerCase()
  if (typeof Headers !== 'undefined' && bag instanceof Headers) return bag.get(name)
  if (Array.isArray(bag)) {
    const hit = bag.find(([k]) => k.toLowerCase() === lower)
    return hit ? hit[1] : null
  }
  for (const [k, v] of Object.entries(bag as Record<string, string>)) if (k.toLowerCase() === lower) return v
  return null
}

const isRequest = (x: unknown): x is Request => typeof Request !== 'undefined' && x instanceof Request

/** The effective HTTP method of a fetch call (init wins over a Request object, default GET). */
export function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (isRequest(input) ? input.method : undefined) ?? 'GET').toUpperCase()
}

function requestUrl(input: RequestInfo | URL, base: string): URL | null {
  try {
    if (typeof input === 'string') return new URL(input, base)
    if (input instanceof URL) return input
    if (isRequest(input)) return new URL(input.url, base)
  } catch {
    /* malformed URL → not tracked */
  }
  return null
}

/** Why a request is excluded (exclusion id), or null when it counts as a tracked mutation. */
export function exclusionFor(input: RequestInfo | URL, init: RequestInit | undefined, origin: string): string | null {
  if (SAFE_METHODS.has(requestMethod(input, init))) return 'safe-method'
  const override = headerFrom(init?.headers, 'X-Payload-HTTP-Method-Override') ?? (isRequest(input) ? input.headers.get('X-Payload-HTTP-Method-Override') : null)
  if (override && SAFE_METHODS.has(override.toUpperCase())) return 'method-override-get'
  const url = requestUrl(input, origin)
  if (!url || url.origin !== origin) return 'cross-origin'
  if (!url.pathname.startsWith('/api/')) return 'not-api'
  return MUTATION_EXCLUSIONS.find((e) => e.test(url))?.id ?? null
}

export const isTrackedMutation = (input: RequestInfo | URL, init: RequestInit | undefined, origin: string) => exclusionFor(input, init, origin) === null

type FetchHost = { fetch: typeof fetch; location: { origin: string } }

const WRAPPED = Symbol.for('pk.admin.mutationTracker')
type Wrapped = typeof fetch & { [WRAPPED]?: { original: typeof fetch; listeners: Set<(n: number) => void>; count: () => number } }

/**
 * Wraps `host.fetch` (idempotent: a second install — React StrictMode, HMR — only adds the listener)
 * and reports the in-flight tracked-mutation count to `onChange`. Returns an uninstall function that
 * removes the listener and restores the original fetch once nobody listens (and only if nothing else
 * wrapped fetch on top of ours in the meantime).
 */
export function installMutationTracker(host: FetchHost, onChange: (inFlight: number) => void, opts: { timeoutMs?: number } = {}): () => void {
  const timeoutMs = opts.timeoutMs ?? MUTATION_TIMEOUT_MS
  let current = host.fetch as Wrapped
  if (!current[WRAPPED]) {
    const original = host.fetch
    const listeners = new Set<(n: number) => void>()
    let inFlight = 0
    const emit = () => listeners.forEach((l) => l(inFlight))
    const wrapped: Wrapped = function trackedFetch(input: RequestInfo | URL, init?: RequestInit) {
      if (!isTrackedMutation(input, init, host.location.origin)) return original.call(host, input, init)
      inFlight += 1
      emit()
      let done = false
      const release = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        inFlight = Math.max(0, inFlight - 1)
        emit()
      }
      const timer = setTimeout(release, timeoutMs)
      let p: Promise<Response>
      try {
        p = original.call(host, input, init)
      } catch (e) {
        release()
        throw e
      }
      return p.then(
        (r) => {
          release()
          return r
        },
        (e: unknown) => {
          release()
          throw e
        },
      )
    }
    wrapped[WRAPPED] = { original, listeners, count: () => inFlight }
    host.fetch = wrapped
    current = wrapped
  }
  const state = current[WRAPPED]!
  state.listeners.add(onChange)
  onChange(state.count())
  return () => {
    state.listeners.delete(onChange)
    if (state.listeners.size === 0 && host.fetch === current) host.fetch = state.original
  }
}
