import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import type { AdminViewServerProps, PayloadRequest } from 'payload'
import Link from 'next/link'
import React from 'react'

import { hasRoleAny, type Role } from '@/access/roles'
import { Icon } from '@/admin/modules/Icon'
import { rupiahOrDash } from '@/lib/money'

import { NoAccess } from './NoAccess'

export { TableScroll } from '../components/TableScroll'

/**
 * Shared bits of the F2 admin custom views (architecture §8, phase plan F2 "admin custom views"):
 * root views are rendered WITHOUT a template by Payload 3.90.1 (views/Root/getRouteData.js: custom
 * views get no templateType) → wrap them in the DefaultTemplate (nav + header) ourselves.
 * Everything here is server-rendered text (React escaping); actions are client components that
 * call /api/v1 (the server re-checks every action).
 */
export function Shell({ props, title, children }: { props: AdminViewServerProps; title: string; children: React.ReactNode }) {
  const { initPageResult, params, searchParams } = props
  return (
    <DefaultTemplate
      i18n={initPageResult.req.i18n}
      locale={initPageResult.locale}
      params={params}
      payload={initPageResult.req.payload}
      permissions={initPageResult.permissions}
      searchParams={searchParams}
      user={initPageResult.req.user ?? undefined}
      visibleEntities={initPageResult.visibleEntities}
    >
      <Gutter>
        <h1 style={{ margin: '24px 0 16px' }}>{title}</h1>
        {children}
      </Gutter>
    </DefaultTemplate>
  )
}

/** QA-20(c): the uniform no-access page (title/roles kept for the call sites, never shown). */
export function Forbidden({ props }: { props: AdminViewServerProps; title?: string; roles?: Role[] }) {
  return <NoAccess props={props} />
}

/** QA-MC4-14: `?pt=` names a PT outside the caller's selection (`foreignPtParam`, pt.tsx). */
export function PtNotAllowed({ props, title }: { props: AdminViewServerProps; title: string }) {
  return (
    <Shell props={props} title={title}>
      <p data-pk-denied="pt">PT yang diminta bukan PT Anda (atau tidak termasuk PT yang dipilih di pemilih PT).</p>
    </Shell>
  )
}

export function allowed(req: PayloadRequest, roles: Role[]): boolean {
  return hasRoleAny(req, ...roles)
}

/**
 * DRMS 15/10 #6 (owner: "jarak antar kolom terlalu lebar"): the custom-view tables hug their columns (width auto)
 * instead of spreading a few columns over the whole page; wide ones still scroll inside TableScroll, whose header row
 * stays frozen (custom.scss .pk-tscroll). Cell padding = the generic list (8 × 12 px).
 */
export const table: React.CSSProperties = { width: 'auto', borderCollapse: 'collapse', fontSize: 13 }
export const th: React.CSSProperties = { textAlign: 'left', borderBottom: '2px solid var(--theme-elevation-150)', padding: '8px 12px', whiteSpace: 'nowrap' }
export const td: React.CSSProperties = { borderBottom: '1px solid var(--theme-elevation-100)', padding: '8px 12px', verticalAlign: 'top' }
export const num: React.CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap' }
export const badge = (tone: 'ok' | 'warn' | 'bad' | 'muted'): React.CSSProperties => ({
  display: 'inline-block',
  padding: '1px 6px',
  borderRadius: 8,
  fontSize: 11,
  fontWeight: 600,
  color: tone === 'muted' ? 'var(--theme-elevation-800)' : '#FFFFFF', // ≥ 4.5:1 on every --pk-tone-* (src/theme/tokens.ts)
  background: tone === 'ok' ? 'var(--pk-tone-ok)' : tone === 'warn' ? 'var(--pk-tone-warn)' : tone === 'bad' ? 'var(--pk-tone-bad)' : 'var(--theme-elevation-150)',
})

export const rp = rupiahOrDash

/**
 * Row action "Ubah" in the custom views' tables — the same look as the "Aksi" column of the Payload
 * lists (.pk-row-act, (payload)/custom.scss). The accessible name starts with the visible text and names
 * the row ("Ubah hari libur Natal").
 */
export function EditButton({ href, name }: { href: string; name: string }) {
  return (
    <Link href={href} prefetch={false} className="pk-row-act" data-kind="edit" aria-label={`Ubah ${name}`} data-pk-row-action="edit">
      <Icon name="edit" size={16} />
      <span>Ubah</span>
    </Link>
  )
}

export function docLink(id: number, label: string) {
  return <a href={`/admin/collections/expense-requests/${id}`}>{label}</a>
}

export function Empty({ text }: { text: string }) {
  return <p style={{ color: 'var(--theme-elevation-600)' }}>{text}</p>
}
