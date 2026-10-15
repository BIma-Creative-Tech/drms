/**
 * Admin loader — anti-flash visibility + navigation intent (pure, tested by
 * tests/unit/admin-loading.test.ts).
 */

export type VisibilityTiming = {
  /** Busy for less than this → the loader never appears (no flash on fast responses). */
  showDelayMs: number
  /** Once shown, stay at least this long (no blink). */
  minVisibleMs: number
  /** Safety: hide after this long even if still busy; stays hidden until busy drops and rises again. */
  maxVisibleMs: number
}

export const DEFAULT_TIMING: VisibilityTiming = { showDelayMs: 180, minVisibleMs: 300, maxVisibleMs: 15_000 }

/** Navigation pending without a route change for this long is dropped (e.g. a cancelled navigation). */
export const NAV_TIMEOUT_MS = 15_000

/**
 * Debounces a boolean "busy" signal into a "visible" signal: shown only after `showDelayMs`,
 * visible for at least `minVisibleMs`, force-hidden after `maxVisibleMs`. Uses the global timers
 * (vitest fake timers in the test).
 *
 * `onBlocked` (DRMS 16/10: "loading belum memblokir klik"): input is blocked from the FIRST moment
 * of busy — no anti-flash delay, a second click must never get through — for as long as the loader
 * is visible, and released together with it by the safety timeout (the page can never stay locked).
 */
export function createVisibilityController(onVisible: (visible: boolean) => void, timing: VisibilityTiming = DEFAULT_TIMING, onBlocked?: (blocked: boolean) => void) {
  let busy = false
  let visible = false
  let blocked = false
  let latched = false // safety timeout fired while still busy
  let shownAt = 0
  let showTimer: ReturnType<typeof setTimeout> | undefined
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let maxTimer: ReturnType<typeof setTimeout> | undefined

  const clear = (t: ReturnType<typeof setTimeout> | undefined) => t !== undefined && clearTimeout(t)
  const syncBlocked = () => {
    const b = visible || (busy && !latched)
    if (b === blocked) return
    blocked = b
    onBlocked?.(b)
  }
  const setVisible = (v: boolean) => {
    if (v === visible) return
    visible = v
    if (!v) {
      clear(maxTimer)
      maxTimer = undefined
    }
    onVisible(v)
    syncBlocked()
  }
  const show = () => {
    showTimer = undefined
    shownAt = Date.now()
    setVisible(true)
    maxTimer = setTimeout(() => {
      latched = true
      clear(hideTimer)
      hideTimer = undefined
      setVisible(false)
    }, timing.maxVisibleMs)
  }

  return {
    update(next: boolean) {
      busy = next
      if (busy) {
        syncBlocked()
        if (latched) return
        clear(hideTimer)
        hideTimer = undefined
        if (!visible && showTimer === undefined) showTimer = setTimeout(show, timing.showDelayMs)
        return
      }
      latched = false
      syncBlocked()
      clear(showTimer)
      showTimer = undefined
      if (visible && hideTimer === undefined) {
        const left = Math.max(0, shownAt + timing.minVisibleMs - Date.now())
        hideTimer = setTimeout(() => {
          hideTimer = undefined
          if (!busy) setVisible(false)
        }, left)
      }
    },
    isVisible: () => visible,
    isBlocked: () => blocked,
    dispose() {
      ;[showTimer, hideTimer, maxTimer].forEach(clear)
      showTimer = hideTimer = maxTimer = undefined
    },
  }
}

/**
 * Keys swallowed while input is blocked: Enter (submits a form, activates a link / button) and Space
 * outside text fields (activates the focused button / checkbox). Typing, Tab and Esc still work.
 */
export function blocksKey(key: string, editableTarget: boolean): boolean {
  return key === 'Enter' || (key === ' ' && !editableTarget)
}

export type ClickLike = {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  defaultPrevented: boolean
}

export type AnchorLike = { href: string; target?: string | null; hasDownload?: boolean }

/**
 * True when a click on this anchor starts an in-app admin navigation that renders a different
 * page: primary button, no modifier (new tab/window), same tab, same origin, under the admin route,
 * and a different path or query (hash-only jumps and the current page are not navigations).
 * Links to /api (PDF, exports) and /auth (SSO/logout handlers) are outside the admin route.
 */
export function isAdminNavigation(click: ClickLike, a: AnchorLike, current: string, adminRoute = '/admin'): boolean {
  if (click.defaultPrevented || click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return false
  if (a.hasDownload || (a.target && a.target !== '_self')) return false
  return isAdminUrlChange(a.href, current, adminRoute)
}

/** Same-origin URL under the admin route whose path or query differs from `current`. */
export function isAdminUrlChange(href: string, current: string, adminRoute = '/admin'): boolean {
  let to: URL
  let from: URL
  try {
    from = new URL(current)
    to = new URL(href, from)
  } catch {
    return false
  }
  if (to.origin !== from.origin) return false
  if (to.pathname !== adminRoute && !to.pathname.startsWith(`${adminRoute}/`)) return false
  const norm = (u: URL) => `${u.pathname.replace(/\/+$/, '') || '/'}${u.search}`
  return norm(to) !== norm(from)
}
