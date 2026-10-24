import { z } from 'zod'

/**
 * F4 — APK offline sync + app gate (ADR 0010 "Sync contract", decision 13). Pure module (bundled by
 * scripts/gen-openapi.mjs).
 *
 * The sync envelope keeps the ADR's snake_case field names (`batch_id`, `client_uuid`, …) so the
 * contract in ADR 0010 and this schema read the same. Entity ids are the numeric server ids of the
 * rest of /api/v1 (masters, media uploads); receipts reference an image uploaded beforehand with
 * POST /api/v1/media/receipts (`media_id`).
 */
const id = z.number().int().positive()
const rupiah = z.number().int().min(0).max(1e13)
const rupiahPos = z.number().int().min(1).max(1e13)
const businessDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'YYYY-MM-DD')
const dateTime = z.iso.datetime({ offset: true })
const qty = z
  .number()
  .positive()
  .max(1e9)
  .refine((v) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6, 'maks. 3 desimal')

export const SYNC_MAX_ITEMS = 50
export const SYNC_MAX_BYTES = 256 * 1024

export const SyncItemTypeEnum = z
  .enum([
    'attendance.check_in',
    'attendance.check_out',
    'attendance.on_behalf',
    'expense_request.draft_upsert',
    'expense_request.draft_delete',
    'progress_report.draft_upsert',
    'service_report.upsert',
    'unit_timesheet.upsert',
    'aftersales_activity.upsert',
    'daily_report.upsert',
  ])
  .meta({
    id: 'SyncItemType',
    description:
      'attendance.on_behalf (US-14, E6): PM only. progress_report.draft_upsert (E4) = create or edit (≤ 24 h) of a progress report (company-settings.syncProgressReportsEnabled). FR1 (ADR 0020): service_report.upsert / unit_timesheet.upsert / aftersales_activity.upsert = create or edit (reporter, ≤ 24 h) of a field report (companies.fieldReportsEnabled; creates otherwise FEATURE_DISABLED). P3: daily_report.upsert = Laporan harian of a konstruksi project (same rules).',
  })
export type SyncItemType = z.infer<typeof SyncItemTypeEnum>

export const SyncClock = z
  .object({
    device_time: dateTime.meta({ description: 'Device wall clock at send time (with offset). Comparison only.' }),
    elapsed_ms: z.number().int().min(0).meta({ description: 'Android monotonic time since boot at send time.' }),
    boot_id: z.string().min(1).max(64),
    last_server_time: dateTime.nullable().optional().meta({ description: 'server_time of the last successful online call on this boot.' }),
    last_server_elapsed_ms: z.number().int().min(0).nullable().optional().meta({ description: 'elapsed_ms recorded together with last_server_time.' }),
  })
  .strict()
  .meta({ id: 'SyncClock' })

export const SyncReceiptInput = z
  .object({
    client_uuid: z.uuid().meta({ description: 'APK id of the receipt (stable across edits).' }),
    receipt_no: z.string().max(64).nullable().optional(),
    vendor_name: z.string().trim().min(1).max(160),
    vendor_id: id.nullable().optional(),
    receipt_date: businessDate,
    receipt_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).nullable().optional(),
    amount: rupiahPos.meta({ description: 'Total PRINTED on the receipt.' }),
    tax_amount: rupiah.nullable().optional(),
    media_id: id.meta({ description: 'media-receipts id uploaded by the caller (POST /api/v1/media/receipts). Cannot change once synced.' }),
  })
  .strict()
  .meta({ id: 'SyncReceiptInput' })

export const SyncLineInput = z
  .object({
    id: z.string().min(1).max(64).optional().meta({ description: 'Server line id (lines that came from the server).' }),
    client_uuid: z.uuid().optional().meta({ description: 'APK id of a new line; becomes the server line id.' }),
    description: z.string().max(500).optional(),
    qty: qty.nullable().optional(),
    uom_id: id.nullable().optional(),
    unit_price: rupiah.nullable().optional().meta({ description: 'D3: required to submit; total = qty × unit_price (qty empty = 1), computed by the server.' }),
    total: rupiahPos.nullable().optional().meta({ description: 'Ignored when unit_price is sent (D3). Old apps sending only total: unit_price = total ÷ qty when exact.' }),
    receipt_amount: rupiah.nullable().optional().meta({ description: 'D3 "Nominal sesuai nota" (optional).' }),
    notes: z.string().max(500).nullable().optional(),
    category_id: id.nullable().optional(),
    vehicle_id: id.nullable().optional(),
    rap_item_id: id.nullable().optional().meta({ description: 'D4: RAP item of the request project (rap-items id). Required to submit when the project has a RAP. Omitted (old apps) = the line keeps its stored item.' }),
    receipts: z.array(SyncReceiptInput).max(20).optional().meta({ description: 'Reimburse drafts only. Upserted by client_uuid; receipts missing here are NOT removed.' }),
  })
  .strict()
  .meta({ id: 'SyncLineInput' })

export const SyncDraftUpsertPayload = z
  .object({
    request_id: id.optional().meta({ description: 'Server id of a draft created online.' }),
    draft_client_uuid: z.uuid().optional().meta({ description: 'APK id of the draft (default: the item client_uuid, i.e. the item that created it).' }),
    kind: z.enum(['advance', 'reimburse']).optional().meta({ description: 'Required for a new draft. advance = Pengajuan Baru.' }),
    title: z.string().trim().min(1).max(200).optional().meta({ description: 'Required for a new draft.' }),
    project_id: id.nullable().optional(),
    cost_center_id: id.nullable().optional().meta({ description: 'D2: ignored for employee payments (Finance sets the cost center at the transfer; still accepted so older apps keep working). ADR 0027: the cost center of a vendor payment without a project.' }),
    needed_date: businessDate.nullable().optional(),
    urgency_level_id: id.nullable().optional().meta({ description: 'urgency-levels id of the request PT (owner decision 2026-10-09).' }),
    period_from: businessDate.nullable().optional().meta({ description: 'Ignored since 2026-10-09: "Periode kegiatan" was replaced by the urgency level. Still accepted so older apps keep working.' }),
    period_to: businessDate.nullable().optional().meta({ description: 'Ignored since 2026-10-09: "Periode kegiatan" was replaced by the urgency level. Still accepted so older apps keep working.' }),
    notes: z.string().max(2000).nullable().optional(),
    requester_ids: z.array(id).max(20).optional(),
    bank_account_id: id.nullable().optional(),
    // ADR 0027 "Pembayaran vendor" (Staff / Finance / PM; kind is set to advance by the server)
    payee_type: z.enum(['karyawan', 'vendor', 'pt_grup']).optional().meta({ description: 'ADR 0027: default karyawan. vendor = vendor payment (Staff / Finance / PM; Staff since 2026-10-16): vendor + vendor account + invoice, no employee account, no LPJ. ADR 0028: pt_grup = payment to another PT of the group (Finance / PM / Direktur): payee_company_id + the receiving PT\'s document (invoice_*), no LPJ. Omitted on an existing draft = the stored payee type stays (older apps never reset a pt_grup draft).' }),
    payee_company_id: id.nullable().optional().meta({ description: 'ADR 0028: receiving PT of a pt_grup draft (masters type intercompany-payees / GET /intercompany/payees). Omitted = unchanged.' }),
    vendor_id: id.nullable().optional(),
    vendor_bank_account_id: id.nullable().optional().meta({ description: 'ADR 0027: an active account of vendor_id (masters type vendor-bank-accounts).' }),
    invoice_no: z.string().trim().max(64).nullable().optional().meta({ description: 'ADR 0027: unique per vendor among live requests (else VALIDATION / 409 errors[invoiceNo]).' }),
    invoice_date: businessDate.nullable().optional(),
    invoice_due_date: businessDate.nullable().optional(),
    invoice_file_id: id.nullable().optional().meta({ description: 'ADR 0027: media-attachments id of the invoice (POST /media/attachments).' }),
    attachment_ids: z.array(id).max(20).optional().meta({ description: 'D2410: general attachments ("Lampiran", media-attachments ids — POST /media/attachments; photo / PDF). Replaces the list; omitted = unchanged. A Reimburse needs at least one to be submitted.' }),
    client_grand_total: rupiah.nullable().optional().meta({ description: 'Advisory; mismatch with the server total → flag CLIENT_TOTAL_MISMATCH.' }),
    lines: z.array(SyncLineInput).max(200).optional().meta({ description: 'Replaces ALL lines when present.' }),
  })
  .strict()
  .meta({ id: 'SyncDraftUpsertPayload', description: 'Omitted fields stay unchanged on an existing draft.' })
export type SyncDraftUpsert = z.infer<typeof SyncDraftUpsertPayload>

export const SyncDraftDeletePayload = z
  .object({
    request_id: id.optional(),
    draft_client_uuid: z.uuid().optional(),
    reason: z.string().trim().min(3).max(1000).optional().meta({ description: 'Default "Draft dihapus dari aplikasi".' }),
  })
  .strict()
  .meta({ id: 'SyncDraftDeletePayload', description: 'Soft delete = a never-submitted draft is cancelled (no hard delete). D2410: a draft submitted before (withdrawn, numbered) → rejected NOT_EDITABLE with the server copy.' })
export type SyncDraftDelete = z.infer<typeof SyncDraftDeletePayload>

/** Exactly one of project_id / cost_center_id / site_id (E6, Q-40: cost-center geofence; ADR 0023 site — ADR 0032: refused, kept so an APK ≤ 0.11.1 gets the reason). */
const oneLocation = (v: { project_id?: number | null; cost_center_id?: number | null; site_id?: number | null }) => [v.project_id, v.cost_center_id, v.site_id].filter((x) => x !== undefined).length === 1
const oneLocationError = { message: 'Isi salah satu: project_id, cost_center_id, ATAU site_id.', path: ['project_id'] }

/**
 * `attendance.check_in` / `attendance.check_out` (US-01/US-02, ADR 0010 decisions 7/8): own
 * attendance at a registered project OR cost center of the own PT (E6, Q-40; DRMS 13/10 A2: no assignment) with a
 * geofence — OnSite inside the given one, Non-OnSite (ADR 0032) inside any (outside all → OUTSIDE_GEOFENCE). The selfie is uploaded
 * first with POST /api/v1/media/selfies. Enabled by company-settings.syncAttendanceEnabled (else
 * `rejected FEATURE_DISABLED`). Corrections (US-15) are POST /api/v1/attendance/{id}/correct.
 */
export const SyncAttendancePayload = z
  .object({
    project_id: id.optional().meta({ description: 'Project (exactly one of project_id / cost_center_id / site_id).' }),
    cost_center_id: id.optional().meta({ description: 'Cost center / operational location (E6, Q-40).' }),
    site_id: id.optional().meta({ description: 'ADR 0023 site — ADR 0032: no longer a check-in location (OnSite → VALIDATION; Non-OnSite: a hint only, recorded at the registered location containing the fix).' }),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy_m: z.number().min(0).max(10_000).nullable().optional().meta({ description: 'GPS accuracy radius (m); up to 50 m is added to the geofence radius.' }),
    is_mocked: z.boolean().meta({ description: 'Android Position.isMocked of this fix; true → rejected MOCK_LOCATION.' }),
    selfie_media_id: id.meta({ description: 'media-selfies id uploaded by the caller (POST /api/v1/media/selfies).' }),
    camera_lens: z.literal('front').optional(),
  })
  .strict()
  .refine(oneLocation, oneLocationError)
  .meta({ id: 'SyncAttendancePayload' })
export type SyncAttendance = z.infer<typeof SyncAttendancePayload>

/**
 * `attendance.on_behalf` (US-14, E6; "diabsenkan oleh PM"): a PM records a check-in/out of a team
 * member (e.g. without a phone, Q-29) at a TEAM project/cost center. The photo is taken and the
 * GPS fix measured on the PM's phone (geofence + mock-location checks apply to that fix); the row
 * is stored with source `pm`, recorded_by = the PM and the reason. The PM cannot record their own
 * attendance this way. Same switch as check-in (syncAttendanceEnabled).
 */
export const SyncOnBehalfPayload = z
  .object({
    employee_id: id.meta({ description: 'Team member (employees id; may have no user account).' }),
    kind: z.enum(['check_in', 'check_out']),
    project_id: id.optional(),
    cost_center_id: id.optional(),
    site_id: id.optional().meta({ description: 'ADR 0023: a team site of the PM (pm-role site assignment, or PM of a project of the site).' }),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy_m: z.number().min(0).max(10_000).nullable().optional(),
    is_mocked: z.boolean(),
    selfie_media_id: id.meta({ description: 'media-selfies id uploaded by the PM (photo of the employee).' }),
    camera_lens: z.enum(['front', 'back']).optional(),
    reason: z.string().trim().min(3).max(500).meta({ description: 'Why the PM records it (e.g. "tidak punya HP"). Required.' }),
  })
  .strict()
  .refine(oneLocation, oneLocationError)
  .meta({ id: 'SyncOnBehalfPayload' })
export type SyncOnBehalf = z.infer<typeof SyncOnBehalfPayload>

const pct = z
  .number()
  .min(0)
  .max(100)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'maks. 2 desimal')

/**
 * `progress_report.draft_upsert` (E4, T11/US-10): creates a progress report (PM of a team project or
 * Direktur) or edits one within 24 h (reporter only, `base_rev` = server rev, `reason` required).
 * Photos are uploaded first with POST /api/v1/media/progress-photos (≤ 5 per report). The report date
 * is the company-TZ date of the time that counts (server / monotonic estimate / device clock flagged
 * DEVICE_TIME_ONLY). Enabled by company-settings.syncProgressReportsEnabled (else FEATURE_DISABLED).
 */
export const SyncProgressReportPayload = z
  .object({
    report_id: id.optional().meta({ description: 'Server id of a report created online (edit).' }),
    report_client_uuid: z.uuid().optional().meta({ description: 'APK id of the report (default: the client_uuid of the item that created it).' }),
    project_id: id.optional().meta({ description: 'Required for a new report.' }),
    stage_id: id.optional().meta({ description: 'Required for a new report; a stage of project_id.' }),
    pct_after: pct.optional().meta({ description: 'Stage % after the work (required for a new report; never below the server stage %).' }),
    work: z.string().trim().min(3).max(2000).optional().meta({ description: 'Pekerjaan (required for a new report).' }),
    issues: z.string().trim().max(2000).nullable().optional().meta({ description: 'Kendala.' }),
    photo_media_ids: z.array(id).max(5).optional().meta({ description: 'media-progress-photos ids uploaded by the caller. On an edit: ids not yet on the report are added (photos are never removed).' }),
    reason: z.string().trim().min(3).max(1000).optional().meta({ description: 'Required when editing an existing report.' }),
  })
  .strict()
  .meta({ id: 'SyncProgressReportPayload' })
export type SyncProgressReport = z.infer<typeof SyncProgressReportPayload>

// ---------------------------------------------------------------- FR1 field reports (ADR 0020)

const dec2 = (max: number) =>
  z
    .number()
    .min(0)
    .max(max)
    .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'maks. 2 desimal')
const fieldQty = z
  .number()
  .positive()
  .max(1e6)
  .refine((v) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6, 'maks. 3 desimal')
const optStr = (max: number) => z.string().trim().max(max).nullable().optional()

export const SyncSparepartLine = z
  .object({ name: z.string().trim().min(1).max(160), part_no: optStr(64), qty: fieldQty, uom: optStr(16), note: optStr(300) })
  .strict()
  .meta({ id: 'SyncSparepartLine' })
export const SyncActivityItem = z
  .object({ name: z.string().trim().min(1).max(160), part_no: optStr(64), qty: fieldQty, uom: optStr(16) })
  .strict()
  .meta({ id: 'SyncActivityItem' })

/**
 * `service_report.upsert` (FR1): creates a service report (Staff assigned / PM team / Direktur, project
 * kind kontrak_unit or aftersales) or edits the reporter's own within 24 h (`base_rev` = server rev).
 * Photos first via POST /api/v1/media/progress-photos (≤ 25, DRMS owner 2026-10-17). HM below the unit's latest
 * reading → rejected HM_DECREASED. DRMS owner 2026-10-17: service types = `service_type_ids` (ids of the PT master,
 * GET /service-types); the legacy single `service_type` (APK 0.7.0) is any code of that master and is used only
 * without `service_type_ids` — on an edit a code already on the report keeps a multi-selection made on the web.
 */
export const SyncServiceReportPayload = z
  .object({
    report_id: id.optional().meta({ description: 'Server id (edit of a report created online).' }),
    report_client_uuid: z.uuid().optional().meta({ description: 'APK id of the report (default: the client_uuid of the item that created it).' }),
    project_id: id.optional().meta({ description: 'Required for a new report.' }),
    unit_id: id.optional().meta({ description: 'Required for a new report.' }),
    report_date: businessDate.optional().meta({ description: 'Default: the company-TZ date of the time that counts.' }),
    helpers: optStr(200),
    start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
    end_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
    hour_meter: dec2(10_000_000).nullable().optional(),
    service_type_ids: z
      .array(id)
      .min(1, 'Pilih minimal satu jenis servis.')
      .max(20)
      .refine((xs) => new Set(xs).size === xs.length, 'Jenis servis ganda.')
      .optional()
      .meta({ description: 'Jenis servis (1–20, unique, selection order): rows of the report PT\'s master; new ones must be active. A new report needs this or service_type.' }),
    service_type: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .nullable()
      .optional()
      .meta({ description: 'LEGACY single code (must exist in the PT master). A new report needs exactly one of service_type_ids / service_type; on an edit it is ignored when service_type_ids is sent, else a code already on the report keeps its selection and another one replaces it.' }),
    complaint: optStr(2000),
    action: z.string().trim().min(3).max(4000).optional().meta({ description: 'Required for a new report.' }),
    unit_status_after: z.enum(['siap', 'rusak', 'menunggu_part']).optional().meta({ description: 'Required for a new report.' }),
    spareparts: z.array(SyncSparepartLine).max(50).optional(),
    notes: optStr(2000),
    photo_media_ids: z.array(id).max(25).optional().meta({ description: 'Max 25. On an edit: ids not yet on the report are added (photos are never removed).' }),
    reason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict()
  .meta({ id: 'SyncServiceReportPayload' })
export type SyncServiceReport = z.infer<typeof SyncServiceReportPayload>

/**
 * `unit_timesheet.upsert` (FR1): one timesheet per unit and date. D2410 (user 2026-10-24): HM optional — hm_start +
 * hm_end both or none, the HM photo required only with HM (older APKs always send all three: unchanged behaviour).
 */
export const SyncUnitTimesheetPayload = z
  .object({
    timesheet_id: id.optional(),
    timesheet_client_uuid: z.uuid().optional(),
    project_id: id.optional().meta({ description: 'Required for a new timesheet (kind kontrak_unit).' }),
    unit_id: id.optional().meta({ description: 'Required for a new timesheet (active contract unit on report_date).' }),
    report_date: businessDate.optional().meta({ description: 'Required for a new timesheet.' }),
    hm_start: dec2(10_000_000).nullable().optional().meta({ description: 'Optional (D2410), both hm_start and hm_end or none. On an edit: omitted = unchanged, null = cleared.' }),
    hm_end: dec2(10_000_000).nullable().optional(),
    work_hours: dec2(24).optional().meta({ description: 'Required for a new timesheet.' }),
    standby_hours: dec2(24).optional(),
    breakdown_hours: dec2(24).optional(),
    breakdown_reason: optStr(500),
    fuel_liters: dec2(100_000).nullable().optional(),
    operator_name: optStr(128),
    location: optStr(200),
    notes: optStr(2000),
    hm_photo_media_id: id
      .nullable()
      .optional()
      .meta({ description: 'Photo of the HM meter — required when the timesheet has HM (D2410). Never replaced: on an edit it is only added to a timesheet without one (ignored otherwise).' }),
    reason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict()
  .meta({ id: 'SyncUnitTimesheetPayload' })
export type SyncUnitTimesheet = z.infer<typeof SyncUnitTimesheetPayload>

/** `aftersales_activity.upsert` (FR1): one activity of the aftersales log (project kind aftersales). */
export const SyncAftersalesActivityPayload = z
  .object({
    activity_id: id.optional(),
    activity_client_uuid: z.uuid().optional(),
    project_id: id.optional().meta({ description: 'Required for a new activity.' }),
    client_id: id.optional().meta({ description: 'Required for a new activity (customer of the PT).' }),
    activity_date: businessDate.optional(),
    kind: z.enum(['penawaran', 'po_masuk', 'pengiriman', 'penagihan', 'kunjungan', 'lainnya']).optional().meta({ description: 'Required for a new activity.' }),
    doc_no: optStr(64),
    items: z.array(SyncActivityItem).max(50).optional(),
    value: rupiah.nullable().optional(),
    relates_to: id.nullable().optional().meta({ description: 'pengiriman / penagihan: server id of the incoming PO.' }),
    po_delivered: z.boolean().optional(),
    follow_up_date: businessDate.nullable().optional(),
    receiver: optStr(128),
    notes: optStr(2000),
    photo_media_ids: z.array(id).max(5).optional(),
    reason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict()
  .meta({ id: 'SyncAftersalesActivityPayload' })
export type SyncAftersalesActivity = z.infer<typeof SyncAftersalesActivityPayload>

const weather = z.enum(['cerah', 'berawan', 'hujan']).nullable().optional()
const dailyQty = z
  .number()
  .min(0)
  .max(100_000_000)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'maks. 2 desimal')
const SyncDailyResource = z.object({ resource_type_id: id, count: z.number().int().min(1).max(9999), hours: dec2(24).nullable().optional() }).strict().meta({ id: 'SyncDailyResource' })

/**
 * `daily_report.upsert` (P3): Laporan harian of a konstruksi project — one per project, reporter and date
 * (DAILY_EXISTS). Volumes per RAP item; on an edit `work` / `materials`, when sent, are the full new
 * values of the listed items (the server books the difference). Above the RAP volume needs `notes`
 * (OVER_RAP_NOTE_REQUIRED). Photos first via POST /api/v1/media/progress-photos (≤ 10).
 */
export const SyncDailyReportPayload = z
  .object({
    daily_report_id: id.optional().meta({ description: 'Server id (edit of a report created online).' }),
    daily_report_client_uuid: z.uuid().optional().meta({ description: 'APK id of the report (default: the client_uuid of the item that created it).' }),
    project_id: id.optional().meta({ description: 'Required for a new report (kind konstruksi).' }),
    report_date: businessDate.optional().meta({ description: 'Default: the company-TZ date of the time that counts. Cannot change.' }),
    weather_morning: weather,
    weather_noon: weather,
    weather_afternoon: weather,
    rain_hours: dec2(24).nullable().optional(),
    stop_hours: dec2(24).nullable().optional(),
    work: z.array(z.object({ rap_item_id: id, qty: dailyQty }).strict()).max(300).optional(),
    materials: z.array(z.object({ rap_item_id: id, received: dailyQty.optional(), used: dailyQty.optional() }).strict()).max(300).optional(),
    manpower: z.array(SyncDailyResource).max(60).optional(),
    equipment: z.array(SyncDailyResource).max(60).optional(),
    issues: optStr(2000),
    notes: optStr(2000),
    photo_media_ids: z.array(id).max(10).optional().meta({ description: 'On an edit: ids not yet on the report are added (photos are never removed).' }),
    reason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict()
  .meta({ id: 'SyncDailyReportPayload' })
export type SyncDailyReport = z.infer<typeof SyncDailyReportPayload>

export const SyncItem = z
  .object({
    client_uuid: z.uuid().meta({ description: 'Idempotency key of this queue item (UUIDv7). Replays return `duplicate` with the stored result.' }),
    type: SyncItemTypeEnum,
    company_id: id
      .optional()
      .meta({
        description:
          'MC3: PT of this item (an active membership of the caller). The item is processed under this PT whatever X-Company-Ids says; the PT derived from its references must match (else COMPANY_MISMATCH). Omitted (released APK ≤ 0.2.x) → the caller\'s only PT; a caller with several PTs gets 409 COMPANY_REQUIRED for the whole batch.',
      }),
    schema_version: z.literal(1),
    offline: z.boolean().meta({ description: 'true = created while offline (stored as a comparison flag).' }),
    device_time: dateTime.meta({ description: 'Device wall clock when the user acted. Comparison only; the server time is authoritative.' }),
    elapsed_ms: z.number().int().min(0).meta({ description: 'Monotonic time since boot when the user acted.' }),
    boot_id: z.string().min(1).max(64).optional().meta({ description: 'Boot of elapsed_ms (default: clock.boot_id). A different boot → time_trust device_only.' }),
    base_rev: z
      .number()
      .int()
      .min(1)
      .nullable()
      .optional()
      .meta({
        description:
          'Server `rev` the edit is based on (null/absent = new draft; on an existing draft → conflict). A new draft starts at rev 1 and every applied edit adds exactly 1, so queued edits of a draft created offline use 1, 2, … in queue order.',
      }),
    depends_on: z.array(z.uuid()).max(SYNC_MAX_ITEMS).optional().meta({ description: 'client_uuid of earlier items that must be applied first.' }),
    // Documented as anyOf (components for the Dart client); validated per item type by the
    // service, so a bad payload rejects only its own item (never the whole batch).
    payload: z
      .union([
        SyncDraftUpsertPayload,
        SyncDraftDeletePayload,
        SyncAttendancePayload,
        SyncOnBehalfPayload,
        SyncProgressReportPayload,
        SyncServiceReportPayload,
        SyncUnitTimesheetPayload,
        SyncAftersalesActivityPayload,
        SyncDailyReportPayload,
        z.record(z.string(), z.unknown()),
      ])
      .meta({
        description:
          'Type specific: expense_request.draft_upsert → SyncDraftUpsertPayload, expense_request.draft_delete → SyncDraftDeletePayload, attendance.check_in / attendance.check_out → SyncAttendancePayload, attendance.on_behalf → SyncOnBehalfPayload, progress_report.draft_upsert → SyncProgressReportPayload, service_report.upsert → SyncServiceReportPayload, unit_timesheet.upsert → SyncUnitTimesheetPayload, aftersales_activity.upsert → SyncAftersalesActivityPayload, daily_report.upsert → SyncDailyReportPayload; other types: free-form until supported.',
      }),
  })
  .strict()
  .meta({ id: 'SyncItem' })
export type SyncItemIn = z.infer<typeof SyncItem>

export const SyncBatch = z
  .object({
    batch_id: z.uuid(),
    device_id: z.uuid().meta({ description: 'Must equal the X-Device-Id of the registered device.' }),
    clock: SyncClock,
    items: z.array(SyncItem).min(1).max(SYNC_MAX_ITEMS),
  })
  .strict()
  .meta({ id: 'SyncBatch', description: `≤ ${SYNC_MAX_ITEMS} items and ≤ ${SYNC_MAX_BYTES} bytes JSON per batch (ADR 0010 decision 14).` })
export type SyncBatchIn = z.infer<typeof SyncBatch>


export const SyncDraftCopy = z
  .object({
    id,
    uuid: z.string().nullable(),
    client_uuid: z.string().nullable(),
    rev: z.number().int(),
    status: z.string(),
    doc_no: z.string().nullable(),
    kind: z.enum(['advance', 'reimburse']),
    title: z.string(),
    project_id: id.nullable(),
    cost_center_id: id.nullable(),
    needed_date: z.string().nullable(),
    urgency_level_id: id.nullable(),
    notes: z.string().nullable(),
    requester_ids: z.array(id),
    bank_account_id: id.nullable(),
    payee_type: z.enum(['karyawan', 'vendor', 'pt_grup']).meta({ description: 'ADR 0027 / 0028.' }),
    payee_company_id: id.nullable().meta({ description: 'ADR 0028: receiving PT of a pt_grup draft.' }),
    vendor_id: id.nullable(),
    vendor_bank_account_id: id.nullable(),
    invoice_no: z.string().nullable(),
    invoice_date: z.string().nullable(),
    invoice_due_date: z.string().nullable(),
    invoice_file_id: id.nullable(),
    grand_total: rupiah,
    updated_at: z.string().nullable(),
    lines: z.array(
      z.object({
        id: z.string(),
        no: z.number().int(),
        description: z.string().nullable(),
        qty: z.number().nullable(),
        uom_id: id.nullable(),
        unit_price: rupiah.nullable(),
        total: rupiah.nullable(),
        receipt_amount: rupiah.nullable(),
        notes: z.string().nullable(),
        category_id: id.nullable(),
        vehicle_id: id.nullable(),
        rap_item_id: id.nullable(),
      }),
    ),
    receipts: z.array(
      z.object({
        id,
        client_uuid: z.string().nullable(),
        line_id: z.string(),
        receipt_no: z.string().nullable(),
        vendor_name: z.string(),
        receipt_date: z.string(),
        receipt_time: z.string().nullable(),
        amount: rupiah,
        tax_amount: rupiah.nullable(),
        media_id: id.nullable(),
        status: z.string(),
      }),
    ),
  })
  .meta({ id: 'SyncDraftCopy', description: 'Server version of the draft (server wins on conflict).' })
export type SyncDraftCopyOut = z.infer<typeof SyncDraftCopy>

export const SyncProgressReportCopy = z
  .object({
    id,
    client_uuid: z.string().nullable(),
    rev: z.number().int(),
    doc_no: z.string().nullable(),
    project_id: id,
    stage_id: id,
    report_date: z.string(),
    pct_before: z.number(),
    pct_after: z.number(),
    project_pct_after: z.number().nullable(),
    work: z.string(),
    issues: z.string().nullable(),
    photo_media_ids: z.array(id),
    offline: z.boolean(),
    editable_until: z.string().nullable(),
    updated_at: z.string().nullable(),
  })
  .meta({ id: 'SyncProgressReportCopy', description: 'Server version of a progress report (server wins on conflict).' })
export type SyncProgressReportCopyOut = z.infer<typeof SyncProgressReportCopy>

export const SyncServiceReportCopy = z
  .object({
    id,
    client_uuid: z.string().nullable(),
    rev: z.number().int(),
    doc_no: z.string().nullable(),
    project_id: id,
    unit_id: id,
    report_date: z.string(),
    hour_meter: z.number().nullable(),
    service_type: z.string().meta({ description: 'LEGACY single value: code of the first selected type whose code is one of the four legacy codes (servis_berkala, perbaikan, inspeksi, pemasangan), else of the first selected type.' }),
    service_type_ids: z.array(id).meta({ description: 'DRMS owner 2026-10-17: the selected service types (selection order).' }),
    action: z.string(),
    unit_status_after: z.string(),
    photo_media_ids: z.array(id),
    flags: z.array(z.string()),
    offline: z.boolean(),
    editable_until: z.string().nullable(),
    updated_at: z.string().nullable(),
  })
  .meta({ id: 'SyncServiceReportCopy', description: 'Server version of a service report (server wins on conflict).' })
export type SyncServiceReportCopyOut = z.infer<typeof SyncServiceReportCopy>

export const SyncUnitTimesheetCopy = z
  .object({
    id,
    client_uuid: z.string().nullable(),
    rev: z.number().int(),
    project_id: id,
    unit_id: id,
    report_date: z.string(),
    hm_start: z.number().nullable().meta({ description: 'null = no HM reading (D2410).' }),
    hm_end: z.number().nullable(),
    work_hours: z.number(),
    standby_hours: z.number(),
    breakdown_hours: z.number(),
    hm_photo_media_id: id.nullable(),
    flags: z.array(z.string()),
    offline: z.boolean(),
    editable_until: z.string().nullable(),
    updated_at: z.string().nullable(),
  })
  .meta({ id: 'SyncUnitTimesheetCopy', description: 'Server version of a unit timesheet (server wins on conflict).' })
export type SyncUnitTimesheetCopyOut = z.infer<typeof SyncUnitTimesheetCopy>

export const SyncAftersalesActivityCopy = z
  .object({
    id,
    client_uuid: z.string().nullable(),
    rev: z.number().int(),
    doc_no: z.string().nullable().meta({ description: 'External document number (Q/PO/SJ/INV).' }),
    project_id: id,
    client_id: id,
    activity_date: z.string(),
    kind: z.string(),
    po_status: z.string().nullable(),
    relates_to: id.nullable(),
    photo_media_ids: z.array(id),
    flags: z.array(z.string()),
    offline: z.boolean(),
    editable_until: z.string().nullable(),
    updated_at: z.string().nullable(),
  })
  .meta({ id: 'SyncAftersalesActivityCopy', description: 'Server version of an aftersales activity (server wins on conflict; the value is not echoed).' })
export type SyncAftersalesActivityCopyOut = z.infer<typeof SyncAftersalesActivityCopy>

export const SyncDailyReportCopy = z
  .object({
    id,
    client_uuid: z.string().nullable(),
    rev: z.number().int(),
    doc_no: z.string().nullable(),
    project_id: id,
    report_date: z.string(),
    work: z.array(z.object({ rap_item_id: id, qty: z.number() })),
    materials: z.array(z.object({ rap_item_id: id, received: z.number(), used: z.number() })),
    worker_count: z.number().int(),
    photo_media_ids: z.array(id),
    flags: z.array(z.string()),
    offline: z.boolean(),
    editable_until: z.string().nullable(),
    updated_at: z.string().nullable(),
  })
  .meta({ id: 'SyncDailyReportCopy', description: 'Server version of a daily report (server wins on conflict); work / materials = current ledger sums.' })
export type SyncDailyReportCopyOut = z.infer<typeof SyncDailyReportCopy>

export const SYNC_STATUSES = ['applied', 'duplicate', 'rejected', 'conflict', 'deferred', 'unsupported'] as const
export type SyncStatus = (typeof SYNC_STATUSES)[number]

export const SyncResult = z
  .object({
    client_uuid: z.string(),
    status: z.enum(SYNC_STATUSES).meta({
      description:
        'applied | duplicate (replay; original result below) | rejected (business rule, never retry) | conflict (stale base_rev, server wins, see server_copy) | deferred (retry later) | unsupported (item type not enabled on this server yet — keep it queued, do not count as an attempt; see GET /app/config features).',
    }),
    original_status: z.enum(['applied', 'rejected', 'conflict']).nullable().meta({ description: 'For duplicate: the status of the first processing.' }),
    server_id: z.string().nullable().meta({ description: 'Server id (numeric, as string) of the expense request / attendance / progress report.' }),
    rev: z.number().int().nullable(),
    received_at: z.string().meta({ description: 'Authoritative server time of (first) processing, UTC.' }),
    time_trust: z.enum(['server', 'estimated', 'device_only']),
    flags: z.array(z.string()).meta({ description: 'OFFLINE, CLOCK_SKEW, CLIENT_TOTAL_MISMATCH, ALREADY_CANCELLED, DEVICE_TIME_ONLY; FR1 also BACKDATED, HM_GAP, BREAKDOWN_SUGGEST_SERVICE; P3 also MELEBIHI_RAP, POSSIBLE_DUPLICATE.' }),
    errors: z.array(
      z.object({
        code: z.string().meta({ description: 'VALIDATION, NOT_EDITABLE, STALE_REV (conflict), NOT_FOUND, FORBIDDEN, MEDIA_MISSING, CLIENT_UUID_CONFLICT, COMPANY_NOT_ALLOWED (MC3: company_id is not an active membership of the caller), COMPANY_MISMATCH (MC3: the PT derived from the item references ≠ company_id — or ≠ the only PT of a caller without company_id; only for a PT the caller is mapped to — a reference in another PT is answered like a missing one, QA-MC4-14), FEATURE_DISABLED, DEPENDENCY_FAILED, DEPENDENCY_PENDING, STATE_CONFLICT, INTEGRITY, UNSUPPORTED, INTERNAL; attendance: MOCK_LOCATION, OUTSIDE_GEOFENCE, NOT_ASSIGNED, NO_GEOFENCE, ALREADY_CHECKED_IN, NO_CHECK_IN, ALREADY_CHECKED_OUT (on_behalf also FORBIDDEN: not a PM / not a team location / own attendance), PRIVACY_ACK_REQUIRED (ADR 0018: while the app setting minAppVersion ≥ 0.3.3, the caller — for on_behalf the PM — has not acknowledged the current privacy notice; final, never retry: show the notice, POST /me/privacy-ack, record again); progress reports: WEIGHTS_INCOMPLETE, PROGRESS_DECREASED, PHOTO_LIMIT, MEDIA_IN_USE; FR1 field reports: FEATURE_DISABLED, WRONG_PROJECT_KIND, HM_DECREASED, NOT_IN_CONTRACT, DUPLICATE_DATE, PO_CLOSED, PHOTO_LIMIT, MEDIA_IN_USE; P3 daily reports: DAILY_EXISTS, OVER_RAP_NOTE_REQUIRED.' }),
        field: z.string().optional(),
        message: z.string(),
      }),
    ),
    company_id: z.number().int().nullable().optional().meta({ description: 'MC3: PT the item was processed under (company_id, or the only PT of a legacy item); null when it was not an allowed PT.' }),
    server_copy: SyncDraftCopy.nullable(),
    // progress_report.draft_upsert only: server version of the report (applied, conflict, NOT_EDITABLE).
    server_report: SyncProgressReportCopy.nullable().optional(),
    // FR1 field reports: server version of the record (applied, conflict, NOT_EDITABLE)
    server_service_report: SyncServiceReportCopy.nullable().optional(),
    server_unit_timesheet: SyncUnitTimesheetCopy.nullable().optional(),
    server_aftersales_activity: SyncAftersalesActivityCopy.nullable().optional(),
    // P3: server version of a daily report
    server_daily_report: SyncDailyReportCopy.nullable().optional(),
  })
  .meta({ id: 'SyncResult' })
export type SyncResultOut = z.infer<typeof SyncResult>

export const SyncBatchResponse = z
  .object({ batch_id: z.string(), server_time: z.string(), results: z.array(SyncResult) })
  .meta({ id: 'SyncBatchResponse' })

// ---------------------------------------------------------------- app gate

export const AppConfigQuery = z
  .object({ version: z.string().regex(/^\d+\.\d+\.\d+$/).optional().meta({ description: 'Installed APK version → updateRequired / updateAvailable.' }) })
  .meta({ id: 'AppConfigQuery' })

export const AppConfig = z
  .object({
    minSupportedVersion: z.string().nullable().meta({ description: 'Below this every authenticated call answers 426.' }),
    latestVersion: z.string().nullable(),
    downloadUrl: z.string().nullable().meta({ description: 'APK download page (side-load); null = not published yet ("hubungi admin").' }),
    releaseNotes: z
      .array(z.string())
      .optional()
      .meta({
        description:
          'Plain-text "Yang baru di versi …" bullets (Indonesian, ≤ 15 × ≤ 300 chars) of latestVersion, from the /unduh release manifest; omitted when the published APK is not latestVersion or has no notes.',
      }),
    updateRequired: z.boolean().nullable().meta({ description: 'Only with ?version=.' }),
    updateAvailable: z.boolean().nullable().meta({ description: 'Only with ?version=.' }),
    timezone: z.string().meta({ description: 'Display timezone (IANA) — the server timezone every PT uses (ADR 0016 §9).' }),
    serverTime: z.string(),
    android: z.object({ packageName: z.string() }),
    features: z
      .object({
        pushEnabled: z.boolean().meta({ description: 'false until FCM is configured (ADR 0011) — poll GET /notifications instead.' }),
        syncExpenseDrafts: z.boolean().meta({ description: 'MC4: true when at least one active PT allows it (per-PT value: GET /me companies[].settings.syncExpenseDraftsEnabled).' }),
        syncAttendance: z.boolean().meta({ description: 'MC4: true when at least one active PT allows it (per-PT value: GET /me companies[].settings.syncAttendanceEnabled).' }),
        syncProgressReports: z.boolean().meta({ description: 'MC4: true when at least one active PT allows it (per-PT value: GET /me companies[].settings.syncProgressReportsEnabled).' }),
      })
      .meta({
        description:
          'Public, unauthenticated hints (no PT is known before login). With several PTs each flag is the OR over the active PTs; the server still enforces the flag of the item\'s PT on every sync item (FEATURE_DISABLED). Clients that know the user read GET /me companies[].settings instead.',
      }),
    sync: z.object({ maxItemsPerBatch: z.number().int(), maxBatchBytes: z.number().int(), rateLimitPerMinute: z.number().int() }),
  })
  .meta({ id: 'AppConfig' })
