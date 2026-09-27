import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { dateId, PROGRESS_STYLE, ProgressCell, ProgressVsBudgetRows } from '@/admin/views/progress-ui'
import type { ProjectProgress } from '@/domain/reports/progress'

/** E4 web (US-12): K-09 widget markup — status never colour-only, bars clamped, placeholders gone. */
const row = (over: Partial<ProjectProgress> = {}): ProjectProgress => ({
  id: 1,
  code: 'PRJ-A',
  name: 'Gudang Contoh',
  status: 'berjalan',
  budget: 100_000_000,
  committed: 60_000_000,
  budgetPct: 60,
  budgetTone: 'ok',
  progressPct: 45,
  weightSum: 100,
  stagesComplete: true,
  gap: 15,
  tone: 'bad',
  toneLabel: 'Anggaran mendahului progress',
  lastReportDate: '2026-09-20',
  reportCount: 4,
  ...over,
})

describe('ProgressVsBudgetRows', () => {
  it('renders both measures on one axis with an icon+label status and a link per project', () => {
    const html = renderToStaticMarkup(React.createElement(ProgressVsBudgetRows, { id: 't', rows: [row()], hrefOf: (p: ProjectProgress) => `/admin/progress/project/${p.id}`, empty: 'kosong' }))
    expect(html).toContain('data-pk-tone="bad"')
    expect(html).toContain('Anggaran mendahului progress · selisih 15,0%')
    expect(html).toContain('href="/admin/progress/project/1"')
    expect(html).toContain('width:60%')
    expect(html).toContain('width:45%')
    expect(html).toContain('data-pk-status-tone="bad"')
  })
  it('clamps > 100 % and shows no physical bar while stages are incomplete', () => {
    const html = renderToStaticMarkup(React.createElement(ProgressVsBudgetRows, { id: 't', rows: [row({ budgetPct: 130, stagesComplete: false, gap: null, tone: 'none', toneLabel: 'Tahapan belum 100%' })], empty: 'kosong' }))
    expect(html).toContain('width:100%')
    expect(html.match(/<i style/g)).toHaveLength(1) // no physical bar while stages are incomplete
    expect(html).toContain('Tahapan belum 100%')
    expect(html).not.toContain('selisih')
  })
  it('empty state', () => {
    expect(renderToStaticMarkup(React.createElement(ProgressVsBudgetRows, { id: 't', rows: [], empty: 'Belum ada project.' }))).toContain('Belum ada project.')
  })
})

describe('ProgressCell (replaces the "(F5)" placeholder)', () => {
  it('shows the % and the K-09 status, or a neutral pill when stages are incomplete / no data', () => {
    expect(renderToStaticMarkup(React.createElement(ProgressCell, { p: row({ tone: 'ok', gap: -2, toneLabel: 'Sesuai' }) }))).toMatch(/45,0%.*Sesuai/)
    expect(renderToStaticMarkup(React.createElement(ProgressCell, { p: row({ stagesComplete: false }) }))).toContain('Tahapan belum 100%')
    expect(renderToStaticMarkup(React.createElement(ProgressCell, { p: undefined }))).toBe('—')
  })
})

describe('kit', () => {
  it('dates and styles use tokens only (no raw hex except white on filled status dots)', () => {
    expect(dateId('2026-09-05')).toBe('5 Sep 2026')
    expect(dateId(null)).toBe('—')
    expect(PROGRESS_STYLE.match(/#[0-9A-Fa-f]{3,6}\b/g) ?? []).toEqual(['#FFFFFF'])
    expect(PROGRESS_STYLE).toContain('prefers-reduced-motion')
  })
})
