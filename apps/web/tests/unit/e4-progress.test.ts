import { describe, expect, it } from 'vitest'

import { buildOpenApiDocument } from '@/api/v1/openapi'
import { MediaKindEnum, FileCollectionEnum } from '@/api/v1/schemas-flow'
import { ProgressReportCreate, ProgressReportUpdate, StageSetBody } from '@/api/v1/schemas-progress'
import { SyncItem, SyncProgressReportPayload } from '@/api/v1/schemas-sync'
import { collectionWeightError, daysBetweenDates, isComplete, isPct, localDate, MAX_PHOTOS, projectProgress, stageSetErrors, weightSum } from '@/domain/progress/rules'
import { progressGap, progressTone } from '@/domain/reports/rules'

/** E4 pure parts: G11 weights, progress recalculation, K-09 colour, API/sync schemas. */

describe('stage weights (G11)', () => {
  it('sum over active stages only; complete = 100 within 0.01', () => {
    expect(weightSum([{ weightPct: 30 }, { weightPct: 70 }])).toBe(100)
    expect(weightSum([{ weightPct: 30 }, { weightPct: 70 }, { weightPct: 20, active: false }])).toBe(100)
    expect(weightSum([{ weightPct: 33.33 }, { weightPct: 33.33 }, { weightPct: 33.34 }])).toBe(100)
    expect(isComplete(100)).toBe(true)
    expect(isComplete(99.99)).toBe(false)
    expect(isComplete(100.01)).toBe(false)
  })

  it('editor: the whole set must total exactly 100 %, names/sequences unique, weights 0–100 with ≤ 2 decimals', () => {
    const ok = [
      { name: 'Persiapan', weightPct: 30, sequence: 1 },
      { name: 'Struktur', weightPct: 70, sequence: 2 },
    ]
    expect(stageSetErrors(ok)).toEqual([])
    expect(stageSetErrors([{ name: 'A', weightPct: 30, sequence: 1 }]).map((e) => e.message)).toEqual(['Total bobot harus 100% (sekarang 30%).'])
    expect(stageSetErrors([...ok, { name: 'X', weightPct: 1, sequence: 3 }]).some((e) => /101%/.test(e.message))).toBe(true)
    expect(stageSetErrors([{ name: 'A', weightPct: 50, sequence: 1 }, { name: 'a', weightPct: 50, sequence: 1 }]).map((e) => e.path)).toEqual(['stages.1.name', 'stages.1.sequence'])
    expect(stageSetErrors([{ name: 'A', weightPct: 33.333, sequence: 1 }, { name: 'B', weightPct: 66.667, sequence: 2 }]).map((e) => e.path)).toEqual(['stages.0.weightPct', 'stages.1.weightPct'])
    expect(stageSetErrors([])).toEqual([{ path: 'stages', message: 'Minimal satu tahapan.' }])
  })

  it('single-stage writes (admin): an incomplete set may grow to 100 %, a complete set never breaks', () => {
    expect(collectionWeightError(0, 30)).toBeNull()
    expect(collectionWeightError(30, 100)).toBeNull()
    expect(collectionWeightError(90, 100.5)).toMatch(/melebihi 100%/)
    expect(collectionWeightError(100, 100)).toBeNull()
    expect(collectionWeightError(100, 90)).toMatch(/sudah 100%/)
    expect(collectionWeightError(100, 110)).toMatch(/editor tahapan/)
  })
})

describe('project physical progress = Σ(weight × stage %) / 100', () => {
  it('AC: a 50 % report on a 30 % stage raises the project by 15 points', () => {
    const before = [
      { weightPct: 30, progressPct: 0 },
      { weightPct: 70, progressPct: 0 },
    ]
    const after = [
      { weightPct: 30, progressPct: 50 },
      { weightPct: 70, progressPct: 0 },
    ]
    expect(projectProgress(after) - projectProgress(before)).toBe(15)
  })

  it('inactive stages are ignored, 2 decimals, clamped 0..100', () => {
    expect(projectProgress([{ weightPct: 33.33, progressPct: 50 }, { weightPct: 66.67, progressPct: 10 }])).toBe(23.33)
    expect(projectProgress([{ weightPct: 100, progressPct: 100 }, { weightPct: 50, progressPct: 100, active: false }])).toBe(100)
    expect(projectProgress([])).toBe(0)
  })

  it('percent inputs: 0..100 with ≤ 2 decimals', () => {
    expect([0, 12.5, 99.99, 100].every(isPct)).toBe(true)
    expect([-1, 100.01, 12.345, Number.NaN, '50'].some(isPct)).toBe(false)
  })

  it('business dates in the company timezone', () => {
    // 2026-09-25 17:30 UTC = 2026-09-26 01:30 WITA
    expect(localDate(new Date('2026-09-25T17:30:00Z'), 'Asia/Makassar')).toBe('2026-09-26')
    expect(daysBetweenDates('2026-09-23', '2026-09-26')).toBe(3)
  })
})

describe('K-09 progress fisik vs anggaran (US-12)', () => {
  it('selisih = % anggaran − % progress; hijau ≤ 0, kuning ≤ 8, merah > 8 (defaults)', () => {
    expect(progressGap(40, 45)).toBe(-5)
    expect(progressTone(progressGap(40, 45), 0, 8)).toBe('ok')
    expect(progressTone(0, 0, 8)).toBe('ok')
    expect(progressTone(0.01, 0, 8)).toBe('warn')
    expect(progressTone(8, 0, 8)).toBe('warn')
    expect(progressTone(8.01, 0, 8)).toBe('bad')
    expect(progressTone(progressGap(null, 10), 0, 8)).toBe('none')
    expect(progressTone(3, 5, 10)).toBe('ok') // thresholds come from settings
  })
})

describe('API + sync schemas (E4)', () => {
  const uuid = '0192a4b6-2d1a-7e0b-8f5e-7a9d3c1b2e44'
  it('create: ≤ 5 photos (the 6th is refused), pct with ≤ 2 decimals, strict', () => {
    const base = { projectId: 1, stageId: 2, pctAfter: 50, work: 'Pengecoran kolom' }
    expect(ProgressReportCreate.safeParse({ ...base, photoIds: [1, 2, 3, 4, 5] }).success).toBe(true)
    expect(MAX_PHOTOS).toBe(5)
    expect(ProgressReportCreate.safeParse({ ...base, photoIds: [1, 2, 3, 4, 5, 6] }).success).toBe(false)
    expect(ProgressReportCreate.safeParse({ ...base, pctAfter: 50.555 }).success).toBe(false)
    expect(ProgressReportCreate.safeParse({ ...base, pctAfter: 101 }).success).toBe(false)
    expect(ProgressReportCreate.safeParse({ ...base, reporter: 3 }).success).toBe(false)
    expect(ProgressReportUpdate.safeParse({ work: 'x y z' }).success).toBe(false) // reason required
    expect(ProgressReportUpdate.safeParse({ work: 'x y z', reason: 'salah ketik' }).success).toBe(true)
  })

  it('stage editor body: stages or templateId, strict', () => {
    expect(StageSetBody.safeParse({ stages: [{ name: 'A', weightPct: 100, sequence: 1 }] }).success).toBe(true)
    expect(StageSetBody.safeParse({ templateId: 3 }).success).toBe(true)
    expect(StageSetBody.safeParse({ stages: [{ name: 'A', weightPct: 100, sequence: 1, progressPct: 40 }] }).success).toBe(false)
  })

  it('sync payload progress_report.draft_upsert: strict, ≤ 5 photos; SyncItem accepts it', () => {
    const p = { project_id: 1, stage_id: 2, pct_after: 40, work: 'Pasang bata', photo_media_ids: [7] }
    expect(SyncProgressReportPayload.safeParse(p).success).toBe(true)
    expect(SyncProgressReportPayload.safeParse({ ...p, photo_media_ids: [1, 2, 3, 4, 5, 6] }).success).toBe(false)
    expect(SyncProgressReportPayload.safeParse({ ...p, reporter_id: 1 }).success).toBe(false)
    const item = { client_uuid: uuid, type: 'progress_report.draft_upsert', schema_version: 1, offline: true, device_time: '2026-09-26T08:00:00+08:00', elapsed_ms: 1000, payload: p }
    expect(SyncItem.safeParse(item).success).toBe(true)
  })

  it('media kind + file collection progress-photos; OpenAPI documents the E4 paths', () => {
    expect(MediaKindEnum.safeParse('progress-photos').success).toBe(true)
    expect(FileCollectionEnum.safeParse('progress-photos').success).toBe(true)
    const doc = buildOpenApiDocument('0.0.0') as unknown as { paths: Record<string, Record<string, unknown>>; components: { schemas: Record<string, unknown> } }
    expect(Object.keys(doc.paths['/progress-reports'] ?? {}).sort()).toEqual(['get', 'post'])
    expect(Object.keys(doc.paths['/progress-reports/{id}'] ?? {}).sort()).toEqual(['get', 'patch'])
    expect(Object.keys(doc.paths['/projects/{id}/stages'] ?? {}).sort()).toEqual(['get', 'put'])
    expect(doc.paths['/projects/progress']?.get).toBeDefined()
    for (const c of ['ProgressReport', 'ProgressReportCreate', 'SyncProgressReportPayload', 'SyncProgressReportCopy', 'ProjectStageSet', 'ProjectProgressList']) {
      expect(doc.components.schemas[c], c).toBeDefined()
    }
  })
})
