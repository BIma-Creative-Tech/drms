'use client'

import { getTranslation } from '@payloadcms/translations'
import { useStepNav, useTheme, useTranslation } from '@payloadcms/ui'
import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import { Icon } from '@/admin/modules/Icon'
import { moduleForPath, profileHref, type ResolvedModule } from '@/admin/modules/registry'
import { BRAND_NAME } from '@/theme/graphics'

import type { SwitcherState } from './company-switcher'
import { CompanySwitcher } from './CompanySwitcher'
import { deriveCrumbs, type Crumb } from './crumbs'
import type { NavUser } from './modules-server'
import { isQuickCreateShortcut, type QuickCreateGroup } from './quick-create'

/**
 * Odoo-style top bar (client). Left: launcher button (⊞ → /admin) + current module (link to the module
 * landing page, D9). Right: PT switcher (MC2-4, ./CompanySwitcher.tsx), bell (server node) + avatar
 * menu (profile & signature, account security / 2FA, light/dark theme, logout = the existing
 * LogoutButton form).
 * DRMS 13/10 #9 (owner decision D2): the module menu (links/▾ dropdowns + the ☰ sheet on mobile) is
 * gone from the bar; every former menu entry is a tile of the module landing page (registry
 * landingSections = the same resolved items), reachable via the module name and the breadcrumb home.
 * Compact mode (≤ 768px): shorter PT label. Keyboard: ↓/Enter/Space opens a menu, ↑/↓ inside, Esc
 * closes and returns focus, visible focus rings (custom.scss). Reduced motion: MotionConfig
 * reducedMotion="user". Below the bar: the breadcrumb line (PageCrumbs) — only on pages that have crumbs.
 * DRMS 16/10 (owner, "konsep no. 1"): "+ Buat" menu left of the PT switcher — create pages of what the caller may
 * create (items resolved on the server, ./quick-create.ts), grouped; Alt+N opens it; icon-only "+" under 640px.
 */

type Props = { modules: ResolvedModule[]; user: NavUser; companies?: SwitcherState; quickCreate?: QuickCreateGroup[]; bell: React.ReactNode; logout: React.ReactNode }

const EASE = [0.22, 1, 0.36, 1] as const
const MENU_ANIM = {
  initial: { opacity: 0, y: -6, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.16, ease: EASE } },
  exit: { opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.1 } },
}

function Badge({ n, label }: { n?: number; label?: string }) {
  if (!n) return null
  return (
    <span className="pk-bar__count" aria-label={label ?? `${n} menunggu`}>
      {n > 99 ? '99+' : n}
    </span>
  )
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

export function ModuleBar({ modules, user, companies, quickCreate, bell, logout }: Props) {
  const pathname = usePathname() ?? '/admin'
  const modId = moduleForPath(pathname)
  const mod = useMemo(() => modules.find((m) => m.id === modId) ?? null, [modules, modId])

  // Menus remember the path they were opened on → navigating closes them (no effect needed).
  const [openState, setOpenState] = useState<{ path: string; key: string } | null>(null)
  const openKey = openState?.path === pathname ? openState.key : null
  const setOpenKey = useCallback((key: string | null) => setOpenState(key ? { path: pathname, key } : null), [pathname])
  // ≤ 768px: the PT switcher shows its short label (the bar no longer measures a menu, DRMS 13/10 #9)
  const [compact, setCompact] = useState(false)

  // outside click / Esc (menus handle their own Esc for focus return)
  useEffect(() => {
    if (!openKey) return
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

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const on = () => setCompact(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  return (
    <MotionConfig reducedMotion="user">
      <header className="pk-bar" data-pk-nav="bar" data-compact={compact || undefined} data-module={mod?.id ?? 'launcher'}>
        <div className="pk-bar__start">
          <Link href="/admin" className="pk-bar__icon-btn pk-bar__launcher" aria-label="Semua modul" title="Semua modul" data-pk-nav-link="launcher" aria-current={pathname.replace(/\/+$/, '') === '/admin' ? 'page' : undefined}>
            <Icon name="grid" size={22} />
          </Link>
          {mod ? (
            // DRMS 13/10 #9: no module menu in the bar any more — the module name opens the module
            // landing page (D9 tiles = exactly the old menu items, with their badges).
            <Link href={mod.href} className="pk-bar__module" data-mod={mod.id} data-pk-nav-link="module-home" title={mod.landing ? `Menu ${mod.label}` : mod.label}>
              <span className="pk-bar__chip" aria-hidden="true">
                <Icon name={mod.icon} size={18} />
              </span>
              <span className="pk-bar__module-name">{mod.label}</span>
              <Badge n={mod.badge} />
            </Link>
          ) : (
            <span className="pk-bar__module pk-bar__brand">
              {BRAND_NAME}
            </span>
          )}
        </div>

        <div className="pk-bar__end">
          {quickCreate?.length ? <QuickCreateMenu groups={quickCreate} open={openKey === 'quick'} setOpen={(v) => setOpenKey(v ? 'quick' : null)} /> : null}
          {companies ? <CompanySwitcher state={companies} compact={compact} open={openKey === 'company'} setOpen={(v) => setOpenKey(v ? 'company' : null)} /> : null}
          {bell}
          <AvatarMenu user={user} logout={logout} open={openKey === 'account'} setOpen={(v) => setOpenKey(v ? 'account' : null)} />
        </div>
      </header>
      <PageCrumbs pathname={pathname} mod={mod} />
    </MotionConfig>
  )
}

export default ModuleBar
