import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { Rap, RapItemCreate } from '@/api/v1/schemas-daily'
import { ProjectListItem } from '@/api/v1/schemas-projects'
import { RAP_MISSING_MESSAGE, rapDrivesProgress, rapRequiredFor } from '@/domain/rap/rules'
import { buildRapWorkbook, parseRapWorkbook } from '@/domain/rap/workbook'
import { readXlsx, writeXlsx } from '@/import/xlsx-io'

/**
 * DRMS 10/10 D4, owner decision 2026-10-11 "RAP wajib untuk semua proyek yang punya RAB" ("Melebihi RAP" stays a
 * warning): RAP for every project kind with a RAB, a submit block with one message (server = web = APK), stage
 * optional outside konstruksi, templates per project kind.
 */
const SRC = path.resolve(__dirname, '../../src')
const read = (p: string) => readFileSync(path.join(SRC, p), 'utf8')

describe('D4 RAP for every project with a RAB — rule', () => {
  it('required: RAB > 0 of any kind, and konstruksi always (P3 unchanged)', () => {
    for (const kind of ['umum', 'trading', 'kontrak_unit', 'aftersales', 'konstruksi']) expect(rapRequiredFor({ kind, budget: 50_000_000 })).toBe(true)
    expect(rapRequiredFor({ kind: 'konstruksi', budget: null })).toBe(true)
    for (const budget of [null, undefined, 0]) {
      expect(rapRequiredFor({ kind: 'umum', budget })).toBe(false)
      expect(rapRequiredFor({ kind: 'trading', budget })).toBe(false)
    }
  })

  it('only konstruksi RAPs drive the stage progress (daily reports stay kind-specific, ADR 0020)', () => {
    expect(rapDrivesProgress('konstruksi')).toBe(true)
    for (const kind of ['umum', 'trading', 'kontrak_unit', 'aftersales', null]) expect(rapDrivesProgress(kind)).toBe(false)
  })

  it('one message for the requester: server (submit 400 projectId), web form and APK use the same text', () => {
    expect(RAP_MISSING_MESSAGE).toBe('Project belum punya RAP — hubungi PM')
    expect(read('domain/expense/drafts.ts')).toMatch(/if \(forSubmit && !rap\.hasRap && rap\.required\) \{\s*errors\.push\(\{ path: 'projectId', message: RAP_MISSING_MESSAGE \}\)/)
    expect(read('admin/components/lines/LinesTableField.tsx')).toContain('{RAP_MISSING_MESSAGE}')
    const arb = JSON.parse(readFileSync(path.resolve(SRC, '../../mobile/lib/l10n/app_id.arb'), 'utf8')) as Record<string, string>
    expect(arb.rapMissingBlock).toBe(RAP_MISSING_MESSAGE)
    expect(read('../../mobile/lib/features/expense/domain/draft_validation.dart')).toContain(`const rapMissingMessage = '${RAP_MISSING_MESSAGE}'`)
  })

  it('the RAP service no longer refuses non-konstruksi projects; progress refresh is konstruksi-only', () => {
    const svc = read('domain/rap/service.ts')
    expect(svc).not.toContain("'RAP hanya untuk project jenis konstruksi.'")
    expect(svc).toMatch(/if \(!rapDrivesProgress\(kindOf\(doc\.kind\)\)\) return/)
  })
})

describe('D4 RAP Excel: tahapan optional (required for konstruksi by the service)', () => {
  const row = { code: 'T.1', description: 'Pembelian semen untuk dijual', stageName: '', kind: 'material' as const, uomCode: 'SAK', volume: 500, unitPrice: 62_000, weightPct: null }

  it('a row without tahapan round-trips; the header is no longer marked required', () => {
    const bytes = buildRapWorkbook(['SAK'], [row])
    const parsed = parseRapWorkbook(bytes)
    expect(parsed.issues).toEqual([])
    expect(parsed.rows.map(({ row: _r, ...x }) => x)).toEqual([row])
    const header = readXlsx(bytes).sheets.find((s) => s.name === 'RAP')!.rows[0]!
    expect(header).toContain('tahapan')
    expect(header).toContain('kode*')
  })

  it('a file without the tahapan column is accepted; > 128 characters is still an error', () => {
    const noStage = writeXlsx([{ name: 'RAP', rows: [['kode', 'uraian', 'jenis', 'satuan', 'volume'], ['T.1', 'Semen', 'material', 'SAK', 10]] }])
    const p = parseRapWorkbook(noStage)
    expect(p.issues).toEqual([])
    expect(p.rows[0]).toMatchObject({ code: 'T.1', stageName: '' })
    const long = parseRapWorkbook(buildRapWorkbook(['SAK'], [{ ...row, stageName: 'x'.repeat(129) }]))
    expect(long.issues).toEqual([expect.objectContaining({ row: 2, column: 'tahapan' })])
  })
})

describe('D4 API contract', () => {
  it('RAP item: stage nullable (non-konstruksi), stageId optional on create; Rap carries rapRequired / drivesProgress', () => {
    expect(RapItemCreate.safeParse({ code: 'T.1', description: 'Semen', kind: 'material', uomId: 1, volume: 10 }).success).toBe(true)
    expect(RapItemCreate.safeParse({ code: 'T.1', description: 'Semen', kind: 'material', uomId: 1, volume: 10, stageId: null }).success).toBe(true)
    const shape = Rap.shape
    expect(Object.keys(shape)).toEqual(expect.arrayContaining(['rapRequired', 'drivesProgress']))
  })

  it('project list item: rapRequired + rapMissing', () => {
    expect(Object.keys(ProjectListItem.shape)).toEqual(expect.arrayContaining(['rapRequired', 'rapMissing']))
  })
})
