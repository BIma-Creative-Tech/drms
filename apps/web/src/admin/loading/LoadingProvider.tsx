'use client'

import { useRouteTransition } from '@payloadcms/ui'
import { usePathname, useSearchParams } from 'next/navigation'
import React, { Suspense, useEffect, useRef, useState } from 'react'

import { LoadingDots } from './LoadingDots'
import { installMutationTracker } from './mutation-tracker'
import { createVisibilityController, isAdminNavigation, isAdminUrlChange, NAV_TIMEOUT_MS } from './visibility'

/**
 * Admin loader (Uiverse "thin-lionfish-5" dots, see LoadingDots.tsx) on every module navigation and
 * every create / update / delete. Mounted once through `admin.components.providers`
 * (payload.config.ts) → present on every admin page, Payload's built-in views included (NestProviders
 * inside RootProvider, @payloadcms/next 3.90.1 layouts/Root).
 *
 * Signals (no call site had to change):
 * - navigation: (a) capture-phase click on a same-origin `<a>` to another admin URL (next/link,
 *   Payload Link, plain anchors: launcher, module menu, breadcrumbs, links inside views), (b) submit
 *   of a GET filter form to an admin URL, (c) Payload's own `useRouteTransition().isTransitioning`
 *   (router.push after Save/Duplicate/Delete, Payload Link). Ends when `usePathname()` /
 *   `useSearchParams()` change (= the new route rendered). Next App Router has no router events.
 *   No `loading.tsx`: the admin page (`[[...segments]]`) renders Payload's template, module bar
 *   included, so a Suspense fallback would blank the whole shell.
 * - mutations: in-flight unsafe `/api/` fetches (mutation-tracker.ts, exclusion list there).
 *
 * Timing (visibility.ts): shown after 180 ms, at least 300 ms, never longer than 15 s.
 * Navigation overlay sits under the module bar and lets clicks through; the mutation overlay
 * covers the page (drawers included) and absorbs pointer events so nothing is submitted twice.
 * Focus is never moved; the status text is announced politely.
 */
export function LoadingProvider({ children }: { children?: React.ReactNode }) {
  const { isTransitioning } = useRouteTransition()
  const [mutations, setMutations] = useState(0)
  const [navPending, setNavPending] = useState(false)
  const [visible, setVisible] = useState(false)
  const controller = useRef<ReturnType<typeof createVisibilityController> | null>(null)

  useEffect(() => {
    const c = createVisibilityController(setVisible)
    controller.current = c
    return () => {
      c.dispose()
      controller.current = null
    }
  }, [])

  useEffect(() => installMutationTracker(window, setMutations), [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]')
      if (!(a instanceof HTMLAnchorElement)) return
      if (isAdminNavigation(e, { href: a.href, target: a.getAttribute('target'), hasDownload: a.hasAttribute('download') }, window.location.href)) setNavPending(true)
    }
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target
      if (!(form instanceof HTMLFormElement) || (form.getAttribute('method') ?? 'get').toLowerCase() !== 'get') return
      const to = new URL(form.action || window.location.href)
      to.search = new URLSearchParams(new FormData(form, e.submitter) as unknown as Record<string, string>).toString()
      if (isAdminUrlChange(to.href, window.location.href)) setNavPending(true)
    }
    // Back from a full-page navigation (bfcache) restores the page as it was: drop stale state.
    const onPageShow = (e: PageTransitionEvent) => e.persisted && setNavPending(false)
    document.addEventListener('click', onClick, true)
    document.addEventListener('submit', onSubmit, true)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('submit', onSubmit, true)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  useEffect(() => {
    if (!navPending) return
    const t = setTimeout(() => setNavPending(false), NAV_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [navPending])

  const saving = mutations > 0
  const busy = saving || navPending || isTransitioning
  useEffect(() => controller.current?.update(busy), [busy])

  const mode = saving ? 'save' : 'nav'
  return (
    <>
      {children}
      <Suspense fallback={null}>
        <RouteWatcher onRouteChange={() => setNavPending(false)} />
      </Suspense>
      <div className="pk-loading" data-mode={mode} data-visible={visible || undefined} aria-hidden="true" data-pk-loading>
        <LoadingDots />
      </div>
      <span className="pk-loading__status" role="status" aria-live="polite">
        {visible ? (saving ? 'Menyimpan…' : 'Memuat…') : ''}
      </span>
    </>
  )
}

/** Fires after the rendered route (path or query) changed. Suspense: useSearchParams() bail-out. */
function RouteWatcher({ onRouteChange }: { onRouteChange: () => void }) {
  const pathname = usePathname()
  const search = useSearchParams()?.toString() ?? ''
  const cb = useRef(onRouteChange)
  useEffect(() => {
    cb.current = onRouteChange
  })
  useEffect(() => {
    cb.current()
  }, [pathname, search])
  return null
}
