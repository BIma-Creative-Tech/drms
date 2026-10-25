'use client'

import Link from 'next/link'
import React, { useEffect, useId, useRef, useState } from 'react'

import { Icon } from '@/admin/modules/Icon'
import { activeHref, itemIcon, moduleForPath, profileHref, type ModuleId, type ResolvedModule } from '@/admin/modules/registry'
import { BRAND_NAME, BRAND_PRODUCT, BrandMark } from '@/theme/graphics'

import type { NavUser } from './modules-server'

/**
 * D2510 (user 2026-10-25, ADR 0033): Nexus-style left sidebar — replaces the Odoo launcher/landing navigation of
 * ADR 0014 as the primary menu. One group per visible module (registry resolveModules, the same items the module
 * landing pages show): a single-item module is a plain link, a module with more items is a collapsible group with
 * its section labels as sub-headings. The group of the current page opens by itself; the others remember what the
 * user toggled until the next reload. Badges = the module/item counts of the server.
 * Desktop: full (264px) or compact (icons only, expands as an overlay on hover/focus) — `mode`, remembered in the
 * `pk-side` cookie by the bar. ≤ 1024px: off-canvas drawer (`open`), closed by the backdrop, Esc or navigating.
 * Footer: the caller (initials, name, role) → profile page.
 */

type Props = {
  modules: ResolvedModule[]
  user: NavUser
  pathname: string
  compact: boolean
  open: boolean
  onClose: () => void
  onToggleCompact: () => void
}

function Count({ n }: { n?: number }) {
  if (!n) return null
  return (
    <span className="pk-side__count" aria-hidden="true">
      {n > 99 ? '99+' : n}
    </span>
  )
}

const withCount = (label: string, n?: number) => (n ? `${label}, ${n} menunggu` : label)

export function AppSidebar({ modules, user, pathname, compact, open, onClose, onToggleCompact }: Props) {
  const uid = useId()
  const activeMod = moduleForPath(pathname)
  // user toggles of the groups (undefined = default: only the current module's group is open)
  const [toggled, setToggled] = useState<Partial<Record<ModuleId, boolean>>>({})
  const isOpen = (id: ModuleId) => toggled[id] ?? id === activeMod
  const aside = useRef<HTMLElement>(null)
  // drawer opened (≤ 1024px): keyboard focus moves into it (the current item, else the first link)
  useEffect(() => {
    if (!open) return
    const el = aside.current
    requestAnimationFrame(() => (el?.querySelector<HTMLElement>('[aria-current="page"]') ?? el?.querySelector<HTMLElement>('.pk-side__mod'))?.focus())
  }, [open])
  const clean = (pathname.split(/[?#]/)[0] ?? '').replace(/\/+$/, '')
  const current = activeHref(
    clean,
    modules.flatMap((m) => m.sections.flatMap((s) => s.items.map((i) => i.href))),
  )

  return (
    <>
      <aside
        ref={aside}
        id="pk-side"
        className="pk-side"
        aria-label="Navigasi utama"
        data-pk-nav="sidebar"
        data-compact={compact || undefined}
        data-open={open || undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="pk-side__brand">
          <Link href="/admin/dashboard" className="pk-side__logo" data-pk-nav-link="home" title={BRAND_NAME}>
            <BrandMark size={32} />
            <span className="pk-side__logo-text">
              <strong>{BRAND_NAME}</strong>
              <span>{BRAND_PRODUCT}</span>
            </span>
          </Link>
          <button type="button" className="pk-side__collapse" onClick={onToggleCompact} aria-label={compact ? 'Lebarkan menu' : 'Ringkas menu'} title={compact ? 'Lebarkan menu' : 'Ringkas menu'} aria-pressed={compact} data-pk-side-compact>
            <Icon name="sidebar" size={18} />
          </button>
          <button type="button" className="pk-side__close" onClick={onClose} aria-label="Tutup menu" data-pk-side-close>
            <Icon name="close" size={20} />
          </button>
        </div>

        <nav className="pk-side__scroll" aria-label="Modul">
          {modules.length ? null : <p className="pk-side__empty">Akun Anda belum punya akses ke modul mana pun. Hubungi Admin.</p>}
          <ul className="pk-side__mods">
            {modules.map((m) => {
              const items = m.sections.flatMap((s) => s.items)
              const here = m.id === activeMod
              if (items.length < 2) {
                const it = items[0]!
                return (
                  <li key={m.id} data-mod={m.id}>
                    <Link
                      href={it.href}
                      className="pk-side__mod"
                      data-pk-side-mod={m.id}
                      data-active={here || undefined}
                      aria-current={current === it.href ? 'page' : undefined}
                      aria-label={compact ? withCount(m.label, m.badge) : undefined}
                      title={compact ? m.label : undefined}
                      onClick={onClose}
                    >
                      <span className="pk-side__chip" aria-hidden="true">
                        <Icon name={m.icon} size={18} />
                      </span>
                      <span className="pk-side__label">{m.label}</span>
                      <Count n={m.badge} />
                    </Link>
                  </li>
                )
              }
              const gid = `${uid}-${m.id}`
              const expanded = isOpen(m.id)
              return (
                <li key={m.id} data-mod={m.id} data-open={expanded || undefined}>
                  <button
                    type="button"
                    className="pk-side__mod"
                    aria-expanded={expanded}
                    aria-controls={gid}
                    data-pk-side-mod={m.id}
                    data-active={here || undefined}
                    title={compact ? m.label : undefined}
                    onClick={() => setToggled((t) => ({ ...t, [m.id]: !expanded }))}
                  >
                    <span className="pk-side__chip" aria-hidden="true">
                      <Icon name={m.icon} size={18} />
                    </span>
                    <span className="pk-side__label">{m.label}</span>
                    <Count n={m.badge} />
                    <Icon name="chevronDown" size={14} className="pk-side__chev" />
                  </button>
                  <div id={gid} className="pk-side__sub" hidden={!expanded}>
                    {m.sections.map((s) => (
                      <div key={s.key} className="pk-side__sec">
                        {s.label ? <p className="pk-side__sec-label">{s.label}</p> : null}
                        <ul>
                          {s.items.map((i) => (
                            <li key={i.key}>
                              <Link
                                href={i.href}
                                className="pk-side__item"
                                data-pk-side-link={i.navKey ?? i.href}
                                aria-current={current === i.href ? 'page' : undefined}
                                aria-label={i.badge ? withCount(i.label, i.badge) : undefined}
                                onClick={onClose}
                              >
                                <Icon name={itemIcon(i, m.icon)} size={16} />
                                <span className="pk-side__label">{i.label}</span>
                                <Count n={i.badge} />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="pk-side__foot">
          <Link href={profileHref(user)} className="pk-side__user" data-pk-nav-link="side-profile" title={`${user.name} — profil`} onClick={onClose}>
            <span className="pk-side__avatar" aria-hidden="true">
              {user.initials}
            </span>
            <span className="pk-side__who">
              <strong>{user.name}</strong>
              <span>{user.roleLabel}</span>
            </span>
          </Link>
        </div>
      </aside>
      {open ? <div className="pk-side__backdrop" aria-hidden="true" onClick={onClose} data-pk-side-backdrop /> : null}
    </>
  )
}

export default AppSidebar
