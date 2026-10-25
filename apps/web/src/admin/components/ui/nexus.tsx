import React from 'react'

import { Icon } from '@/admin/modules/Icon'
import type { IconName } from '@/admin/modules/icons'

/**
 * D2510 (ADR 0033): the shared Nexus-style building blocks of the admin pages — daisyUI's card / badge-soft /
 * status / progress patterns rebuilt on the `--pk-*` tokens (styles: custom.scss "Nexus kit", class prefix
 * `pk-nx-`). No hooks → server and client components. Dashboard, list/edit chrome and the custom pages use these
 * instead of their own card/badge markup so every page reads as one system.
 */

export type Tone = 'primary' | 'ok' | 'warn' | 'bad' | 'info' | 'neutral'

/** Page title row: optional module chip, title, one muted line, actions on the right (wrap under 640px). */
export function PageHeader({ title, sub, icon, mod, actions, id }: { title: React.ReactNode; sub?: React.ReactNode; icon?: IconName; mod?: string; actions?: React.ReactNode; id?: string }) {
  return (
    <header className="pk-nx-head" data-mod={mod} data-pk-page-head>
      {icon ? (
        <span className="pk-nx-head__chip" aria-hidden="true">
          <Icon name={icon} size={22} />
        </span>
      ) : null}
      <div className="pk-nx-head__text">
        <h1 className="pk-nx-head__title" id={id}>
          {title}
        </h1>
        {sub ? <p className="pk-nx-head__sub">{sub}</p> : null}
      </div>
      {actions ? <div className="pk-nx-head__actions">{actions}</div> : null}
    </header>
  )
}

/** Card (Nexus `card bg-base-100`): head = glyph + title (+ muted note) + actions, body, optional foot. */
export function Panel({
  title,
  icon,
  note,
  actions,
  foot,
  flush,
  id,
  className,
  children,
  ...rest
}: {
  title?: React.ReactNode
  icon?: IconName
  note?: React.ReactNode
  actions?: React.ReactNode
  foot?: React.ReactNode
  /** Body without padding (a table that runs edge to edge). */
  flush?: boolean
  id?: string
  className?: string
  children?: React.ReactNode
} & Record<`data-${string}`, string | undefined>) {
  const hid = id ? `${id}-title` : undefined
  return (
    <section className={`pk-nx-card${className ? ` ${className}` : ''}`} id={id} aria-labelledby={title ? hid : undefined} {...rest}>
      {title || actions ? (
        <div className="pk-nx-card__head">
          {icon ? <Icon name={icon} size={18} className="pk-nx-card__glyph" /> : null}
          {title ? (
            <h2 className="pk-nx-card__title" id={hid}>
              {title}
              {note ? <span className="pk-nx-card__note">{note}</span> : null}
            </h2>
          ) : null}
          {actions ? <div className="pk-nx-card__actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className={`pk-nx-card__body${flush ? ' is-flush' : ''}`}>{children}</div>
      {foot ? <div className="pk-nx-card__foot">{foot}</div> : null}
    </section>
  )
}

/** Soft badge (daisyUI `badge badge-soft`): tinted pill, readable text in both modes. */
export function SoftBadge({ tone = 'neutral', children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span className="pk-nx-badge" data-tone={tone} title={title}>
      {children}
    </span>
  )
}

/** Status dot + label (daisyUI `status`), e.g. a metric legend. */
export function StatusDot({ tone = 'primary', label }: { tone?: Tone; label?: React.ReactNode }) {
  return (
    <span className="pk-nx-status">
      <span className="pk-nx-status__dot" data-tone={tone} aria-hidden="true" />
      {label}
    </span>
  )
}

/** Progress bar (daisyUI `progress`): value 0–100, accessible name required. */
export function Progress({ value, label, tone = 'primary' }: { value: number; label: string; tone?: Tone }) {
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  return (
    <span className="pk-nx-progress" data-tone={tone} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)}>
      <span className="pk-nx-progress__bar" style={{ width: `${v}%` }} />
    </span>
  )
}
