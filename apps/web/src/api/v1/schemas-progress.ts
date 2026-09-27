import { z } from 'zod'

/**
 * /api/v1 contract for E4: project stages (G11 editor), progress reports (T11, US-10/US-31) and the
 * K-09 progress-vs-budget data (US-12). Percentages have ≤ 2 decimals; business dates 'YYYY-MM-DD'
 * (company TZ); server timestamps ISO-8601 UTC. Pure module (bundled by scripts/gen-openapi.mjs).
 */
const id = z.number().int().positive()
const pct = z
  .number()
  .min(0)
  .max(100)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'maks. 2 desimal')
const businessDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'YYYY-MM-DD')
const reason = z.string().trim().min(3).max(1000)

export const MAX_PHOTOS_PER_REPORT = 5

// ---------------------------------------------------------------- stages

export const StageInput = z
  .object({
    id: id.optional().meta({ description: 'Existing stage id; omit for a new stage (Direktur only).' }),
    name: z.string().trim().min(1).max(128),
    weightPct: pct.meta({ description: 'Bobot (%); the ACTIVE set must total exactly 100.' }),
    sequence: z.number().int().min(1).max(999),
  })
  .strict()
  .meta({ id: 'StageInput' })

export const StageSetBody = z
  .object({
    stages: z.array(StageInput).min(1).max(100).optional().meta({ description: 'The whole active set. Existing stages missing here are deactivated (Direktur only).' }),
    templateId: id.optional().meta({ description: 'Apply a stage template to a project without stages (instead of `stages`).' }),
    reason: reason.optional().meta({ description: 'Required when a weight changes or a stage is (de)activated (G7).' }),
  })
  .strict()
  .meta({ id: 'StageSetBody' })

export const Stage = z
  .object({ id, name: z.string(), weightPct: z.number(), sequence: z.number().int(), progressPct: z.number(), active: z.boolean() })
  .meta({ id: 'ProjectStage' })

export const StageSet = z
  .object({
    projectId: id,
    weightSum: z.number().meta({ description: 'Σ weights of active stages.' }),
    complete: z.boolean().meta({ description: 'weightSum = 100 → progress reports can be created.' }),
    progressPct: z.number().meta({ description: 'Project physical progress = Σ(weight × stage %) / 100.' }),
    stages: z.array(Stage),
  })
  .meta({ id: 'ProjectStageSet' })

// ---------------------------------------------------------------- progress reports

export const ProgressReportCreate = z
  .object({
    projectId: id,
    stageId: id,
    pctAfter: pct.meta({ description: 'Stage progress after this report (%); never below the current stage %.' }),
    work: z.string().trim().min(3).max(2000).meta({ description: 'Pekerjaan.' }),
    issues: z.string().trim().max(2000).nullable().optional().meta({ description: 'Kendala.' }),
    photoIds: z.array(id).max(MAX_PHOTOS_PER_REPORT).optional().meta({ description: 'media-progress-photos ids uploaded by the caller (POST /media/progress-photos), max 5.' }),
    clientUuid: z.uuid().optional().meta({ description: 'Client id; a replay returns the existing report (200).' }),
  })
  .strict()
  .meta({ id: 'ProgressReportCreate' })

export const ProgressReportUpdate = z
  .object({
    pctAfter: pct.optional().meta({ description: 'Correction; only on the latest report of the stage, never below pctBefore.' }),
    work: z.string().trim().min(3).max(2000).optional(),
    issues: z.string().trim().max(2000).nullable().optional(),
    addPhotoIds: z.array(id).max(MAX_PHOTOS_PER_REPORT).optional().meta({ description: 'Photos to add (total per report ≤ 5).' }),
    reason: reason.meta({ description: 'Required for every edit (requirements §8 T11).' }),
  })
  .strict()
  .meta({ id: 'ProgressReportUpdate' })

export const ProgressReportListQuery = z
  .object({
    project: z.coerce.number().int().positive().optional(),
    stage: z.coerce.number().int().positive().optional(),
    from: businessDate.optional(),
    to: businessDate.optional(),
    mine: z.enum(['1', 'true']).optional().meta({ description: 'Only reports created by the caller.' }),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().max(64).optional(),
  })
  .meta({ id: 'ProgressReportListQuery' })

export const ProgressPhoto = z
  .object({
    id,
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    filesize: z.number().int().nullable(),
    url: z.string().meta({ description: 'GET (auth) — /api/v1/media/progress-photos/{id}/file' }),
    thumbUrl: z.string(),
  })
  .meta({ id: 'ProgressPhoto' })

export const ProgressReport = z
  .object({
    id,
    uuid: z.string().nullable(),
    docNo: z.string().nullable().meta({ description: 'LP/YYMM/####' }),
    project: z.object({ id, code: z.string().nullable(), name: z.string().nullable() }),
    stage: z.object({ id, name: z.string().nullable(), weightPct: z.number().nullable() }),
    reportDate: z.string().meta({ description: 'Business date (company TZ) of the time that counts.' }),
    pctBefore: z.number(),
    pctAfter: z.number(),
    projectPctBefore: z.number().nullable(),
    projectPctAfter: z.number().nullable(),
    work: z.string(),
    issues: z.string().nullable(),
    reporter: z.object({ id, name: z.string().nullable() }),
    photos: z.array(ProgressPhoto),
    offline: z.boolean(),
    timeTrust: z.enum(['server', 'estimated', 'device_only']),
    source: z.enum(['web', 'apk']).nullable(),
    flags: z.array(z.string()),
    receivedAt: z.string().nullable(),
    editableUntil: z.string().nullable(),
    editable: z.boolean().meta({ description: 'The caller is the reporter and the 24 h window is open.' }),
    rev: z.number().int().meta({ description: 'Content revision (sync base_rev).' }),
    clientUuid: z.string().nullable(),
    createdAt: z.string().nullable(),
  })
  .meta({ id: 'ProgressReport' })

export const ProgressReportList = z
  .object({ items: z.array(ProgressReport), nextCursor: z.string().nullable() })
  .meta({ id: 'ProgressReportList' })

// ---------------------------------------------------------------- K-09

export const ProjectProgressQuery = z
  .object({
    project: z.coerce.number().int().positive().optional(),
    arsip: z.enum(['ya']).optional().meta({ description: 'Include archived projects.' }),
  })
  .meta({ id: 'ProjectProgressQuery' })

export const ProjectProgressItem = z
  .object({
    id,
    code: z.string(),
    name: z.string(),
    status: z.string(),
    budget: z.number().nullable(),
    committed: z.number().meta({ description: 'K-07 Komitmen (Rp).' }),
    budgetPct: z.number().nullable().meta({ description: 'K-08 % of RAB (null = no RAB).' }),
    budgetTone: z.enum(['none', 'ok', 'warn', 'over']),
    progressPct: z.number().meta({ description: 'Physical progress (%).' }),
    weightSum: z.number(),
    stagesComplete: z.boolean(),
    gap: z.number().nullable().meta({ description: 'K-09 selisih = budgetPct − progressPct (null = not computable).' }),
    tone: z.enum(['none', 'ok', 'warn', 'bad']).meta({ description: 'ok (hijau) ≤ warnGapPct · warn (kuning) ≤ badGapPct · bad (merah) > badGapPct.' }),
    toneLabel: z.string(),
    lastReportDate: z.string().nullable(),
    reportCount: z.number().int(),
  })
  .meta({ id: 'ProjectProgressItem' })

export const ProjectProgressList = z
  .object({ asOf: z.string(), warnGapPct: z.number(), badGapPct: z.number(), projects: z.array(ProjectProgressItem) })
  .meta({ id: 'ProjectProgressList' })
