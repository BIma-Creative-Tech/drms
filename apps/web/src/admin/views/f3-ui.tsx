import React from 'react'

import { cellText } from '@/domain/reports/export'
import type { Column, FilterField, Table } from '@/domain/reports/registry'
import { BUDGET_LABELS, type BudgetTone } from '@/domain/reports/rules'

/**
 * Server-rendered building blocks of the F3 reports (wireframes §0) and shared pieces of the
 * Beranda (charts/cards: ./viz.tsx). Colours are the web-starter theme tokens (--pk-*, set per
 * light/dark mode in (payload)/custom.scss from src/theme/tokens.ts); status is never colour alone.
 * All text goes through React escaping. `data-pk-*` attributes are stable UAT selectors.
 * D2510 (ADR 0033, Nexus look): budget badges are soft badges (tinted pill, *-text token), report tables get the
 * muted header row and roomy rows of the dashboard tables (viz.tsx); class names unchanged.
 */
export const F3_STYLE = `
.pk-f3 { --pk-grid: var(--pk-border); --pk-muted: var(--pk-muted-fg);
  --pk-ok: var(--pk-tone-ok-text); --pk-warn: var(--pk-tone-warn-text); --pk-bad: var(--pk-tone-bad-text); --pk-none: var(--theme-elevation-500); }
.pk-f3 section.pk-block { margin: 0 0 24px; }
.pk-f3 section.pk-block > h2 { font-family: var(--pk-font-heading); font-size: 17px; line-height: 1.3; margin: 0 0 10px; }
.pk-f3 .pk-scroll { overflow-x: auto; margin: 0 0 12px; background: var(--pk-card); border: 1px solid var(--pk-border); border-radius: var(--style-radius-l); box-shadow: var(--pk-shadow); }
/* DRMS 15/10 #6: a report with few columns does not spread them over the page — the card hugs its table */
.pk-f3 .pk-scroll:has(> table.pk-table) { width: fit-content; max-width: 100%; }
.pk-f3 table.pk-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.pk-f3 .pk-table th { text-align: left; border-bottom: 1px solid var(--pk-border); padding: 10px 14px; white-space: nowrap; color: var(--pk-muted-fg); background: color-mix(in oklab, var(--pk-muted-bg) 55%, var(--pk-card)); font-size: 12px; font-weight: 600; }
.pk-f3 .pk-table td { border-bottom: 1px solid var(--pk-border); padding: 10px 14px; vertical-align: top; overflow-wrap: break-word; }
.pk-f3 .pk-table tbody tr:hover td { background: color-mix(in oklab, var(--pk-primary) 5%, transparent); }
.pk-f3 .pk-table tbody tr:last-child td { border-bottom: 0; }
.pk-f3 .pk-table .n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.pk-f3 .pk-table tfoot td { font-weight: 700; border-top: 1px solid var(--pk-border); }
/* soft badge (= kit pk-nx-badge): the tone's *-text colour on its own 14% tint; the glyph keeps status off colour alone */
.pk-f3 .pk-badge { display: inline-flex; align-items: center; gap: 4px; min-height: 22px; padding: 0 8px; border-radius: 999px; font-size: 12px; font-weight: 600; line-height: 1.2; white-space: nowrap; background: color-mix(in oklab, currentColor 14%, var(--pk-card)); }
.pk-f3 .pk-badge > span[aria-hidden] { font-size: 10px; }
.pk-f3 .pk-badge.ok { color: var(--pk-ok); } .pk-f3 .pk-badge.warn { color: var(--pk-warn); } .pk-f3 .pk-badge.over { color: var(--pk-bad); } .pk-f3 .pk-badge.none { color: var(--pk-muted-fg); }
.pk-f3 .pk-empty { color: var(--pk-muted); }
.pk-f3 .pk-note { color: var(--pk-muted); font-size: 12px; margin: 4px 0; }
.pk-f3 form.pk-filter { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: flex-end; margin: 0 0 12px; padding: 12px; border: 1px solid var(--pk-border); border-radius: var(--style-radius-l); background: var(--pk-card); }
.pk-f3 form.pk-filter label { display: flex; flex-direction: column; font-size: 12px; gap: 2px; }
/* DRMS 15/10 #2: a checkbox / radio label is a row (box left of its text); the field rules below skip the box itself */
.pk-f3 form.pk-filter label:has(> input:is([type='checkbox'], [type='radio'])) { flex-direction: row; align-items: center; justify-content: flex-start; gap: 8px; font-size: 13px; }
.pk-f3 form.pk-filter input:not([type='checkbox'], [type='radio']), .pk-f3 form.pk-filter select { font-size: 13px; padding: 4px 6px; min-width: 140px; background: var(--theme-input-bg, var(--theme-elevation-0)); color: var(--theme-text); border: 1px solid var(--pk-input); border-radius: var(--style-radius-s); }
.pk-f3 form.pk-filter select[multiple] { min-height: 90px; }
/* DRMS 13/10 Umum #4: checklist dropdowns (MultiSelect) inside .pk-filter — undo the column label / 140px input rules */
.pk-f3 form.pk-filter .pk-filter__multi { display: flex; flex-direction: column; font-size: 12px; gap: 2px; }
.pk-f3 form.pk-filter .pk-ms__search { min-width: 0; width: 100%; }
.pk-f3 .pk-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0 0 12px; font-size: 13px; }
/* one button system: same box as .pk-kbtn (components/kas/style.ts) — 38 px, 32 px .sm, 44 px on touch */
.pk-f3 .pk-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; min-height: 38px; padding: 0 14px; border-radius: var(--style-radius-m); border: 1px solid var(--pk-btn-border); text-decoration: none; background: var(--pk-card); color: var(--theme-text); font: inherit; font-size: 13px; font-weight: 600; line-height: 1.2; white-space: nowrap; cursor: pointer; }
.pk-f3 .pk-btn:hover { border-color: var(--pk-primary); color: var(--pk-primary); }
.pk-f3 .pk-btn:focus-visible { outline: 2px solid var(--pk-ring); outline-offset: 2px; }
.pk-f3 .pk-btn.sm { min-height: 32px; padding: 0 10px; }
@media (pointer: coarse) { .pk-f3 .pk-btn, .pk-f3 .pk-btn.sm { min-height: 44px; } }
.pk-f3 .pk-btn.primary { background: var(--pk-primary); border-color: var(--pk-primary); color: var(--pk-on-primary); }
.pk-f3 .pk-btn.primary:hover { background: var(--pk-primary-hover); color: var(--pk-on-primary); }
.pk-f3 .pk-tabs { display: flex; gap: 8px; margin: 0 0 16px; flex-wrap: wrap; }
.pk-f3 .pk-tabs a { padding: 5px 12px; border-radius: 999px; border: 1px solid var(--pk-input); text-decoration: none; font-size: 13px; }
.pk-f3 .pk-tabs a[aria-current="page"] { background: var(--pk-primary); border-color: var(--pk-primary); color: var(--pk-on-primary); }
.pk-f3 .pk-placeholder { border: 1px dashed var(--pk-input); border-radius: var(--style-radius-l); padding: 12px; color: var(--pk-muted); font-size: 13px; }
@media (max-width: 767px) { .pk-f3 .pk-secondary { display: none; } }
`

export function F3Root({ children, name }: { children: React.ReactNode; name: string }) {
  return (
    <div className="pk-f3" data-pk-view={name}>
      <style>{F3_STYLE}</style>
      {children}
    </div>
  )
}

const TONE_ICON: Record<BudgetTone, string> = { ok: '●', warn: '▲', over: '■', none: '○' }

export function BudgetBadge({ tone }: { tone: BudgetTone }) {
  return (
    <span className={`pk-badge ${tone}`} data-pk-budget={tone}>
      <span aria-hidden>{TONE_ICON[tone]}</span>
      {BUDGET_LABELS[tone]}
    </span>
  )
}

export function Empty({ text }: { text: string }) {
  return <p className="pk-empty">{text}</p>
}

export function Placeholder({ text, id }: { text: string; id: string }) {
  return (
    <div className="pk-placeholder" data-pk-placeholder={id}>
      {text}
    </div>
  )
}

const isNum = (c: Column) => c.type === 'money' || c.type === 'int' || c.type === 'pct'

/** Report table (screen): secondary columns hidden on phones, first data column links (C9), document numbers link per cell (12b). */
export function ReportTable({ t, id }: { t: Table; id: string }) {
  if (t.rows.length === 0) return <Empty text={t.empty ?? 'Tidak ada data untuk filter ini.'} />
  // the row link sits on the first DATA column — not on the PT column of a consolidated report (MC2)
  const rowLinkKey = t.columns.find((c) => c.key !== 'pt')?.key
  return (
    <div className="pk-scroll">
      <table className="pk-table" data-pk-table={id}>
        <thead>
          <tr>
            {t.columns.map((c) => (
              <th key={c.key} className={`${isNum(c) ? 'n' : ''} ${c.primary ? '' : 'pk-secondary'}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r, i) => (
            <tr key={i}>
              {t.columns.map((c) => {
                const text = cellText(r.cells[c.key] ?? null, c.type)
                const cls = `${isNum(c) ? 'n' : ''} ${c.primary ? '' : 'pk-secondary'}`
                if (c.key === 'status' && typeof r.cells.status === 'string' && t.key === 'project') {
                  const tone = (Object.entries(BUDGET_LABELS).find(([, l]) => l === r.cells.status)?.[0] ?? 'none') as BudgetTone
                  return (
                    <td key={c.key} className={cls}>
                      <BudgetBadge tone={tone} />
                    </td>
                  )
                }
                return (
                  <td key={c.key} className={cls}>
                    {(() => {
                      const href = r.links?.[c.key] ?? (c.key === rowLinkKey && r.href ? r.href : undefined)
                      return href ? <a href={href}>{text || '—'}</a> : text
                    })()}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
        {t.totals ? (
          <tfoot>
            <tr>
              {t.columns.map((c) => (
                <td key={c.key} className={`${isNum(c) ? 'n' : ''} ${c.primary ? '' : 'pk-secondary'}`}>
                  {cellText(t.totals![c.key] ?? null, c.type)}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  )
}

/** Plain GET filter form (no client JS); `keep` = hidden params preserved (e.g. the role tab). */
export function FilterForm({ fields, action, keep = {} }: { fields: FilterField[]; action: string; keep?: Record<string, string> }) {
  return (
    <form method="get" action={action} className="pk-filter" data-pk-filter>
      {Object.entries(keep).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {fields.map((f) => (
        <label key={f.name}>
          {f.label}
          {f.kind === 'select' ? (
            <select name={f.name} defaultValue={String(f.value)}>
              <option value="">Semua</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.kind === 'multiselect' ? (
            <select name={f.name} multiple defaultValue={Array.isArray(f.value) ? f.value : []}>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input type={f.kind === 'text' ? 'text' : f.kind} name={f.name} defaultValue={String(f.value)} maxLength={60} />
          )}
        </label>
      ))}
      <button type="submit" className="pk-btn primary" data-pk-action="apply">
        Terapkan
      </button>
      <a className="pk-btn" href={action} data-pk-action="reset">
        Reset
      </a>
    </form>
  )
}
