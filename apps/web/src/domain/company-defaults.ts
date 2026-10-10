import type { Field, PayloadRequest } from 'payload'

import { relId } from '@/access/roles'
import { writeAudit } from '@/audit/writer'
import { COMPANY_SETTING_FIELDS } from '@/collections/Companies'
import { WEEKDAY_KEYS } from '@/domain/attendance/schedule'
import { ruleDecisionError } from '@/domain/expense/decision'
import { stepsError, type AckBy, type AckMode } from '@/domain/expense/rules'
import { DEFAULT_SEQUENCES } from '@/domain/numbering'
import { CASH_IN_SOURCES, DEFAULT_APPROVAL_RULES } from '@/seed/data'
import { DEFAULT_TZ } from '@/lib/time'

/**
 * "Salin default dari DRMS" (US-MC-01, wireframe §3 "Saat dibuat (sekali)", ADR 0016 §4 "seeded per
 * new PT from the DRMS defaults"): a new PT gets from a SOURCE PT (default: the lowest-id active PT
 * other than the new one = #1 DRMS)
 * - the document sequences (every doc type of the source; missing ones from the ADR 0007 defaults
 *   `DEFAULT_SEQUENCES`), with `startAt` 1 — a new PT starts its own series (Q-54: the Admin sets
 *   "Nomor awal" before the first document; counters are per PT anyway);
 * - the approval rules WITHOUT per-PT references (no category / project / cost center / named user —
 *   those point at rows of the source PT) that today's rule checks accept (skipped ones are
 *   reported); a doc type the source has no
 *   copyable rule for gets the ADR 0013 defaults `DEFAULT_APPROVAL_RULES` (same as seed + import);
 * - the source's default work schedule (copied by name, set as the new PT's default);
 * - the per-PT settings (`COMPANY_SETTING_FIELDS`) whose value on the new PT still equals the field
 *   default — a value the creator changed in the form is kept;
 * - QA-11: the SYSTEM cash-in sources (`SYSTEM_CASH_IN_SOURCES`: "Pengembalian LPJ", code `LPJ`, used by
 *   the LPJ refund) — also for a PT created WITHOUT copying defaults (`ensureSystemCashInSources`).
 *
 * IDEMPOTENT: every row is create-only by its natural key inside the target PT (doc type / rule
 * name / schedule name); a second run creates nothing and changes no setting that already differs
 * from the default. Runs in the caller's transaction (`req`); rows are audited by their collections
 * (`withAudit`, actor = the caller) + ONE summary row (`create`, docType `company`, field
 * `defaultsCopied`, new value = the report). SYSTEM-WRITE: the caller (group admin creating a PT)
 * may have no membership in the new PT yet.
 */
export type CopyDefaultsReport = {
  source: number | null
  sequences: { created: string[]; existing: string[] }
  rules: { created: string[]; existing: string[]; skipped: string[] }
  workSchedule: { created: boolean; name: string | null; setAsDefault: boolean }
  settings: string[]
  cashInSources: { created: string[]; existing: string[] }
}

/**
 * QA-11: cash-in sources the workflow itself posts with (lpj.ts settle → KM "Pengembalian LPJ"). Same
 * code/name as the seed (seed/data.ts CASH_IN_SOURCES); backfilled for existing PTs by migration
 * 20261008_120100_qa_flow_lpj_source.
 */
export const SYSTEM_CASH_IN_SOURCES = CASH_IN_SOURCES.filter((s) => s.code === 'LPJ')

/**
 * Creates the missing SYSTEM_CASH_IN_SOURCES of PT `target` (create-only by code, any active flag:
 * a deliberately deactivated source is left alone). Audited by the collection (`withAudit`, actor =
 * the caller). SYSTEM-WRITE: the caller may have no membership in a new PT yet.
 */
export async function ensureSystemCashInSources(req: PayloadRequest, target: number): Promise<{ created: string[]; existing: string[] }> {
  const out = { created: [] as string[], existing: [] as string[] }
  const res = await req.payload.find({
    collection: 'cash-in-sources',
    where: { and: [{ company: { equals: target } }, { code: { in: SYSTEM_CASH_IN_SOURCES.map((s) => s.code) } }] },
    depth: 0,
    pagination: false,
    overrideAccess: true, // SYSTEM-READ: system masters of the target PT
    req,
  })
  const have = new Set(res.docs.map((d) => (d as { code?: string }).code))
  for (const s of SYSTEM_CASH_IN_SOURCES) {
    if (have.has(s.code)) {
      out.existing.push(s.code)
      continue
    }
    await req.payload.create({
      collection: 'cash-in-sources',
      data: { company: target, code: s.code, name: s.name, active: true } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: system master of a PT (QA-11), audited by the collection
      req,
    })
    out.created.push(s.code)
  }
  return out
}

/** Owner decision 2026-10-09: default "Tingkat Urgensi" of a PT (configurable afterwards). */
export const DEFAULT_URGENCY_LEVELS = [
  { code: 'LOW', name: 'Low', rank: 1 },
  { code: 'MEDIUM', name: 'Medium', rank: 2 },
  { code: 'HIGH', name: 'High', rank: 3 },
  { code: 'SUPER', name: 'Super', rank: 4 },
] as const

/**
 * Creates DEFAULT_URGENCY_LEVELS in PT `target` when it has none at all (levels are never deleted, so
 * "none" = never seeded; a PT that renamed or deactivated its levels is left alone). Audited by the
 * collection. SYSTEM-WRITE: the caller may have no membership in a new PT yet.
 */
export async function ensureDefaultUrgencyLevels(req: PayloadRequest, target: number): Promise<string[]> {
  const res = await req.payload.find({ collection: 'urgency-levels', where: { company: { equals: target } }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: masters of the target PT */, req })
  if (res.docs.length > 0) return []
  for (const u of DEFAULT_URGENCY_LEVELS) {
    await req.payload.create({ collection: 'urgency-levels', data: { company: target, ...u, active: true } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: default master of a PT */, req })
  }
  return DEFAULT_URGENCY_LEVELS.map((u) => u.code)
}

/** req.context flag: the create comes from the seed / go-live import (they apply their own defaults). */
export const SKIP_COMPANY_DEFAULTS = 'pkSkipCompanyDefaults'

type Row = Record<string, unknown> & { id: number }

async function findAll(req: PayloadRequest, collection: 'document-sequences' | 'approval-rules' | 'work-schedules', company: number): Promise<Row[]> {
  const res = await req.payload.find({
    collection,
    where: { company: { equals: company } },
    depth: 0,
    pagination: false,
    sort: 'id',
    overrideAccess: true, // SYSTEM-READ: defaults of the source / target PT (group admin action)
    req,
  })
  return res.docs as unknown as Row[]
}

async function createIn(req: PayloadRequest, collection: 'document-sequences' | 'approval-rules' | 'work-schedules', data: Record<string, unknown>): Promise<number> {
  const doc = await req.payload.create({
    collection,
    data: data as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: copy defaults into a new PT (caller = group admin, checked by the companies create access)
    req,
  })
  return doc.id as number
}

/** Named leaf setting fields (rows / collapsibles flattened) with their default values. */
/** FR1 (ADR 0020 §10): feature flags rolled out PT by PT stay at their default (OFF) on a new PT. */
export const NOT_COPIED_SETTINGS: ReadonlySet<string> = new Set(['fieldReportsEnabled'])

export function settingDefaults(fields: readonly Field[] = COMPANY_SETTING_FIELDS): Array<{ name: string; defaultValue: unknown }> {
  const out: Array<{ name: string; defaultValue: unknown }> = []
  for (const f of fields) {
    if ('name' in f && typeof f.name === 'string') {
      if (f.type === 'relationship' || f.type === 'upload') continue // defaultWorkSchedule: handled as a copied row
      out.push({ name: f.name, defaultValue: 'defaultValue' in f ? f.defaultValue : undefined })
    } else if ('fields' in f && Array.isArray(f.fields)) out.push(...settingDefaults(f.fields as Field[]))
  }
  return out
}

/** Source PT: explicit (must exist), else the lowest-id ACTIVE PT other than the target; null = none. */
async function sourceOf(req: PayloadRequest, target: number, from: number | null | undefined): Promise<Row | null> {
  if (typeof from === 'number') {
    if (from === target) return null
    const doc = await req.payload.findByID({ collection: 'companies', id: from, depth: 0, overrideAccess: true /* SYSTEM-READ: source PT */, req, disableErrors: true })
    return (doc as unknown as Row | null) ?? null
  }
  const res = await req.payload.find({
    collection: 'companies',
    where: { and: [{ active: { equals: true } }, { id: { not_equals: target } }] },
    sort: 'id',
    limit: 1,
    depth: 0,
    overrideAccess: true, // SYSTEM-READ: default source PT (#1 DRMS)
    req,
  })
  return (res.docs[0] as unknown as Row | undefined) ?? null
}

const RULE_FIELDS = ['name', 'docType', 'requestType', 'minAmount', 'maxAmount', 'priority', 'acknowledge', 'acknowledgeBy', 'acknowledgeRole', 'signDiajukan', 'signDibuat', 'active'] as const

/**
 * A source rule that cannot be copied: it names rows of its own PT (category / project / cost center
 * / users), or the rules hook would refuse it today (`scope_manager` outside expense requests, non-decision roles,
 * broken levels — possible in rules saved before ADR 0013). Skipped + reported, never a failed create
 * (a failing nested write would roll the whole PT create back).
 */
function notCopyable(r: Row): boolean {
  const steps = Array.isArray(r.steps) ? (r.steps as Array<Record<string, unknown>>) : []
  if ([r.category, r.project, r.costCenter, r.acknowledgeUser].some((v) => relId(v) !== undefined) || steps.some((s) => relId(s.approverUser) !== undefined) || r.acknowledgeBy === 'user') return true
  const rule = {
    acknowledge: (r.acknowledge ?? 'required') as AckMode,
    acknowledgeBy: (r.acknowledgeBy ?? 'role') as AckBy,
    acknowledgeRole: (r.acknowledgeRole ?? null) as never,
    acknowledgeUser: null,
    steps: steps.map((s) => ({ level: Number(s.level), approverRole: (s.approverRole ?? null) as never, approverUser: null })),
  }
  const max = typeof r.maxAmount === 'number' ? r.maxAmount : null
  if (max !== null && max < Number(r.minAmount ?? 0)) return true
  if (r.docType === 'budget_addendum' && (r.requestType ?? 'any') !== 'any') return true
  return stepsError(rule.steps) !== null || ruleDecisionError(rule, () => undefined, (r.docType as string | undefined) ?? 'expense_request') !== null
}

export async function copyCompanyDefaults(req: PayloadRequest, target: number, opts: { from?: number | null; settings?: boolean } = {}): Promise<CopyDefaultsReport> {
  const src = await sourceOf(req, target, opts.from)
  const sourceId = src?.id ?? null
  const report: CopyDefaultsReport = {
    source: sourceId,
    sequences: { created: [], existing: [] },
    rules: { created: [], existing: [], skipped: [] },
    workSchedule: { created: false, name: null, setAsDefault: false },
    settings: [],
    cashInSources: { created: [], existing: [] },
  }
  const tgt = (await req.payload.findByID({ collection: 'companies', id: target, depth: 0, overrideAccess: true /* SYSTEM-READ: target PT */, req })) as unknown as Row
  const tz = (typeof tgt.timezone === 'string' && tgt.timezone) || process.env.TZ || DEFAULT_TZ

  // ---- document sequences (ADR 0007): source rows, else the built-in defaults; startAt 1
  const have = new Set((await findAll(req, 'document-sequences', target)).map((s) => s.docType as string))
  const srcSeq = sourceId !== null ? await findAll(req, 'document-sequences', sourceId) : []
  const byType = new Map<string, Record<string, unknown>>()
  for (const d of DEFAULT_SEQUENCES) byType.set(d.docType, { ...d })
  for (const s of srcSeq) byType.set(s.docType as string, { docType: s.docType, docCode: s.docCode, pattern: s.pattern, resetPolicy: s.resetPolicy, padding: s.padding, active: s.active !== false })
  for (const [docType, s] of byType) {
    if (have.has(docType)) {
      report.sequences.existing.push(docType)
      continue
    }
    await createIn(req, 'document-sequences', { ...s, company: target, startAt: 1, timezone: tz, active: s.active !== false })
    report.sequences.created.push(docType)
  }

  // ---- approval rules (ADR 0013): copyable source rules, else the defaults per doc type
  const haveRules = new Set((await findAll(req, 'approval-rules', target)).map((r) => r.name as string))
  const srcRules = sourceId !== null ? await findAll(req, 'approval-rules', sourceId) : []
  const wanted: Array<Record<string, unknown>> = []
  for (const r of srcRules) {
    if (notCopyable(r)) {
      report.rules.skipped.push(r.name as string)
      continue
    }
    const data: Record<string, unknown> = {}
    for (const k of RULE_FIELDS) if (r[k] !== undefined) data[k] = r[k]
    data.steps = (Array.isArray(r.steps) ? (r.steps as Array<Record<string, unknown>>) : []).map((s) => ({ level: s.level, approverRole: s.approverRole ?? null }))
    wanted.push(data)
  }
  const coveredTypes = new Set(wanted.map((r) => r.docType as string))
  for (const d of DEFAULT_APPROVAL_RULES) if (!coveredTypes.has(d.docType)) wanted.push({ ...d })
  for (const r of wanted) {
    if (haveRules.has(r.name as string)) {
      report.rules.existing.push(r.name as string)
      continue
    }
    await createIn(req, 'approval-rules', { ...r, company: target })
    haveRules.add(r.name as string)
    report.rules.created.push(r.name as string)
  }

  // ---- QA-11: system cash-in sources ("Pengembalian LPJ")
  report.cashInSources = await ensureSystemCashInSources(req, target)

  // ---- default work schedule (E6, Q-30) + per-PT settings (only values still at their default)
  const patch: Record<string, unknown> = {}
  const srcSchedule = src ? relId(src.defaultWorkSchedule) : undefined
  if (srcSchedule !== undefined && sourceId !== null) {
    const ws = (await req.payload.findByID({ collection: 'work-schedules', id: srcSchedule, depth: 0, overrideAccess: true /* SYSTEM-READ: source schedule */, req, disableErrors: true })) as Row | null
    if (ws) {
      const name = ws.name as string
      report.workSchedule.name = name
      const existing = (await findAll(req, 'work-schedules', target)).find((x) => x.name === name)
      let id = existing?.id
      if (id === undefined) {
        const days = (ws.workDays ?? {}) as Record<string, unknown>
        id = await createIn(req, 'work-schedules', {
          company: target,
          name,
          startTime: ws.startTime,
          endTime: ws.endTime,
          lateToleranceMin: ws.lateToleranceMin,
          workDays: Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, days[k] === true])),
          active: ws.active !== false,
        })
        report.workSchedule.created = true
      }
      if (relId(tgt.defaultWorkSchedule) === undefined) {
        patch.defaultWorkSchedule = id
        report.workSchedule.setAsDefault = true
      }
    }
  }
  if (opts.settings !== false && src) {
    for (const { name, defaultValue } of settingDefaults()) {
      if (NOT_COPIED_SETTINGS.has(name)) continue
      const now = tgt[name]
      const atDefault = now === undefined || now === null || now === defaultValue
      if (atDefault && src[name] !== undefined && src[name] !== null && src[name] !== now) {
        patch[name] = src[name]
        report.settings.push(name)
      }
    }
  }
  if (Object.keys(patch).length > 0) {
    await req.payload.update({
      collection: 'companies',
      id: target,
      data: patch as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: defaults of a new PT (audited field by field by withAudit)
      req,
    })
  }
  await writeAudit(req, [{ action: 'create', docType: 'company', docId: String(target), field: 'defaultsCopied', newValue: report, companyId: target }])
  return report
}
