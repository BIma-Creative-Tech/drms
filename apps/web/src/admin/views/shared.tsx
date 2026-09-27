import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import type { AdminViewServerProps, PayloadRequest } from 'payload'
import React from 'react'

import { hasRole, type Role } from '@/access/roles'
import { formatRupiah } from '@/lib/money'

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

export function Forbidden({ props, title, roles }: { props: AdminViewServerProps; title: string; roles: Role[] }) {
  return (
    <Shell props={props} title={title}>
      <p>Halaman ini hanya untuk peran: {roles.join(', ')}.</p>
    </Shell>
  )
}

export function allowed(req: PayloadRequest, roles: Role[]): boolean {
  return hasRole(req, ...roles)
}

export const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
export const th: React.CSSProperties = { textAlign: 'left', borderBottom: '2px solid var(--theme-elevation-150)', padding: '6px 8px', whiteSpace: 'nowrap' }
export const td: React.CSSProperties = { borderBottom: '1px solid var(--theme-elevation-100)', padding: '6px 8px', verticalAlign: 'top' }
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

export const rp = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatRupiah(v))

export function docLink(id: number, label: string) {
  return <a href={`/admin/collections/expense-requests/${id}`}>{label}</a>
}

export function Empty({ text }: { text: string }) {
  return <p style={{ color: 'var(--theme-elevation-600)' }}>{text}</p>
}
