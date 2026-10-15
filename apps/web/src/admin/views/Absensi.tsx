import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import type { AdminViewServerProps, PayloadRequest } from 'payload'
import Link from 'next/link'
import React from 'react'

import { hasRoleAny, ownEmployees, relId, userId } from '@/access/roles'
import { CorrectionDialog, DefaultSchedule, GeofenceForm, HolidayAdd, ScheduleAssign, SelfCheckForm, SelfieButton, type Option, type SelfCheckLocation } from '@/admin/components/absensi/AttendanceActions'
import { KAS_STYLE } from '@/admin/components/kas/style'
import { AutoSubmit } from '@/admin/components/list/AutoSubmit'
import { matchesQuery, spValue } from '@/admin/list-query'
import { Icon as Glyph } from '@/admin/modules/Icon'
import type { DayRecap, LocationDay, LocationRef, RecapSummary, TeamTodayRow } from '@/domain/attendance/aggregate'
import { classCounts, classifyDay, DAY_CLASSES, LEGEND, minutesText, monthWeeks, offsetText, shiftMonth, type DayClass } from '@/domain/attendance/calendar'
import { attendanceContext, attendanceScope, employeeRef, narrowAttScope, narrowAttToCompanies, narrowAttToSite, type AttScope } from '@/domain/attendance/queries'
import { OUTSIDE_AREA_LABEL } from '@/domain/attendance/area'
import { eligibleLocations, employeeAttendance, referenceSite, type EmployeeAttendance } from '@/domain/attendance/eligibility'
import { dayRowsAt } from '@/domain/attendance/record'
import type { ScheduleSnapshot } from '@/domain/attendance/schedule'
import { employeeRecap, myRecap, teamTodayFor, type MonthlyRecap, type TeamTodayResult } from '@/domain/attendance/service'
import { correctionHistory, mayCorrect, recapEmployees, scopeLocations, selfieState, teamMonth, type CorrectionRow, type Opt } from '@/domain/attendance/web'
import { firstDay, lastDay, MONTHS_SHORT, PERIOD_RE, periodLabel } from '@/domain/reports/rules'
import { privacyAckCheck } from '@/legal/privacy-enforcement'
import { withReqTransaction } from '@/lib/system-tx'
import { tzOffsetMinutes } from '@/lib/time'
import { formatServerTime } from '@/pdf/format'

import { ChartHover } from './ChartHover'
import { F3Root } from './f3-ui'
import { foreignPtParam, PtChip, ptView, type PtView } from './pt'
import { EditButton, PtNotAllowed } from './shared'
import { Bento, Card, DashHead, DataTable, EmptyState, HBarList, KpiRow, KpiTile, StatusPill, TableView, VIZ_STYLE } from './viz'
import { settings as companySettings } from '@/domain/companies'
import { NoAccess } from './NoAccess'
import { DateInput } from '../components/DateInput'

/**
 * E6 web (plan fase1-golive E6, S2; US-09/13/14/15, Q-30/33/40): admin views of the attendance
 * module — "Tim hari ini" board (/admin/absensi), monthly recap per employee + team grid
 * (/admin/absensi/rekap), work schedules / holidays / geofence of cost centers (/admin/absensi/jadwal)
 * and the Beranda widget. Server-rendered with the caller's scope (same services as
 * /api/v1/attendance/*: office roles all, PM team, Staff only their own recap); writes go through the
 * existing endpoints (T10 correction: POST /api/v1/attendance/{id}/correct; masters: Payload REST with
 * the collection access + audit hooks). Colours only through theme tokens; status = glyph + label +
 * colour, never colour alone. `data-pk-*` = stable UAT selectors.
 */
export const ABSENSI_STYLE = `
/* web self check-in (owner decision 2026-10-09): APK-like field screen */
.pk-selfcheck { max-width: 560px; }
.pk-sc-locs { border: 0; margin: 0; padding: 0; display: grid; gap: 10px; }
.pk-sc-locs legend { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.pk-sc-loc { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; align-items: center; min-height: 56px; padding: 12px 14px; border: 1px solid var(--pk-border); border-radius: var(--style-radius-m); background: var(--pk-card); cursor: pointer; }
.pk-sc-loc:has(input:checked) { border-color: var(--pk-primary); box-shadow: 0 0 0 1px var(--pk-primary); }
.pk-sc-loc input { grid-row: span 2; } /* the radio box: native normalisation (custom.scss, DRMS 15/10 #2) */
.pk-sc-loc .name { font-weight: 600; font-size: 15px; display: flex; flex-direction: column; }
.pk-sc-loc .name .sub { font-weight: 400; font-size: 12px; color: var(--pk-muted-fg); }
.pk-sc-loc .st { font-size: 12px; font-weight: 600; color: var(--pk-muted-fg); }
.pk-sc-loc[data-state='hadir'] .st { color: var(--pk-primary); }
.pk-sc-loc[data-state='selesai'] .st { color: var(--pk-tone-ok-text); }
.pk-sc-go { width: 100%; min-height: 52px; font-size: 16px; border-radius: 999px; }
.pk-sc-loc[data-area='in'] { border-color: var(--pk-tone-ok-text); }
.pk-sc-loc .area { font-size: 12px; font-weight: 600; color: var(--pk-tone-ok-text); }
.pk-chip.warn { color: var(--pk-tone-warn-text); border-color: currentColor; }
.pk-sc-detect { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 12px; }
.pk-sc-detect .note { font-size: 13px; }
.pk-sc-detect .note[data-tone='warn'] { color: var(--pk-tone-warn-text); }
.pk-f3 {
  --dc-ok: var(--pk-tone-ok-text); --dc-warn: var(--pk-tone-warn-text); --dc-bad: var(--pk-tone-bad-text); --dc-info: var(--pk-primary);
}
.pk-f3 .pk-sr, .pk-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.pk-f3 .pk-subnav { display: flex; flex-wrap: wrap; gap: 8px; margin: -4px 0 16px; }
.pk-f3 .pk-subnav a { display: inline-flex; align-items: center; min-height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--pk-input); text-decoration: none; font-size: 13px; font-weight: 600; color: var(--pk-fg); }
.pk-f3 .pk-subnav a[aria-current='page'] { background: var(--pk-primary); border-color: var(--pk-primary); color: var(--pk-on-primary); }
@media (pointer: coarse) { .pk-f3 .pk-subnav a { min-height: 44px; } }
.pk-f3 form.pk-filter input[type='date'], .pk-f3 form.pk-filter input[type='month'] { min-width: 150px; }
.pk-f3 form.pk-filter .pk-kbtn { align-self: flex-end; }
/* day classes: tinted cell + glyph in the tone's text colour */
.pk-f3 .dc { --c: var(--pk-muted-fg); background: color-mix(in oklab, var(--c) 16%, var(--pk-card)); color: var(--c); border: 1px solid color-mix(in oklab, var(--c) 35%, var(--pk-border)); }
.pk-f3 .dc.ok { --c: var(--dc-ok); } .pk-f3 .dc.warn { --c: var(--dc-warn); } .pk-f3 .dc.info { --c: var(--dc-info); }
.pk-f3 .dc.bad { --c: var(--dc-bad); background: color-mix(in oklab, var(--c) 30%, var(--pk-card)); border-color: var(--c); }
.pk-f3 .dc.muted { background: var(--pk-muted-bg); color: var(--pk-muted-fg); border-color: var(--pk-border); }
.pk-f3 .dc.empty { background: transparent; color: var(--pk-muted-fg); border: 1px dashed var(--pk-input); }
.pk-f3 .dcbar.ok { background: var(--dc-ok); } .pk-f3 .dcbar.warn { background: var(--dc-warn); } .pk-f3 .dcbar.bad { background: var(--dc-bad); } .pk-f3 .dcbar.info { background: var(--dc-info); } .pk-f3 .dcbar.muted, .pk-f3 .dcbar.empty { background: var(--viz-mute); }
/* calendar */
.pk-f3 .pk-cal { width: 100%; border-collapse: separate; border-spacing: 4px; table-layout: fixed; }
.pk-f3 .pk-cal th { font-size: 11px; font-weight: 600; color: var(--pk-muted-fg); text-align: center; padding: 0 0 2px; }
.pk-f3 .pk-cal td { padding: 0; vertical-align: top; }
.pk-f3 .pk-cal .cell { display: flex; flex-direction: column; gap: 2px; min-height: 64px; padding: 6px 7px; border-radius: 8px; font-size: 11px; line-height: 1.3; }
.pk-f3 .pk-cal .cell .d { display: flex; justify-content: space-between; align-items: baseline; font-weight: 700; font-size: 12px; color: var(--pk-fg); }
.pk-f3 .pk-cal .cell .g { font-size: 12px; }
.pk-f3 .pk-cal .cell .tm { color: var(--pk-fg); font-variant-numeric: tabular-nums; }
.pk-f3 .pk-cal .cell .hn { color: var(--pk-muted-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pk-f3 .pk-cal .cell.today { outline: 2px solid var(--pk-ring); outline-offset: 1px; }
.pk-f3 .pk-cal a.cell { text-decoration: none; } .pk-f3 .pk-cal a.cell:hover { filter: brightness(1.03); box-shadow: var(--pk-shadow-hover); }
.pk-f3 .pk-cal a.cell:focus-visible { outline: 2px solid var(--pk-ring); outline-offset: 2px; }
@container (max-width: 560px) { .pk-f3 .pk-cal { border-spacing: 2px; } .pk-f3 .pk-cal .cell { min-height: 44px; padding: 4px; } .pk-f3 .pk-cal .cell .tm, .pk-f3 .pk-cal .cell .hn { display: none; } }
.pk-f3 .pk-dlegend { display: flex; flex-wrap: wrap; gap: 6px 12px; margin: 10px 0 0; padding: 0; list-style: none; font-size: 12px; color: var(--pk-muted-fg); }
.pk-f3 .pk-dlegend li { display: inline-flex; align-items: center; gap: 6px; }
.pk-f3 .pk-dlegend .sw { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 5px; font-size: 11px; }
.pk-f3 .pk-dlegend b { color: var(--pk-fg); font-variant-numeric: tabular-nums; }
/* team grid (employees × days) */
.pk-f3 .pk-grid-w { overflow-x: auto; margin: 0 -18px; padding: 0 18px 4px; }
.pk-f3 table.pk-grid { border-collapse: separate; border-spacing: 2px; font-size: 11px; }
.pk-f3 .pk-grid th { font-weight: 600; color: var(--pk-muted-fg); text-align: center; padding: 2px 0; min-width: 22px; }
.pk-f3 .pk-grid th.we { color: var(--pk-tone-bad-text); }
.pk-f3 .pk-grid th.nm, .pk-f3 .pk-grid td.nm { position: sticky; left: 0; z-index: 1; background: var(--pk-card); text-align: left; min-width: 170px; max-width: 220px; padding: 2px 8px 2px 0; }
.pk-f3 .pk-grid td.nm a { font-weight: 600; color: var(--pk-primary); text-decoration: none; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.pk-f3 .pk-grid td.nm small { display: block; color: var(--pk-muted-fg); }
.pk-f3 .pk-grid td.c { width: 22px; height: 24px; padding: 0; text-align: center; border-radius: 5px; font-size: 10px; line-height: 24px; }
.pk-f3 .pk-grid td.t { padding: 0 6px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; color: var(--pk-fg); white-space: nowrap; }
.pk-f3 .pk-grid th.t { padding: 0 6px; }
/* board */
.pk-f3 .pk-board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin: 0 0 24px; }
@media (max-width: 1099px) { .pk-f3 .pk-board { grid-template-columns: minmax(0, 1fr); } }
.pk-f3 .pk-col { background: var(--pk-muted-bg); border: 1px solid var(--pk-border); border-radius: var(--style-radius-l); padding: 12px; min-width: 0; }
.pk-f3 .pk-col > h2 { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 10px; font-size: 15px; }
.pk-f3 .pk-col > h2 .n { font-size: 12px; font-weight: 700; padding: 1px 9px; border-radius: 999px; background: var(--pk-card); border: 1px solid var(--pk-border); font-variant-numeric: tabular-nums; }
.pk-f3 .pk-col ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.pk-f3 .pk-mem { background: var(--pk-card); border: 1px solid var(--pk-border); border-radius: 10px; padding: 10px 12px; box-shadow: var(--pk-shadow); display: grid; gap: 6px; }
.pk-f3 .pk-mem .top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.pk-f3 .pk-mem .top a { font-weight: 700; color: var(--pk-fg); text-decoration: none; } .pk-f3 .pk-mem .top a:hover { color: var(--pk-primary); text-decoration: underline; }
.pk-f3 .pk-mem .top small { color: var(--pk-muted-fg); font-size: 11px; }
.pk-f3 .pk-mem .tms { display: flex; gap: 14px; font-size: 12px; color: var(--pk-muted-fg); font-variant-numeric: tabular-nums; }
.pk-f3 .pk-mem .tms b { color: var(--pk-fg); font-size: 14px; }
.pk-f3 .pk-mem .tags { display: flex; flex-wrap: wrap; gap: 4px 6px; }
.pk-f3 .pk-chip, .pk-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; border: 1px solid var(--pk-border); color: var(--pk-muted-fg); background: var(--pk-card); white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.pk-f3 .pk-chip.proj::before { content: 'P'; font-size: 9px; font-weight: 800; color: var(--pk-primary); }
.pk-f3 .pk-chip.cc::before { content: 'PB'; font-size: 9px; font-weight: 800; color: var(--pk-tone-warn-text); }
.pk-f3 .pk-chip.site::before { content: 'S'; font-size: 9px; font-weight: 800; color: var(--pk-tone-ok-text); }
.pk-f3 .pk-split3 { display: flex; height: 10px; gap: 2px; margin: 10px 0 4px; }
.pk-f3 .pk-split3 > span { min-width: 2px; } .pk-f3 .pk-split3 > span:first-child { border-radius: 999px 2px 2px 999px; } .pk-f3 .pk-split3 > span:last-child { border-radius: 2px 999px 999px 2px; }
.pk-f3 .pk-split3 .b { background: var(--viz-mute); } .pk-f3 .pk-split3 .h { background: var(--viz-soft); } .pk-f3 .pk-split3 .s { background: var(--viz-strong); }
/* detail table + dialogs */
.pk-f3 .pk-t .pk-actk { font-size: 11px; font-weight: 700; color: var(--pk-muted-fg); min-width: 42px; text-align: right; }
.pk-f3 .pk-t .pk-actk:not(:first-child) { margin-left: 8px; padding-left: 10px; border-left: 1px solid var(--pk-border); }
.pk-f3 .pk-t .locs { display: grid; gap: 6px; }
.pk-f3 .pk-t .loc { display: grid; gap: 4px; }
.pk-ba { display: flex; align-items: center; gap: 14px; padding: 10px 12px; border-radius: var(--style-radius-m); background: var(--pk-muted-bg); border: 1px solid var(--pk-border); }
.pk-ba .lbl { display: block; font-size: 11px; color: var(--pk-muted-fg); font-weight: 600; }
.pk-ba b { font-size: 20px; font-variant-numeric: tabular-nums; }
.pk-ba .arrow { font-size: 18px; color: var(--pk-muted-fg); }
.pk-selfie-dlg { width: min(420px, calc(100vw - 32px)); }
.pk-selfie-box { display: grid; place-items: center; min-height: 200px; background: var(--pk-muted-bg); border-radius: var(--style-radius-m); overflow: hidden; }
.pk-selfie-box img { display: block; max-width: 100%; max-height: 60dvh; height: auto; }
.pk-okmsg { color: var(--pk-tone-ok-text); font-size: 12px; font-weight: 600; margin: 0; }
.pk-inline { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.pk-inline.wrap { align-items: flex-end; }
.pk-inline .pk-fld.grow { flex: 1 1 220px; }
.pk-inline select, .pk-geo input:not([type='checkbox'], [type='radio']) { min-height: 36px; padding: 6px 8px; font: inherit; font-size: 13px; color: var(--theme-text); background: var(--theme-input-bg, var(--theme-elevation-0)); border: 1px solid var(--pk-input); border-radius: var(--style-radius-s); max-width: 100%; }
.pk-inline select:focus-visible, .pk-geo input:not([type='checkbox'], [type='radio']):focus-visible { outline: 2px solid var(--pk-ring); outline-offset: 2px; }
.pk-inline > label { font-size: 13px; font-weight: 600; }
.pk-geo { display: grid; grid-template-columns: repeat(3, minmax(90px, 1fr)) auto; gap: 8px; align-items: end; }
.pk-geo .pk-fld label { font-size: 11px; font-weight: 600; color: var(--pk-muted-fg); }
.pk-geo .pk-geo-act { display: flex; gap: 6px; }
.pk-geo > p { grid-column: 1 / -1; }
@container (max-width: 640px) { .pk-geo { grid-template-columns: repeat(3, minmax(0, 1fr)); } .pk-geo .pk-geo-act { grid-column: 1 / -1; } }
@media (pointer: coarse) { .pk-inline select, .pk-geo input:not([type='checkbox'], [type='radio']) { min-height: 44px; } }
.pk-f3 .pk-days { display: inline-flex; gap: 3px; }
.pk-f3 .pk-days span { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; font-size: 10px; font-weight: 700; border: 1px solid var(--pk-border); color: var(--pk-muted-fg); }
.pk-f3 .pk-days span.on { background: color-mix(in oklab, var(--pk-primary) 14%, var(--pk-card)); color: var(--pk-primary); border-color: color-mix(in oklab, var(--pk-primary) 40%, var(--pk-border)); }
`

const WD = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
const WD_LONG = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']
const dayMonth = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS_SHORT[Number(date.slice(5, 7)) - 1] ?? ''} ${date.slice(0, 4)}`
const dayShort = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS_SHORT[Number(date.slice(5, 7)) - 1] ?? ''}`
const wdOf = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}
const locLabel = (l: LocationRef) => `${l.code} ${l.name}`
const hhmm = (iso: string | null | undefined, tz: string) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) : '—')

type SP = Record<string, string | string[] | undefined>
const one = (sp: SP, k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '')
const idParam = (sp: SP, k: string) => {
  const v = one(sp, k)
  return /^\d{1,10}$/.test(v) && Number(v) > 0 ? Number(v) : undefined
}

// ---------------------------------------------------------------- PT filter (MC2, ADR 0016 §6)

/** PTs of the attendance scope that are in the switcher selection (the PT filter's choices). */
const scopePts = (scope: AttScope | null, pt: PtView) => (scope?.parts ?? []).map((p) => p.company).filter((c) => pt.selected.includes(c))
/** `?pt=` when it is one of `pts` (a selected PT outside the attendance scope is ignored — never widens; a foreign PT → PtNotAllowed). */
const ptParam = (sp: SP, pts: readonly number[]) => {
  const v = idParam(sp, 'pt')
  return v !== undefined && pts.includes(v) ? v : undefined
}
/** Filter options: only the chosen PT's, labels prefixed `[CS1]` while several PTs are shown. */
function ptOptions<T extends { id: number; label: string; companyId: number | null }>(list: readonly T[], pt: PtView, chosen: number | undefined): T[] {
  return list
    .filter((o) => chosen === undefined || o.companyId === chosen)
    .map((o) => (pt.multi && chosen === undefined && o.companyId !== null ? { ...o, label: `[${pt.ref(o.companyId)?.shortCode ?? o.companyId}] ${o.label}` } : o))
}

function PtSelect({ pt, pts, value }: { pt: PtView; pts: readonly number[]; value: number | undefined }) {
  if (!pt.multi || pts.length < 2) return null
  return (
    <label>
      PT
      <select name="pt" defaultValue={value ? String(value) : ''} data-pk-pt-filter>
        <option value="">Semua PT ({pts.map((c) => pt.ref(c)?.shortCode).join(', ')})</option>
        {pts.map((c) => (
          <option key={c} value={c}>
            {pt.ref(c)?.shortCode} — {pt.ref(c)?.name ?? ''}
          </option>
        ))}
      </select>
    </label>
  )
}

// ---------------------------------------------------------------- frame

function Frame({ props, name, children }: { props: AdminViewServerProps; name: string; children: React.ReactNode }) {
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
        <F3Root name={name}>
          <style>{VIZ_STYLE}</style>
          <style>{KAS_STYLE}</style>
          <style>{ABSENSI_STYLE}</style>
          <ChartHover>{children}</ChartHover>
        </F3Root>
      </Gutter>
    </DefaultTemplate>
  )
}

function SubNav({ active, scope }: { active: 'today' | 'absen' | 'rekap' | 'jadwal'; scope: AttScope | null }) {
  const items: Array<[typeof active, string, string]> = scope
    ? [
        ['today', '/admin/absensi', 'Tim hari ini'],
        ['absen', '/admin/absensi/absen', 'Absen'],
        ['rekap', '/admin/absensi/rekap', 'Rekap bulanan'],
        ['jadwal', '/admin/absensi/jadwal', 'Jadwal & hari libur'],
      ]
    : [
        ['absen', '/admin/absensi/absen', 'Absen'],
        ['rekap', '/admin/absensi/rekap', 'Rekap saya'],
      ]
  return (
    <nav className="pk-subnav" aria-label="Menu absensi">
      {items.map(([k, href, label]) => (
        <Link key={k} href={href} aria-current={k === active ? 'page' : undefined} data-pk-subnav={k}>
          {label}
        </Link>
      ))}
      {scope && hasRoleScope(scope) ? (
        <Link href="/admin/laporan/absensi" data-pk-subnav="laporan">
          Laporan absensi (export) ↗
        </Link>
      ) : null}
    </nav>
  )
}
const hasRoleScope = (s: AttScope) => s.kind === 'all' || s.kind === 'team'

function Alert({ tone, children, attr }: { tone: 'ok' | 'bad' | 'info'; children: React.ReactNode; attr?: string }) {
  return (
    <div className={`pk-alert ${tone}`} data-pk-alert={attr}>
      <b aria-hidden>{tone === 'ok' ? '✓' : tone === 'bad' ? '!' : 'i'}</b>
      <p>{children}</p>
    </div>
  )
}

function Failed({ props, name, title, err, req }: { props: AdminViewServerProps; name: string; title: string; err: unknown; req: PayloadRequest }) {
  const msg = (err as { message?: string })?.message ?? ''
  const status = (err as { status?: number })?.status
  if (!status || status >= 500) req.payload.logger.error({ msg: 'attendance view failed', view: name, err: msg })
  return (
    <Frame props={props} name={name}>
      <DashHead title={title} />
      <Alert tone="bad" attr="error">
        {status && status < 500 ? msg : 'Data tidak dapat dimuat. Coba lagi.'}
      </Alert>
      <p>
        <Link className="pk-kbtn sm" href="/admin/absensi" data-pk-back>
          <Glyph name="arrowLeft" size={16} />
          Absensi
        </Link>
      </p>
    </Frame>
  )
}

// ---------------------------------------------------------------- Tim hari ini (US-13)

function MemberCard({ m, tz, month, pt }: { m: TeamTodayRow; tz: string; month: string; pt: PtView }) {
  const where = m.locations.length ? m.locations.map((l) => l.location) : m.assigned
  return (
    <li className="pk-mem" data-pk-member={m.employee.id} data-pk-member-status={m.status}>
      <div className="top">
        <Link href={`/admin/absensi/rekap?karyawan=${m.employee.id}&bulan=${month}`}>{m.employee.name}</Link>
        <small>{m.employee.code}</small>
        {pt.multi ? <PtChip pt={pt.ref(m.companyId)} /> : null}
      </div>
      {m.status !== 'belum_absen' ? (
        <div className="tms">
          <span>
            Masuk <b>{m.checkInLocal ?? hhmm(m.checkIn, tz)}</b>
          </span>
          <span>
            Pulang <b>{m.checkOutLocal ?? '—'}</b>
          </span>
        </div>
      ) : null}
      <div className="tags">
        {where.map((l) => (
          <span key={`${l.type}:${l.id}`} className={`pk-chip ${LOC_CHIP[l.type]}`} title={`${LOC_TITLE[l.type]} ${locLabel(l)}`}>
            {locLabel(l)}
          </span>
        ))}
        {m.lateMinutes > 0 ? <StatusPill tone="warn" label={`Terlambat ${minutesText(m.lateMinutes)}`} /> : null}
        {m.onBehalf ? <StatusPill tone="progress" label="Diabsenkan PM" /> : null}
        {m.corrected ? <StatusPill tone="none" label="Dikoreksi" /> : null}
      </div>
    </li>
  )
}

/** ADR 0023: location chip / label per location type (project, pusat biaya, site = kantor cabang). */
const LOC_CHIP: Record<'project' | 'cost_center' | 'site', string> = { project: 'proj', cost_center: 'cc', site: 'site' }
const LOC_TITLE: Record<'project' | 'cost_center' | 'site', string> = { project: 'Project', cost_center: 'Pusat biaya', site: 'Site' }

/** ADR 0023 §5: "Site" filter of the attendance views (hidden while the PTs have no site). */
function SiteSelect({ options, value, all = 'Semua site' }: { options: Array<{ id: number; label: string }>; value: number | undefined; all?: string }) {
  if (options.length === 0) return null
  return (
    <label>
      Site
      <select name="site" defaultValue={String(value ?? '')} data-pk-filter-site>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export async function AbsensiToday(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  const sp = (props.searchParams ?? {}) as SP
  if (foreignPtParam(req, props.searchParams)) return <PtNotAllowed props={props} title="Absensi hari ini" />
  const pt = await ptView(req)
  let data: { scope: AttScope | null; r: TeamTodayResult | null; loc: { projects: Opt[]; costCenters: Opt[]; sites: Opt[] }; today: string; lateCount: number; pts: number[]; chosen: number | undefined } | null = null
  try {
    data = await withReqTransaction(req, async () => {
      const scope = await attendanceScope(req)
      const ctx = await attendanceContext(req)
      const pts = scopePts(scope, pt)
      const chosen = ptParam(sp, pts)
      if (!scope) return { scope, r: null, loc: { projects: [], costCenters: [], sites: [] }, today: ctx.today, lateCount: 0, pts, chosen }
      const date = /^\d{4}-\d{2}-\d{2}$/.test(one(sp, 'tanggal')) && one(sp, 'tanggal') <= ctx.today ? one(sp, 'tanggal') : ctx.today
      const r = await teamTodayFor(req, { date, projectId: idParam(sp, 'project'), costCenterId: idParam(sp, 'pusat'), siteId: idParam(sp, 'site'), companyIds: chosen ? [chosen] : undefined })
      return { scope, r, loc: await scopeLocations(req, scope), today: ctx.today, lateCount: r.members.filter((m) => m.lateMinutes > 0).length, pts, chosen }
    })
  } catch (err) {
    return <Failed props={props} name="absensi-today" title="Absensi · Tim hari ini" err={err} req={req} />
  }
  const { scope, r, loc, today, lateCount, pts, chosen } = data
  if (!scope || !r) {
    return (
      <NoAccess
        props={props}
        hint={
          <>
            Rekap absensi Anda sendiri ada di <Link href="/admin/absensi/rekap">Rekap saya</Link>.
          </>
        }
      />
    )
  }
  const c = r.counts
  const month = r.date.slice(0, 7)
  // DRMS 10/10 D8: name/code search over the board (the KPI tiles keep counting the whole team)
  const search = spValue(props.searchParams, 'q').slice(0, 100)
  const filtered = Boolean(idParam(sp, 'project') || idParam(sp, 'pusat') || idParam(sp, 'site') || chosen || search)
  const col = (key: 'belum_absen' | 'hadir' | 'selesai', title: string, note: string) => {
    const list = r.members.filter((m) => m.status === key && matchesQuery([m.employee.name, m.employee.code], search))
    return (
      <section className="pk-col" aria-labelledby={`col-${key}`} data-pk-column={key}>
        <h2 id={`col-${key}`}>
          <span>{title}</span>
          <span className="n" aria-label={`${list.length} orang`}>
            {list.length}
          </span>
        </h2>
        {list.length === 0 ? (
          <EmptyState text={note} />
        ) : (
          <ul>
            {list.map((m) => (
              <MemberCard key={m.employee.id} m={m} tz={r.timezone} month={month} pt={pt} />
            ))}
          </ul>
        )}
      </section>
    )
  }
  const pct = (n: number) => (c.total > 0 ? `${Math.round((n / c.total) * 100)}%` : '0%')
  return (
    <Frame props={props} name="absensi-today">
      <DashHead title="Absensi · Tim hari ini" note={`${WD_LONG[wdOf(r.date) - 1]}, ${dayMonth(r.date)} (WITA) · ${r.scope === 'team' ? 'anggota tim di project/pusat biaya Anda' : 'semua karyawan yang ditugaskan'}${r.date === today ? '' : ' · tanggal lampau'}`} />
      <SubNav active="today" scope={scope} />
      <form className="pk-filter" method="get" action="/admin/absensi" role="search" aria-label="Filter tim hari ini" data-pk-filter="absensi-today">
        <label className="pk-filter__search">
          Cari
          <input type="search" name="q" defaultValue={search} placeholder="Nama atau kode karyawan…" maxLength={100} autoComplete="off" data-pk-search="absensi-today" />
        </label>
        <label>
          Tanggal
          <DateInput type="date" name="tanggal" defaultValue={r.date} max={today} />
        </label>
        <PtSelect pt={pt} pts={pts} value={chosen} />
        <label>
          Project
          <select name="project" defaultValue={String(idParam(sp, 'project') ?? '')}>
            <option value="">Semua project</option>
            {ptOptions(loc.projects, pt, chosen).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Pusat biaya
          <select name="pusat" defaultValue={String(idParam(sp, 'pusat') ?? '')}>
            <option value="">Semua pusat biaya</option>
            {ptOptions(loc.costCenters, pt, chosen).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <SiteSelect options={ptOptions(loc.sites, pt, chosen)} value={idParam(sp, 'site')} />
        <button type="submit" className="pk-kbtn primary">
          Terapkan
        </button>
        {filtered || r.date !== today ? (
          <Link className="pk-kbtn" href="/admin/absensi">
            Hari ini
          </Link>
        ) : null}
        <AutoSubmit />
      </form>
      {r.holidayName ? (
        <Alert tone="info" attr="holiday">
          Hari libur: <strong>{r.holidayName}</strong>. Absensi tetap diterima dan ditandai; tidak dihitung terlambat.
        </Alert>
      ) : null}
      <Bento label="Ringkasan kehadiran">
        <KpiRow cols={4}>
          <KpiTile id="att-total" icon="users" label="Anggota ditugaskan" value={`${c.total}`} kpi="att-total" i={0}>
            <div className="pk-split3" role="img" aria-label={`Belum absen ${c.belum_absen}, hadir ${c.hadir}, selesai ${c.selesai}`}>
              {c.belum_absen ? <span className="b" style={{ flex: c.belum_absen }} /> : null}
              {c.hadir ? <span className="h" style={{ flex: c.hadir }} /> : null}
              {c.selesai ? <span className="s" style={{ flex: c.selesai }} /> : null}
            </div>
            <p className="pk-kpi-x">
              <span className="pk-legend" style={{ margin: 0 }}>
                <span>
                  <span className="sw mute" />
                  belum
                </span>
                <span>
                  <span className="sw soft" />
                  hadir
                </span>
                <span>
                  <span className="sw strong" />
                  selesai
                </span>
              </span>
            </p>
          </KpiTile>
          <KpiTile id="att-belum" icon="clock" label="Belum absen" value={`${c.belum_absen}`} kpi="att-belum" href="#col-belum_absen" more="Lihat daftar" i={1}>
            <p className="pk-kpi-x">{pct(c.belum_absen)} dari tim</p>
          </KpiTile>
          <KpiTile id="att-hadir" icon="target" label="Hadir (belum pulang)" value={`${c.hadir}`} kpi="att-hadir" href="#col-hadir" more="Lihat daftar" i={2}>
            <p className="pk-kpi-x">{lateCount > 0 ? <StatusPill tone="warn" label={`${lateCount} terlambat`} /> : <StatusPill tone="ok" label="Tidak ada yang terlambat" />}</p>
          </KpiTile>
          <KpiTile id="att-selesai" icon="check" label="Selesai (sudah pulang)" value={`${c.selesai}`} kpi="att-selesai" href="#col-selesai" more="Lihat daftar" i={3}>
            <p className="pk-kpi-x">{pct(c.selesai)} dari tim</p>
          </KpiTile>
        </KpiRow>
      </Bento>
      {c.total === 0 ? (
        <EmptyState text={r.scope === 'team' ? 'Belum ada anggota tim yang ditugaskan di project/pusat biaya Anda pada tanggal ini.' : 'Belum ada penugasan tim pada tanggal ini.'} action={{ href: '/admin/collections/team-assignments', label: 'Kelola penugasan tim' }} />
      ) : (
        <div className="pk-board">
          {col('belum_absen', 'Belum absen', 'Semua anggota sudah absen ✓')}
          {col('hadir', 'Hadir', 'Tidak ada yang sedang bekerja.')}
          {col('selesai', 'Selesai', 'Belum ada yang absen pulang.')}
        </div>
      )}
      <p className="pk-note">
        Waktu = zona perusahaan ({r.timezone}), memakai koreksi terakhir (T10). Lokasi: <span className="pk-chip proj">project</span> <span className="pk-chip cc">pusat biaya</span> <span className="pk-chip site">site</span> tempat absen (atau yang
        ditugaskan bila belum absen).
      </p>
    </Frame>
  )
}

// ---------------------------------------------------------------- Rekap bulanan (US-09 + tim)

function Legend({ counts }: { counts?: Record<DayClass, number> }) {
  return (
    <ul className="pk-dlegend" aria-label="Keterangan warna" data-pk-legend>
      {LEGEND.filter((k) => !counts || counts[k] > 0 || k === 'ontime' || k === 'late' || k === 'absent' || k === 'off').map((k) => (
        <li key={k}>
          <span className={`sw dc ${DAY_CLASSES[k].tone}`} aria-hidden>
            {DAY_CLASSES[k].glyph}
          </span>
          {DAY_CLASSES[k].label}
          {counts ? <b>{counts[k]}</b> : null}
        </li>
      ))}
    </ul>
  )
}

function Calendar({ month, days, today, anchor }: { month: string; days: DayRecap[]; today: string; anchor: boolean }) {
  const by = new Map(days.map((d) => [d.date, d]))
  return (
    <table className="pk-cal" data-pk-calendar={month}>
      <caption className="pk-sr">Kalender absensi {periodLabel(month)}</caption>
      <thead>
        <tr>
          {WD.map((w) => (
            <th key={w} scope="col">
              {w}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {monthWeeks(month).map((week, wi) => (
          <tr key={wi}>
            {week.map((date, di) => {
              if (!date) return <td key={di} />
              const d = by.get(date)
              const cls: DayClass = d ? classifyDay(d, today, date) : 'none'
              const meta = DAY_CLASSES[cls]
              const future = date > today
              const label = `${WD_LONG[di]} ${dayMonth(date)}: ${future ? 'belum berjalan' : meta.label}${d?.checkInLocal ? `, masuk ${d.checkInLocal}` : ''}${d?.checkOutLocal ? `, pulang ${d.checkOutLocal}` : ''}${d && d.lateMinutes > 0 ? `, terlambat ${d.lateMinutes} menit` : ''}${d && d.earlyLeaveMinutes > 0 ? `, pulang cepat ${d.earlyLeaveMinutes} menit` : ''}${d?.holidayName ? `, ${d.holidayName}` : ''}`
              const inner = (
                <>
                  <span className="d">
                    <span>{Number(date.slice(8))}</span>
                    {!future ? (
                      <span className="g" aria-hidden>
                        {meta.glyph}
                      </span>
                    ) : null}
                  </span>
                  {d?.checkInLocal ? (
                    <span className="tm">
                      {d.checkInLocal}–{d.checkOutLocal ?? '…'}
                    </span>
                  ) : null}
                  {d?.holidayName ? <span className="hn">{d.holidayName}</span> : null}
                </>
              )
              const cl = `cell dc ${future ? 'empty' : meta.tone}${date === today ? ' today' : ''}`
              return (
                <td key={di} data-pk-day={date} data-pk-day-class={future ? 'future' : cls}>
                  {anchor && d?.checkIn ? (
                    <a className={cl} href={`#hari-${date}`} aria-label={label} data-tip={JSON.stringify({ t: dayMonth(date), r: [[meta.label, d.checkInLocal ? `${d.checkInLocal}–${d.checkOutLocal ?? '…'}` : '', '']] })}>
                      {inner}
                    </a>
                  ) : (
                    <div className={cl} aria-label={label} role="img">
                      {inner}
                    </div>
                  )}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ScheduleBox({ s }: { s: ScheduleSnapshot | null }) {
  if (!s) return <EmptyState text="Tanpa jadwal kerja: keterlambatan & tidak hadir tidak dihitung." action={{ href: '/admin/absensi/jadwal', label: 'Atur jadwal' }} />
  return (
    <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
      <div>
        <strong>{s.name || 'Jadwal kerja'}</strong>
        <div className="pk-note" style={{ margin: 0 }}>
          {s.start}–{s.end} · toleransi {s.toleranceMin} menit
        </div>
      </div>
      <span className="pk-days" aria-label={`Hari kerja: ${s.workDays.map((d) => WD_LONG[d - 1]).join(', ')}`}>
        {WD.map((w, i) => (
          <span key={w} className={s.workDays.includes(i + 1) ? 'on' : ''} aria-hidden>
            {w.slice(0, 2)}
          </span>
        ))}
      </span>
    </div>
  )
}

function Stamp({ loc, kind, d, tz }: { loc: LocationDay; kind: 'checkIn' | 'checkOut'; d: DayRecap; tz: string }) {
  const s = loc[kind]
  if (!s) return <span className="pk-note">—</span>
  return (
    <span>
      <b>{hhmm(s.time, tz)}</b>
      {s.source === 'pm' ? ' · PM' : ''}
      {s.corrected ? ' · dikoreksi' : ''}
      {s.outsideArea ? (
        <span className="pk-chip warn" data-pk-outside-area>
          {' '}
          {OUTSIDE_AREA_LABEL}
        </span>
      ) : null}
      <span className="pk-sr"> {d.date}</span>
    </span>
  )
}

/**
 * Owner decision 2026-10-09: web self check-in/out, every role. DRMS 13/10 A2: the location list is every registered
 * location of the caller's PT(s) with its point (`eligibleLocations`), so the form can detect the area from the
 * browser GPS; a Non-OnSite employee also gets a "Di luar area" entry (reference = home site, else head office).
 * POST /attendance/check-in|check-out re-check everything (type rule, geofence for OnSite, Non-OnSite resolution,
 * company-settings.syncAttendanceEnabled, ADR 0018 privacy ack).
 */
export async function AbsensiAbsen(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  let data: { scope: AttScope | null; locations: SelfCheckLocation[]; privacyBlocked: boolean } | null = null
  try {
    data = await withReqTransaction(req, async () => {
      const scope = await attendanceScope(req)
      const ctx = await attendanceContext(req)
      const uid = userId(req)
      // one after another: the request transaction has one connection (domain/reports/kpi.ts rows)
      const employees: EmployeeAttendance[] = []
      for (const e of ownEmployees(req)) {
        const emp = await employeeAttendance(req, e)
        if (emp) employees.push(emp)
      }
      const eligible = await eligibleLocations(req, employees)
      const locations: SelfCheckLocation[] = []
      for (const l of eligible) {
        const rows = await dayRowsAt(req, l.employee, { type: l.kind, id: l.id }, ctx.today)
        const at = (k: 'check_in' | 'check_out') => {
          const r = rows.find((x) => x.kind === k)
          return r ? formatServerTime(String(r.effective_time), ctx.timeZone) : null
        }
        locations.push({
          type: l.kind,
          id: l.id,
          label: `${l.code} ${l.name}`,
          checkIn: at('check_in'),
          checkOut: at('check_out'),
          lat: l.lat,
          lng: l.lng,
          radiusM: l.radiusM,
          ...(l.home ? { home: true } : {}),
          ...(l.isHeadOffice ? { headOffice: true } : {}),
          ...(employees.find((e) => e.id === l.employee)?.type === 'non_onsite' ? { nonOnsite: true } : {}),
        })
      }
      // DRMS 13/10 A2 (owner 2026-10-14): Non-OnSite has no location restriction — "Di luar area" at the reference site
      for (const e of employees) {
        if (e.type !== 'non_onsite') continue
        const ref = await referenceSite(req, e)
        if (!ref) continue
        const rows = await dayRowsAt(req, e.id, { type: 'site', id: ref.id }, ctx.today)
        const at = (k: 'check_in' | 'check_out') => {
          const r = rows.find((x) => x.kind === k)
          return r ? formatServerTime(String(r.effective_time), ctx.timeZone) : null
        }
        locations.push({ type: 'site', id: ref.id, label: `${OUTSIDE_AREA_LABEL} (ref. ${ref.code} ${ref.name})`, checkIn: at('check_in'), checkOut: at('check_out'), outsideArea: true, nonOnsite: true })
      }
      const privacyBlocked = uid === undefined ? false : (await privacyAckCheck(req, uid)).required
      return { scope, locations, privacyBlocked }
    })
  } catch (err) {
    return <Failed props={props} name="absensi-absen" title="Absensi · Absen" err={err} req={req} />
  }
  const { scope, locations, privacyBlocked } = data
  return (
    <Frame props={props} name="absensi-absen">
      <DashHead title="Absensi · Absen" note="Absen masuk / pulang dari web, aturan sama dengan aplikasi Android." />
      <SubNav active="absen" scope={scope} />
      <Card id="self-check" title="Absen hari ini" span={12}>
        <SelfCheckForm locations={locations} privacyBlocked={privacyBlocked} />
      </Card>
    </Frame>
  )
}

type RekapData = {
  pt: PtView
  pts: number[]
  chosen: number | undefined
  scope: AttScope | null
  today: string
  tz: string
  month: string
  employees: Opt[]
  recap: MonthlyRecap | null
  history: CorrectionRow[]
  selfies: Map<number, boolean>
  canCorrect: boolean
  own: boolean
  grid: Awaited<ReturnType<typeof teamMonth>> | null
  loc: { projects: Opt[]; costCenters: Opt[]; sites: Opt[] }
}

export async function AbsensiRekap(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  const sp = (props.searchParams ?? {}) as SP
  if (foreignPtParam(req, props.searchParams)) return <PtNotAllowed props={props} title="Rekap absensi" />
  const pt = await ptView(req)
  let d: RekapData
  try {
    d = await withReqTransaction(req, async (): Promise<RekapData> => {
      const full = await attendanceScope(req)
      const pts = scopePts(full, pt)
      const chosen = ptParam(sp, pts)
      // MC2: the PT filter narrows the scope per PT (never widens; foreign ids → PtNotAllowed, QA-MC4-14)
      const scope = full && chosen ? narrowAttToCompanies(full, [chosen]) : full
      const ctx = await attendanceContext(req)
      const month = PERIOD_RE.test(one(sp, 'bulan')) && one(sp, 'bulan') <= ctx.today.slice(0, 7) ? one(sp, 'bulan') : ctx.today.slice(0, 7)
      const from = firstDay(month)
      const to = lastDay(month)
      const empId = idParam(sp, 'karyawan')
      const ownEmp = relId((req.user as { employee?: unknown } | null)?.employee)
      const base = { pt, pts, chosen, scope, today: ctx.today, tz: ctx.timeZone, month, history: [], selfies: new Map<number, boolean>(), canCorrect: false, own: false, grid: null, loc: { projects: [], costCenters: [], sites: [] } }
      if (!scope) {
        // Staff: own recap only (US-09).
        const recap = ownEmp !== undefined ? await myRecap(req, month) : null
        const ids = recap ? recap.days.flatMap((x) => x.locations.flatMap((l) => [l.checkIn?.id, l.checkOut?.id])).filter((x): x is number => typeof x === 'number') : []
        return { ...base, employees: [], recap, history: recap ? await correctionHistory(req, recap.employee.id, from, to) : [], selfies: await selfieState(req, ids), own: true }
      }
      const employees = await recapEmployees(req, scope, from, to)
      if (empId === undefined) {
        // mc2-contract §0.1: narrowAttScope keeps each PT's own ids — a project id of another PT matches nothing
        // ADR 0023 §5: the site filter only narrows (extra predicate per PT)
        const narrowed = narrowAttToSite(narrowAttScope(scope, idParam(sp, 'project'), idParam(sp, 'pusat')), idParam(sp, 'site'))
        return { ...base, employees, recap: null, grid: await teamMonth(req, narrowed, month), loc: await scopeLocations(req, scope) }
      }
      const recap = await employeeRecap(req, empId, month)
      const emp = await employeeRef(req, empId)
      const ids = recap.days.flatMap((x) => x.locations.flatMap((l) => [l.checkIn?.id, l.checkOut?.id])).filter((x): x is number => typeof x === 'number')
      return {
        ...base,
        employees,
        recap,
        history: await correctionHistory(req, empId, from, to),
        selfies: await selfieState(req, ids),
        canCorrect: mayCorrect(req, scope, empId, emp?.companyId),
        own: ownEmp === empId,
      }
    })
  } catch (err) {
    return <Failed props={props} name="absensi-rekap" title="Absensi · Rekap bulanan" err={err} req={req} />
  }
  return (
    <Frame props={props} name={d.recap ? 'absensi-rekap' : 'absensi-rekap-tim'}>
      <DashHead title={d.recap ? `Rekap absensi · ${d.recap.employee.name}` : d.scope ? 'Absensi · Rekap bulanan tim' : 'Rekap absensi saya'} note={`${periodLabel(d.month)} · zona ${d.tz} · koreksi T10 diterapkan`}>
        <div className="pk-kact">
          <Link className="pk-kbtn sm" href={monthHref(sp, shiftMonth(d.month, -1))} aria-label="Bulan sebelumnya" data-pk-link="prev-month">
            ‹ {periodLabel(shiftMonth(d.month, -1))}
          </Link>
          {d.month < d.today.slice(0, 7) ? (
            <Link className="pk-kbtn sm" href={monthHref(sp, shiftMonth(d.month, 1))} aria-label="Bulan berikutnya" data-pk-link="next-month">
              {periodLabel(shiftMonth(d.month, 1))} ›
            </Link>
          ) : null}
        </div>
      </DashHead>
      <SubNav active="rekap" scope={d.scope} />
      {d.scope ? (
        <form className="pk-filter" method="get" action="/admin/absensi/rekap" role="search" aria-label="Pilih karyawan dan bulan" data-pk-filter="absensi-rekap">
          <PtSelect pt={d.pt} pts={d.pts} value={d.chosen} />
          <label>
            Karyawan
            <select name="karyawan" defaultValue={String(idParam(sp, 'karyawan') ?? '')}>
              <option value="">— Seluruh tim (grid) —</option>
              {ptOptions(d.employees, d.pt, d.chosen).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bulan
            <input type="month" name="bulan" defaultValue={d.month} max={d.today.slice(0, 7)} />
          </label>
          {!d.recap ? (
            <>
              <label>
                Project
                <select name="project" defaultValue={String(idParam(sp, 'project') ?? '')}>
                  <option value="">Semua</option>
                  {ptOptions(d.loc.projects, d.pt, d.chosen).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Pusat biaya
                <select name="pusat" defaultValue={String(idParam(sp, 'pusat') ?? '')}>
                  <option value="">Semua</option>
                  {ptOptions(d.loc.costCenters, d.pt, d.chosen).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <SiteSelect options={ptOptions(d.loc.sites, d.pt, d.chosen)} value={idParam(sp, 'site')} all="Semua" />
            </>
          ) : null}
          <button type="submit" className="pk-kbtn primary">
            Tampilkan
          </button>
        </form>
      ) : null}
      {d.recap ? <EmployeeRecap d={d} recap={d.recap} /> : d.grid ? <TeamGrid d={d} grid={d.grid} sp={sp} /> : <Alert tone="info">Akun Anda belum terhubung ke data karyawan. Hubungi Admin.</Alert>}
    </Frame>
  )
}

function monthHref(sp: SP, month: string): string {
  const q = new URLSearchParams()
  for (const k of ['karyawan', 'project', 'pusat', 'site', 'pt']) if (one(sp, k)) q.set(k, one(sp, k))
  q.set('bulan', month)
  return `/admin/absensi/rekap?${q.toString()}`
}

function EmployeeRecap({ d, recap }: { d: RekapData; recap: MonthlyRecap }) {
  const s: RecapSummary = recap.summary
  const classes = recap.days.map((x) => classifyDay(x, d.today, x.date))
  const counts = classCounts(classes)
  const detail = recap.days.filter((x) => x.checkIn || x.status === 'tidak_hadir').reverse()
  const offset = offsetText(tzOffsetMinutes(new Date(`${recap.from}T12:00:00Z`), d.tz))
  const presentPct = s.workingDays > 0 ? Math.round((Math.min(s.presentDays - s.holidayWorkDays - s.offDayWorkDays, s.workingDays) / s.workingDays) * 100) : null
  return (
    <>
      <Bento label="Ringkasan bulan">
        <KpiRow cols={6}>
          <KpiTile id="rk-hadir" icon="check" label="Hadir" value={`${s.presentDays}`} title={`${s.presentDays} hari hadir dari ${s.workingDays} hari kerja`} kpi="rk-hadir" i={0}>
            <p className="pk-kpi-x">
              dari <b>{s.workingDays}</b> hari kerja{presentPct !== null ? ` · ${presentPct}%` : ''}
            </p>
          </KpiTile>
          <KpiTile id="rk-absent" icon="inbox" label="Tidak hadir" value={`${s.absentDays}`} kpi="rk-absent" i={1}>
            <p className="pk-kpi-x">{s.absentDays === 0 ? <StatusPill tone="ok" label="Nihil" /> : <StatusPill tone="bad" label="hari kerja tanpa absen" />}</p>
          </KpiTile>
          <KpiTile id="rk-late" icon="clock" label="Terlambat" value={`${s.lateDays} hari`} kpi="rk-late" i={2}>
            <p className="pk-kpi-x">total {minutesText(s.lateMinutes)}</p>
          </KpiTile>
          <KpiTile id="rk-early" icon="down" label="Pulang cepat" value={`${s.earlyLeaveDays} hari`} kpi="rk-early" i={3}>
            <p className="pk-kpi-x">total {minutesText(s.earlyLeaveMinutes)}</p>
          </KpiTile>
          <KpiTile id="rk-work" icon="target" label="Jam kerja" value={minutesText(s.workMinutes)} kpi="rk-work" i={4}>
            <p className="pk-kpi-x">{s.incompleteDays > 0 ? <StatusPill tone="warn" label={`${s.incompleteDays} hari tanpa absen pulang`} /> : 'semua hari lengkap'}</p>
          </KpiTile>
          <KpiTile id="rk-other" icon="users" label="Diabsenkan PM / dikoreksi" value={`${s.onBehalfDays} / ${s.correctedDays}`} kpi="rk-other" i={5}>
            <p className="pk-kpi-x">
              libur: <b>{s.holidayWorkDays}</b> · non-kerja: <b>{s.offDayWorkDays}</b> hari masuk
            </p>
          </KpiTile>
        </KpiRow>
        <Card id="rk-calendar" title="Kalender" sub="Klik hari untuk rincian; ikon + warna = status" span={8} i={6}>
          <Calendar month={recap.month} days={recap.days} today={d.today} anchor />
          <Legend counts={counts} />
        </Card>
        <Card id="rk-side" title="Jadwal & komposisi" sub={recap.schedule ? 'Jadwal karyawan saat ini' : undefined} span={4} i={7}>
          <ScheduleBox s={recap.schedule} />
          <div style={{ marginTop: 16 }}>
            <HBarList
              id="rk-classes"
              fmt={(v) => `${v} hari`}
              empty="Belum ada hari berjalan."
              items={LEGEND.filter((k) => counts[k] > 0 && k !== 'none').map((k) => ({ key: k, label: `${DAY_CLASSES[k].glyph} ${DAY_CLASSES[k].label}`, value: counts[k], cls: `dcbar ${DAY_CLASSES[k].tone}` }))}
            />
          </div>
        </Card>
        <Card id="rk-detail" title="Rincian harian" sub={`${detail.length} hari · terbaru dulu${d.canCorrect ? ' · koreksi jam oleh PM tim/Admin (alasan wajib)' : ''}`} span={12} i={8}>
          <DataTable<DayRecap>
            id="rk-detail"
            caption="Rincian absensi harian"
            rows={detail}
            rowKey={(x) => x.date}
            rowAttrs={(x) => ({ id: `hari-${x.date}`, 'data-pk-row-day': x.date })}
            empty={<EmptyState text="Belum ada absensi bulan ini." />}
            cols={[
              {
                key: 'tgl',
                label: 'Tanggal',
                sort: 'descending',
                cell: (x) => (
                  <>
                    <span className="nw">
                      {WD[x.weekday - 1]}, {dayShort(x.date)}
                    </span>
                    {x.holidayName ? <span className="sub">{x.holidayName}</span> : null}
                  </>
                ),
              },
              {
                key: 'st',
                label: 'Status',
                cell: (x) => {
                  const c = classifyDay(x, d.today, x.date)
                  const t = DAY_CLASSES[c].tone
                  return <StatusPill tone={t === 'ok' ? 'ok' : t === 'warn' ? 'warn' : t === 'bad' ? 'bad' : t === 'info' ? 'progress' : 'none'} label={DAY_CLASSES[c].label} />
                },
              },
              {
                key: 'loc',
                label: 'Lokasi · masuk → pulang',
                cell: (x) =>
                  x.locations.length === 0 ? (
                    <span className="pk-note">—</span>
                  ) : (
                    <div className="locs">
                      {x.locations.map((l) => (
                        <div key={`${l.location.type}:${l.location.id}`} className="loc">
                          <span className={`pk-chip ${LOC_CHIP[l.location.type]}`}>{locLabel(l.location)}</span>
                          <span className="nw">
                            <Stamp loc={l} kind="checkIn" d={x} tz={d.tz} /> → <Stamp loc={l} kind="checkOut" d={x} tz={d.tz} />
                          </span>
                        </div>
                      ))}
                    </div>
                  ),
              },
              { key: 'dur', label: 'Durasi', num: true, sec: true, cell: (x) => minutesText(x.workMinutes) },
              { key: 'late', label: 'Terlambat', num: true, cell: (x) => (x.lateMinutes > 0 ? `${x.lateMinutes} m` : '—') },
              { key: 'early', label: 'Pulang cepat', num: true, sec: true, cell: (x) => (x.earlyLeaveMinutes > 0 ? `${x.earlyLeaveMinutes} m` : '—') },
              {
                key: 'act',
                label: 'Aksi',
                cell: (x) =>
                  x.locations.length === 0 ? null : (
                    <div className="locs">
                      {x.locations.map((l) => (
                        <div key={`${l.location.type}:${l.location.id}`} className="pk-kact">
                          {(['checkIn', 'checkOut'] as const).map((k) => {
                            const s = l[k]
                            if (!s) return null
                            const kindLabel = k === 'checkIn' ? 'masuk' : 'pulang'
                            return (
                              <React.Fragment key={k}>
                                <span className="pk-actk" aria-hidden>
                                  {k === 'checkIn' ? 'Masuk' : 'Pulang'}
                                </span>
                                <SelfieButton attendanceId={s.id} label={`${kindLabel} ${dayShort(x.date)}`} available={d.selfies.get(s.id) !== false} own={d.own} />
                                {d.canCorrect ? (
                                  <CorrectionDialog
                                    attendanceId={s.id}
                                    kind={k === 'checkIn' ? 'check_in' : 'check_out'}
                                    date={x.date}
                                    dateLabel={dayMonth(x.date)}
                                    employee={recap.employee.name}
                                    location={locLabel(l.location)}
                                    currentLocal={hhmm(s.time, d.tz)}
                                    offset={offset}
                                    corrected={s.corrected}
                                  />
                                ) : null}
                              </React.Fragment>
                            )
                          })}
                        </div>
                      ))}
                    </div>
                  ),
              },
            ]}
          />
          {detail.some((v) => v.onBehalf) ? <p className="pk-note">PM = diabsenkan oleh PM (US-14).</p> : null}
        </Card>
        <Card id="rk-history" title="Riwayat koreksi (T10)" sub="Jam lama → baru, alasan dan pengoreksi; tidak bisa dihapus" span={12} i={9}>
          <DataTable<CorrectionRow>
            id="rk-history"
            caption="Riwayat koreksi absensi"
            rows={d.history}
            rowKey={(h) => h.id}
            empty={<EmptyState text="Belum ada koreksi bulan ini." />}
            cols={[
              { key: 'tgl', label: 'Tanggal', cell: (h) => <span className="nw">{dayShort(h.localDate)}</span> },
              { key: 'k', label: 'Jenis', cell: (h) => (h.kind === 'check_in' ? 'Masuk' : 'Pulang') },
              {
                key: 'ba',
                label: 'Sebelum → sesudah',
                cell: (h) => (
                  <span className="nw" data-pk-correction={h.id}>
                    <s>{hhmm(h.oldTime, d.tz)}</s> → <b>{hhmm(h.newTime, d.tz)}</b>
                  </span>
                ),
              },
              { key: 'r', label: 'Alasan', cell: (h) => h.reason },
              { key: 'by', label: 'Oleh', sec: true, cell: (h) => h.by },
              { key: 'at', label: 'Waktu koreksi', sec: true, sort: 'descending', cell: (h) => <span className="nw">{formatServerTime(h.at, d.tz)}</span> },
            ]}
          />
        </Card>
      </Bento>
      <p className="pk-note">
        Terlambat = menit setelah jam masuk jadwal bila melebihi toleransi (dihitung dari jam masuk); hari libur/non-kerja tidak dihitung terlambat, hanya ditandai. Selfie hanya untuk PM tim, Finance, Direktur,
        Admin dan karyawan sendiri; membuka selfie orang lain tercatat di audit log.
      </p>
    </>
  )
}

function TeamGrid({ d, grid, sp }: { d: RekapData; grid: NonNullable<RekapData['grid']>; sp: SP }) {
  const [y, m] = d.month.split('-').map(Number) as [number, number]
  const lastDate = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const dates = Array.from({ length: lastDate }, (_, i) => `${d.month}-${String(i + 1).padStart(2, '0')}`)
  const all: DayClass[] = []
  const sum = (k: keyof RecapSummary) => grid.reduce((t, e) => t + e.summary[k], 0)
  const q = new URLSearchParams()
  if (idParam(sp, 'project')) q.set('project', String(idParam(sp, 'project')))
  if (idParam(sp, 'pusat')) q.set('pusat', String(idParam(sp, 'pusat')))
  if (d.chosen) q.set('pt', String(d.chosen))
  q.set('bulan', d.month)
  const rows = grid.map((e) => {
    const by = new Map(e.days.map((x) => [x.date, x]))
    const cls = dates.map((date) => {
      const day = by.get(date)
      if (!day) return null
      const c = classifyDay(day, d.today, date)
      all.push(c)
      return { c, day }
    })
    return { e, cls }
  })
  const counts = classCounts(all)
  return (
    <Bento label="Rekap tim">
      <KpiRow cols={4}>
        <KpiTile id="tg-members" icon="users" label="Karyawan" value={`${grid.length}`} kpi="tg-members" i={0}>
          <p className="pk-kpi-x">{d.scope?.kind === 'team' ? 'anggota tim Anda' : 'ditugaskan / punya absensi'}</p>
        </KpiTile>
        <KpiTile id="tg-present" icon="check" label="Hari hadir" value={`${sum('presentDays')}`} kpi="tg-present" i={1}>
          <p className="pk-kpi-x">
            dari <b>{sum('workingDays')}</b> hari kerja terjadwal
          </p>
        </KpiTile>
        <KpiTile id="tg-late" icon="clock" label="Terlambat" value={`${sum('lateDays')} hari`} kpi="tg-late" i={2}>
          <p className="pk-kpi-x">
            total {minutesText(sum('lateMinutes'))} · pulang cepat <b>{sum('earlyLeaveDays')}</b> hari
          </p>
        </KpiTile>
        <KpiTile id="tg-absent" icon="inbox" label="Tidak hadir" value={`${sum('absentDays')} hari`} kpi="tg-absent" href={`/admin/laporan/absensi?${q.toString()}`} more="Laporan absensi" i={3}>
          <p className="pk-kpi-x">{sum('incompleteDays') > 0 ? <StatusPill tone="warn" label={`${sum('incompleteDays')} tanpa absen pulang`} /> : 'semua hari lengkap'}</p>
        </KpiTile>
      </KpiRow>
      <Card id="tg-grid" title={`Grid kehadiran ${periodLabel(d.month)}`} sub="Baris = karyawan, kolom = tanggal. Klik nama untuk kalender & koreksi." span={12} i={4}>
        {grid.length === 0 ? (
          <EmptyState text={d.scope?.kind === 'team' ? 'Belum ada anggota tim atau absensi di cakupan Anda bulan ini.' : 'Belum ada penugasan atau absensi bulan ini.'} />
        ) : (
          <>
            <div className="pk-grid-w">
              <table className="pk-grid" data-pk-table="team-grid">
                <caption className="pk-sr">Grid kehadiran tim {periodLabel(d.month)}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="nm">
                      Karyawan
                    </th>
                    {dates.map((date) => (
                      <th key={date} scope="col" className={wdOf(date) === 7 ? 'we' : ''} title={`${WD_LONG[wdOf(date) - 1]} ${dayMonth(date)}`}>
                        {Number(date.slice(8))}
                      </th>
                    ))}
                    <th scope="col" className="t" title="Hari hadir">
                      Hdr
                    </th>
                    <th scope="col" className="t" title="Hari terlambat">
                      Tlt
                    </th>
                    <th scope="col" className="t" title="Hari tidak hadir">
                      TH
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ e, cls }) => (
                    <tr key={e.id} data-pk-grid-employee={e.id}>
                      <td className="nm">
                        <a href={`/admin/absensi/rekap?karyawan=${e.id}&bulan=${d.month}`}>{e.name}</a>
                        <small>{e.code}</small>
                        {d.pt.multi ? <PtChip pt={d.pt.ref(e.companyId)} /> : null}
                      </td>
                      {cls.map((v, i) => {
                        const date = dates[i]!
                        if (!v) return <td key={date} className="c dc empty" aria-label={`${dayMonth(date)}: belum berjalan`} />
                        const meta = DAY_CLASSES[v.c]
                        const tipText = `${meta.label}${v.day.checkInLocal ? ` · ${v.day.checkInLocal}–${v.day.checkOutLocal ?? '…'}` : ''}${v.day.holidayName ? ` · ${v.day.holidayName}` : ''}`
                        return (
                          <td key={date} className={`c dc ${meta.tone}`} tabIndex={0} aria-label={`${e.name}, ${dayMonth(date)}: ${tipText}`} data-tip={JSON.stringify({ t: `${e.name} · ${dayShort(date)}`, r: [[tipText, '', '']] })} data-pk-cell={v.c}>
                            <span aria-hidden>{meta.glyph}</span>
                          </td>
                        )
                      })}
                      <td className="t">{e.summary.presentDays}</td>
                      <td className="t">{e.summary.lateDays}</td>
                      <td className="t">{e.summary.absentDays}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Legend counts={counts} />
            <TableView summary="Tabel angka per karyawan">
              <table className="pk-t">
                <thead>
                  <tr>
                    <th>Karyawan</th>
                    <th className="n">Hari kerja</th>
                    <th className="n">Hadir</th>
                    <th className="n">Tidak hadir</th>
                    <th className="n">Terlambat (hari/menit)</th>
                    <th className="n">Pulang cepat (hari/menit)</th>
                    <th className="n">Jam kerja</th>
                  </tr>
                </thead>
                <tbody>
                  {grid.map((e) => (
                    <tr key={e.id}>
                      <td>
                        {e.name}
                        {d.pt.multi ? ` · ${d.pt.ref(e.companyId)?.shortCode ?? ''}` : ''}
                      </td>
                      <td className="n">{e.summary.workingDays}</td>
                      <td className="n">{e.summary.presentDays}</td>
                      <td className="n">{e.summary.absentDays}</td>
                      <td className="n">
                        {e.summary.lateDays} / {e.summary.lateMinutes}
                      </td>
                      <td className="n">
                        {e.summary.earlyLeaveDays} / {e.summary.earlyLeaveMinutes}
                      </td>
                      <td className="n">{minutesText(e.summary.workMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableView>
          </>
        )}
      </Card>
    </Bento>
  )
}

// ---------------------------------------------------------------- Jadwal kerja, hari libur, geofence

type JadwalData = {
  schedules: Array<{ id: number; name: string; start: string; end: string; tol: number; days: number[]; active: boolean; used: number }>
  defaultId: number | null
  companyId: number
  employees: Array<{ id: number; code: string; name: string; scheduleId: number | null }>
  holidays: Array<{ id: number; date: string; name: string }>
  costCenters: Array<{ id: number; code: string; name: string; lat: number | null; lng: number | null; radiusM: number | null; active: boolean }>
  defaultRadius: number
  year: string
  today: string
}

export async function AbsensiJadwal(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  const sp = (props.searchParams ?? {}) as SP
  const scope = await withReqTransaction(req, () => attendanceScope(req)).catch(() => null)
  if (!scope) {
    return (
      <NoAccess props={props} />
    )
  }
  const canWrite = hasRoleAny(req, 'pk-admin', 'pk-owner') // collection update access: Admin + Owner (Direktur)
  const canCreate = hasRoleAny(req, 'pk-admin') // create: Admin only
  let d: JadwalData
  try {
    d = await withReqTransaction(req, async (): Promise<JadwalData> => {
      const ctx = await attendanceContext(req)
      const year = /^\d{4}$/.test(one(sp, 'tahun')) ? one(sp, 'tahun') : ctx.today.slice(0, 4)
      const p = req.payload
      const ws = await p.find({ collection: 'work-schedules', limit: 200, depth: 0, sort: 'name', user: req.user, overrideAccess: false, req })
      const emps = await p.find({ collection: 'employees', where: { active: { equals: true } }, limit: 500, depth: 0, sort: 'name', select: { code: true, name: true, workSchedule: true }, user: req.user, overrideAccess: false, req })
      const hol = await p.find({ collection: 'holidays', where: { and: [{ date: { greater_than_equal: `${year}-01-01` } }, { date: { less_than_equal: `${year}-12-31` } }] }, limit: 400, depth: 0, sort: 'date', user: req.user, overrideAccess: false, req })
      const cc = await p.find({ collection: 'cost-centers', limit: 300, depth: 0, sort: 'code', user: req.user, overrideAccess: false, req })
      // MC2: PT switcher — MC1 shows the settings of the context PT (only / first PT)
      const s = await companySettings(req)
      const employees = emps.docs.map((e) => {
        const x = e as unknown as { id: number; code: string; name: string; workSchedule?: unknown }
        return { id: x.id, code: x.code, name: x.name, scheduleId: relId(x.workSchedule) ?? null }
      })
      const defaultId = relId(s.defaultWorkSchedule) ?? null
      const used = new Map<number, number>()
      for (const e of employees) {
        const k = e.scheduleId ?? defaultId
        if (k) used.set(k, (used.get(k) ?? 0) + 1)
      }
      return {
        schedules: ws.docs.map((w) => {
          const x = w as unknown as { id: number; name: string; startTime: string; endTime: string; lateToleranceMin?: number | null; active?: boolean | null; workDays?: Record<string, boolean | null> | null }
          const keys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
          return { id: x.id, name: x.name, start: x.startTime, end: x.endTime, tol: x.lateToleranceMin ?? 15, days: keys.map((k, i) => ((x.workDays?.[k] ?? k !== 'sun') ? i + 1 : 0)).filter((v) => v > 0), active: x.active !== false, used: used.get(x.id) ?? 0 }
        }),
        defaultId,
        companyId: s.companyId,
        employees,
        holidays: hol.docs.map((h) => ({ id: h.id as number, date: (h as { date: string }).date, name: (h as { name: string }).name })),
        costCenters: cc.docs.map((c) => {
          const x = c as unknown as { id: number; code: string; name: string; lat?: number | null; lng?: number | null; radiusM?: number | null; active?: boolean | null }
          return { id: x.id, code: x.code, name: x.name, lat: x.lat ?? null, lng: x.lng ?? null, radiusM: x.radiusM ?? null, active: x.active !== false }
        }),
        defaultRadius: s.defaultGeofenceRadiusM ?? 100,
        year,
        today: ctx.today,
      }
    })
  } catch (err) {
    return <Failed props={props} name="absensi-jadwal" title="Jadwal & hari libur" err={err} req={req} />
  }
  const opts: Option[] = d.schedules.filter((s) => s.active).map((s) => ({ id: s.id, label: `${s.name} (${s.start}–${s.end})` }))
  const def = d.schedules.find((s) => s.id === d.defaultId)
  const withGeo = d.costCenters.filter((c) => c.lat !== null && c.lng !== null).length
  const upcoming = d.holidays.filter((h) => h.date >= d.today)
  const y = Number(d.year)
  return (
    <Frame props={props} name="absensi-jadwal">
      <DashHead title="Absensi · Jadwal & hari libur" note="Dasar perhitungan terlambat / pulang cepat / tidak hadir (Q-30) dan geofence pusat biaya (Q-40)." />
      <SubNav active="jadwal" scope={scope} />
      {!canWrite ? (
        <Alert tone="info" attr="read-only">
          Tampilan baca. Perubahan jadwal, hari libur dan geofence oleh Admin atau Direktur (tercatat di audit log).
        </Alert>
      ) : null}
      <Bento label="Ringkasan jadwal">
        <KpiRow cols={4}>
          <KpiTile id="jd-default" icon="clock" label="Jadwal default" value={def ? `${def.start}–${def.end}` : '—'} kpi="jd-default" href="#jadwal-default" more="Ubah" i={0}>
            <p className="pk-kpi-x">{def ? `${def.name} · toleransi ${def.tol} m` : <StatusPill tone="warn" label="Belum diatur" />}</p>
          </KpiTile>
          <KpiTile id="jd-own" icon="users" label="Karyawan berjadwal khusus" value={`${d.employees.filter((e) => e.scheduleId).length}`} kpi="jd-own" href="#penugasan" more="Penugasan" i={1}>
            <p className="pk-kpi-x">dari {d.employees.length} karyawan aktif</p>
          </KpiTile>
          <KpiTile id="jd-holidays" icon="doc" label={`Hari libur ${d.year}`} value={`${d.holidays.length}`} kpi="jd-holidays" href="#hari-libur" more="Daftar" i={2}>
            <p className="pk-kpi-x">{upcoming[0] ? `berikutnya ${dayShort(upcoming[0].date)} · ${upcoming[0].name}` : 'tidak ada lagi tahun ini'}</p>
          </KpiTile>
          <KpiTile id="jd-geo" icon="target" label="Pusat biaya bergeofence" value={`${withGeo}/${d.costCenters.length}`} kpi="jd-geo" href="#geofence" more="Atur titik" i={3}>
            <p className="pk-kpi-x">tanpa titik = absen di sana ditolak</p>
          </KpiTile>
        </KpiRow>

        <Card id="jadwal" title="Jadwal kerja" sub="Hari kerja, jam masuk/pulang dan toleransi" span={7} i={4} action={canCreate ? { href: '/admin/collections/work-schedules/create', label: 'Jadwal baru' } : undefined}>
          <div id="jadwal-default" style={{ marginBottom: 14 }}>
            <DefaultSchedule current={d.defaultId} companyId={d.companyId} options={opts} disabled={!canWrite} />
          </div>
          <DataTable
            id="work-schedules"
            caption="Jadwal kerja"
            rows={d.schedules}
            rowKey={(s) => s.id}
            empty={<EmptyState text="Belum ada jadwal kerja." action={canCreate ? { href: '/admin/collections/work-schedules/create', label: 'Buat jadwal' } : undefined} />}
            cols={[
              {
                key: 'n',
                label: 'Jadwal',
                cell: (s) => (
                  <>
                    <a href={`/admin/collections/work-schedules/${s.id}`}>{s.name}</a>
                    {s.id === d.defaultId ? <span className="sub">default perusahaan</span> : null}
                  </>
                ),
              },
              { key: 'j', label: 'Jam', cell: (s) => <span className="nw">{s.start}–{s.end}</span> },
              {
                key: 'd',
                label: 'Hari kerja',
                sec: true,
                cell: (s) => (
                  <span className="pk-days" aria-label={s.days.map((v) => WD_LONG[v - 1]).join(', ')}>
                    {WD.map((w, i) => (
                      <span key={w} className={s.days.includes(i + 1) ? 'on' : ''} aria-hidden>
                        {w.slice(0, 2)}
                      </span>
                    ))}
                  </span>
                ),
              },
              { key: 't', label: 'Toleransi', num: true, cell: (s) => `${s.tol} m` },
              { key: 'u', label: 'Dipakai', num: true, sec: true, cell: (s) => `${s.used} org` },
              { key: 'a', label: 'Status', cell: (s) => (s.active ? <StatusPill tone="ok" label="Aktif" /> : <StatusPill tone="none" label="Nonaktif" />) },
              ...(canWrite
                ? [{ key: 'e', label: 'Aksi', num: true, cell: (s: (typeof d.schedules)[number]) => <EditButton href={`/admin/collections/work-schedules/${s.id}`} name={`jadwal ${s.name}`} /> }]
                : []),
            ]}
          />
        </Card>

        <Card id="hari-libur" title={`Hari libur ${d.year}`} sub="Absen di hari libur tetap diterima dan ditandai" span={5} i={5}>
          <nav className="pk-tabs" aria-label="Tahun" style={{ marginBottom: 10 }}>
            {[y - 1, y, y + 1].map((v) => (
              <Link key={v} href={`/admin/absensi/jadwal?tahun=${v}#hari-libur`} aria-current={v === y ? 'page' : undefined}>
                {v}
              </Link>
            ))}
          </nav>
          {canCreate ? (
            <div style={{ marginBottom: 12 }}>
              <HolidayAdd year={d.year} />
            </div>
          ) : null}
          <DataTable
            id="holidays"
            caption={`Hari libur ${d.year}`}
            rows={d.holidays}
            rowKey={(h) => h.id}
            rowAttrs={(h) => ({ 'data-pk-holiday': h.date })}
            empty={<EmptyState text={`Belum ada hari libur ${d.year}.`} />}
            cols={[
              {
                key: 'tg',
                label: 'Tanggal',
                sort: 'ascending',
                cell: (h) => (
                  <span className="nw">
                    {WD[wdOf(h.date) - 1]}, {dayShort(h.date)}
                  </span>
                ),
              },
              { key: 'n', label: 'Keterangan', cell: (h) => (h.date < d.today ? <span style={{ color: 'var(--pk-muted-fg)' }}>{h.name}</span> : h.name) },
              ...(canWrite
                ? [{ key: 'e', label: 'Aksi', num: true, cell: (h: (typeof d.holidays)[number]) => <EditButton href={`/admin/collections/holidays/${h.id}`} name={`hari libur ${h.name}`} /> }]
                : []),
            ]}
          />
        </Card>

        <Card id="penugasan" title="Penugasan jadwal karyawan" sub="Kosong = memakai jadwal default perusahaan" span={6} i={6}>
          <DataTable
            id="schedule-assign"
            caption="Jadwal kerja per karyawan"
            rows={d.employees}
            rowKey={(e) => e.id}
            empty={<EmptyState text="Belum ada karyawan aktif." />}
            cols={[
              {
                key: 'n',
                label: 'Karyawan',
                cell: (e) => (
                  <>
                    <span>{e.name}</span>
                    <span className="sub">{e.code}</span>
                  </>
                ),
              },
              { key: 's', label: 'Jadwal', cell: (e) => <ScheduleAssign employeeId={e.id} employee={e.name} current={e.scheduleId} options={opts} disabled={!canWrite} /> },
            ]}
          />
        </Card>

        <Card id="geofence" title="Geofence pusat biaya" sub="Titik + radius tempat absen di pusat biaya (Q-40)" span={6} i={7}>
          <DataTable
            id="geofence"
            caption="Geofence pusat biaya"
            rows={d.costCenters}
            rowKey={(c) => c.id}
            rowAttrs={(c) => ({ 'data-pk-geofence': String(c.id) })}
            empty={<EmptyState text="Belum ada pusat biaya." />}
            cols={[
              {
                key: 'n',
                label: 'Pusat biaya',
                cell: (c) => (
                  <>
                    <span>
                      {c.code} {c.name}
                    </span>
                    <span className="sub">{c.lat !== null && c.lng !== null ? (c.radiusM !== null ? `radius ${c.radiusM} m` : `radius default ${d.defaultRadius} m`) : 'tanpa titik — absen ditolak'}{c.active ? '' : ' · nonaktif'}</span>
                  </>
                ),
              },
              { key: 'g', label: 'Latitude · longitude · radius', cell: (c) => <GeofenceForm costCenterId={c.id} name={`${c.code} ${c.name}`} lat={c.lat} lng={c.lng} radiusM={c.radiusM} defaultRadius={d.defaultRadius} disabled={!canWrite} /> },
            ]}
          />
          <p className="pk-note">Koordinat desimal (WGS84), mis. dari Google Maps/OSM. &quot;Cek di peta&quot; membuka OpenStreetMap di tab baru (tidak ada peta tertanam).</p>
        </Card>
      </Bento>
    </Frame>
  )
}

// ---------------------------------------------------------------- Beranda widget (US-13)

/** "Kehadiran tim hari ini" card body for the Beranda (PM; office roles see all). Own transaction. */
export async function TeamTodayWidget({ req }: { req: PayloadRequest }) {
  let r: TeamTodayResult | null = null
  try {
    r = await withReqTransaction(req, async () => ((await attendanceScope(req)) ? teamTodayFor(req, {}) : null))
  } catch (err) {
    req.payload.logger.error({ msg: 'team today widget failed', err: (err as Error).message })
    return <EmptyState text="Kehadiran tim tidak dapat dimuat." />
  }
  if (!r) return null
  const c = r.counts
  const late = r.members.filter((m) => m.lateMinutes > 0).length
  const waiting = r.members.filter((m) => m.status === 'belum_absen').slice(0, 4)
  return (
    <div data-pk-widget="team-today">
      {c.total === 0 ? (
        <EmptyState text="Belum ada anggota tim yang ditugaskan hari ini." action={{ href: '/admin/absensi', label: 'Buka absensi' }} />
      ) : (
        <>
          <div className="pk-kpis c3" style={{ gap: 8 }}>
            {(
              [
                ['belum_absen', 'Belum absen', c.belum_absen],
                ['hadir', 'Hadir', c.hadir],
                ['selesai', 'Selesai', c.selesai],
              ] as const
            ).map(([k, label, n]) => (
              <a key={k} className="pk-kpi" href={`/admin/absensi#col-${k}`} style={{ padding: '10px 12px', textDecoration: 'none', color: 'inherit' }} data-pk-att-count={k}>
                <span className="pk-kpi-l">{label}</span>
                <span className="pk-kpi-v" style={{ fontSize: 22, margin: 0 }}>
                  {n}
                </span>
              </a>
            ))}
          </div>
          <div className="pk-split" role="img" aria-label={`Belum absen ${c.belum_absen}, hadir ${c.hadir}, selesai ${c.selesai} dari ${c.total}`} style={{ height: 10 }}>
            {c.belum_absen ? <span className="mute" style={{ flex: c.belum_absen }} /> : null}
            {c.hadir ? <span className="soft" style={{ flex: c.hadir }} /> : null}
            {c.selesai ? <span className="strong" style={{ flex: c.selesai }} /> : null}
          </div>
          <p className="pk-note" style={{ margin: '6px 0 0' }}>
            {c.total} ditugaskan · {late > 0 ? `${late} terlambat` : 'tidak ada yang terlambat'}
            {r.holidayName ? ` · libur: ${r.holidayName}` : ''}
            {waiting.length ? ` · belum absen: ${waiting.map((m) => m.employee.name).join(', ')}${c.belum_absen > waiting.length ? ', …' : ''}` : ''}
          </p>
        </>
      )}
      <p style={{ margin: '8px 0 0', fontSize: 12 }}>
        <Link href="/admin/absensi" style={{ fontWeight: 600, color: 'var(--pk-primary)' }}>
          Buka Tim hari ini →
        </Link>
      </p>
    </div>
  )
}

export default AbsensiToday
