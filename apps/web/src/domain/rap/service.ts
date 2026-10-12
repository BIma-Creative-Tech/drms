import { createHash } from 'node:crypto'

import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { hasRole, relId } from '@/access/roles'
import { resolveScope } from '@/access/scope'
import { fail, validation } from '@/domain/field/common'
import { kindOf, PROJECT_KIND_LABELS } from '@/domain/field/rules'
import { lockProject, projectStages, recalcProjectProgress, setStageProgress, type StageRow } from '@/domain/progress/recalc'
import { requireVisibleProject, saveStageSet } from '@/domain/progress/stages'
import { getRequestTx } from '@/lib/tx'

import { rapItemMoney, sumRapMoney, type RapMoney } from './budget'
import { isQty, itemPct, normUom, rapDrivesProgress, rapRequiredFor, round2, stagePct, stockOf, type RapKind } from './rules'
import { parseRapWorkbook, type RapIssue, type RapRow } from './workbook'

/**
 * P3 RAP of a project (owner decisions 2026-10-10; every project kind since DRMS 10/10 D4, owner 2026-10-11 "RAP wajib
 * untuk semua proyek yang punya RAB"). Who: Direktur/Admin of the PT (any project) and the PM of the project's team;
 * Staff read quantities only (no prices). Lock: once the project has a daily-report ledger line the RAP is locked —
 * then only Direktur/Admin, with a reason. Items are never deleted (deactivated). Konstruksi: every item has a stage
 * and every change recomputes the RAP-driven stages and the project %; other kinds (`rapDrivesProgress` false): the
 * stage is optional (an existing stage only, never created by an import) and the progress stays manual (E4).
 */

type Project = { id: number; company: number; kind: string; status: string | null; budget: number | null }

export type RapRoles = { director: boolean; pm: boolean; prices: boolean }

export async function loadProjectFor(req: PayloadRequest, projectId: number): Promise<Project> {
  await requireVisibleProject(req, projectId)
  const p = (await req.payload.findByID({ collection: 'projects', id: projectId, depth: 0, overrideAccess: true /* SYSTEM-READ: after the visibility check */, req })) as unknown as Record<string, unknown>
  return { id: projectId, company: relId(p.company) ?? -1, kind: String(p.kind ?? 'umum'), status: (p.status as string | null) ?? null, budget: typeof p.budget === 'number' ? p.budget : null }
}

export async function rapRoles(req: PayloadRequest, p: Pick<Project, 'id' | 'company'>): Promise<RapRoles> {
  const director = hasRole(req, ['pk-owner', 'pk-admin'], p.company)
  const pm = hasRole(req, 'pk-pm', p.company) && (await resolveScope(req, p.company)).teamProjects.includes(p.id)
  return { director, pm, prices: director || pm || hasRole(req, 'pk-finance', p.company) }
}

/** Locked = the project already has realisation (any ledger line). */
export async function isRapLocked(req: PayloadRequest, p: Pick<Project, 'id' | 'company'>): Promise<boolean> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`SELECT EXISTS (SELECT 1 FROM daily_report_lines l WHERE l.project_id = ${p.id} AND l.company_id = ${p.company}) AS locked`)) as unknown as { rows: Array<{ locked: boolean }> }
  return r.rows[0]?.locked === true
}

async function requireEditor(req: PayloadRequest, p: Project, reason: string | null | undefined): Promise<{ locked: boolean; roles: RapRoles; reason: string }> {
  if (p.status === 'arsip') fail(409, 'STATE_CONFLICT', 'Project sudah diarsipkan.')
  const roles = await rapRoles(req, p)
  if (!roles.director && !roles.pm) fail(403, 'FORBIDDEN', 'RAP hanya dapat diubah oleh Direktur/Admin atau PM project ini.')
  const locked = await isRapLocked(req, p)
  const why = (reason ?? '').trim()
  if (locked && !roles.director) fail(409, 'RAP_LOCKED', 'RAP terkunci karena sudah ada realisasi: perubahan hanya oleh Direktur/Admin dengan alasan.')
  if (locked && why.length < 3) fail(400, 'VALIDATION', 'Alasan wajib diisi (RAP terkunci karena sudah ada realisasi).', 'reason')
  return { locked, roles, reason: why }
}

type ItemRow = {
  id: number
  code: string
  description: string
  kind: RapKind
  /** null = no stage (allowed outside konstruksi only, DB trigger). */
  stage_id: number | null
  stage_name: string | null
  uom_id: number
  uom_code: string
  volume: string
  unit_price: string | null
  weight_pct: string | null
  sort_order: string | null
  realised_qty: string | null
  received_qty: string | null
  used_qty: string | null
  active: boolean | null
}

async function itemRows(req: PayloadRequest, p: Pick<Project, 'id' | 'company'>): Promise<ItemRow[]> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT i.id, i.code, i.description, i.kind::text AS kind, i.stage_id, s.name AS stage_name, i.uom_id, u.code AS uom_code,
           i.volume::text AS volume, i.unit_price::text AS unit_price, i.weight_pct::text AS weight_pct, i.sort_order::text AS sort_order,
           i.realised_qty::text AS realised_qty, i.received_qty::text AS received_qty, i.used_qty::text AS used_qty, i.active
      FROM rap_items i LEFT JOIN project_stages s ON s.id = i.stage_id JOIN uoms u ON u.id = i.uom_id
     WHERE i.project_id = ${p.id} AND i.company_id = ${p.company}
     ORDER BY i.sort_order, i.id`)) as unknown as { rows: ItemRow[] }
  return r.rows
}

const num = (v: string | null | undefined): number => (v === null || v === undefined ? 0 : Number(v))
const numN = (v: string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v))

export type RapItemDto = {
  id: number
  code: string
  description: string
  /** DRMS 10/10 contract alias of `description`. */
  name: string
  kind: RapKind
  /** null outside konstruksi when the item has no stage (DRMS 10/10 D4, 2026-10-11). */
  stage: { id: number; name: string } | null
  uom: { id: number; code: string }
  volume: number
  /** DRMS 10/10 contract alias of `volume`. */
  qty: number
  unitPrice?: number | null
  value?: number | null
  /**
   * D4 money (price roles only): planned = volume × harga satuan, realisedAmount = Σ approved line totals (from the
   * final Direktur approval), transferredAmount / verifiedAmount, remaining = planned − realisedAmount, percent.
   * `realised` (above) stays the realised QUANTITY of the daily reports (P3).
   */
  planned?: number | null
  realisedAmount?: number
  transferredAmount?: number
  verifiedAmount?: number
  remaining?: number | null
  percent?: number | null
  overBudget?: boolean
  weightPct: number | null
  sortOrder: number
  realised: number
  received: number
  used: number
  stock: number | null
  pct: number | null
  overRap: boolean
  active: boolean
}

export function itemDto(r: ItemRow, prices: boolean, money?: RapMoney): RapItemDto {
  const volume = num(r.volume)
  const realised = num(r.realised_qty)
  const price = numN(r.unit_price)
  return {
    id: r.id,
    code: r.code,
    description: r.description,
    name: r.description,
    kind: r.kind,
    stage: r.stage_id === null ? null : { id: r.stage_id, name: r.stage_name ?? '' },
    uom: { id: r.uom_id, code: r.uom_code },
    volume,
    qty: volume,
    ...(prices ? { unitPrice: price, value: price === null ? null : Math.round(volume * price) } : {}),
    ...(prices && money
      ? { planned: money.planned, realisedAmount: money.realised, transferredAmount: money.transferred, verifiedAmount: money.verified, remaining: money.remaining, percent: money.percent, overBudget: money.overBudget }
      : {}),
    weightPct: numN(r.weight_pct),
    sortOrder: num(r.sort_order),
    realised,
    received: num(r.received_qty),
    used: num(r.used_qty),
    stock: r.kind === 'material' ? stockOf(num(r.received_qty), num(r.used_qty)) : null,
    pct: r.kind === 'pekerjaan' ? itemPct(realised, volume) : null,
    overRap: r.kind === 'pekerjaan' && realised > volume,
    active: r.active !== false,
  }
}

export type RapStageDto = { id: number; name: string; weightPct: number; progressPct: number; active: boolean; progressMode: 'manual' | 'rap'; basis: 'value' | 'equal' | 'none'; workItems: number }

/** GET /projects/{id}/rap — items, stage summary, lock state, value vs RAB (prices only for office roles + PM). */
export async function loadRap(req: PayloadRequest, projectId: number) {
  const p = await loadProjectFor(req, projectId)
  const roles = await rapRoles(req, p)
  const [rows, stages, locked, modes] = [await itemRows(req, p), await projectStages(req, projectId), await isRapLocked(req, p), await stageModes(req, p)]
  // D4: plan vs realisation in money per item (price roles only)
  const money = roles.prices ? await rapItemMoney(req, [projectId]) : null
  const items = rows.map((r) => itemDto(r, roles.prices, money?.get(r.id)))
  const stageDtos: RapStageDto[] = stages.map((s) => {
    const work = rows.filter((r) => r.stage_id === s.id && r.kind === 'pekerjaan')
    const res = stagePct(work.map((r) => ({ volume: num(r.volume), realised: num(r.realised_qty), unitPrice: numN(r.unit_price), active: r.active !== false })))
    return { id: s.id, name: s.name, weightPct: s.weightPct, progressPct: s.progressPct, active: s.active, progressMode: modes.get(s.id) ?? 'manual', basis: res.basis, workItems: work.filter((r) => r.active !== false).length }
  })
  const rapValue = roles.prices ? rows.filter((r) => r.active !== false && r.unit_price !== null).reduce((s, r) => s + Math.round(num(r.volume) * num(r.unit_price)), 0) : null
  const kind = kindOf(p.kind)
  return {
    projectId,
    kind,
    // DRMS 10/10 D4: the project needs ≥ 1 active item before requests can be sent (RAB > 0 or konstruksi)
    rapRequired: rapRequiredFor({ kind, budget: p.budget }),
    // konstruksi only: work items drive the stage progress (else stage optional, progress manual)
    drivesProgress: rapDrivesProgress(kind),
    locked,
    canEdit: p.status !== 'arsip' && (roles.director || (roles.pm && !locked)),
    needsReason: locked,
    items,
    stages: stageDtos,
    totals: roles.prices ? { rapValue, budget: p.budget, overBudget: rapValue !== null && p.budget !== null && rapValue > p.budget } : null,
    // D4: Σ plan vs realisation of the items (active ones, plus deactivated items that carry realisation)
    budget: money ? sumRapMoney([...money.values()].filter((m) => m.active || m.realised > 0)) : null,
    // the APK caches these with the RAP: manpower / equipment types of the project's PT for the daily report
    resourceTypes: await resourceTypesOf(req, p.company),
  }
}

async function resourceTypesOf(req: PayloadRequest, company: number): Promise<Array<{ id: number; kind: 'tenaga' | 'alat'; code: string; name: string }>> {
  const res = await req.payload.find({
    collection: 'resource-types',
    where: { and: [{ company: { equals: company } }, { active: { not_equals: false } }] },
    sort: 'code',
    depth: 0,
    pagination: false,
    overrideAccess: true, // SYSTEM-READ: masters of the project's PT (caller passed the project visibility check)
    req,
  })
  return (res.docs as Array<{ id: number; kind: 'tenaga' | 'alat'; code: string; name: string }>).map((d) => ({ id: d.id, kind: d.kind, code: d.code, name: d.name }))
}

async function stageModes(req: PayloadRequest, p: Pick<Project, 'id' | 'company'>): Promise<Map<number, 'manual' | 'rap'>> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`SELECT s.id, s.progress_mode::text AS mode FROM project_stages s WHERE s.project_id = ${p.id} AND s.company_id = ${p.company}`)) as unknown as {
    rows: Array<{ id: number; mode: string | null }>
  }
  return new Map(r.rows.map((x) => [x.id, x.mode === 'rap' ? 'rap' : 'manual']))
}

/**
 * Recomputes every stage that has active work items (progress_mode → `rap`, % from the RAP) and the
 * project %. Stages without work items go back to `manual` (their last % stays). Runs in the caller's
 * transaction (lockProject first).
 */
export async function refreshRapProgress(req: PayloadRequest, projectId: number): Promise<void> {
  const doc = (await req.payload.findByID({ collection: 'projects', id: projectId, depth: 0, overrideAccess: true /* SYSTEM-READ: PT + kind */, req })) as { company?: unknown; kind?: unknown }
  // DRMS 10/10 D4: outside konstruksi the RAP is a cost plan only — the stages keep their manual progress (E4)
  if (!rapDrivesProgress(kindOf(doc.kind))) return
  const p = { id: projectId, company: relId(doc.company) ?? -1 }
  await lockProject(req, projectId)
  const [rows, stages, modes] = [await itemRows(req, p), await projectStages(req, projectId), await stageModes(req, p)]
  for (const s of stages) {
    const work = rows.filter((r) => r.stage_id === s.id && r.kind === 'pekerjaan' && r.active !== false)
    const mode: 'manual' | 'rap' = work.length > 0 ? 'rap' : 'manual'
    if (modes.get(s.id) !== mode) {
      const tx = await getRequestTx(req)
      await tx.execute(sql`UPDATE project_stages SET progress_mode = ${mode}, updated_at = now() WHERE id = ${s.id} AND company_id = ${p.company}`)
    }
    if (mode === 'rap') {
      const pct = stagePct(work.map((r) => ({ volume: num(r.volume), realised: num(r.realised_qty), unitPrice: numN(r.unit_price), active: true }))).pct
      if (round2(pct) !== round2(s.progressPct)) await setStageProgress(req, s.id, pct)
    }
  }
  await recalcProjectProgress(req, projectId)
}

// ------------------------------------------------------------------------------------ single items

export type RapItemInput = {
  code?: string
  description?: string
  /** Required for konstruksi; other kinds may leave it empty / clear it with null. */
  stageId?: number | null
  kind?: RapKind
  uomId?: number
  volume?: number
  unitPrice?: number | null
  weightPct?: number | null
  sortOrder?: number
  active?: boolean
}

function itemIssues(i: RapItemInput, create: boolean, stageRequired: boolean): Array<{ path: string; message: string }> {
  const out: Array<{ path: string; message: string }> = []
  const need = <K extends keyof RapItemInput>(k: K) => create && (i[k] === undefined || i[k] === null)
  if (need('code') || (i.code !== undefined && (!i.code.trim() || i.code.trim().length > 32))) out.push({ path: 'code', message: 'Kode wajib, maks. 32 karakter.' })
  if (need('description') || (i.description !== undefined && (!i.description.trim() || i.description.trim().length > 300))) out.push({ path: 'description', message: 'Uraian wajib, maks. 300 karakter.' })
  if (stageRequired && (need('stageId') || i.stageId === null)) out.push({ path: 'stageId', message: 'Tahapan wajib untuk project konstruksi.' })
  if (need('kind')) out.push({ path: 'kind', message: 'Jenis wajib.' })
  if (need('uomId')) out.push({ path: 'uomId', message: 'Satuan wajib.' })
  if (need('volume') || (i.volume !== undefined && !isQty(i.volume))) out.push({ path: 'volume', message: 'Volume harus > 0, maks. 2 desimal.' })
  if (i.unitPrice !== undefined && i.unitPrice !== null && !(Number.isSafeInteger(i.unitPrice) && i.unitPrice >= 0)) out.push({ path: 'unitPrice', message: 'Harga satuan harus Rupiah bulat ≥ 0.' })
  if (i.weightPct !== undefined && i.weightPct !== null && !(i.weightPct >= 0 && i.weightPct <= 100)) out.push({ path: 'weightPct', message: 'Bobot 0–100.' })
  return out
}

async function checkRefs(req: PayloadRequest, p: Project, i: RapItemInput, stages: StageRow[]): Promise<void> {
  const issues: Array<{ path: string; message: string }> = []
  if (i.stageId !== undefined && i.stageId !== null && !stages.some((s) => s.id === i.stageId && s.active)) issues.push({ path: 'stageId', message: 'Tahapan bukan tahapan aktif project ini.' })
  if (i.uomId !== undefined) {
    const u = await req.payload.findByID({ collection: 'uoms', id: i.uomId, depth: 0, overrideAccess: true /* SYSTEM-READ: shared master */, req, disableErrors: true })
    if (!u || (u as { active?: boolean | null }).active === false) issues.push({ path: 'uomId', message: 'Satuan tidak ditemukan atau nonaktif.' })
  }
  validation(issues)
}

const withReason = async <T>(req: PayloadRequest, reason: string, fn: () => Promise<T>): Promise<T> => {
  if (reason) req.context.auditReason = reason
  try {
    return await fn()
  } finally {
    delete req.context.auditReason
  }
}

/** POST /projects/{id}/rap/items */
export async function createRapItem(req: PayloadRequest, projectId: number, input: RapItemInput, reason?: string | null): Promise<RapItemDto> {
  const p = await loadProjectFor(req, projectId)
  const ed = await requireEditor(req, p, reason)
  validation(itemIssues(input, true, rapDrivesProgress(kindOf(p.kind))))
  await lockProject(req, projectId)
  const stages = await projectStages(req, projectId)
  await checkRefs(req, p, input, stages)
  const code = input.code!.trim()
  const existing = await itemRows(req, p)
  if (existing.some((r) => r.code.toUpperCase() === code.toUpperCase())) fail(409, 'DUPLICATE_CODE', `Kode ${code} sudah ada di RAP project ini.`, 'code')
  const doc = await withReason(req, ed.reason, () =>
    req.payload.create({
      collection: 'rap-items',
      data: {
        project: projectId,
        stage: input.stageId ?? null,
        code,
        description: input.description!.trim(),
        kind: input.kind!,
        uom: input.uomId!,
        volume: round2(input.volume!),
        unitPrice: input.unitPrice ?? null,
        weightPct: input.weightPct ?? null,
        sortOrder: input.sortOrder ?? existing.length + 1,
        active: true,
      } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: RAP item after the role / lock checks above
      req,
    }),
  )
  await refreshRapProgress(req, projectId)
  return itemDto((await itemRows(req, p)).find((r) => r.id === (doc.id as number))!, ed.roles.prices)
}

/** PATCH /rap-items/{id} — kind and project never change; deactivate with `active: false`. */
export async function updateRapItem(req: PayloadRequest, itemId: number, input: RapItemInput, reason?: string | null): Promise<RapItemDto> {
  const cur = (await req.payload.findByID({ collection: 'rap-items', id: itemId, depth: 0, user: req.user, overrideAccess: false /* caller's read scope */, req }).catch(() => null)) as Record<string, unknown> | null
  if (!cur) fail(404, 'NOT_FOUND', 'Item RAP tidak ditemukan.')
  const projectId = relId(cur!.project)!
  const p = await loadProjectFor(req, projectId)
  const ed = await requireEditor(req, p, reason)
  if (input.kind !== undefined && input.kind !== cur!.kind) fail(400, 'VALIDATION', 'Jenis item tidak dapat diubah (buat item baru).', 'kind')
  validation(itemIssues(input, false, rapDrivesProgress(kindOf(p.kind))))
  await lockProject(req, projectId)
  const stages = await projectStages(req, projectId)
  await checkRefs(req, p, input, stages)
  if (input.code !== undefined) {
    const code = input.code.trim()
    if ((await itemRows(req, p)).some((r) => r.id !== itemId && r.code.toUpperCase() === code.toUpperCase())) fail(409, 'DUPLICATE_CODE', `Kode ${code} sudah ada di RAP project ini.`, 'code')
  }
  const data: Record<string, unknown> = {}
  if (input.code !== undefined) data.code = input.code.trim()
  if (input.description !== undefined) data.description = input.description.trim()
  if (input.stageId !== undefined) data.stage = input.stageId
  if (input.uomId !== undefined) data.uom = input.uomId
  if (input.volume !== undefined) data.volume = round2(input.volume)
  if (input.unitPrice !== undefined) data.unitPrice = input.unitPrice
  if (input.weightPct !== undefined) data.weightPct = input.weightPct
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder
  if (input.active !== undefined) data.active = input.active
  if (Object.keys(data).length > 0) {
    await withReason(req, ed.reason, () => req.payload.update({ collection: 'rap-items', id: itemId, data: data as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: after the role / lock checks */, req }))
    await refreshRapProgress(req, projectId)
  }
  return itemDto((await itemRows(req, p)).find((r) => r.id === itemId)!, ed.roles.prices)
}

// ------------------------------------------------------------------------------------ import / templates

export type RapPreviewRow = { row: number; code: string; status: 'new' | 'changed' | 'unchanged'; changes: string[] }
export type RapPreview = {
  fileHash: string
  locked: boolean
  rows: RapPreviewRow[]
  deactivated: Array<{ code: string; description: string; hasRealisation: boolean }>
  newStages: string[]
  issues: RapIssue[]
  counts: { new: number; changed: number; unchanged: number; deactivated: number }
}

const key = (s: string) => s.trim().toUpperCase()
const stageKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

async function uomIds(req: PayloadRequest, codes: string[]): Promise<Map<string, number>> {
  if (codes.length === 0) return new Map()
  const res = await req.payload.find({ collection: 'uoms', where: { active: { not_equals: false } }, depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ: shared master */, req })
  return new Map(res.docs.map((d) => [key(String((d as { code?: unknown }).code ?? '')), d.id as number]))
}

/** Diff of `rows` against the project's RAP (pure on loaded data) + reference issues. */
async function diffRows(req: PayloadRequest, p: Project, rows: RapRow[], removeMissing: boolean) {
  const existing = await itemRows(req, p)
  const stages = await projectStages(req, p.id)
  const uoms = await uomIds(req, [...new Set(rows.map((r) => r.uomCode))])
  const issues: RapIssue[] = []
  const byCode = new Map(existing.map((e) => [key(e.code), e]))
  const stageNames = new Map(stages.filter((s) => s.active).map((s) => [stageKey(s.name), s]))
  // konstruksi: stage required, unknown stages are created (Direktur); other kinds: optional, existing stages only
  const staged = rapDrivesProgress(kindOf(p.kind))
  const newStages = staged ? [...new Set(rows.map((r) => r.stageName.trim()).filter((n) => n && !stageNames.has(stageKey(n))))] : []
  const out: RapPreviewRow[] = []
  rows.forEach((r, i) => {
    const uomId = uoms.get(key(normUom(r.uomCode)))
    if (!uomId) issues.push({ row: r.row, column: 'satuan', message: `Satuan "${r.uomCode}" tidak dikenal.` })
    if (staged && !r.stageName.trim()) issues.push({ row: r.row, column: 'tahapan', message: 'Tahapan wajib untuk project konstruksi.' })
    if (!staged && r.stageName.trim() && !stageNames.has(stageKey(r.stageName))) {
      issues.push({ row: r.row, column: 'tahapan', message: `Tahapan "${r.stageName.trim()}" tidak ada di project ini — kosongkan kolom tahapan atau pakai tahapan yang sudah ada.` })
    }
    const e = byCode.get(key(r.code))
    if (!e) return void out.push({ row: r.row, code: r.code, status: 'new', changes: [] })
    if (e.kind !== r.kind) issues.push({ row: r.row, column: 'jenis', message: `Kode ${r.code}: jenis tidak dapat diubah (${e.kind} → ${r.kind}).` })
    const changes: string[] = []
    if (e.description !== r.description) changes.push('uraian')
    if (stageKey(e.stage_name ?? '') !== stageKey(r.stageName)) changes.push('tahapan')
    if (uomId !== undefined && e.uom_id !== uomId) changes.push('satuan')
    if (round2(num(e.volume)) !== round2(r.volume)) changes.push('volume')
    if (numN(e.unit_price) !== r.unitPrice) changes.push('harga_satuan')
    if (numN(e.weight_pct) !== r.weightPct) changes.push('bobot')
    if (num(e.sort_order) !== i + 1) changes.push('urutan')
    if (e.active === false) changes.push('aktif kembali')
    out.push({ row: r.row, code: r.code, status: changes.length ? 'changed' : 'unchanged', changes })
  })
  const inFile = new Set(rows.map((r) => key(r.code)))
  const deactivated = removeMissing
    ? existing.filter((e) => e.active !== false && !inFile.has(key(e.code))).map((e) => ({ code: e.code, description: e.description, hasRealisation: num(e.realised_qty) + num(e.received_qty) + num(e.used_qty) !== 0 }))
    : []
  return { out, issues, newStages, deactivated, existing, stages, uoms, stageNames }
}

/** POST /projects/{id}/rap/import/preview — nothing is written. */
export async function previewRapImport(req: PayloadRequest, projectId: number, bytes: Uint8Array): Promise<RapPreview> {
  const p = await loadProjectFor(req, projectId)
  const roles = await rapRoles(req, p)
  if (!roles.director && !roles.pm) fail(403, 'FORBIDDEN', 'RAP hanya dapat diubah oleh Direktur/Admin atau PM project ini.')
  const locked = await isRapLocked(req, p)
  const parsed = parseRapWorkbook(bytes)
  const d = await diffRows(req, p, parsed.rows, true)
  const issues = [...parsed.issues, ...d.issues]
  if (d.newStages.length > 0 && !roles.director) issues.push({ message: `Tahapan baru (${d.newStages.join(', ')}) hanya dapat dibuat oleh Direktur/Admin.` })
  if (locked && !roles.director) issues.push({ message: 'RAP terkunci karena sudah ada realisasi: impor hanya oleh Direktur/Admin dengan alasan.' })
  const counts = { new: 0, changed: 0, unchanged: 0, deactivated: d.deactivated.length }
  for (const r of d.out) counts[r.status]++
  return { fileHash: createHash('sha256').update(bytes).digest('hex'), locked, rows: d.out, deactivated: d.deactivated, newStages: d.newStages, issues, counts }
}

/** Proposed weights of the full stage set: value share (volume × price of work items) when every stage has value, else equal. */
function proposeWeights(names: string[], rows: RapRow[]): number[] {
  const value = names.map((n) => rows.filter((r) => r.kind === 'pekerjaan' && stageKey(r.stageName) === stageKey(n)).reduce((s, r) => s + r.volume * (r.unitPrice ?? 0), 0))
  const total = value.reduce((s, v) => s + v, 0)
  const raw = value.every((v) => v > 0) && total > 0 ? value.map((v) => (v / total) * 100) : names.map(() => 100 / names.length)
  const w = raw.map((x) => round2(x))
  w[w.length - 1] = round2(100 - w.slice(0, -1).reduce((s, x) => s + x, 0))
  return w
}

async function applyRows(req: PayloadRequest, p: Project, rows: RapRow[], opts: { removeMissing: boolean; reason: string; roles: RapRoles }) {
  const d = await diffRows(req, p, rows, opts.removeMissing)
  const problems = [...d.issues]
  if (d.newStages.length > 0 && !opts.roles.director) problems.push({ message: `Tahapan baru (${d.newStages.join(', ')}) hanya dapat dibuat oleh Direktur/Admin.` })
  if (problems.length) validation(problems.map((i) => ({ path: i.row ? `rows.${i.row}${i.column ? `.${i.column}` : ''}` : 'file', message: i.row ? `Baris ${i.row}: ${i.message}` : i.message })))

  if (d.newStages.length > 0) {
    const active = d.stages.filter((s) => s.active)
    const names = [...active.map((s) => s.name), ...d.newStages]
    const weights = proposeWeights(names, rows)
    const maxSeq = Math.max(0, ...d.stages.map((s) => s.sequence))
    await saveStageSet(req, p.id, {
      stages: names.map((n, i) => (i < active.length ? { id: active[i]!.id, name: n, weightPct: weights[i]!, sequence: active[i]!.sequence } : { name: n, weightPct: weights[i]!, sequence: maxSeq + (i - active.length) + 1 })),
      reason: opts.reason || 'Impor RAP: tahapan baru, bobot diusulkan dari porsi nilai',
    })
  }
  const stages = new Map((await projectStages(req, p.id)).filter((s) => s.active).map((s) => [stageKey(s.name), s.id]))
  const byCode = new Map(d.existing.map((e) => [key(e.code), e]))
  await withReason(req, opts.reason, async () => {
    for (const [i, r] of rows.entries()) {
      const data = {
        code: r.code.trim(),
        description: r.description,
        stage: r.stageName.trim() ? (stages.get(stageKey(r.stageName)) ?? null) : null,
        uom: d.uoms.get(key(normUom(r.uomCode)))!,
        volume: round2(r.volume),
        unitPrice: r.unitPrice,
        weightPct: r.weightPct,
        sortOrder: i + 1,
        active: true,
      }
      const e = byCode.get(key(r.code))
      if (!e) {
        await req.payload.create({ collection: 'rap-items', data: { ...data, project: p.id, kind: r.kind } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: RAP import after the checks */, req })
      } else if (d.out[i]!.status === 'changed') {
        await req.payload.update({ collection: 'rap-items', id: e.id, data: data as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: RAP import after the checks */, req })
      }
    }
    for (const x of d.deactivated) {
      const e = byCode.get(key(x.code))!
      await req.payload.update({ collection: 'rap-items', id: e.id, data: { active: false } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: item missing from the import → deactivated (never deleted) */, req })
    }
  })
  await refreshRapProgress(req, p.id)
}

/** POST /projects/{id}/rap/import/commit — same file as the preview (sha256), else 409. Idempotent by code. */
export async function commitRapImport(req: PayloadRequest, projectId: number, bytes: Uint8Array, opts: { fileHash: string; reason?: string | null }) {
  const p = await loadProjectFor(req, projectId)
  const ed = await requireEditor(req, p, opts.reason)
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (hash !== opts.fileHash) fail(409, 'FILE_CHANGED', 'File berbeda dari yang dipratinjau. Ulangi pratinjau.', 'fileHash')
  const parsed = parseRapWorkbook(bytes)
  if (parsed.issues.length) validation(parsed.issues.map((i) => ({ path: i.row ? `rows.${i.row}` : 'file', message: i.row ? `Baris ${i.row}: ${i.message}` : i.message })))
  await lockProject(req, projectId)
  await applyRows(req, p, parsed.rows, { removeMissing: true, reason: ed.reason, roles: ed.roles })
  return loadRap(req, projectId)
}

/** POST /projects/{id}/rap/apply-template — only on a project without RAP items. */
export async function applyRapTemplate(req: PayloadRequest, projectId: number, templateId: number) {
  const p = await loadProjectFor(req, projectId)
  const ed = await requireEditor(req, p, null)
  await lockProject(req, projectId)
  if ((await itemRows(req, p)).length > 0) fail(409, 'STATE_CONFLICT', 'Template hanya dapat dipakai pada project yang belum punya RAP.', 'templateId')
  const t = (await req.payload.findByID({ collection: 'rap-templates', id: templateId, depth: 0, overrideAccess: true /* SYSTEM-READ: PT checked below */, req, disableErrors: true })) as Record<string, unknown> | null
  if (!t || t.active === false || relId(t.company) !== p.company) fail(400, 'VALIDATION', 'Template RAP tidak ditemukan atau nonaktif.', 'templateId')
  // DRMS 10/10 D4: a template of another project kind does not fit (stages / items of that business)
  if (typeof t!.projectKind === 'string' && t!.projectKind !== kindOf(p.kind)) {
    fail(400, 'VALIDATION', `Template RAP ini untuk project jenis ${PROJECT_KIND_LABELS[kindOf(t!.projectKind)]}.`, 'templateId')
  }
  const rows: RapRow[] = ((t!.items as Array<Record<string, unknown>> | null) ?? []).map((x, i) => ({
    row: i + 1,
    code: String(x.code),
    description: String(x.description),
    stageName: typeof x.stageName === 'string' ? x.stageName : '',
    kind: x.kind as RapKind,
    uomCode: String(x.uomCode),
    volume: Number(x.volume),
    unitPrice: typeof x.unitPrice === 'number' ? x.unitPrice : null,
    weightPct: typeof x.weightPct === 'number' ? x.weightPct : null,
  }))
  if (!rapDrivesProgress(kindOf(p.kind))) {
    // outside konstruksi the stage is only a grouping: a template stage this project does not have is dropped
    const own = new Set((await projectStages(req, p.id)).filter((s) => s.active).map((s) => stageKey(s.name)))
    for (const r of rows) if (!own.has(stageKey(r.stageName))) r.stageName = ''
  }
  await applyRows(req, p, rows, { removeMissing: false, reason: '', roles: ed.roles })
  return loadRap(req, projectId)
}

/** POST /projects/{id}/rap/save-template — the project's ACTIVE items as a template of the same PT. */
export async function saveRapAsTemplate(req: PayloadRequest, projectId: number, name: string): Promise<{ id: number; name: string; items: number }> {
  const p = await loadProjectFor(req, projectId)
  const roles = await rapRoles(req, p)
  if (!roles.director && !roles.pm) fail(403, 'FORBIDDEN', 'Template RAP hanya oleh Direktur/Admin atau PM project ini.')
  const title = name.trim()
  if (title.length < 3 || title.length > 128) fail(400, 'VALIDATION', 'Nama template 3–128 karakter.', 'name')
  const items = (await itemRows(req, p)).filter((r) => r.active !== false)
  if (items.length === 0) fail(409, 'STATE_CONFLICT', 'RAP project ini masih kosong.')
  const doc = await req.payload.create({
    collection: 'rap-templates',
    data: {
      company: p.company,
      name: title,
      projectKind: kindOf(p.kind),
      active: true,
      items: items.map((r) => ({ code: r.code, description: r.description, stageName: r.stage_name, kind: r.kind, uomCode: r.uom_code, volume: num(r.volume), unitPrice: numN(r.unit_price), weightPct: numN(r.weight_pct) })),
    } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: template of the project's PT after the role check
    req,
  })
  return { id: doc.id as number, name: title, items: items.length }
}

/** Uom codes for the template dropdown (shared master). */
export async function activeUomCodes(req: PayloadRequest): Promise<string[]> {
  const res = await req.payload.find({ collection: 'uoms', where: { active: { not_equals: false } }, depth: 0, pagination: false, sort: 'code', overrideAccess: true /* SYSTEM-READ: shared master */, req })
  return res.docs.map((d) => String((d as { code?: unknown }).code ?? '')).filter(Boolean)
}

export type RapTemplateOption = { id: number; name: string; items: number; projectKind: string | null }

/** Active RAP templates of the project's PT that fit its kind (same kind or "any kind") — web "Pakai template". */
export async function rapTemplatesFor(req: PayloadRequest, projectId: number): Promise<RapTemplateOption[]> {
  const p = await loadProjectFor(req, projectId)
  const res = await req.payload.find({
    collection: 'rap-templates',
    where: { and: [{ company: { equals: p.company } }, { active: { not_equals: false } }, { or: [{ projectKind: { equals: kindOf(p.kind) } }, { projectKind: { exists: false } }] }] },
    sort: 'name',
    depth: 0,
    pagination: false,
    overrideAccess: true, // SYSTEM-READ: templates of the visible project's PT (applying re-checks the editor role)
    req,
  })
  return (res.docs as Array<{ id: number; name?: string; items?: unknown[] | null; projectKind?: string | null }>).map((d) => ({ id: d.id, name: d.name ?? '', items: d.items?.length ?? 0, projectKind: d.projectKind ?? null }))
}
