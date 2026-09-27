import Link from 'next/link'
import React from 'react'

import { MONTHS_SHORT } from '@/domain/reports/rules'
import type { PillTone } from '@/domain/reports/viz'
import type { ProjectProgress } from '@/domain/reports/progress'

import { EmptyState, pctText, rp, StatusPill } from './viz'

/**
 * E4/E5 admin kit (Sprint S2 web A): shared pieces of the progress, progress-report and addendum
 * views, on top of the Beranda kit (./viz.tsx) and the Kas controls (KAS_STYLE).
 * Chart method = dataviz skill: progress fisik vs % anggaran on ONE 0–100 % axis (same unit, never
 * a dual axis) as paired thin bars in the validated one-hue ordinal pair already used for
 * komitmen/realisasi (light blue-350/600, dark blue-550/300 — validator: ALL CHECKS PASS both modes);
 * K-09 status as a pill with icon + label (never colour alone); every chart has a table twin and
 * data-tip tooltips (ChartHover). Colours only through theme tokens → light/dark follow html[data-theme].
 */
export const PROGRESS_STYLE = `
.pk-f3 .pk-pvb { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.pk-f3 .pk-pvb-row { display: grid; grid-template-columns: minmax(0, 28%) minmax(0, 1fr) 310px; align-items: center; gap: 4px 14px; padding: 4px; margin: 0 -4px; border-radius: 6px; color: inherit; text-decoration: none; }
.pk-f3 a.pk-pvb-row:hover, .pk-f3 .pk-pvb-row:focus-visible { background: color-mix(in oklab, var(--pk-primary) 6%, transparent); }
.pk-f3 .pk-pvb-row .l { min-width: 0; font-size: 13px; }
.pk-f3 .pk-pvb-row .l span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pk-f3 .pk-pvb-row .l small { display: block; color: var(--pk-muted-fg); font-size: 11px; }
.pk-f3 .pk-pvb-row .t { display: grid; gap: 2px; position: relative; }
.pk-f3 .pk-pvb-row .t > span { position: relative; height: 10px; background: var(--viz-track); border-radius: 0 4px 4px 0; }
.pk-f3 .pk-pvb-row .t > span > i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 0 4px 4px 0; }
.pk-f3 .pk-pvb-row .t .b > i { background: var(--viz-soft); } .pk-f3 .pk-pvb-row .t .p > i { background: var(--viz-strong); }
.pk-f3 .pk-pvb-row .v { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.pk-f3 .pk-pvb-row .v b { color: var(--pk-fg); }
@container (max-width: 720px) { .pk-f3 .pk-pvb-row { grid-template-columns: minmax(0, 1fr) auto; } .pk-f3 .pk-pvb-row .t { grid-column: 1 / -1; grid-row: 2; } }
@container (max-width: 520px) { .pk-f3 .pk-pvb-row { grid-template-columns: minmax(0, 1fr); } .pk-f3 .pk-pvb-row .t { grid-row: 3; } .pk-f3 .pk-pvb-row .v { align-items: flex-start; white-space: normal; } }
.pk-f3 .pk-pvb-axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--pk-muted-fg); margin: 2px 324px 0 calc(28% + 10px); }
@container (max-width: 720px) { .pk-f3 .pk-pvb-axis { display: none; } }
/* stages */
.pk-f3 .pk-stages { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.pk-f3 .pk-stage { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 4px 12px; align-items: center; }
.pk-f3 .pk-stage .n { width: 28px; height: 28px; border-radius: 999px; display: inline-grid; place-items: center; font-size: 12px; font-weight: 700; background: color-mix(in oklab, var(--pk-primary) 12%, transparent); color: var(--pk-primary); }
.pk-f3 .pk-stage.done .n { background: var(--pk-tone-ok); color: #FFFFFF; }
.pk-f3 .pk-stage .nm { font-size: 13px; font-weight: 600; min-width: 0; }
.pk-f3 .pk-stage .nm small { display: block; font-weight: 400; color: var(--pk-muted-fg); font-size: 11.5px; }
.pk-f3 .pk-stage .bar { grid-column: 2 / -1; height: 8px; border-radius: 999px; background: var(--viz-track); overflow: hidden; }
.pk-f3 .pk-stage .bar > i { display: block; height: 100%; border-radius: 999px; background: var(--viz-1); }
.pk-f3 .pk-stage .pc { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
/* timeline */
.pk-f3 .pk-tl { list-style: none; margin: 0; padding: 0 0 0 18px; border-left: 2px solid var(--pk-border); display: grid; gap: 14px; }
.pk-f3 .pk-tl > li { position: relative; }
.pk-f3 .pk-tl > li::before { content: ''; position: absolute; left: -24px; top: 4px; width: 10px; height: 10px; border-radius: 999px; background: var(--pk-card); border: 2px solid var(--viz-1); }
.pk-f3 .pk-tl > li[data-pk-done='yes']::before { background: var(--viz-1); }
.pk-f3 .pk-tl .when { font-size: 12px; color: var(--pk-muted-fg); }
.pk-f3 .pk-tl .what { font-size: 13px; margin: 2px 0 0; }
.pk-f3 .pk-tl .what b { font-variant-numeric: tabular-nums; }
/* photo gallery */
.pk-f3 .pk-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none; }
.pk-f3 .pk-gallery a { display: block; aspect-ratio: 4 / 3; border-radius: var(--style-radius-m); overflow: hidden; border: 1px solid var(--pk-border); background: var(--viz-track); }
.pk-f3 .pk-gallery a:focus-visible { outline: 2px solid var(--pk-ring); outline-offset: 2px; }
.pk-f3 .pk-gallery img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .2s ease; }
.pk-f3 .pk-gallery a:hover img { transform: scale(1.03); }
@media (prefers-reduced-motion: reduce) { .pk-f3 .pk-gallery img { transition: none; } }
.pk-f3 .pk-thumbs { display: flex; gap: 4px; }
.pk-f3 .pk-thumbs img { width: 36px; height: 28px; object-fit: cover; border-radius: 4px; border: 1px solid var(--pk-border); background: var(--viz-track); }
.pk-f3 .pk-dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 16px; margin: 0; font-size: 13px; }
.pk-f3 .pk-dl dt { color: var(--pk-muted-fg); } .pk-f3 .pk-dl dd { margin: 0; overflow-wrap: anywhere; }
.pk-f3 .pk-pre { white-space: pre-wrap; margin: 0; font-size: 13px; line-height: 1.55; }
.pk-f3 .pk-t tr:target td { background: color-mix(in oklab, var(--pk-primary) 12%, transparent); }
.pk-f3 form.pk-filter .pk-kbtn { align-self: flex-end; }
@media (max-width: 559px) { .pk-f3 .pk-dash-head .pk-kact { width: 100%; } .pk-f3 .pk-dash-head .pk-kact > * { flex: 1 1 auto; } }
`

export function Alert({ tone, children, attr }: { tone: 'ok' | 'bad' | 'info'; children: React.ReactNode; attr?: string }) {
  return (
    <div className={`pk-alert ${tone}`} role={tone === 'bad' ? 'alert' : 'status'} data-pk-alert={attr}>
      <b aria-hidden>{tone === 'ok' ? '✓' : tone === 'bad' ? '!' : 'i'}</b>
      <div>{children}</div>
    </div>
  )
}

/** '2026-09-25' → '25 Sep 2026'. */
export const dateId = (date: string | null | undefined) => (date ? `${Number(date.slice(8, 10))} ${MONTHS_SHORT[Number(date.slice(5, 7)) - 1] ?? ''} ${date.slice(0, 4)}` : '—')
/** ISO instant → local "25 Sep 2026 14.05" in `tz`. */
export function dateTimeId(iso: string | null | undefined, tz: string): string {
  if (!iso) return '—'
  const f = new Intl.DateTimeFormat('id-ID', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  return f.format(new Date(iso))
}

const TONE_PILL: Record<ProjectProgress['tone'], PillTone> = { ok: 'ok', warn: 'warn', bad: 'bad', none: 'none' }

/** K-09 status (US-12): icon + label, colour only reinforces. */
export function ProgressTonePill({ p }: { p: Pick<ProjectProgress, 'tone' | 'toneLabel' | 'gap'> }) {
  return <StatusPill tone={TONE_PILL[p.tone]} label={p.gap === null ? p.toneLabel : `${p.toneLabel} · selisih ${pctText(p.gap)}`} />
}

export function ProgressLegend({ warn, bad }: { warn: number; bad: number }) {
  return (
    <div className="pk-legend" aria-hidden>
      <span>
        <i className="sw soft" />% anggaran terpakai (komitmen, K-08)
      </span>
      <span>
        <i className="sw strong" />
        Progress fisik
      </span>
      <span>
        Hijau selisih ≤ {warn}% · kuning ≤ {bad}% · merah &gt; {bad}%
      </span>
    </div>
  )
}

const tip = (t: string, r: Array<[string, string, string?]>) => JSON.stringify({ t, r })
const w = (v: number | null) => `${Math.max(0, Math.min(100, v ?? 0))}%`

/**
 * Paired bars per project on one 0–100 % axis: % anggaran terpakai vs progress fisik (K-09, US-12).
 * Values above 100 % are clamped visually; the exact number is always printed beside the bars.
 */
export function ProgressVsBudgetRows({ id, rows, hrefOf, empty }: { id: string; rows: ProjectProgress[]; hrefOf?: (p: ProjectProgress) => string; empty: string }) {
  if (rows.length === 0) return <EmptyState text={empty} />
  return (
    <>
      <ul className="pk-pvb" data-pk-chart={id}>
        {rows.map((p) => {
          const label = `${p.code} ${p.name}`
          const t = tip(label, [
            ['anggaran terpakai', `${pctText(p.budgetPct)} (${rp(p.committed)} dari RAB ${rp(p.budget)})`, 'soft'],
            ['progress fisik', pctText(p.progressPct), 'strong'],
            ['status', p.toneLabel],
          ])
          const body = (
            <>
              <span className="l">
                <span title={label}>{label}</span>
                <small>{p.budget ? `RAB ${rp(p.budget)}` : 'Tanpa RAB'} · {p.reportCount} laporan{p.lastReportDate ? ` · terakhir ${dateId(p.lastReportDate)}` : ''}</small>
              </span>
              <span className="t" aria-hidden>
                <span className="b">{(p.budgetPct ?? 0) > 0 ? <i style={{ width: w(p.budgetPct) }} /> : null}</span>
                <span className="p">{p.stagesComplete && p.progressPct > 0 ? <i style={{ width: w(p.progressPct) }} /> : null}</span>
              </span>
              <span className="v">
                <span>
                  <b>{pctText(p.stagesComplete ? p.progressPct : null)}</b> fisik · {pctText(p.budgetPct)} anggaran
                </span>
                <ProgressTonePill p={p} />
              </span>
            </>
          )
          return (
            <li key={p.id} data-pk-progress-project={p.code} data-pk-tone={p.tone}>
              {hrefOf ? (
                <a className="pk-pvb-row" href={hrefOf(p)} data-tip={t}>
                  {body}
                </a>
              ) : (
                <div className="pk-pvb-row" tabIndex={0} data-tip={t}>
                  {body}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <div className="pk-pvb-axis" aria-hidden>
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
    </>
  )
}

/** Table twin of the chart (every number, also for screen readers / print). */
export function ProgressTable({ rows, hrefOf }: { rows: ProjectProgress[]; hrefOf?: (p: ProjectProgress) => string }) {
  return (
    <table className="pk-t" data-pk-table="progress-vs-budget">
      <thead>
        <tr>
          <th scope="col">Project</th>
          <th scope="col" className="n">
            RAB
          </th>
          <th scope="col" className="n">
            Komitmen
          </th>
          <th scope="col" className="n">
            % anggaran
          </th>
          <th scope="col" className="n">
            Progress fisik
          </th>
          <th scope="col" className="n">
            Selisih
          </th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.id}>
            <td>{hrefOf ? <a href={hrefOf(p)}>{`${p.code} ${p.name}`}</a> : `${p.code} ${p.name}`}</td>
            <td className="n">{rp(p.budget)}</td>
            <td className="n">{rp(p.committed)}</td>
            <td className="n">{pctText(p.budgetPct, 2)}</td>
            <td className="n" data-pk-kpi="progress">
              {p.stagesComplete ? pctText(p.progressPct, 2) : '—'}
            </td>
            <td className="n">{pctText(p.gap, 2)}</td>
            <td>
              <ProgressTonePill p={p} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Compact "Progress fisik" cell for budget tables (Dashboard, report anggaran-project). */
export function ProgressCell({ p }: { p: ProjectProgress | undefined }) {
  if (!p) return <>—</>
  if (!p.stagesComplete) return <StatusPill tone="none" label="Tahapan belum 100%" />
  return (
    <span className="nw" data-pk-progress={p.code}>
      <b style={{ fontVariantNumeric: 'tabular-nums' }}>{pctText(p.progressPct)}</b> <ProgressTonePill p={p} />
    </span>
  )
}

/**
 * US-12 widget of the Beranda (Direktur/Finance: all projects, PM: team): the projects with the
 * largest K-09 gap first, paired bars + status, link to the full progress page. Replaces the
 * "(F5)" placeholder. Carries its own styles (the Beranda renders only VIZ_STYLE).
 */
export function ProgressVsBudgetCard({ id, data, span = 12, i = 0, limit = 6, pm }: { id: string; data: { warnGapPct: number; badGapPct: number; projects: ProjectProgress[] }; span?: 6 | 7 | 8 | 12; i?: number; limit?: number; pm?: boolean }) {
  const rows = [...data.projects].sort((a, b) => (b.gap ?? -999) - (a.gap ?? -999) || a.code.localeCompare(b.code))
  const flagged = rows.filter((p) => p.tone === 'bad' || p.tone === 'warn').length
  return (
    <section className={`pk-card s${span} pk-anim`} style={{ '--i': i } as React.CSSProperties} aria-labelledby={`pk-card-${id}`} data-pk-card={id}>
      <style>{PROGRESS_STYLE}</style>
      <div className="pk-card-h">
        <h2 id={`pk-card-${id}`}>
          Progress fisik vs anggaran
          <span className="sub">
            K-09 (US-12){pm ? ' · project tim Anda' : ''} · {flagged > 0 ? `${flagged} project perlu perhatian` : 'semua sesuai'} · selisih terbesar dulu
          </span>
        </h2>
        <Link href="/admin/progress">Progress project →</Link>
      </div>
      <div className="pk-card-b">
        {rows.length > 0 ? <ProgressLegend warn={data.warnGapPct} bad={data.badGapPct} /> : null}
        <ProgressVsBudgetRows id={id} rows={rows.slice(0, limit)} hrefOf={(p) => `/admin/progress/project/${p.id}`} empty={pm ? 'Anda belum ditetapkan sebagai PM project mana pun.' : 'Belum ada project.'} />
        {rows.length > 0 ? (
          <details className="pk-tv">
            <summary>Tabel angka</summary>
            <div className="pk-tw">
              <ProgressTable rows={rows} hrefOf={(p) => `/admin/progress/project/${p.id}`} />
            </div>
          </details>
        ) : null}
      </div>
      {rows.length > limit ? <p className="pk-card-f">Menampilkan {limit} dari {rows.length} project — semua ada di tabel angka dan halaman Progress project.</p> : null}
    </section>
  )
}
