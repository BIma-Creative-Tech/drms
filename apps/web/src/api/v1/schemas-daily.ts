import { z } from 'zod'

import { companyFilterParam, createCompanyField } from './schemas'

/**
 * /api/v1 contract of P3 "Konstruksi: RAP + Laporan Harian" (owner decisions 2026-10-10). Business dates
 * 'YYYY-MM-DD' (company TZ), quantities max. 2 decimals, money integer Rupiah. RAP prices/values are
 * absent for callers without the price roles (Direktur, Admin, Finance, PM of the project). Pure module
 * (bundled by scripts/gen-openapi.mjs).
 */
const id = z.number().int().positive()
const businessDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'YYYY-MM-DD')
const dec2 = (min: number, max: number) =>
  z
    .number()
    .min(min)
    .max(max)
    .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'maks. 2 desimal')
const qty0 = dec2(0, 100_000_000)
const hours = dec2(0, 24)
const optText = (max: number) => z.string().trim().max(max).nullable().optional()
const reason = z.string().trim().min(3).max(1000)
const clientUuid = z.uuid().optional().meta({ description: 'Client id; a replay by the same reporter returns the existing report (200); another user → 409 CLIENT_UUID_CONFLICT.' })

export const RapKindEnum = z.enum(['pekerjaan', 'material']).meta({ id: 'RapKind', description: 'pekerjaan counts toward the stage %; material only masuk / terpakai / stok.' })
export const WeatherEnum = z.enum(['cerah', 'berawan', 'hujan']).meta({ id: 'Weather' })
export const LineKindEnum = z.enum(['work', 'material_in', 'material_used']).meta({ id: 'DailyLineKind' })
export const LineOriginEnum = z.enum(['report', 'edit', 'correction']).meta({ id: 'DailyLineOrigin' })

// ---------------------------------------------------------------- RAP

const rapItemFields = {
  code: z.string().trim().min(1).max(32).meta({ description: 'Unique per project (409 DUPLICATE_CODE).' }),
  description: z.string().trim().min(1).max(300),
  stageId: id.nullable().optional().meta({ description: 'Stage of the same project. Required for konstruksi (400 stageId); other kinds may omit it (DRMS 10/10 D4) and clear it with null.' }),
  kind: RapKindEnum,
  uomId: id,
  volume: dec2(0.01, 100_000_000),
  unitPrice: z.number().int().min(0).max(1e13).nullable().optional(),
  weightPct: dec2(0, 100).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
}
const lockReason = reason.optional().meta({ description: 'Required once the RAP is locked (any daily-report realisation): Direktur/Admin only (409 RAP_LOCKED otherwise).' })

export const RapItemCreate = z.object({ ...rapItemFields, reason: lockReason }).strict().meta({ id: 'RapItemCreate' })
export const RapItemUpdate = z
  .object({
    code: rapItemFields.code.optional(),
    description: rapItemFields.description.optional(),
    stageId: rapItemFields.stageId,
    kind: RapKindEnum.optional().meta({ description: 'Cannot change (400).' }),
    uomId: id.optional(),
    volume: rapItemFields.volume.optional(),
    unitPrice: rapItemFields.unitPrice,
    weightPct: rapItemFields.weightPct,
    sortOrder: rapItemFields.sortOrder,
    active: z.boolean().optional().meta({ description: 'false = deactivate (items are never deleted).' }),
    reason: reason.optional().meta({
      description:
        'Required (min. 3) once the RAP is locked (any daily-report realisation: Direktur/Admin only, 409 RAP_LOCKED otherwise) and — owner 2026-10-13 — for ANY change of a used item ("Sudah terpakai": expense lines from the final approval onward or daily-report quantities), every editor role (400 field `reason`). Written to the audit log.',
    }),
  })
  .strict()
  .meta({ id: 'RapItemUpdate' })

/** D4 (DRMS 10/10): plan vs realisation in money (price roles only). */
export const RapBudget = z
  .object({
    planned: z.number().nullable().meta({ description: 'Σ planned of the priced items (null: no item priced).' }),
    realised: z.number().meta({ description: 'Σ line totals from the final approval onward.' }),
    transferred: z.number(),
    verified: z.number(),
    remaining: z.number().nullable(),
    percent: z.number().nullable(),
    overBudget: z.boolean(),
    overBudgetItems: z.number().int(),
  })
  .meta({ id: 'RapBudget' })

export const RapItem = z
  .object({
    id,
    code: z.string(),
    description: z.string(),
    name: z.string().meta({ description: 'DRMS 10/10: alias of description.' }),
    kind: RapKindEnum,
    stage: z.object({ id, name: z.string() }).nullable().meta({ description: 'null: item without stage (allowed outside konstruksi, DRMS 10/10 D4).' }),
    uom: z.object({ id, code: z.string() }),
    volume: z.number(),
    qty: z.number().meta({ description: 'DRMS 10/10: alias of volume.' }),
    unitPrice: z.number().nullable().optional().meta({ description: 'Price roles only.' }),
    value: z.number().nullable().optional().meta({ description: 'volume × unitPrice (price roles only).' }),
    planned: z.number().nullable().optional().meta({ description: 'D4 (price roles only): planned amount = round(volume × unitPrice); null when unpriced.' }),
    realisedAmount: z.number().optional().meta({ description: 'D4 (price roles only): Σ line totals of requests charged to this item from the final approval onward. (`realised` = realised QUANTITY of the daily reports.)' }),
    transferredAmount: z.number().optional().meta({ description: 'D4 (price roles only): Σ line totals of requests already transferred.' }),
    verifiedAmount: z.number().optional().meta({ description: 'D4 (price roles only): Σ valid receipts of those lines after LPJ / receipt verification.' }),
    remaining: z.number().nullable().optional().meta({ description: 'D4 (price roles only): planned − realisedAmount.' }),
    percent: z.number().nullable().optional().meta({ description: 'D4 (price roles only): realisedAmount / planned × 100 (2 decimals).' }),
    overBudget: z.boolean().optional().meta({ description: 'D4 (price roles only): realisedAmount > planned ("Melebihi RAP").' }),
    weightPct: z.number().nullable(),
    sortOrder: z.number(),
    realised: z.number().meta({ description: 'Σ work volume of the daily reports (pekerjaan).' }),
    received: z.number(),
    used: z.number(),
    stock: z.number().nullable().meta({ description: 'material: received − used.' }),
    pct: z.number().nullable().meta({ description: 'pekerjaan: min(realised / volume, 1) × 100.' }),
    overRap: z.boolean(),
    active: z.boolean(),
  })
  .meta({ id: 'RapItem' })

export const Rap = z
  .object({
    projectId: id,
    kind: z.string(),
    rapRequired: z.boolean().meta({ description: 'DRMS 10/10 D4 (owner 2026-10-11): the project has a RAB (or is konstruksi) → it needs ≥ 1 active item before a request can be submitted ("Project belum punya RAP — hubungi PM").' }),
    drivesProgress: z.boolean().meta({ description: 'konstruksi only: work items drive the stage % (daily reports). Other kinds: cost plan only, stage optional, progress manual.' }),
    locked: z.boolean(),
    canEdit: z.boolean(),
    needsReason: z.boolean(),
    items: z.array(RapItem),
    stages: z.array(
      z.object({
        id,
        name: z.string(),
        weightPct: z.number(),
        progressPct: z.number(),
        active: z.boolean(),
        progressMode: z.enum(['manual', 'rap']),
        basis: z.enum(['value', 'equal', 'none']).meta({ description: 'value = weighted by volume × price (all work items priced), equal otherwise.' }),
        workItems: z.number().int(),
      }),
    ),
    totals: z.object({ rapValue: z.number().nullable(), budget: z.number().nullable(), overBudget: z.boolean() }).nullable().meta({ description: 'Price roles only.' }),
    budget: RapBudget.nullable().meta({ description: 'D4 (price roles only): Σ plan vs realisation of the items.' }),
    resourceTypes: z.array(z.object({ id, kind: z.enum(['tenaga', 'alat']), code: z.string(), name: z.string() })).meta({ description: 'Active manpower / equipment types of the project\'s PT (daily report pickers; APK cache).' }),
  })
  .meta({ id: 'Rap' })

export const RapImportCommit = z
  .object({ fileHash: z.string().regex(/^[0-9a-f]{64}$/), reason: reason.optional().meta({ description: 'Required (min. 3) on a locked RAP (Direktur/Admin only) and when the file changes / deactivates a used item (preview `usedChanged`).' }) })
  .strict()
  .meta({ id: 'RapImportCommit', description: 'multipart: field "file" (.xlsx) + "_payload" (this JSON). fileHash = the preview\'s sha256 (409 FILE_CHANGED).' })

export const RapPreview = z
  .object({
    fileHash: z.string(),
    locked: z.boolean(),
    rows: z.array(z.object({ row: z.number().int(), code: z.string(), status: z.enum(['new', 'changed', 'unchanged']), changes: z.array(z.string()) })),
    deactivated: z.array(z.object({ code: z.string(), description: z.string(), hasRealisation: z.boolean() })),
    usedChanged: z.array(z.string()).meta({ description: 'Codes of used items ("Sudah terpakai") the file changes or deactivates — the commit then needs `reason` (400 field `reason`).' }),
    newStages: z.array(z.string()),
    issues: z.array(z.object({ row: z.number().int().optional(), column: z.string().optional(), message: z.string() })),
    counts: z.object({ new: z.number().int(), changed: z.number().int(), unchanged: z.number().int(), deactivated: z.number().int() }),
  })
  .meta({ id: 'RapPreview' })

export const RapApplyTemplate = z.object({ templateId: id }).strict().meta({ id: 'RapApplyTemplate' })
export const RapSaveTemplate = z.object({ name: z.string().trim().min(3).max(128) }).strict().meta({ id: 'RapSaveTemplate' })
export const RapTemplateSaved = z.object({ id, name: z.string(), items: z.number().int() }).meta({ id: 'RapTemplateSaved' })

// ---------------------------------------------------------------- daily reports

const Work = z.object({ rapItemId: id, qty: qty0 }).strict().meta({ id: 'DailyWorkIn', description: 'Volume pekerjaan today (item kind pekerjaan). 0 removes a booked value on edit.' })
const Material = z.object({ rapItemId: id, received: qty0.optional(), used: qty0.optional() }).strict().meta({ id: 'DailyMaterialIn' })
const Resource = z
  .object({ resourceTypeId: id, count: z.number().int().min(1).max(9999), hours: hours.nullable().optional() })
  .strict()
  .meta({ id: 'DailyResourceIn', description: 'resource-types of the PT (tenaga for manpower, alat for equipment).' })
const Weather = z.object({ morning: WeatherEnum.nullable().optional(), noon: WeatherEnum.nullable().optional(), afternoon: WeatherEnum.nullable().optional() }).strict()

const dailyContent = {
  weather: Weather.optional(),
  rainHours: hours.nullable().optional(),
  stopHours: hours.nullable().optional(),
  work: z.array(Work).max(300).optional(),
  materials: z.array(Material).max(300).optional(),
  manpower: z.array(Resource).max(60).optional(),
  equipment: z.array(Resource).max(60).optional(),
  issues: optText(2000).meta({ description: 'Kendala.' }),
  notes: optText(2000).meta({ description: 'Required when a work item goes above its RAP volume (400 OVER_RAP_NOTE_REQUIRED).' }),
}

export const DailyReportCreate = z
  .object({
    company: createCompanyField,
    projectId: id.meta({ description: 'Project of kind konstruksi (else 409 WRONG_PROJECT_KIND).' }),
    reportDate: businessDate.optional().meta({ description: 'Default: today (company TZ). Not in the future, ≤ 14 days back. One per project, reporter and date (409 DAILY_EXISTS).' }),
    ...dailyContent,
    photoIds: z.array(id).max(10).optional(),
    clientUuid,
  })
  .strict()
  .meta({ id: 'DailyReportCreate' })

const dailyPatch = { ...dailyContent, addPhotoIds: z.array(id).max(10).optional().meta({ description: 'Photos to add (total ≤ 10).' }) }

export const DailyReportUpdate = z
  .object({ ...dailyPatch, reason: reason.optional() })
  .strict()
  .meta({ id: 'DailyReportUpdate', description: 'Reporter within 24 h. work/materials, when sent, are the full new values of the listed items; the difference is booked to the ledger (origin edit).' })

export const DailyReportCorrection = z
  .object({ ...dailyPatch, reason: reason.meta({ description: 'Required: PM of the project team or the Direktur, any time (ledger origin correction, flag CORRECTED).' }) })
  .strict()
  .meta({ id: 'DailyReportCorrection' })

export const DailyReportListQuery = z
  .object({
    project: z.coerce.number().int().positive().optional(),
    reporter: z.coerce.number().int().positive().optional(),
    from: businessDate.optional(),
    to: businessDate.optional(),
    mine: z.enum(['1', 'true']).optional(),
    q: z.string().trim().max(100).optional().meta({ description: 'DRMS 10/10 D8 text search: number, issues, notes (every word must match).' }),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().max(64).optional(),
    company: companyFilterParam,
  })
  .meta({ id: 'DailyReportListQuery' })

const Ref = z.object({ id, name: z.string().nullable() })
const ItemRef = z.object({ id, code: z.string(), description: z.string(), kind: z.string(), uom: z.string() })
const Photo = z.object({ id, width: z.number().int().nullable(), height: z.number().int().nullable(), filesize: z.number().int().nullable(), url: z.string(), thumbUrl: z.string() })

export const DailyReport = z
  .object({
    id,
    uuid: z.string().nullable(),
    companyId: id.nullable(),
    docNo: z.string().nullable().meta({ description: 'LH/YYMM/####' }),
    project: z.object({ id, code: z.string().nullable(), name: z.string().nullable(), kind: z.string().nullable() }),
    reportDate: z.string(),
    reporter: Ref,
    weather: z.object({ morning: WeatherEnum.nullable(), noon: WeatherEnum.nullable(), afternoon: WeatherEnum.nullable() }),
    rainHours: z.number().nullable(),
    stopHours: z.number().nullable(),
    work: z.array(z.object({ item: ItemRef, qty: z.number() })),
    materials: z.array(z.object({ item: ItemRef, received: z.number(), used: z.number() })),
    manpower: z.array(z.object({ resourceTypeId: id, name: z.string(), count: z.number().int(), hours: z.number().optional() })),
    equipment: z.array(z.object({ resourceTypeId: id, name: z.string(), count: z.number().int(), hours: z.number().optional() })),
    workerCount: z.number().int(),
    issues: z.string().nullable(),
    notes: z.string().nullable(),
    photos: z.array(Photo),
    offline: z.boolean(),
    timeTrust: z.enum(['server', 'estimated', 'device_only']),
    source: z.enum(['web', 'apk']).nullable(),
    flags: z.array(z.string()).meta({ description: 'MELEBIHI_RAP, POSSIBLE_DUPLICATE, BACKDATED, CORRECTED, OFFLINE, DEVICE_TIME_ONLY, CLOCK_SKEW.' }),
    receivedAt: z.string().nullable(),
    editableUntil: z.string().nullable(),
    editable: z.boolean(),
    correctedAt: z.string().nullable(),
    correctedBy: Ref.nullable(),
    rev: z.number().int(),
    clientUuid: z.string().nullable(),
    createdAt: z.string().nullable(),
    ledger: z
      .array(z.object({ id, item: ItemRef, kind: LineKindEnum, qty: z.number(), origin: LineOriginEnum, reason: z.string().nullable(), by: Ref, at: z.string() }))
      .optional()
      .meta({ description: 'Detail only: every ledger line (append-only history).' }),
  })
  .meta({ id: 'DailyReport' })

export const DailyReportList = z.object({ items: z.array(DailyReport), nextCursor: z.string().nullable() }).meta({ id: 'DailyReportList' })

export const DailyRecap = z
  .object({
    project: z.object({ id, startDate: z.string() }),
    weeks: z.array(z.object({ week: z.number().int(), from: z.string(), to: z.string(), reports: z.number().int(), workerDays: z.number().int(), rainHours: z.number(), stopHours: z.number() })),
    items: z.array(z.object({ id, code: z.string(), description: z.string(), uom: z.string(), volume: z.number(), perWeek: z.record(z.string(), z.number()), realised: z.number(), pct: z.number() })),
  })
  .meta({ id: 'DailyRecap', description: '"Minggu ke-N": Mon–Sun weeks from the project start.' })
