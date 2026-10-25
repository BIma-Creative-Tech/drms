'use client'

import { getTranslation } from '@payloadcms/translations'
import { useStepNav, useTheme, useTranslation } from '@payloadcms/ui'
import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import { Icon } from '@/admin/modules/Icon'
import { moduleForPath, profileHref, type ResolvedModule } from '@/admin/modules/registry'

import { AppSidebar } from './AppSidebar'
import { CommandPalette } from './CommandPalette'
import type { SwitcherState } from './company-switcher'
import { CompanySwitcher } from './CompanySwitcher'
import { deriveCrumbs, type Crumb } from './crumbs'
import type { NavUser } from './modules-server'
import { isPaletteShortcut, navEntries, sidebarCookie, type SidebarMode } from './nav-search'
import { isQuickCreateShortcut, type QuickCreateGroup } from './quick-create'

/**
 * Admin shell (client), D2510 Nexus layout (user 2026-10-25, ADR 0033 — supersedes the Odoo top bar of ADR 0014):
 * the left sidebar (./AppSidebar.tsx, every visible module and menu item) + a slim top bar. Top bar left: sidebar
 * toggle (desktop: full ↔ compact, remembered in the `pk-side` cookie; ≤ 1024px: opens the drawer) and the menu
 * search (./CommandPalette.tsx, Ctrl+K / ⌘K). Right: "+ Buat" (DRMS 16/10, Alt+N, icon-only under 640px), PT
 * switcher (MC2-4, ./CompanySwitcher.tsx; short label ≤ 768px), bell (server node) and the avatar menu (profile &
 * signature, account security / 2FA, light/dark theme, logout = the existing LogoutButton form).
 * Keyboard: ↓/Enter/Space opens a menu, ↑/↓ inside, Esc closes and returns focus, visible focus rings (custom.scss).
 * Reduced motion: MotionConfig reducedMotion="user". Below the bar: the breadcrumb line (PageCrumbs) — only on
 * pages that have crumbs.
 */

type Props = {
  modules: ResolvedModule[]
  user: NavUser
  companies?: SwitcherState
  quickCreate?: QuickCreateGroup[]
  bell: React.ReactNode
  logout: React.ReactNode
  /** D2510: desktop sidebar width from the `pk-side` cookie (server), so the first paint has the right column. */
  sidebarMode?: SidebarMode
}

const EASE = [0.22, 1, 0.36, 1] as const
const MENU_ANIM = {
  initial: { opacity: 0, y: -6, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.16, ease: EASE } },
  exit: { opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.1 } },
}

function focusables(root: HTMLElement | null): HTMLElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')) : []
}

function moveFocus(list: HTMLElement[], current: Element | null, delta: number | 'first' | 'last') {
  if (!list.length) return
  const i = list.indexOf(current as HTMLElement)
  const next = delta === 'first' ? 0 : delta === 'last' ? list.length - 1 : (i + delta + list.length) % list.length
  list[next]?.focus()
}

const MOVES: Record<string, number | 'first' | 'last'> = { ArrowDown: 1, ArrowUp: -1, Home: 'first', End: 'last' }

/** ↑/↓/Home/End inside an open menu, Esc closes it and returns focus to its trigger. */
function onMenuKeys(e: React.KeyboardEvent, root: HTMLElement | null, close: (refocus: boolean) => void) {
  const mv = MOVES[e.key]
  if (mv !== undefined) {
    e.preventDefault()
    moveFocus(focusables(root), document.activeElement, mv)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    close(true)
  }
}

/** Focus leaving the dropdown (Tab, click elsewhere) closes it. */
function closeOnFocusOut(e: React.FocusEvent<HTMLElement>, setOpen: (v: boolean) => void) {
  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
}

// ------------------------------------------------------------------------------ avatar menu

function AvatarMenu({ user, logout, open, setOpen }: { user: NavUser; logout: React.ReactNode; open: boolean; setOpen: (v: boolean) => void }) {
  const { theme, setTheme } = useTheme()
  const id = useId()
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) requestAnimationFrame(() => focusables(menu.current)[0]?.focus())
  }, [open])
  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) btn.current?.focus()
  }
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <div className="pk-bar__dd pk-bar__dd--end" data-open={open || undefined} onBlur={(e) => closeOnFocusOut(e, setOpen)}>
      <button
        ref={btn}
        type="button"
        className="pk-bar__avatar"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Akun: ${user.name}`}
        title={user.name}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
          }
        }}
        data-pk-avatar
      >
        <span aria-hidden="true">{user.initials}</span>
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            ref={menu}
            id={id}
            className="pk-bar__menu pk-bar__menu--account"
            role="group"
            aria-label="Menu akun"
            {...MENU_ANIM}
            onKeyDown={(e) => onMenuKeys(e, menu.current, close)}
          >
            <div className="pk-bar__who">
              <strong>{user.name}</strong>
              <span>{user.roleLabel}</span>
              {user.email ? <span className="pk-bar__email">{user.email}</span> : null}
            </div>
            <Link href={profileHref(user)} className="pk-bar__menu-link" data-pk-nav-link="profile" onClick={() => close(false)}>
              <Icon name="userEdit" size={18} />
              <span className="pk-bar__label">Profil &amp; tanda tangan</span>
            </Link>
            <Link href="/admin/keamanan-akun" className="pk-bar__menu-link" data-pk-nav-link="account-security" onClick={() => close(false)}>
              <Icon name="shieldLock" size={18} />
              <span className="pk-bar__label">Keamanan akun</span>
            </Link>
            <button type="button" className="pk-bar__menu-link" onClick={() => setTheme(next)} data-pk-theme-toggle={next}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
              <span className="pk-bar__label">{theme === 'dark' ? 'Tema terang' : 'Tema gelap'}</span>
            </button>
            <div className="pk-bar__logout">
              <Icon name="logout" size={18} />
              {logout}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

// ------------------------------------------------------------------------------ "+ Buat" menu

/** Focus is in a text input / editor: Alt+N is a character there, not the shortcut. */
function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return el.isContentEditable || el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null
}

function QuickCreateMenu({ groups, open, setOpen }: { groups: QuickCreateGroup[]; open: boolean; setOpen: (v: boolean) => void }) {
  const id = useId()
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) requestAnimationFrame(() => focusables(menu.current)[0]?.focus())
  }, [open])
  // Alt+N anywhere (outside text inputs) opens the menu with the first item focused
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isQuickCreateShortcut(e, isTyping(e.target))) return
      e.preventDefault()
      if (open) requestAnimationFrame(() => focusables(menu.current)[0]?.focus())
      else setOpen(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, setOpen])
  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) btn.current?.focus()
  }
  return (
    <div className="pk-bar__dd pk-bar__dd--end pk-quick" data-open={open || undefined} onBlur={(e) => closeOnFocusOut(e, setOpen)} data-pk-quick-create>
      <button
        ref={btn}
        type="button"
        className="pk-quick__btn"
        aria-expanded={open}
        aria-controls={id}
        aria-label="Buat baru"
        aria-keyshortcuts="Alt+N"
        title="Buat baru (Alt+N)"
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
          }
        }}
        data-pk-nav-link="quick-create"
      >
        <Icon name="add" size={20} />
        <span className="pk-quick__text" aria-hidden="true">
          Buat
        </span>
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div ref={menu} id={id} className="pk-bar__menu pk-quick__menu" role="group" aria-label="Buat baru" {...MENU_ANIM} onKeyDown={(e) => onMenuKeys(e, menu.current, close)}>
            {groups.map((g) => (
              <div key={g.id} className="pk-quick__group" role="group" aria-labelledby={`${id}-${g.id}`} data-mod={g.mod}>
                <div className="pk-quick__head" id={`${id}-${g.id}`}>
                  {g.label}
                </div>
                {g.items.map((it) => (
                  <Link key={it.key} href={it.href} className="pk-bar__menu-link pk-quick__link" data-pk-quick={it.key} onClick={() => close(false)}>
                    <span className="pk-quick__chip" aria-hidden="true">
                      <Icon name={it.icon} size={16} />
                    </span>
                    <span className="pk-bar__label">{it.label}</span>
                  </Link>
                ))}
              </div>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

// ------------------------------------------------------------------------------ breadcrumbs

/**
 * Payload's step-nav items, but only while they belong to the current pathname: custom views never
 * set steps, so after a client navigation from an edit view the old steps would linger. The steps
 * are stamped with the path they were set on (state adjusted during render, no effect).
 */
function useOwnedSteps(pathname: string) {
  const { stepNav } = useStepNav()
  const [owned, setOwned] = useState<{ nav: typeof stepNav; path: string } | null>(null)
  if (owned?.nav !== stepNav) setOwned({ nav: stepNav, path: pathname })
  const nav = owned?.nav === stepNav ? owned : { nav: stepNav, path: pathname }
  return nav.path === pathname && nav.nav.length ? nav.nav : null
}

/**
 * Slim breadcrumb line under the bar (replaces Payload's AppHeader row — its lone graphics-Icon home
 * crumb and the empty row on pages without crumbs). Home = current module; see ./crumbs.ts.
 */
function PageCrumbs({ pathname, mod }: { pathname: string; mod: ResolvedModule | null }) {
  const { i18n } = useTranslation()
  const steps = useOwnedSteps(pathname)
  const crumbs = deriveCrumbs({
    pathname,
    module: mod,
    steps,
    translate: (l) => (typeof l === 'string' ? l : l && typeof l === 'object' ? getTranslation(l as Record<string, string>, i18n) : ''),
  })
  if (!crumbs.length) return null
  return (
    <nav className="pk-crumbs" aria-label="Lokasi halaman" data-pk-crumbs>
      <ol className="pk-crumbs__list">
        {crumbs.map((c) => (
          <li key={c.key} className="pk-crumbs__item" data-home={c.key === 'home' || undefined}>
            {c.href ? (
              <Link href={c.href} className="pk-crumbs__link" data-pk-crumb={c.key} data-mod={c.mod} title={c.label}>
                <CrumbInner c={c} />
              </Link>
            ) : (
              <span className="pk-crumbs__current" aria-current="page" data-pk-crumb={c.key} data-mod={c.mod} title={c.label}>
                <CrumbInner c={c} />
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

function CrumbInner({ c }: { c: Crumb }) {
  return (
    <>
      {c.icon ? (
        <span className="pk-crumbs__chip" aria-hidden="true">
          <Icon name={c.icon} size={12} />
        </span>
      ) : null}
      <span className="pk-crumbs__label">{c.label}</span>
    </>
  )
}

// ------------------------------------------------------------------------------ bar

export function ModuleBar({ modules, user, companies, quickCreate, bell, logout, sidebarMode = 'full' }: Props) {
  const pathname = usePathname() ?? '/admin'
  const modId = moduleForPath(pathname)
  const mod = useMemo(() => modules.find((m) => m.id === modId) ?? null, [modules, modId])
  const entries = useMemo(() => navEntries(modules), [modules])

  // Menus remember the path they were opened on → navigating closes them (no effect needed).
  const [openState, setOpenState] = useState<{ path: string; key: string } | null>(null)
  const openKey = openState?.path === pathname ? openState.key : null
  const setOpenKey = useCallback((key: string | null) => setOpenState(key ? { path: pathname, key } : null), [pathname])
  // ≤ 768px: the PT switcher shows its short label
  const [compact, setCompact] = useState(false)
  // D2510: ≤ 1024px the sidebar is an off-canvas drawer (openKey 'side'); wider it is full or compact (cookie)
  const [narrow, setNarrow] = useState(false)
  const [sideCompact, setSideCompact] = useState(sidebarMode === 'compact')
  const [palette, setPalette] = useState(false)
  const drawer = narrow && openKey === 'side'

  const toggleSide = () => {
    if (narrow) return setOpenKey(drawer ? null : 'side')
    const next = !sideCompact
    setSideCompact(next)
    try {
      document.cookie = sidebarCookie(next ? 'compact' : 'full')
    } catch {
      // cookies blocked: the mode lasts until the next reload
    }
  }

  // outside click / Esc (menus handle their own Esc for focus return)
  useEffect(() => {
    if (!openKey || openKey === 'side') return
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.('.pk-bar__dd[data-open]')) setOpenKey(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenKey(null)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openKey, setOpenKey])

  // Ctrl+K / ⌘K anywhere opens the menu search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteShortcut(e)) return
      e.preventDefault()
      setOpenKey(null)
      setPalette(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [setOpenKey])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const side = window.matchMedia('(max-width: 1024px)')
    const on = () => {
      setCompact(mq.matches)
      setNarrow(side.matches)
    }
    on()
    mq.addEventListener('change', on)
    side.addEventListener('change', on)
    return () => {
      mq.removeEventListener('change', on)
      side.removeEventListener('change', on)
    }
  }, [])

  const searchBtn = useRef<HTMLButtonElement>(null)
  const closePalette = useCallback(() => {
    setPalette(false)
    requestAnimationFrame(() => searchBtn.current?.focus())
  }, [])

  return (
    <MotionConfig reducedMotion="user">
      <AppSidebar
        modules={modules}
        user={user}
        pathname={pathname}
        compact={sideCompact}
        open={drawer}
        onClose={() => drawer && setOpenKey(null)}
        onToggleCompact={toggleSide}
      />
      <header className="pk-bar" data-pk-nav="bar" data-compact={compact || undefined} data-module={mod?.id ?? 'home'}>
        <div className="pk-bar__start">
          <button
            type="button"
            className="pk-bar__icon-btn pk-bar__side-toggle"
            aria-controls="pk-side"
            aria-expanded={narrow ? drawer : !sideCompact}
            aria-label={narrow ? 'Buka menu' : sideCompact ? 'Lebarkan menu' : 'Ringkas menu'}
            title="Menu"
            onClick={toggleSide}
            data-pk-nav-link="sidebar-toggle"
          >
            <Icon name="menu" size={22} />
          </button>
          <button ref={searchBtn} type="button" className="pk-bar__search" onClick={() => setPalette(true)} aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K" data-pk-nav-link="search">
            <Icon name="search" size={18} />
            <span className="pk-bar__search-text">Cari menu…</span>
            <kbd className="pk-bar__kbd" aria-hidden="true">
              Ctrl K
            </kbd>
          </button>
        </div>

        <div className="pk-bar__end">
          {quickCreate?.length ? <QuickCreateMenu groups={quickCreate} open={openKey === 'quick'} setOpen={(v) => setOpenKey(v ? 'quick' : null)} /> : null}
          {companies ? <CompanySwitcher state={companies} compact={compact} open={openKey === 'company'} setOpen={(v) => setOpenKey(v ? 'company' : null)} /> : null}
          {bell}
          <AvatarMenu user={user} logout={logout} open={openKey === 'account'} setOpen={(v) => setOpenKey(v ? 'account' : null)} />
        </div>
      </header>
      <PageCrumbs pathname={pathname} mod={mod} />
      {palette ? <CommandPalette entries={entries} onClose={closePalette} /> : null}
    </MotionConfig>
  )
}

export default ModuleBar
