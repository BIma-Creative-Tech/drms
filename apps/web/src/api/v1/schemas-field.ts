import { z } from 'zod'

import { companyFilterParam, createCompanyField } from './schemas'

/**
 * /api/v1 contract of FR1 "Laporan lapangan per jenis project" (ADR 0020, requirements v1.3): service
 * reports, unit timesheets, aftersales activity log, units and contract units. Business dates
 * 'YYYY-MM-DD' (company TZ), server timestamps ISO-8601 UTC, money integer Rupiah. Contract rates,
 * billing estimates and aftersales values are null for callers without the rate roles (Direktur,
 * Finance, Admin; a value also for its reporter). Pure module (bundled by scripts/gen-openapi.mjs).
 */
const id = z.number().int().positive()
const businessDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'YYYY-MM-DD')
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM')
const dec2 = (max: number) =>
  z
    .number()
    .min(0)
    .max(max)
    .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'maks. 2 desimal')
const qty = z
  .number()
  .positive()
  .max(1e6)
  .refine((v) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6, 'maks. 3 desimal')
const rupiah = z.number().int().min(0).max(1e13)
const text = (max: number) => z.string().trim().max(max)
const optText = (max: number) => text(max).nullable().optional()
const reason = z.string().trim().min(3).max(1000)
const clientUuid = z.uuid().optional().meta({ description: 'Client id; a replay by the same reporter returns the existing record (200); another user → 409 CLIENT_UUID_CONFLICT.' })

export const PROJECT_KIND_VALUES = ['umum', 'konstruksi', 'kontrak_unit', 'aftersales', 'trading'] as const
export const ProjectKindEnum = z.enum(PROJECT_KIND_VALUES).meta({ id: 'ProjectKind', description: 'ADR 0020: kontrak_unit → timesheet + servis; aftersales → servis + aktivitas; others: no field reports (konstruksi: P3).' })
export const UnitStatusEnum = z.enum(['siap', 'rusak', 'menunggu_part']).meta({ id: 'UnitStatus' })
export const ServiceTypeEnum = z.enum(['servis_berkala', 'perbaikan', 'inspeksi', 'pemasangan']).meta({ id: 'ServiceType' })
export const ActivityKindEnum = z.enum(['penawaran', 'po_masuk', 'pengiriman', 'penagihan', 'kunjungan', 'lainnya']).meta({ id: 'AftersalesActivityKind' })
export const PoStatusEnum = z.enum(['belum_kirim', 'sebagian', 'terkirim', 'batal']).meta({ id: 'PoStatus' })

export const MAX_SPAREPART_LINES = 50
export const MAX_ACTIVITY_ITEMS = 50

export const SparepartLine = z
  .object({
    name: z.string().trim().min(1).max(160),
    partNo: optText(64),
    qty,
    uom: optText(16).meta({ description: 'Satuan (text, e.g. PCS, SET, LTR).' }),
    note: optText(300),
  })
  .strict()
  .meta({ id: 'SparepartLine', description: 'Spare part used (text only — no stock is kept, ADR 0020 §9).' })
export type SparepartLineIn = z.infer<typeof SparepartLine>

export const ActivityItem = z
  .object({ name: z.string().trim().min(1).max(160), partNo: optText(64), qty, uom: optText(16) })
  .strict()
  .meta({ id: 'AftersalesActivityItem' })
export type ActivityItemIn = z.infer<typeof ActivityItem>

export const SparepartLines = z.array(SparepartLine).max(MAX_SPAREPART_LINES)
export const ActivityItems = z.array(ActivityItem).max(MAX_ACTIVITY_ITEMS)

const Photo = z
  .object({
    id,
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    filesize: z.number().int().nullable(),
    url: z.string().meta({ description: 'GET (auth) — /api/v1/media/progress-photos/{id}/file' }),
    thumbUrl: z.string(),
  })
  .meta({ id: 'FieldPhoto' })

const Ref = z.object({ id, name: z.string().nullable() })
const ProjectRef = z.object({ id, code: z.string().nullable(), name: z.string().nullable(), kind: ProjectKindEnum.nullable() }).meta({ id: 'FieldProjectRef' })
const UnitRef = z
  .object({ id, label: z.string().nullable(), unitCode: z.string().nullable(), plateDisplay: z.string().nullable(), type: z.string().nullable(), owner: z.enum(['sendiri', 'pelanggan']).nullable() })
  .meta({ id: 'FieldUnitRef' })

const bookkeeping = {
  offline: z.boolean(),
  timeTrust: z.enum(['server', 'estimated', 'device_only']),
  source: z.enum(['web', 'apk']).nullable(),
  flags: z.array(z.string()).meta({ description: 'OFFLINE, DEVICE_TIME_ONLY, CLOCK_SKEW, BACKDATED, HM_GAP (timesheet), BREAKDOWN_SUGGEST_SERVICE (timesheet), CORRECTED.' }),
  receivedAt: z.string().nullable(),
  editableUntil: z.string().nullable(),
  editable: z.boolean().meta({ description: 'The caller is the reporter and the 24 h window is open.' }),
  correctedAt: z.string().nullable(),
  correctedBy: Ref.nullable(),
  rev: z.number().int().meta({ description: 'Content revision (sync base_rev).' }),
  clientUuid: z.string().nullable(),
  createdAt: z.string().nullable(),
}

const listQuery = {
  project: z.coerce.number().int().positive().optional(),
  from: businessDate.optional(),
  to: businessDate.optional(),
  mine: z.enum(['1', 'true']).optional().meta({ description: 'Only records created by the caller.' }),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(64).optional(),
  company: companyFilterParam,
}

// ---------------------------------------------------------------- service reports

const serviceContent = {
  helpers: optText(200).meta({ description: 'Helper (names, text).' }),
  startTime: hhmm.nullable().optional(),
  endTime: hhmm.nullable().optional(),
  hourMeter: dec2(10_000_000).nullable().optional().meta({ description: 'HM at the service; below the unit\'s latest reading on/before the date → 409 HM_DECREASED (corrections: PM/Direktur).' }),
  serviceType: ServiceTypeEnum,
  complaint: optText(2000),
  action: z.string().trim().min(3).max(4000).meta({ description: 'Tindakan / pekerjaan.' }),
  unitStatusAfter: UnitStatusEnum.meta({ description: 'Unit status after the service → vehicles.status (menunggu_part notifies the project PM).' }),
  spareparts: SparepartLines.optional(),
  notes: optText(2000),
}

export const ServiceReportCreate = z
  .object({
    company: createCompanyField,
    projectId: id.meta({ description: 'Project of kind kontrak_unit or aftersales (else 409 WRONG_PROJECT_KIND).' }),
    unitId: id.meta({ description: 'Unit of the project PT; a customer-owned unit must belong to the project\'s client when the project has one.' }),
    reportDate: businessDate.optional().meta({ description: 'Default: today (company TZ). Not in the future, ≤ 14 days back.' }),
    ...serviceContent,
    photoIds: z.array(id).max(10).optional().meta({ description: 'media-progress-photos ids uploaded by the caller (before/after), max 10.' }),
    clientUuid,
  })
  .strict()
  .meta({ id: 'ServiceReportCreate' })

const servicePatch = {
  helpers: serviceContent.helpers,
  startTime: serviceContent.startTime,
  endTime: serviceContent.endTime,
  hourMeter: serviceContent.hourMeter,
  serviceType: ServiceTypeEnum.optional(),
  complaint: serviceContent.complaint,
  action: serviceContent.action.optional(),
  unitStatusAfter: UnitStatusEnum.optional(),
  spareparts: SparepartLines.optional(),
  notes: serviceContent.notes,
  addPhotoIds: z.array(id).max(10).optional().meta({ description: 'Photos to add (total ≤ 10).' }),
}

export const ServiceReportUpdate = z
  .object({ ...servicePatch, reason: reason.optional().meta({ description: 'Optional for the reporter\'s own edit inside the 24 h window (audited).' }) })
  .strict()
  .meta({ id: 'ServiceReportUpdate' })

export const ServiceReportCorrection = z
  .object({ ...servicePatch, reason: reason.meta({ description: 'Required: PM of the project team or Direktur, any time (audited, flag CORRECTED).' }) })
  .strict()
  .meta({ id: 'ServiceReportCorrection' })

export const ServiceReportListQuery = z
  .object({ ...listQuery, unit: z.coerce.number().int().positive().optional(), status: UnitStatusEnum.optional().meta({ description: 'unitStatusAfter' }), reporter: z.coerce.number().int().positive().optional() })
  .meta({ id: 'ServiceReportListQuery' })

export const ServiceReport = z
  .object({
    id,
    uuid: z.string().nullable(),
    companyId: id.nullable(),
    docNo: z.string().nullable().meta({ description: 'SV/YYMM/####' }),
    project: ProjectRef,
    unit: UnitRef,
    reportDate: z.string(),
    reporter: Ref,
    helpers: z.string().nullable(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    hourMeter: z.number().nullable(),
    serviceType: ServiceTypeEnum,
    complaint: z.string().nullable(),
    action: z.string(),
    unitStatusAfter: UnitStatusEnum,
    spareparts: z.array(SparepartLine),
    notes: z.string().nullable(),
    photos: z.array(Photo),
    ...bookkeeping,
  })
  .meta({ id: 'ServiceReport' })

export const ServiceReportList = z.object({ items: z.array(ServiceReport), nextCursor: z.string().nullable() }).meta({ id: 'ServiceReportList' })

// ---------------------------------------------------------------- unit timesheets

const hours = dec2(24)
const timesheetContent = {
  hmStart: dec2(10_000_000).meta({ description: 'HM awal; ≠ the previous timesheet\'s HM akhir → flag HM_GAP (not rejected).' }),
  hmEnd: dec2(10_000_000).meta({ description: 'HM akhir ≥ HM awal.' }),
  workHours: hours,
  standbyHours: hours.optional(),
  breakdownHours: hours.optional(),
  breakdownReason: optText(500).meta({ description: 'Required when breakdownHours > 0.' }),
  fuelLiters: dec2(100_000).nullable().optional(),
  operatorName: optText(128).meta({ description: 'Operator (text; operators have no account).' }),
  location: optText(200),
  notes: optText(2000),
}

export const UnitTimesheetCreate = z
  .object({
    company: createCompanyField,
    projectId: id.meta({ description: 'Project of kind kontrak_unit.' }),
    unitId: id.meta({ description: 'Unit in an ACTIVE contract unit of the project on reportDate (else 409 NOT_IN_CONTRACT). One timesheet per unit and date (409 DUPLICATE_DATE).' }),
    reportDate: businessDate,
    ...timesheetContent,
    hmPhotoId: id.meta({ description: 'Photo of the HM meter (media-progress-photos, uploaded by the caller) — required, exactly one.' }),
    clientUuid,
  })
  .strict()
  .meta({ id: 'UnitTimesheetCreate', description: 'Σ work + standby + breakdown ≤ 24.' })

const timesheetPatch = {
  hmStart: timesheetContent.hmStart.optional(),
  hmEnd: timesheetContent.hmEnd.optional(),
  workHours: hours.optional(),
  standbyHours: hours.optional(),
  breakdownHours: hours.optional(),
  breakdownReason: timesheetContent.breakdownReason,
  fuelLiters: timesheetContent.fuelLiters,
  operatorName: timesheetContent.operatorName,
  location: timesheetContent.location,
  notes: timesheetContent.notes,
}

export const UnitTimesheetUpdate = z
  .object({ ...timesheetPatch, reason: reason.optional() })
  .strict()
  .meta({ id: 'UnitTimesheetUpdate' })

export const UnitTimesheetCorrection = z
  .object({ ...timesheetPatch, reason: reason.meta({ description: 'Required (PM team / Direktur, any time, audited).' }) })
  .strict()
  .meta({ id: 'UnitTimesheetCorrection' })

export const UnitTimesheetListQuery = z
  .object({ ...listQuery, unit: z.coerce.number().int().positive().optional(), reporter: z.coerce.number().int().positive().optional() })
  .meta({ id: 'UnitTimesheetListQuery' })

export const UnitTimesheet = z
  .object({
    id,
    uuid: z.string().nullable(),
    companyId: id.nullable(),
    project: ProjectRef,
    unit: UnitRef,
    contractUnitId: id.nullable(),
    reportDate: z.string(),
    reporter: Ref,
    hmStart: z.number(),
    hmEnd: z.number(),
    hmUsed: z.number().meta({ description: 'hmEnd − hmStart.' }),
    workHours: z.number(),
    standbyHours: z.number(),
    breakdownHours: z.number(),
    breakdownReason: z.string().nullable(),
    fuelLiters: z.number().nullable(),
    operatorName: z.string().nullable(),
    location: z.string().nullable(),
    notes: z.string().nullable(),
    hmPhoto: Photo.nullable(),
    suggestServiceReport: z.boolean().meta({ description: 'breakdownHours ≥ 4 → suggest a service report.' }),
    ...bookkeeping,
  })
  .meta({ id: 'UnitTimesheet' })

export const UnitTimesheetList = z.object({ items: z.array(UnitTimesheet), nextCursor: z.string().nullable() }).meta({ id: 'UnitTimesheetList' })

// ---------------------------------------------------------------- aftersales activities

const activityContent = {
  docNo: optText(64).meta({ description: 'No. dokumen (Q/PO/SJ/INV), text.' }),
  items: ActivityItems.optional(),
  value: rupiah.nullable().optional().meta({ description: 'Nilai (Rp), optional; readable only by Direktur/Finance/Admin and the reporter.' }),
  followUpDate: businessDate.nullable().optional().meta({ description: 'Penawaran only: follow-up date (reminder to reporter + PM when due).' }),
  receiver: optText(128).meta({ description: 'Pengiriman: penerima.' }),
  notes: optText(2000),
}

export const AftersalesActivityCreate = z
  .object({
    company: createCompanyField,
    projectId: id.meta({ description: 'Project of kind aftersales.' }),
    clientId: id.meta({ description: 'Customer (clients) of the project PT.' }),
    activityDate: businessDate.optional().meta({ description: 'Default: today (company TZ).' }),
    kind: ActivityKindEnum,
    ...activityContent,
    relatesTo: id.nullable().optional().meta({ description: 'pengiriman (required) / penagihan: the incoming PO (po_masuk) of the same customer.' }),
    poDelivered: z.boolean().optional().meta({ description: 'pengiriman: "PO selesai dikirim?" — true → PO terkirim, false/absent → sebagian.' }),
    photoIds: z.array(id).max(5).optional().meta({ description: 'Proof photos (surat jalan / serah terima), max 5.' }),
    clientUuid,
  })
  .strict()
  .meta({ id: 'AftersalesActivityCreate' })

const activityPatch = { ...activityContent, addPhotoIds: z.array(id).max(5).optional() }

export const AftersalesActivityUpdate = z
  .object({ ...activityPatch, reason: reason.optional() })
  .strict()
  .meta({ id: 'AftersalesActivityUpdate' })

export const AftersalesActivityCorrection = z
  .object({ ...activityPatch, poStatus: PoStatusEnum.optional().meta({ description: 'po_masuk only (e.g. batal); a cancelled PO stays cancelled.' }), reason: reason.meta({ description: 'Required (PM team / Direktur).' }) })
  .strict()
  .meta({ id: 'AftersalesActivityCorrection' })

export const AftersalesActivityListQuery = z
  .object({
    ...listQuery,
    client: z.coerce.number().int().positive().optional(),
    kind: ActivityKindEnum.optional(),
    poStatus: PoStatusEnum.optional(),
    reporter: z.coerce.number().int().positive().optional(),
  })
  .meta({ id: 'AftersalesActivityListQuery' })

export const AftersalesActivity = z
  .object({
    id,
    uuid: z.string().nullable(),
    companyId: id.nullable(),
    project: ProjectRef,
    activityDate: z.string(),
    reporter: Ref,
    client: Ref,
    kind: ActivityKindEnum,
    docNo: z.string().nullable(),
    items: z.array(ActivityItem),
    value: rupiah.nullable().meta({ description: 'null when hidden from the caller (valueVisible false) or not entered.' }),
    valueVisible: z.boolean(),
    relatesTo: z.object({ id, docNo: z.string().nullable(), activityDate: z.string().nullable() }).nullable(),
    poStatus: PoStatusEnum.nullable(),
    followUpDate: z.string().nullable(),
    receiver: z.string().nullable(),
    notes: z.string().nullable(),
    photos: z.array(Photo),
    ...bookkeeping,
  })
  .meta({ id: 'AftersalesActivity' })

export const AftersalesActivityList = z.object({ items: z.array(AftersalesActivity), nextCursor: z.string().nullable() }).meta({ id: 'AftersalesActivityList' })

export const OpenPosQuery = z
  .object({ client: z.coerce.number().int().positive().optional(), project: z.coerce.number().int().positive().optional(), company: companyFilterParam })
  .meta({ id: 'OpenPosQuery' })

export const OpenPo = z
  .object({
    id,
    companyId: id,
    project: ProjectRef,
    client: Ref,
    activityDate: z.string(),
    docNo: z.string().nullable(),
    items: z.array(ActivityItem),
    value: rupiah.nullable(),
    valueVisible: z.boolean(),
    poStatus: PoStatusEnum,
    ageDays: z.number().int(),
    deliveries: z.number().int().meta({ description: 'Deliveries (pengiriman) recorded against this PO.' }),
  })
  .meta({ id: 'OpenPo' })

export const OpenPoList = z.object({ asOf: z.string(), items: z.array(OpenPo) }).meta({ id: 'OpenPoList' })

// ---------------------------------------------------------------- units + contract units

export const UnitListQuery = z
  .object({
    project: z.coerce.number().int().positive().optional().meta({ description: 'kontrak_unit: units in an active contract of the project today; aftersales: every active unit of the PT.' }),
    updatedSince: z.iso.datetime({ offset: true }).optional().meta({ description: 'Delta sync: only units changed after this instant (incl. deactivated ones).' }),
    company: companyFilterParam,
  })
  .meta({ id: 'UnitListQuery' })

export const Unit = z
  .object({
    id,
    companyId: id,
    kind: z.enum(['kendaraan', 'alat_berat']),
    label: z.string(),
    unitCode: z.string().nullable(),
    plateNo: z.string().nullable(),
    plateDisplay: z.string().nullable(),
    type: z.string().nullable(),
    brandModel: z.string().nullable(),
    serialNo: z.string().nullable(),
    owner: z.enum(['sendiri', 'pelanggan']),
    client: Ref.nullable(),
    status: UnitStatusEnum,
    lastHourMeter: z.number().nullable(),
    lastHourMeterAt: z.string().nullable(),
    contract: z
      .object({ id, projectId: id, startDate: z.string(), endDate: z.string().nullable() })
      .nullable()
      .meta({ description: 'With ?project= (kontrak_unit): the active contract unit (no rates).' }),
    active: z.boolean(),
    updatedAt: z.string().nullable(),
  })
  .meta({ id: 'Unit', description: 'Unit & Kendaraan (no contract rates).' })

export const UnitList = z.object({ serverTime: z.string(), items: z.array(Unit) }).meta({ id: 'UnitList' })

export const ContractUnit = z
  .object({
    id,
    companyId: id,
    projectId: id,
    unit: UnitRef,
    startDate: z.string(),
    endDate: z.string().nullable(),
    active: z.boolean(),
    rateBasis: z.enum(['per_jam', 'per_bulan']),
    rate: rupiah.nullable().meta({ description: 'null unless Direktur/Finance/Admin of the PT (ratesVisible).' }),
    minHoursPerMonth: z.number().nullable(),
    ratesVisible: z.boolean(),
    notes: z.string().nullable(),
  })
  .meta({ id: 'ContractUnit' })

export const ContractUnitList = z.object({ projectId: id, items: z.array(ContractUnit) }).meta({ id: 'ContractUnitList' })
