import { describe, expect, it } from 'vitest'

import type { HistoryRow } from '@/domain/history'
import { historyEntry } from '@/domain/history-format'
import { RENUMBER_GUARDED_FUNCTIONS, RENUMBER_MARKER, withoutPrelude, withPrelude } from '@/migrations/20261013_610000_d1310_renumber'
import { keyMatchesPolicy, makeReplacer, planCsv, planRenumber, textMaps, type CompanyInfo, type CounterRow, type DocRow, type SequenceRow } from '@/renumber/plan'

/**
 * DRMS 13/10 Wave 4 (Umum #1) — the PURE planning of the one-time renumbering (ADR 0007 amendment 2026-10-13):
 * groups PT × doc type × period of the document, created_at order, current pattern with the PT code, counters,
 * derived-text replacement; the history label; the migration's prelude helper. Fictional PTs and numbers only.
 */
const A: CompanyInfo = { id: 1, shortCode: 'AAA', timezone: 'Asia/Makassar' }
const B: CompanyInfo = { id: 2, shortCode: 'BBB', timezone: 'Asia/Makassar' }

let seqId = 0
const seq = (companyId: number, docType: string, pattern: string, over: Partial<SequenceRow> = {}): SequenceRow => ({
  id: ++seqId,
  companyId,
  docType,
  docCode: null,
  pattern,
  padding: 4,
  resetPolicy: 'monthly',
  startAt: 1,
  timezone: 'Asia/Makassar',
  active: true,
  ...over,
})
const doc = (over: Partial<DocRow> & Pick<DocRow, 'id' | 'oldNo' | 'createdAt'>): DocRow => ({
  table: 'expense_requests',
  companyId: 1,
  docType: 'expense_request',
  businessDate: null,
  numberedAt: null,
  ...over,
})
const SEQS = [
  seq(1, 'expense_request', 'PB/{COMPANY}/{YY}{MM}/{seq}'),
  seq(1, 'cash_in', 'KM/{YY}{MM}/{seq}'), // legacy custom pattern WITHOUT the PT code (prod: "Kas Masuk belum ada kode singkat PT")
  seq(1, 'cash_out', 'KK/{COMPANY}/{YY}{MM}/{seq}'),
  seq(1, 'settlement', 'LPJ/{COMPANY}/{YY}{MM}/{seq}'),
  seq(2, 'expense_request', 'PB/{COMPANY}/{YY}{MM}/{seq}'),
]

describe('planRenumber — groups, order, format', () => {
  it('PB per PT × month in created_at order (tie: id), from 1, current pattern with the PT code', () => {
    const plan = planRenumber({
      companies: [A, B],
      sequences: SEQS,
      counters: [],
      docs: [
        // October AAA: created out of number order (the old numbers came from the paper series / a submit order)
        doc({ id: 12, oldNo: '231', businessDate: '2026-10-05', createdAt: '2026-10-05T03:00:00.000Z' }),
        doc({ id: 10, oldNo: '229', businessDate: '2026-10-02', createdAt: '2026-10-02T01:00:00.000Z' }),
        doc({ id: 11, oldNo: '230', businessDate: '2026-10-02', createdAt: '2026-10-02T01:00:00.000Z' }), // same instant → id order
        doc({ id: 9, oldNo: 'PB/AAA/2610/0001', businessDate: '2026-10-09', createdAt: '2026-10-01T00:00:00.000Z' }), // created first
        // September AAA
        doc({ id: 5, oldNo: '228/PB-AAA/20/IX/2026', businessDate: '2026-09-20', createdAt: '2026-09-20T02:00:00.000Z' }),
        // BBB has its own series
        doc({ id: 20, companyId: 2, oldNo: 'PB/BBB/2610/0001', businessDate: '2026-10-03', createdAt: '2026-10-03T00:00:00.000Z' }),
      ],
    })
    expect(plan.errors).toEqual([])
    expect(plan.items.map((i) => [i.id, i.oldNo, i.newNo, i.changed])).toEqual([
      [5, '228/PB-AAA/20/IX/2026', 'PB/AAA/2609/0001', true],
      [9, 'PB/AAA/2610/0001', 'PB/AAA/2610/0001', false],
      [10, '229', 'PB/AAA/2610/0002', true],
      [11, '230', 'PB/AAA/2610/0003', true],
      [12, '231', 'PB/AAA/2610/0004', true],
      [20, 'PB/BBB/2610/0001', 'PB/BBB/2610/0001', false],
    ])
    expect(plan.summary).toEqual({ documents: 6, changed: 4, unchanged: 2, groups: 3 })
    expect(plan.counters).toEqual([
      { companyId: 1, docType: 'expense_request', periodKey: '2026-09', from: null, to: 2, documents: 1 },
      { companyId: 1, docType: 'expense_request', periodKey: '2026-10', from: null, to: 5, documents: 4 },
      { companyId: 2, docType: 'expense_request', periodKey: '2026-10', from: null, to: 2, documents: 1 },
    ])
  })

  it('KM pattern without {COMPANY} → moved to the D5 default (monthly from 1); KM / KK are separate series', () => {
    const plan = planRenumber({
      companies: [A],
      sequences: SEQS.filter((s) => s.companyId === 1),
      counters: [],
      docs: [
        doc({ table: 'cash_entries', docType: 'cash_in', id: 3, oldNo: 'KM/2610/0002', businessDate: '2026-10-07', createdAt: '2026-10-07T00:00:00.000Z' }),
        doc({ table: 'cash_entries', docType: 'cash_in', id: 2, oldNo: 'KM/2610/0001', businessDate: '2026-10-01', createdAt: '2026-10-08T00:00:00.000Z' }),
        doc({ table: 'cash_entries', docType: 'cash_out', id: 1, oldNo: 'KK/AAA/2610/0007', businessDate: '2026-10-01', createdAt: '2026-10-01T00:00:00.000Z' }),
      ],
    })
    expect(plan.patternFixes).toEqual([
      expect.objectContaining({ companyId: 1, docType: 'cash_in', from: expect.objectContaining({ pattern: 'KM/{YY}{MM}/{seq}' }), to: { pattern: 'KM/{COMPANY}/{YY}{MM}/{seq}', padding: 4, resetPolicy: 'monthly', startAt: 1 } }),
    ])
    // order of the plan: PT, doc type (cash_in < cash_out), period, seq
    expect(plan.items.map((i) => [i.id, i.newNo])).toEqual([
      [3, 'KM/AAA/2610/0001'], // created earlier than #2 although its entry date is later
      [2, 'KM/AAA/2610/0002'],
      [1, 'KK/AAA/2610/0001'],
    ])
  })

  it('LPJ: the period comes from the time the number was issued, in the PT timezone (not created_at)', () => {
    const plan = planRenumber({
      companies: [A],
      sequences: SEQS.filter((s) => s.companyId === 1),
      counters: [],
      docs: [
        // 30 Sep 17:30 UTC = 1 Oct 01:30 WITA → October
        doc({ table: 'settlements', docType: 'settlement', id: 1, oldNo: 'LPJ/AAA/2609/0004', numberedAt: '2026-09-30T17:30:00.000Z', createdAt: '2026-09-01T00:00:00.000Z' }),
        doc({ table: 'settlements', docType: 'settlement', id: 2, oldNo: 'LPJ/AAA/2609/0003', numberedAt: '2026-09-29T01:00:00.000Z', createdAt: '2026-09-02T00:00:00.000Z' }),
      ],
    })
    expect(plan.items.map((i) => [i.id, i.date, i.newNo])).toEqual([
      [2, '2026-09-29', 'LPJ/AAA/2609/0001'],
      [1, '2026-10-01', 'LPJ/AAA/2610/0001'],
    ])
  })
})

describe('planRenumber — counters, errors, determinism', () => {
  const docs = [
    doc({ id: 1, oldNo: 'x1', businessDate: '2026-10-02', createdAt: '2026-10-02T00:00:00.000Z' }),
    doc({ id: 2, oldNo: 'x2', businessDate: '2026-10-03', createdAt: '2026-10-03T00:00:00.000Z' }),
  ]
  const counters: CounterRow[] = [
    { companyId: 1, docType: 'expense_request', periodKey: '2026-10', nextValue: 240 }, // goes DOWN to 3
    { companyId: 1, docType: 'expense_request', periodKey: '2026-08', nextValue: 7 }, // no document left → startAt
    { companyId: 1, docType: 'expense_request', periodKey: 'ALL', nextValue: 238 }, // legacy never-key → kept
    { companyId: 1, docType: 'cash_out', periodKey: '2026-10', nextValue: 1 }, // already at startAt → untouched
  ]

  it('group counter = startAt + n; empty policy-shaped periods → startAt; foreign keys kept', () => {
    const plan = planRenumber({ companies: [A], sequences: SEQS, counters, docs })
    expect(plan.counters).toEqual([
      { companyId: 1, docType: 'expense_request', periodKey: '2026-08', from: 7, to: 1, documents: 0 },
      { companyId: 1, docType: 'expense_request', periodKey: '2026-10', from: 240, to: 3, documents: 2 },
    ])
    expect(plan.countersKept).toEqual([counters[2]])
    expect(plan.warnings.join(' ')).toMatch(/1 counter dibiarkan/)
  })

  it('sha256 does not depend on the row order; changes with the mapping', () => {
    const a = planRenumber({ companies: [A], sequences: SEQS, counters, docs })
    const b = planRenumber({ companies: [A], sequences: [...SEQS].reverse(), counters: [...counters].reverse(), docs: [...docs].reverse() })
    expect(b.sha256).toBe(a.sha256)
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/)
    const c = planRenumber({ companies: [A], sequences: SEQS, counters, docs: [docs[0]!] })
    expect(c.sha256).not.toBe(a.sha256)
  })

  it('errors: PT without short code, doc type without sequence, invalid pattern', () => {
    const plan = planRenumber({
      companies: [{ id: 1, shortCode: '', timezone: null }, B],
      sequences: [seq(2, 'transfer', 'TRF/{COMPANY}/{seq}', { resetPolicy: 'monthly' })],
      counters: [],
      docs: [doc({ id: 1, oldNo: 'p', createdAt: '2026-10-01T00:00:00.000Z' }), doc({ id: 2, companyId: 2, oldNo: 'q', createdAt: '2026-10-01T00:00:00.000Z' }), doc({ id: 3, companyId: 2, table: 'transfers', docType: 'transfer', oldNo: 't', createdAt: '2026-10-01T00:00:00.000Z' })],
    })
    expect(plan.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/PT #1: kode singkat PT kosong/),
        expect.stringMatching(/PT #2 \(BBB\): tidak ada baris penomoran untuk expense_request/),
        expect.stringMatching(/PT #2 transfer: pola "TRF\/\{COMPANY\}\/\{seq\}" tidak valid/),
      ]),
    )
  })

  it('policy key shapes', () => {
    expect(keyMatchesPolicy('2026-10', 'monthly')).toBe(true)
    expect(keyMatchesPolicy('2026-13', 'monthly')).toBe(false)
    expect(keyMatchesPolicy('ALL', 'monthly')).toBe(false)
    expect(keyMatchesPolicy('2026', 'yearly')).toBe(true)
    expect(keyMatchesPolicy('ALL', 'never')).toBe(true)
  })
})

describe('derived text', () => {
  it('one pass (a swap A↔B is safe), whole tokens only, longest first', () => {
    const r = makeReplacer(
      new Map([
        ['PB/AAA/2610/0001', 'PB/AAA/2610/0002'],
        ['PB/AAA/2610/0002', 'PB/AAA/2610/0001'],
        ['29/PB-AAA/1/X/2026', 'PB/AAA/2610/0003'],
        ['KM/2610/0001', 'KM/AAA/2610/0001'],
      ]),
    )
    expect(r('Transfer TRF/AAA/2610/0001 — PB/AAA/2610/0001 Semen; lihat PB/AAA/2610/0002.')).toBe('Transfer TRF/AAA/2610/0001 — PB/AAA/2610/0002 Semen; lihat PB/AAA/2610/0001.')
    // 229/… is another (longer) number: "29/…" must not match inside it
    expect(r('No 229/PB-AAA/1/X/2026 dan 29/PB-AAA/1/X/2026')).toBe('No 229/PB-AAA/1/X/2026 dan PB/AAA/2610/0003')
    expect(r('Jurnal balik KM/2610/0001: salah input; KM/2610/00012 bukan')).toBe('Jurnal balik KM/AAA/2610/0001: salah input; KM/2610/00012 bukan')
    expect(makeReplacer(new Map())('tetap')).toBe('tetap')
  })

  it('textMaps: changed numbers per PT only, never an ambiguous old string', () => {
    const plan = planRenumber({
      companies: [A, B],
      sequences: [...SEQS, seq(2, 'cash_in', 'KM/{YY}{MM}/{seq}')],
      counters: [],
      docs: [
        doc({ table: 'cash_entries', docType: 'cash_in', id: 1, oldNo: 'KM/2610/0001', businessDate: '2026-10-01', createdAt: '2026-10-01T00:00:00.000Z' }),
        doc({ table: 'cash_entries', docType: 'cash_in', id: 2, companyId: 2, oldNo: 'KM/2610/0001', businessDate: '2026-10-01', createdAt: '2026-10-01T00:00:00.000Z' }),
        doc({ id: 3, oldNo: 'DUP', businessDate: '2026-10-01', createdAt: '2026-10-01T00:00:00.000Z' }),
        doc({ id: 4, oldNo: 'DUP', businessDate: '2026-10-02', createdAt: '2026-10-02T00:00:00.000Z' }),
      ],
    })
    const maps = textMaps(plan)
    expect(maps.get(1)?.get('KM/2610/0001')).toBe('KM/AAA/2610/0001')
    expect(maps.get(2)?.get('KM/2610/0001')).toBe('KM/BBB/2610/0001') // same legacy string, other PT, other number
    expect(maps.get(1)?.has('DUP')).toBe(false)
    expect(plan.warnings.join(' ')).toMatch(/Nomor lama ganda dalam satu PT .*DUP/)
  })

  it('CSV for the review: header, ; separated, quoted when needed', () => {
    const plan = planRenumber({ companies: [A], sequences: SEQS, counters: [], docs: [doc({ id: 1, oldNo: 'a;b', businessDate: '2026-10-01', createdAt: '2026-10-01T00:00:00.000Z' })] })
    const csv = planCsv(plan, new Map([[1, 'AAA']]))
    expect(csv.split('\n')[0]).toBe('kode_pt;tabel;jenis;id;dibuat;tanggal_dokumen;periode;urut;nomor_lama;nomor_baru;berubah')
    expect(csv.split('\n')[1]).toBe('AAA;expense_requests;expense_request;1;2026-10-01T00:00:00.000Z;2026-10-01;2026-10;1;"a;b";PB/AAA/2610/0001;ya')
  })
})

describe('history + migration helper', () => {
  it('"Log perubahan": a renumbered row reads "Nomor diubah: lama → baru"', () => {
    const row: HistoryRow = { id: 1, serverTime: '2026-10-13T01:15:00.000Z', docType: 'expense_request', docId: '4', docNo: 'PB/AAA/2610/0001', action: 'renumbered', field: 'docNo', lineNo: null, oldValue: '229', newValue: 'PB/AAA/2610/0001', statusFrom: null, statusTo: null, reason: 'Penomoran ulang', userId: null, userName: null, userRoles: null, source: 'system', appVersion: null, deviceId: null }
    const e = historyEntry(row, 'Asia/Makassar')
    expect(e).toMatchObject({ action: 'nomor diubah', field: 'Nomor diubah', change: '229 → PB/AAA/2610/0001', who: 'sistem' })
    expect(`${e.field}: ${e.change}`).toBe('Nomor diubah: 229 → PB/AAA/2610/0001')
    expect(historyEntry({ ...row, docType: 'cash_entry', field: 'entryNo', oldValue: 'KM/2610/0001', newValue: 'KM/AAA/2610/0001' }, 'Asia/Makassar')).toMatchObject({ field: 'Nomor diubah', doc: 'Kas PB/AAA/2610/0001' })
    expect(historyEntry({ ...row, docType: 'cash_entry', field: 'description', oldValue: 'Transfer TRF/1', newValue: 'Transfer TRF/AAA/2610/0001' }, 'Asia/Makassar').field).toBe('Keterangan (nomor diubah)')
  })

  it('prelude goes right after the top-level BEGIN, once; removable', () => {
    const def = 'CREATE OR REPLACE FUNCTION public.pk_x()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\n    DECLARE\n      a int;\n    BEGIN\n      IF x THEN BEGIN NULL; END; END IF;\n      RETURN NEW;\n    END\n    $function$\n'
    const once = withPrelude(def)
    expect(once.indexOf(RENUMBER_MARKER)).toBeGreaterThan(once.indexOf('    BEGIN'))
    expect(once.indexOf(RENUMBER_MARKER)).toBeLessThan(once.indexOf('IF x THEN'))
    expect(once).toContain("IF TG_OP = 'UPDATE' AND current_setting('pk.renumber', true) = 'on' THEN")
    expect(withPrelude(once)).toBe(once)
    expect(withoutPrelude(once)).toBe(def)
    expect(RENUMBER_GUARDED_FUNCTIONS).toEqual(expect.arrayContaining(['pk_protect_columns', 'pk_counter_monotonic', 'pk_cash_entries_guard', 'pk_transfers_guard']))
  })
})
