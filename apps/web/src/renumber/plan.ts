/**
 * DRMS 13/10 Wave 4 — ONE-TIME controlled renumbering of issued document numbers (ADR 0007 "Amendment 2026-10-13").
 * Client (Umum #1): "Reset penomoran dari 1 dan bentuk ulang nomor yang sudah ada berdasarkan tanggal dibuat. Kas Masuk
 * belum ada kode singkat PT."
 *
 * PURE planning module (no DB, unit-tested): given the numbered documents, the sequences, the counters and the PT
 * short codes of the PTs in scope, it computes the full old → new mapping:
 * - group = PT × sequence doc type × period of the document (the period key of the sequence's reset policy, from the
 *   SAME date the allocator used: the document's business date, or — for LPJ / addendum, numbered "today" at submit —
 *   the time the number was issued), in the sequence timezone;
 * - inside a group: order by `created_at`, tie-break by id → seq = startAt, startAt + 1, …;
 * - number = the CURRENT pattern of the doc type in that PT (`formatDocNo`); a pattern without `{COMPANY}` (e.g. an old
 *   custom `KM/{YY}{MM}/{seq}`) is first moved to the D5 default of the doc type (`<DOC>/{COMPANY}/{YY}{MM}/{seq}`,
 *   4 digits, monthly from 1);
 * - counters: every group's counter → startAt + n (the next new document gets n + 1); a counter of a period that has
 *   no document any more → startAt; counters whose key does not belong to the policy (legacy `ALL`) are left alone.
 * Database side (lock, two-phase update, audit, derived text, verification): `./db.ts`. CLI: `./cli.ts`.
 */
import { createHash } from 'node:crypto'

import { DEFAULT_SEQUENCES, formatDocNo, parseBusinessDate, patternError, periodKey, type ResetPolicy } from '@/domain/numbering'
import { DEFAULT_TZ, localDateInTz, type LocalDate } from '@/lib/time'

/** The document tables that carry an issued number (our own numbers only — `aftersales_activities.doc_no` is the
 * client's external Q/PO/SJ/INV number and is NOT renumbered). */
export const DOC_TABLES = [
  { table: 'expense_requests', column: 'doc_no', auditDocType: 'expense_request', field: 'docNo', label: 'Pengajuan (PB)' },
  { table: 'transfers', column: 'doc_no', auditDocType: 'transfer', field: 'docNo', label: 'Transfer (TRF)' },
  { table: 'settlements', column: 'doc_no', auditDocType: 'settlement', field: 'docNo', label: 'LPJ' },
  { table: 'cash_entries', column: 'entry_no', auditDocType: 'cash_entry', field: 'entryNo', label: 'Kas (KM/KK)' },
  { table: 'progress_reports', column: 'doc_no', auditDocType: 'progress_report', field: 'docNo', label: 'Laporan progress (LP)' },
  { table: 'budget_addenda', column: 'doc_no', auditDocType: 'budget_addendum', field: 'docNo', label: 'Addendum RAB (ADD)' },
  { table: 'service_reports', column: 'doc_no', auditDocType: 'service_report', field: 'docNo', label: 'Laporan servis (SV)' },
  { table: 'daily_reports', column: 'doc_no', auditDocType: 'daily_report', field: 'docNo', label: 'Laporan harian (LH)' },
  { table: 'project_loans', column: 'doc_no', auditDocType: 'project_loan', field: 'docNo', label: 'Pinjaman antar project (PJ)' },
] as const
export type DocTable = (typeof DOC_TABLES)[number]['table']

export type CompanyInfo = { id: number; shortCode: string | null; timezone: string | null }
export type SequenceRow = {
  id: number
  companyId: number
  docType: string
  docCode: string | null
  pattern: string
  padding: number
  resetPolicy: ResetPolicy
  startAt: number
  timezone: string | null
  active: boolean
}
export type DocRow = {
  table: DocTable
  id: number
  companyId: number
  /** Sequence doc type (cash entries: `cash_in` / `cash_out` by direction). */
  docType: string
  oldNo: string
  /** Business date `YYYY-MM-DD` the allocator used (request / transfer / entry / report / loan date), if stored. */
  businessDate: string | null
  /** Instant the number was issued (first `number_issued` audit row, else submit time) — LPJ / addendum. ISO. */
  numberedAt: string | null
  /** ISO timestamp (ms) — the client's ordering key ("berdasarkan tanggal dibuat"). */
  createdAt: string
}
export type CounterRow = { companyId: number; docType: string; periodKey: string; nextValue: number }

export type PlanItem = DocRow & { date: string; periodKey: string; seq: number; newNo: string; changed: boolean }
export type SequenceConfigSnapshot = { pattern: string; padding: number; resetPolicy: ResetPolicy; startAt: number }
export type PatternFix = { sequenceId: number; companyId: number; docType: string; from: SequenceConfigSnapshot; to: SequenceConfigSnapshot }
export type CounterChange = { companyId: number; docType: string; periodKey: string; from: number | null; to: number; documents: number }
export type RenumberPlan = {
  items: PlanItem[]
  patternFixes: PatternFix[]
  counters: CounterChange[]
  /** Counter rows left alone (key outside the reset policy's shape, or a doc type without sequence). */
  countersKept: CounterRow[]
  errors: string[]
  warnings: string[]
  summary: { documents: number; changed: number; unchanged: number; groups: number }
  /** sha256 of the canonical mapping + pattern fixes + counters: `--expect-sha256` on apply = exactly the reviewed plan. */
  sha256: string
}

/** D5 default config per doc type (the target of a pattern without `{COMPANY}`). */
const DEFAULTS = new Map(DEFAULT_SEQUENCES.map((s) => [s.docType as string, s]))

/** True when a counter key has the shape the reset policy produces (`ALL` / `YYYY` / `YYYY-MM`). */
export function keyMatchesPolicy(key: string, policy: ResetPolicy): boolean {
  if (policy === 'never') return key === 'ALL'
  if (policy === 'yearly') return /^\d{4}$/.test(key)
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(key)
}

const fmtDate = (d: LocalDate) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`

function docDate(row: DocRow, tz: string): LocalDate {
  if (row.businessDate) {
    try {
      return parseBusinessDate(row.businessDate)
    } catch {
      // fall through: a malformed stored date → the instant fallbacks
    }
  }
  return localDateInTz(new Date(row.numberedAt ?? row.createdAt), tz)
}

/**
 * Effective sequence per (PT, doc type) after the `{COMPANY}` fix. Inactive rows are used (with a warning): the
 * documents exist, the allocator would refuse new ones until an Admin activates the row again.
 */
function effectiveSequences(sequences: readonly SequenceRow[], errors: string[], warnings: string[]) {
  const out = new Map<string, SequenceRow>()
  const fixes: PatternFix[] = []
  /** Invalid pattern per (PT, doc type): an error only when that PT has documents of the type (see planRenumber). */
  const invalid = new Map<string, string>()
  for (const s of sequences) {
    const key = `${s.companyId}:${s.docType}`
    if (out.has(key)) {
      errors.push(`PT #${s.companyId}: lebih dari satu baris penomoran untuk ${s.docType}.`)
      continue
    }
    let eff = s
    if (!s.pattern.includes('{COMPANY}')) {
      const d = DEFAULTS.get(s.docType)
      if (d) {
        const to: SequenceConfigSnapshot = { pattern: d.pattern, padding: d.padding, resetPolicy: 'monthly', startAt: 1 }
        fixes.push({ sequenceId: s.id, companyId: s.companyId, docType: s.docType, from: { pattern: s.pattern, padding: s.padding, resetPolicy: s.resetPolicy, startAt: s.startAt }, to })
        eff = { ...s, ...to, docCode: s.docCode ?? d.docCode }
      }
    }
    const err = patternError(eff.pattern, eff.resetPolicy)
    if (err) invalid.set(key, `PT #${s.companyId} ${s.docType}: pola "${eff.pattern}" tidak valid — ${err}`)
    else if (!eff.pattern.includes('{COMPANY}')) warnings.push(`PT #${s.companyId} ${s.docType}: pola "${eff.pattern}" tanpa {COMPANY} dan tanpa default (jenis tidak dipakai) — dibiarkan.`)
    if (!s.active) warnings.push(`PT #${s.companyId} ${s.docType}: penomoran nonaktif (dokumen lama tetap dinomori ulang dengan pola ini).`)
    if (eff.resetPolicy !== 'monthly') warnings.push(`PT #${s.companyId} ${s.docType}: reset "${eff.resetPolicy}" (bukan bulanan) — nomor dikelompokkan per periode reset itu.`)
    if (eff.startAt !== 1) warnings.push(`PT #${s.companyId} ${s.docType}: nomor awal ${eff.startAt} (bukan 1) — urutan dimulai dari ${eff.startAt}.`)
    out.set(key, eff)
  }
  fixes.sort((a, b) => a.companyId - b.companyId || (a.docType < b.docType ? -1 : a.docType > b.docType ? 1 : 0))
  return { byKey: out, fixes, invalid }
}

/** Builds the full plan. Deterministic for the same input (order of rows does not matter). */
export function planRenumber(input: { companies: readonly CompanyInfo[]; sequences: readonly SequenceRow[]; docs: readonly DocRow[]; counters: readonly CounterRow[] }): RenumberPlan {
  const errors: string[] = []
  const warnings: string[] = []
  const companies = new Map(input.companies.map((c) => [c.id, c]))
  const { byKey: seqs, fixes, invalid } = effectiveSequences(input.sequences, errors, warnings)

  // ---- group documents
  const groups = new Map<string, { companyId: number; docType: string; periodKey: string; cfg: SequenceRow; rows: Array<{ row: DocRow; date: LocalDate }> }>()
  const missing = new Set<string>()
  for (const row of input.docs) {
    const company = companies.get(row.companyId)
    const cfg = seqs.get(`${row.companyId}:${row.docType}`)
    if (!company) {
      missing.add(`PT #${row.companyId} tidak ditemukan (dokumen ${row.table} #${row.id}).`)
      continue
    }
    if (!company.shortCode || company.shortCode.trim() === '') {
      missing.add(`PT #${row.companyId}: kode singkat PT kosong — isi dulu di Perusahaan (PT).`)
      continue
    }
    if (!cfg) {
      missing.add(`PT #${row.companyId} (${company.shortCode}): tidak ada baris penomoran untuk ${row.docType}.`)
      continue
    }
    const bad = invalid.get(`${row.companyId}:${row.docType}`)
    if (bad) {
      missing.add(bad)
      continue
    }
    const tz = cfg.timezone || company.timezone || DEFAULT_TZ
    const date = docDate(row, tz)
    const key = periodKey(cfg.resetPolicy, date)
    const gk = `${row.companyId}|${row.docType}|${key}`
    let g = groups.get(gk)
    if (!g) {
      g = { companyId: row.companyId, docType: row.docType, periodKey: key, cfg, rows: [] }
      groups.set(gk, g)
    }
    g.rows.push({ row, date })
  }
  errors.push(...[...missing].sort())

  // ---- assign numbers: created_at, then id
  const items: PlanItem[] = []
  for (const g of groups.values()) {
    g.rows.sort((a, b) => (a.row.createdAt < b.row.createdAt ? -1 : a.row.createdAt > b.row.createdAt ? 1 : a.row.table < b.row.table ? -1 : a.row.table > b.row.table ? 1 : a.row.id - b.row.id))
    const code = companies.get(g.companyId)!.shortCode!
    g.rows.forEach(({ row, date }, i) => {
      const seq = g.cfg.startAt + i
      const newNo = formatDocNo({ pattern: g.cfg.pattern, padding: g.cfg.padding, docCode: g.cfg.docCode ?? undefined }, seq, date, code)
      items.push({ ...row, date: fmtDate(date), periodKey: g.periodKey, seq, newNo, changed: newNo !== row.oldNo })
    })
  }
  items.sort((a, b) => a.companyId - b.companyId || (a.docType < b.docType ? -1 : a.docType > b.docType ? 1 : 0) || (a.periodKey < b.periodKey ? -1 : a.periodKey > b.periodKey ? 1 : 0) || a.seq - b.seq)

  // ---- safety: the new numbers are unique per PT and table (and per PT + doc type)
  const seen = new Map<string, PlanItem>()
  for (const it of items) {
    const k = `${it.companyId}|${it.table}|${it.newNo}`
    const prev = seen.get(k)
    if (prev) errors.push(`Nomor baru ganda ${it.newNo} (PT #${it.companyId}): ${prev.table} #${prev.id} dan ${it.table} #${it.id}.`)
    else seen.set(k, it)
  }

  // ---- counters
  const counters: CounterChange[] = []
  const countersKept: CounterRow[] = []
  const existing = new Map(input.counters.map((c) => [`${c.companyId}|${c.docType}|${c.periodKey}`, c]))
  for (const [gk, g] of groups) {
    const to = g.cfg.startAt + g.rows.length
    const cur = existing.get(gk)
    if (!cur || cur.nextValue !== to) counters.push({ companyId: g.companyId, docType: g.docType, periodKey: g.periodKey, from: cur?.nextValue ?? null, to, documents: g.rows.length })
  }
  for (const c of input.counters) {
    const gk = `${c.companyId}|${c.docType}|${c.periodKey}`
    if (groups.has(gk)) continue
    const cfg = seqs.get(`${c.companyId}:${c.docType}`)
    if (!cfg || !keyMatchesPolicy(c.periodKey, cfg.resetPolicy)) {
      countersKept.push(c)
      continue
    }
    if (c.nextValue !== cfg.startAt) counters.push({ companyId: c.companyId, docType: c.docType, periodKey: c.periodKey, from: c.nextValue, to: cfg.startAt, documents: 0 })
  }
  counters.sort((a, b) => a.companyId - b.companyId || (a.docType < b.docType ? -1 : a.docType > b.docType ? 1 : 0) || (a.periodKey < b.periodKey ? -1 : a.periodKey > b.periodKey ? 1 : 0))
  if (countersKept.length > 0) warnings.push(`${countersKept.length} counter dibiarkan (kunci periode tidak sesuai pola reset, mis. ALL lama).`)

  // ---- ambiguous old numbers (the same string on two documents of one PT): never used for derived-text replacement
  const byOld = new Map<string, number>()
  for (const it of items) byOld.set(`${it.companyId}|${it.oldNo}`, (byOld.get(`${it.companyId}|${it.oldNo}`) ?? 0) + 1)
  const ambiguous = [...byOld].filter(([, n]) => n > 1).map(([k]) => k.split('|')[1])
  if (ambiguous.length > 0) warnings.push(`Nomor lama ganda dalam satu PT (tidak diganti di teks turunan): ${ambiguous.slice(0, 10).join(', ')}${ambiguous.length > 10 ? ' …' : ''}`)

  const changed = items.filter((i) => i.changed).length
  const canonical = JSON.stringify({
    items: items.map((i) => [i.table, i.id, i.companyId, i.oldNo, i.newNo]),
    patternFixes: fixes.map((f) => [f.sequenceId, f.from.pattern, f.to.pattern, f.to.padding, f.to.resetPolicy, f.to.startAt]),
    counters: counters.map((c) => [c.companyId, c.docType, c.periodKey, c.from, c.to]),
  })
  return {
    items,
    patternFixes: fixes,
    counters,
    countersKept,
    errors,
    warnings,
    summary: { documents: items.length, changed, unchanged: items.length - changed, groups: groups.size },
    sha256: createHash('sha256').update(canonical).digest('hex'),
  }
}

/**
 * old → new per PT for derived text (cash entry descriptions, notification texts, receipt flags). Only changed
 * numbers, never an ambiguous old string.
 */
export function textMaps(plan: Pick<RenumberPlan, 'items'>): Map<number, Map<string, string>> {
  const count = new Map<string, number>()
  for (const it of plan.items) count.set(`${it.companyId}|${it.oldNo}`, (count.get(`${it.companyId}|${it.oldNo}`) ?? 0) + 1)
  const out = new Map<number, Map<string, string>>()
  for (const it of plan.items) {
    if (!it.changed || count.get(`${it.companyId}|${it.oldNo}`) !== 1) continue
    let m = out.get(it.companyId)
    if (!m) out.set(it.companyId, (m = new Map()))
    m.set(it.oldNo, it.newNo)
  }
  return out
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Replaces every old number in `text` with its new number in ONE pass (so a swap A→B, B→A is safe) and only as a
 * whole token: not preceded by a letter/digit/`/`/`-`/`_` and not followed by one (so `29/PB-X/…` never matches
 * inside `229/PB-X/…`, and `PB/X/2610/0001` not inside `PB/X/2610/00012`). Longest alternatives first.
 */
export function makeReplacer(map: ReadonlyMap<string, string>): (text: string) => string {
  if (map.size === 0) return (t) => t
  const alts = [...map.keys()].sort((a, b) => b.length - a.length || (a < b ? -1 : 1)).map(escapeRe)
  const re = new RegExp(`(?<![\\p{L}\\p{N}/_-])(?:${alts.join('|')})(?![\\p{L}\\p{N}/_-])`, 'gu')
  return (text) => text.replace(re, (m) => map.get(m) ?? m)
}

/** CSV (`;`-separated, Excel id-ID friendly) of the mapping for the review of the dry-run. */
export function planCsv(plan: RenumberPlan, codes: ReadonlyMap<number, string>): string {
  const q = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = ['kode_pt', 'tabel', 'jenis', 'id', 'dibuat', 'tanggal_dokumen', 'periode', 'urut', 'nomor_lama', 'nomor_baru', 'berubah']
  const lines = plan.items.map((i) => [codes.get(i.companyId) ?? `#${i.companyId}`, i.table, i.docType, i.id, i.createdAt, i.date, i.periodKey, i.seq, i.oldNo, i.newNo, i.changed ? 'ya' : 'tidak'].map(q).join(';'))
  return `${head.join(';')}\n${lines.join('\n')}${lines.length ? '\n' : ''}`
}
