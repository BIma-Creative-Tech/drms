import type { AdminViewServerProps, PayloadRequest } from 'payload'
import Link from 'next/link'
import React from 'react'

import { hasRoleAny, type Role } from '@/access/roles'
import { Icon as Glyph } from '@/admin/modules/Icon'
import type { IconName } from '@/admin/modules/icons'
import type { HistoryEntry } from '@/domain/field/web'
import { enabledCompanies } from '@/domain/field/web'
import { UNIT_STATUS_LABELS, type UnitStatus } from '@/domain/field/rules'

import { ImageThumb } from '../components/media/ImageThumb'
import { dateTimeId } from './progress-ui'
import { FIELD_STYLE } from './field-style'
import { Frame } from './frame'
import { NoAccess } from './NoAccess'
import { EmptyState, StatusPill } from './viz'

/**
 * FR1 web views (ADR 0020) — shared server pieces: access gate (role + per-PT feature flag), the
 * page frame with the field styles, tab/chip navigation, status pills, row "Buka" action, photo
 * gallery and change history. Colours only via theme tokens (--pk-*), so light and dark follow
 * html[data-theme]; every action is a button-styled control (.pk-kbtn / .pk-btn / .pk-row-act),
 * ≥ 32 px (44 px on touch); wide tables scroll inside their own box (390 px).
 */
export { FIELD_STYLE } from './field-style'

/** All roles that read field reports (collection access narrows the rows). */
export const FIELD_READERS: readonly Role[] = ['pk-owner', 'pk-finance', 'pk-pm', 'pk-admin', 'pk-staff']
/** Office roles of the recaps (registry rekap-timesheet-kontrak / rekap-aftersales). */
export const FIELD_OFFICE: readonly Role[] = ['pk-owner', 'pk-finance', 'pk-pm', 'pk-admin']
/** Roles that may create field reports (API re-checks assignment/team + flag + kind). */
export const FIELD_CREATORS: readonly Role[] = ['pk-owner', 'pk-pm', 'pk-staff']

export const FEATURE_OFF_HINT = 'Laporan lapangan (servis, timesheet, aftersales) belum diaktifkan untuk PT yang dipilih. Admin grup dapat menyalakannya di Pengaturan › Perusahaan.'

/**
 * Gate of every field view: a role from `roles` and at least one selected PT with
 * companies.fieldReportsEnabled. Returns the enabled PTs, or the page to render instead.
 */
export async function fieldGate(props: AdminViewServerProps, roles: readonly Role[]): Promise<{ ok: true; companies: number[] } | { ok: false; page: React.ReactElement }> {
  const req = props.initPageResult.req as PayloadRequest
  if (!hasRoleAny(req, ...roles)) return { ok: false, page: <NoAccess props={props} /> }
  const companies = await enabledCompanies(req)
  if (companies.length === 0) return { ok: false, page: <NoAccess props={props} hint={<span data-pk-feature-off="fieldReports">{FEATURE_OFF_HINT}</span>} /> }
  return { ok: true, companies }
}

export function FieldFrame({ props, name, children }: { props: AdminViewServerProps; name: string; children: React.ReactNode }) {
  return (
    <Frame props={props} name={name}>
      <style>{FIELD_STYLE}</style>
      {children}
    </Frame>
  )
}

export const segmentNum = (props: AdminViewServerProps, index: number): number => {
  const seg = ((props.params as { segments?: string[] } | undefined)?.segments ?? [])[index] ?? ''
  return /^\d{1,10}$/.test(seg) ? Number(seg) : 0
}

export type SP = Record<string, string | string[] | undefined>
export const spOf = (props: AdminViewServerProps): SP => (props.searchParams ?? {}) as SP
export const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)
export const idParam = (v: string | string[] | undefined): number | undefined => {
  const s = one(v)
  return s && /^\d{1,10}$/.test(s) && Number(s) > 0 ? Number(s) : undefined
}
export const dateParam = (v: string | string[] | undefined): string | undefined => {
  const s = one(v)
  return s && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s) ? s : undefined
}

/** Link-button (.pk-kbtn) with an optional leading/trailing glyph. */
export function BtnLink({ href, children, primary, icon, small, attr }: { href: string; children: React.ReactNode; primary?: boolean; icon?: IconName; small?: boolean; attr?: string }) {
  return (
    <Link className={`pk-kbtn${primary ? ' primary' : ''}${small ? ' sm' : ''}`} href={href} prefetch={false} data-pk-link={attr}>
      {icon ? <Glyph name={icon} size={16} /> : null}
      {children}
    </Link>
  )
}

/**
 * UI feedback 17/10 #5: "Ubah (24 jam)" / "Koreksi" on a field-report detail = a link to the report's edit page
 * (`…/:id/ubah`, `?koreksi=1` for the PM / Direktur correction) — the same form and layout as "baru", no dialog.
 * `data-pk-action` keeps the hooks of the former dialog buttons.
 */
export function EditLink({ href, action, primary, children }: { href: string; action: string; primary?: boolean; children: React.ReactNode }) {
  return (
    <Link className={`pk-kbtn${primary ? ' primary' : ''}`} href={href} prefetch={false} data-pk-action={action}>
      {children}
    </Link>
  )
}

/** Edit page of a field report: `?koreksi=1` → correction (PM / Direktur), else the reporter's edit (24 h). */
export const editModeOf = (sp: SP): 'edit' | 'correction' => (one(sp.koreksi) === '1' ? 'correction' : 'edit')

/** Row action "Buka" (.pk-row-act) — accessible name names the row. */
export function OpenAction({ href, name, label = 'Buka' }: { href: string; name: string; label?: string }) {
  return (
    <Link href={href} prefetch={false} className="pk-row-act" aria-label={`${label} ${name}`} data-pk-row-action="open">
      <Glyph name="document" size={16} />
      <span>{label}</span>
    </Link>
  )
}

/** Tab bar (links, aria-current = the current tab). */
export function Tabs({ tabs, current, label }: { tabs: Array<{ key: string; label: string; href: string }>; current: string; label: string }) {
  return (
    <nav className="pk-ftabs" aria-label={label}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} prefetch={false} aria-current={t.key === current ? 'page' : undefined} data-pk-tab={t.key}>
          {t.label}
        </Link>
      ))}
    </nav>
  )
}

/** Filter chips (links; aria-current="true" = active). */
export function Chips({ label, chips, current }: { label: string; chips: Array<{ key: string; label: string; href: string }>; current: string }) {
  return (
    <nav className="pk-chips" aria-label={label}>
      <span aria-hidden>Tampilkan:</span>
      {chips.map((c) => (
        <Link key={c.key} href={c.href} prefetch={false} aria-current={c.key === current ? 'true' : undefined} data-pk-chip={c.key}>
          {c.label}
        </Link>
      ))}
    </nav>
  )
}

export function UnitStatusPill({ status }: { status: UnitStatus | string | null | undefined }) {
  const s = (status ?? 'siap') as UnitStatus
  return <StatusPill tone={s === 'siap' ? 'ok' : s === 'rusak' ? 'bad' : 'warn'} label={UNIT_STATUS_LABELS[s] ?? String(s)} />
}

const FLAG_LABELS: Record<string, string> = {
  OFFLINE: 'dibuat offline',
  DEVICE_TIME_ONLY: 'jam HP saja',
  CLOCK_SKEW: 'jam HP tidak cocok',
  BACKDATED: 'tanggal mundur',
  HM_GAP: '⚠ selisih HM',
  BREAKDOWN_SUGGEST_SERVICE: 'saran laporan servis',
  CORRECTED: 'dikoreksi',
}

export function FlagPills({ flags }: { flags: readonly string[] }) {
  if (flags.length === 0) return null
  return (
    <span className="pk-rowacts" data-pk-flags={flags.join(',')}>
      {flags.map((f) => (
        <StatusPill key={f} tone={f === 'HM_GAP' || f === 'CORRECTED' || f === 'BREAKDOWN_SUGGEST_SERVICE' ? 'warn' : 'none'} label={FLAG_LABELS[f] ?? f} />
      ))}
    </span>
  )
}

type Photo = { id: number; url: string; thumbUrl: string; width: number | null; height: number | null }

/** D2510 (web 0.21.1): shared ImageThumb per photo (lightbox group = the report; `caption` = date / unit / location). */
export function PhotoGallery({ photos, label, empty = 'Tanpa foto.', caption }: { photos: readonly Photo[]; label: string; empty?: string; caption?: string }) {
  if (photos.length === 0) return <EmptyState text={empty} />
  return (
    <ul className="pk-gallery" data-pk-gallery>
      {photos.map((p, i) => (
        <li key={p.id}>
          <ImageThumb src={{ href: p.url, thumb: p.thumbUrl, fallback: 'full' }} size="fill" group={`photos-${photos[0]!.id}`} title={`Foto ${i + 1} ${label}`} caption={caption} label={`Foto ${i + 1} dari ${photos.length}, buka ukuran penuh`} data-pk-photo={p.id} />
        </li>
      ))}
    </ul>
  )
}

export function History({ entries, tz }: { entries: readonly HistoryEntry[]; tz: string }) {
  if (entries.length === 0) return <EmptyState text="Belum ada riwayat." />
  return (
    <ol className="pk-hist" data-pk-history>
      {entries.map((e, i) => (
        <li key={i} className={e.action === 'correction' ? 'correction' : undefined} data-pk-history-action={e.action}>
          <b>{e.action === 'create' ? 'Dibuat' : e.action === 'correction' ? 'Dikoreksi' : 'Diubah'}</b> oleh {e.user ?? '—'}
          {e.fields.length > 0 && e.action !== 'create' ? ` · ${e.fields.join(', ')}` : ''}
          <small>
            {dateTimeId(e.at, tz)}
            {e.reason ? ` · alasan: ${e.reason.replace(/^Koreksi:\s*/i, '')}` : ''}
          </small>
        </li>
      ))}
    </ol>
  )
}

/** Bookkeeping card rows shared by the three detail pages. */
export function MetaRows({ d, tz }: { d: { reporter: { name: string | null }; receivedAt: string | null; source: string | null; offline: boolean; editableUntil: string | null; correctedAt: string | null; correctedBy: { name: string | null } | null }; tz: string }) {
  return (
    <dl className="pk-dl">
      <dt>Pelapor</dt>
      <dd>{d.reporter.name ?? '—'}</dd>
      <dt>Diterima server</dt>
      <dd>{dateTimeId(d.receivedAt, tz)}</dd>
      <dt>Sumber</dt>
      <dd>
        {d.source === 'apk' ? 'Aplikasi Android' : d.source === 'web' ? 'Web' : '—'}
        {d.offline ? ' · dibuat offline' : ''}
      </dd>
      <dt>Bisa diedit pelapor</dt>
      <dd>{d.editableUntil ? `s/d ${dateTimeId(d.editableUntil, tz)}` : '—'}</dd>
      {d.correctedAt ? (
        <>
          <dt>Dikoreksi</dt>
          <dd>
            {dateTimeId(d.correctedAt, tz)} oleh {d.correctedBy?.name ?? '—'}
          </dd>
        </>
      ) : null}
    </dl>
  )
}
