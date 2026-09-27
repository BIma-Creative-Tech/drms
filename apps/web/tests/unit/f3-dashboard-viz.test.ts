import { describe, expect, it } from 'vitest'

import { REQUEST_STATUSES } from '@/domain/expense/types'
import { delta, PIPELINE_EXIT, PIPELINE_STAGES, pipelineFromStatus, share, statusTone, topWithOther } from '@/domain/reports/viz'
import { contrastRatio, ramps, semantic } from '@/theme/tokens'

import { VIZ_STYLE } from '@/admin/views/viz'

describe('pipeline stages (Beranda redesign)', () => {
  it('every non-draft status belongs to exactly one stage or the exit bucket', () => {
    const all = [...PIPELINE_STAGES.flatMap((s) => s.statuses), ...PIPELINE_EXIT.statuses] as string[]
    const expected = REQUEST_STATUSES.filter((s) => s !== 'draft')
    expect([...all].sort()).toEqual([...expected].sort())
    expect(new Set(all).size).toBe(all.length)
  })

  it('folds per-status rows of both types into ordered stages with counts and sums', () => {
    const p = pipelineFromStatus([
      { status: 'pending_ack', count: 2, sum: 200 },
      { status: 'pending_approval', count: 1, sum: 50 },
      { status: 'approved', count: 3, sum: 300 },
      { status: 'receipts_verified', count: 1, sum: 10 },
      { status: 'transferred', count: 4, sum: 400 },
      { status: 'lpj_revision', count: 1, sum: 1 },
      { status: 'completed', count: 5, sum: 500 },
      { status: 'lpj_verified', count: 1, sum: 5 },
      { status: 'rejected', count: 2, sum: 20 },
      { status: 'cancelled', count: 1, sum: 1 },
      { status: 'draft', count: 9, sum: 999 }, // never counted
    ])
    expect(p.stages.map((s) => s.key)).toEqual(['ack', 'approval', 'queue', 'lpj', 'done'])
    expect(p.stages.map((s) => s.count)).toEqual([2, 1, 4, 5, 6])
    expect(p.stages.map((s) => s.sum)).toEqual([200, 50, 310, 401, 505])
    expect(p.exit).toMatchObject({ key: 'exit', count: 3, sum: 21 })
    expect(p.total).toBe(21)
  })

  it('empty input → zero stages, never throws', () => {
    const p = pipelineFromStatus([])
    expect(p.total).toBe(0)
    expect(p.stages.every((s) => s.count === 0 && s.sum === 0)).toBe(true)
  })
})

describe('topWithOther', () => {
  const items = [
    { label: 'B', value: 5 },
    { label: 'A', value: 9 },
    { label: 'C', value: 1 },
    { label: 'D', value: 2 },
  ]
  it('keeps the n largest sorted desc and folds the tail into "Lainnya (k)"', () => {
    const r = topWithOther(items, 2)
    expect(r.map((x) => [x.label, x.value, x.other])).toEqual([
      ['A', 9, false],
      ['B', 5, false],
      ['Lainnya (2)', 3, true],
    ])
  })
  it('no tail → no "Lainnya" row', () => {
    expect(topWithOther(items, 4)).toHaveLength(4)
    expect(topWithOther([], 3)).toEqual([])
  })
})

describe('delta / share', () => {
  it('signed change with percent vs previous; null percent on a zero base', () => {
    expect(delta(120, 100)).toEqual({ diff: 20, pct: 20, dir: 'up' })
    expect(delta(80, 100)).toEqual({ diff: -20, pct: -20, dir: 'down' })
    expect(delta(5, 0)).toEqual({ diff: 5, pct: null, dir: 'up' })
    expect(delta(0, 0).dir).toBe('flat')
    expect(delta(-50, -100)).toEqual({ diff: 50, pct: 50, dir: 'up' })
  })
  it('share: one decimal, null without a whole', () => {
    expect(share(1, 3)).toBe(33.3)
    expect(share(5, 0)).toBeNull()
  })
})

describe('status pills', () => {
  it('every status has a tone; reserved good/bad tones only for final states', () => {
    for (const s of REQUEST_STATUSES) expect(['wait', 'progress', 'ok', 'warn', 'bad', 'none']).toContain(statusTone(s))
    expect(statusTone('completed')).toBe('ok')
    expect(statusTone('rejected')).toBe('bad')
    expect(statusTone('pending_ack')).toBe('wait')
    expect(statusTone('lpj_revision')).toBe('warn')
  })
})

describe('chart colours (dataviz validator results pinned as contrast guards)', () => {
  const card = { light: semantic.light.card, dark: semantic.dark.card }
  it('uses only theme ramp variables, no raw hex', () => {
    expect(VIZ_STYLE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
  it('categorical Masuk/Keluar marks clear 3:1 on the card surface in both modes', () => {
    // light: blue-500 / orange-500; dark: blue-450 / orange-500 (see viz.tsx header)
    for (const [hex, bg] of [
      [ramps.blue[500]!, card.light],
      [ramps.warning[500]!, card.light],
      [ramps.blue[450]!, card.dark],
      [ramps.warning[500]!, card.dark],
    ] as const)
      expect(contrastRatio(hex, bg)).toBeGreaterThanOrEqual(3)
  })
  it('ordinal ramp light end clears 2:1 on the surface (light blue-350, dark blue-550)', () => {
    expect(contrastRatio(ramps.blue[350]!, card.light)).toBeGreaterThanOrEqual(2)
    expect(contrastRatio(ramps.blue[550]!, card.dark)).toBeGreaterThanOrEqual(2)
  })
  it('honours reduced motion', () => {
    expect(VIZ_STYLE).toMatch(/prefers-reduced-motion: reduce\)[^}]*animation: none/)
  })
})
