'use client'

import { getTranslation } from '@payloadcms/translations'
import { useStepNav, useTheme, useTranslation } from '@payloadcms/ui'
import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Icon } from '@/admin/modules/Icon'
import { activeHref, moduleForPath, profileHref, type ResolvedItem, type ResolvedModule, type ResolvedSection } from '@/admin/modules/registry'

import { deriveCrumbs, type Crumb } from './crumbs'
import type { NavUser } from './modules-server'

/**
 * Odoo-style top bar (client). Left: launcher button (⊞ → /admin) + current module. Middle: the
 * module menu — an unlabelled section = plain links, a labelled section with several items = ▾
 * dropdown; the active entry carries an animated pill (motion layoutId). Right: bell (server node)
 * + avatar menu (profile & signature, account security / 2FA, light/dark theme, logout = the existing
 * LogoutButton form).
 * Compact mode (≤ 768px OR the menu does not fit): ☰ opens a sheet with the whole module menu —
 * no horizontal scroll at 390px. Keyboard: ←/→/Home/End between top-level entries, ↓/Enter/Space
 * opens a dropdown, ↑/↓ inside, Esc closes and returns focus, visible focus rings (custom.scss),
 * aria-current="page" on the active link. Reduced motion: MotionConfig reducedMotion="user".
 * Below the bar: the breadcrumb line (PageCrumbs) — only on pages that have crumbs.
 */

type Props = { modules: ResolvedModule[]; user: NavUser; bell: React.ReactNode; logout: React.ReactNode }

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

// ------------------------------------------------------------------------------ dropdown

function Dropdown({
  section,
  active,
  current,
  open,
  setOpen,
}: {
  section: ResolvedSection
  active: boolean
  current: string | null
  open: boolean
  setOpen: (v: boolean) => void
}) {
  const id = useId()
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const badge = section.items.reduce((n, i) => n + (i.badge ?? 0), 0)

  useEffect(() => {
    if (open) requestAnimationFrame(() => focusables(menu.current)[0]?.focus())
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) btn.current?.focus()
  }

  return (
    <div className="pk-bar__dd" data-open={open || undefined} onBlur={(e) => closeOnFocusOut(e, setOpen)}>
      <button
        ref={btn}
        type="button"
        className="pk-bar__link"
        aria-expanded={open}
        aria-controls={id}
        data-active={active || undefined}
        data-pk-top
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        {active ? <motion.span layoutId="pk-bar-pill" className="pk-bar__pill" transition={{ type: 'spring', stiffness: 520, damping: 38 }} /> : null}
        <span className="pk-bar__label">{section.label}</span>
        <Badge n={badge} />
        <Icon name="chevronDown" size={14} className="pk-bar__chev" />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            ref={menu}
            id={id}
            className="pk-bar__menu"
            role="group"
            aria-label={section.label}
            {...MENU_ANIM}
            onKeyDown={(e) => onMenuKeys(e, menu.current, close)}
          >
            {section.items.map((it) => (
              <MenuLink key={it.key} item={it} current={current} onNavigate={() => close(false)} />
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function MenuLink({ item, current, onNavigate }: { item: ResolvedItem; current: string | null; onNavigate?: () => void }) {
  const isCurrent = current === item.href
  return (
    <Link
      href={item.href}
      className="pk-bar__menu-link"
      aria-current={isCurrent ? 'page' : undefined}
      data-pk-nav-link={item.navKey}
      data-kind={item.kind}
      onClick={onNavigate}
    >
      <span className="pk-bar__label">{item.label}</span>
      <Badge n={item.badge} />
    </Link>
  )
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

// ------------------------------------------------------------------------------ mobile sheet

function Sheet({ mod, modules, current, onClose }: { mod: ResolvedModule | null; modules: ResolvedModule[]; current: string | null; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    requestAnimationFrame(() => focusables(panel.current)[0]?.focus())
    return () => {
      document.body.style.overflow = overflow
      prev?.focus?.()
    }
  }, [])
  return (
    <motion.div className="pk-sheet" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
      <div className="pk-sheet__scrim" onClick={onClose} aria-hidden="true" />
      <motion.div
        ref={panel}
        className="pk-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-label={mod ? `Menu ${mod.label}` : 'Menu'}
        initial={{ x: '100%' }}
        animate={{ x: 0, transition: { duration: 0.24, ease: EASE } }}
        exit={{ x: '100%', transition: { duration: 0.16 } }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          } else if (e.key === 'Tab') {
            // focus trap inside the modal sheet
            const list = focusables(panel.current)
            const edge = e.shiftKey ? list[0] : list[list.length - 1]
            if (document.activeElement === edge) {
              e.preventDefault()
              ;(e.shiftKey ? list[list.length - 1] : list[0])?.focus()
            }
          }
        }}
      >
        <div className="pk-sheet__head">
          {mod ? (
            <span className="pk-bar__module" data-mod={mod.id}>
              <span className="pk-bar__chip" aria-hidden="true">
                <Icon name={mod.icon} size={18} />
              </span>
              {mod.label}
            </span>
          ) : (
            <span className="pk-bar__module">Menu</span>
          )}
          <button type="button" className="pk-bar__icon-btn" onClick={onClose} aria-label="Tutup menu">
            <Icon name="close" size={22} />
          </button>
        </div>
        <nav className="pk-sheet__body" aria-label={mod ? `Menu ${mod.label}` : 'Modul'}>
          <Link href="/admin" className="pk-sheet__all" onClick={onClose} data-pk-nav-link="launcher-sheet">
            <Icon name="grid" size={18} /> Semua modul
          </Link>
          {mod
            ? mod.sections.map((s) => (
                <div key={s.key} className="pk-sheet__section">
                  {s.label ? <div className="pk-sheet__label">{s.label}</div> : null}
                  {s.items.map((it) => (
                    <MenuLink key={it.key} item={it} current={current} onNavigate={onClose} />
                  ))}
                </div>
              ))
            : modules.map((m) => (
                <Link key={m.id} href={m.href} className="pk-bar__menu-link" onClick={onClose} data-mod={m.id}>
                  <span className="pk-bar__chip pk-bar__chip--sm" aria-hidden="true">
                    <Icon name={m.icon} size={14} />
                  </span>
                  <span className="pk-bar__label">{m.label}</span>
                  <Badge n={m.badge} />
                </Link>
              ))}
        </nav>
      </motion.div>
    </motion.div>
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

export function ModuleBar({ modules, user, bell, logout }: Props) {
  const pathname = usePathname() ?? '/admin'
  const modId = moduleForPath(pathname)
  const mod = useMemo(() => modules.find((m) => m.id === modId) ?? null, [modules, modId])
  const current = useMemo(() => (mod ? activeHref(pathname, mod.sections.flatMap((s) => s.items.map((i) => i.href))) : null), [mod, pathname])

  // Menus/sheet remember the path they were opened on → navigating closes them (no effect needed).
  const [openState, setOpenState] = useState<{ path: string; key: string } | null>(null)
  const [sheetPath, setSheetPath] = useState<string | null>(null)
  const openKey = openState?.path === pathname ? openState.key : null
  const setOpenKey = useCallback((key: string | null) => setOpenState(key ? { path: pathname, key } : null), [pathname])
  const sheet = sheetPath === pathname
  const setSheet = (v: boolean) => setSheetPath(v ? pathname : null)
  const [compact, setCompact] = useState(false)
  const bar = useRef<HTMLElement>(null)
  const mid = useRef<HTMLDivElement>(null)
  const nav = useRef<HTMLElement>(null)

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

  // compact when the viewport is narrow or the menu does not fit its slot
  const measure = useCallback(() => {
    const narrow = window.matchMedia('(max-width: 768px)').matches
    const overflow = !!nav.current && !!mid.current && nav.current.scrollWidth > mid.current.clientWidth + 1
    setCompact(narrow || overflow)
  }, [])
  useLayoutEffect(() => {
    measure()
    const ro = new ResizeObserver(measure)
    if (mid.current) ro.observe(mid.current)
    if (bar.current) ro.observe(bar.current)
    return () => ro.disconnect()
  }, [measure, mod])

  const onNavKey = (e: React.KeyboardEvent) => {
    const tops = Array.from(nav.current?.querySelectorAll<HTMLElement>('[data-pk-top]') ?? [])
    if (!tops.includes(document.activeElement as HTMLElement)) return
    const mv = ({ ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' } as Record<string, number | 'first' | 'last'>)[e.key]
    if (mv === undefined) return
    e.preventDefault()
    setOpenKey(null)
    moveFocus(tops, document.activeElement, mv)
  }

  const sectionActive = (s: ResolvedSection) => !!current && s.items.some((i) => i.href === current)

  return (
    <MotionConfig reducedMotion="user">
      <header ref={bar} className="pk-bar" data-pk-nav="bar" data-compact={compact || undefined} data-module={mod?.id ?? 'launcher'}>
        <div className="pk-bar__start">
          <Link href="/admin" className="pk-bar__icon-btn pk-bar__launcher" aria-label="Semua modul" title="Semua modul" data-pk-nav-link="launcher" aria-current={pathname.replace(/\/+$/, '') === '/admin' ? 'page' : undefined}>
            <Icon name="grid" size={22} />
          </Link>
          {mod ? (
            <Link href={mod.href} className="pk-bar__module" data-mod={mod.id}>
              <span className="pk-bar__chip" aria-hidden="true">
                <Icon name={mod.icon} size={18} />
              </span>
              <span className="pk-bar__module-name">{mod.label}</span>
            </Link>
          ) : (
            <span className="pk-bar__module pk-bar__brand">
              ProyekKas <span className="pk-bar__brand-sub">DRMS</span>
            </span>
          )}
        </div>

        <div ref={mid} className="pk-bar__mid">
          {mod ? (
            <nav ref={nav} className="pk-bar__nav" aria-label={`Menu ${mod.label}`} onKeyDown={onNavKey} aria-hidden={compact || undefined} inert={compact || undefined}>
              {mod.sections.map((s) =>
                s.label && s.items.length > 1 ? (
                  <Dropdown key={s.key} section={s} active={sectionActive(s)} current={current} open={openKey === s.key} setOpen={(v) => setOpenKey(v ? s.key : null)} />
                ) : (
                  s.items.map((it) => {
                    const on = current === it.href
                    return (
                      <Link key={it.key} href={it.href} className="pk-bar__link" data-pk-top data-active={on || undefined} aria-current={on ? 'page' : undefined} data-pk-nav-link={it.navKey} data-kind={it.kind}>
                        {on ? <motion.span layoutId="pk-bar-pill" className="pk-bar__pill" transition={{ type: 'spring', stiffness: 520, damping: 38 }} /> : null}
                        <span className="pk-bar__label">{it.label}</span>
                        <Badge n={it.badge} />
                      </Link>
                    )
                  })
                ),
              )}
            </nav>
          ) : null}
        </div>

        <div className="pk-bar__end">
          {bell}
          <AvatarMenu user={user} logout={logout} open={openKey === 'account'} setOpen={(v) => setOpenKey(v ? 'account' : null)} />
          {compact ? (
            <button type="button" className="pk-bar__icon-btn pk-bar__burger" aria-label={mod ? `Buka menu ${mod.label}` : 'Buka menu modul'} aria-expanded={sheet} aria-haspopup="dialog" onClick={() => setSheet(true)} data-pk-burger>
              <Icon name="menu" size={22} />
            </button>
          ) : null}
        </div>
      </header>
      <PageCrumbs pathname={pathname} mod={mod} />
      <AnimatePresence>{sheet ? <Sheet mod={mod} modules={modules} current={current} onClose={() => setSheet(false)} /> : null}</AnimatePresence>
    </MotionConfig>
  )
}

export default ModuleBar
