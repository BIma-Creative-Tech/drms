import { randomUUID } from 'node:crypto'

import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { employeeIn, hasRole, mappedCompanies, relId, userId } from '@/access/roles'
import { resolveScope } from '@/access/scope'
import { haversineM, insideGeofence, localDateString, employeeOfUser, type AttendanceKind } from '@/domain/sync/attendance'
import { auditPrivacyDenied, PRIVACY_ACK_REQUIRED, PRIVACY_ACK_REQUIRED_DETAIL, privacyAckCheck } from '@/legal/privacy-enforcement'
import { DEFAULT_TZ } from '@/lib/time'
import { getRequestTx } from '@/lib/tx'

import { snapshotOf, type ScheduleSnapshot } from './schedule'
import { effectiveRadiusM } from './calendar'
import { kindAllowedFor, NOT_ELIGIBLE_NON_ONSITE, NOT_ELIGIBLE_OTHER_PT } from './area'
import { employeeAttendance } from './eligibility'
import { companyOf, settings, userOfEmployee as userOfEmployeeLink } from '@/domain/companies'

/**
 * E6 — the ONE write path of `attendances` (sync items attendance.check_in / check_out / on_behalf,
 * US-01/02/14, Q-40). ADR 0023: a location is a project, a cost center or a site (kantor cabang).
 * DRMS 13/10 A2 (ADR 0023 amendment 2026-10-13): WHERE an employee may check in follows the employee's attendance
 * type, no team assignment needed — OnSite: any registered location of the own PT with a point; Non-OnSite: the
 * PT's sites only (head office + branch offices). A PM on-behalf still needs the location in the PM's team.
 * Server-side checks, in this order (error codes are part of the APK contract; `NOT_ASSIGNED` is kept as the code of
 * "location not eligible for this employee" so released APKs keep showing the server text):
 * MOCK_LOCATION → NOT_FOUND/VALIDATION (location) → NO_GEOFENCE → NOT_ASSIGNED → OUTSIDE_GEOFENCE →
 * MEDIA_MISSING / FORBIDDEN (selfie) → ALREADY_CHECKED_IN / NO_CHECK_IN / ALREADY_CHECKED_OUT.
 * On-behalf (source `pm`) additionally: caller holds pk-pm, the location is in the caller's TEAM
 * scope, the employee is not the caller, reason mandatory (schema) — the selfie and GPS come from
 * the PM's phone (plan fase1-golive E6).
 */
export class AttendanceReject extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly field?: string,
  ) {
    super(message)
  }
}

const reject = (code: string, message: string, field?: string): never => {
  throw new AttendanceReject(code, message, field)
}

/** ADR 0023: `site` = a branch office (kantor cabang) of the PT with its own geofence. */
export type Location = { type: 'project'; id: number } | { type: 'cost_center'; id: number } | { type: 'site'; id: number }

/** Collection of a location type. */
export const LOCATION_COLLECTION = { project: 'projects', cost_center: 'cost-centers', site: 'sites' } as const satisfies Record<Location['type'], string>

/** Sync / API field of a location type (`payload.<field>` in errors). */
export const LOCATION_FIELD = { project: 'project_id', cost_center: 'cost_center_id', site: 'site_id' } as const satisfies Record<Location['type'], string>

/** Exactly one of the three location ids → Location (callers validated "exactly one" in the schema). */
export function locationOf(p: { project_id?: number | null; cost_center_id?: number | null; site_id?: number | null }): Location {
  if (typeof p.project_id === 'number') return { type: 'project', id: p.project_id }
  if (typeof p.cost_center_id === 'number') return { type: 'cost_center', id: p.cost_center_id }
  return { type: 'site', id: p.site_id as number }
}

type GeoDoc = { id: number; company?: unknown; code?: string | null; name?: string | null; lat?: number | null; lng?: number | null; radiusM?: number | null; status?: string | null; active?: boolean | null }

export type RecordInput = {
  kind: AttendanceKind
  employee: number
  /** Account of the employee (null: employee without account, on-behalf only). */
  user: number | null
  location: Location
  lat: number
  lng: number
  accuracyM: number | null
  isMocked: boolean
  selfieId: number
  /** The selfie must be uploaded by this user (the caller). */
  uploader: number
  time: Date
  timeTrust: 'server' | 'estimated' | 'device_only'
  estimatedTime: string | null
  receivedAt: Date
  deviceTime: string
  offline: boolean
  flags: string[]
  clientUuid: string
  device: number | null
  source: 'self' | 'pm'
  recordedBy: number | null
  onBehalfReason: string | null
  timeZone: string
  /** Field path prefix for errors (`payload.`). */
  fieldPrefix?: string
}

const LABEL: Record<Location['type'], string> = { project: 'project', cost_center: 'pusat biaya', site: 'site' }

/**
 * DRMS 13/10 A2: is the location eligible for the employee's attendance type (same PT; OnSite: any kind, Non-OnSite:
 * sites only)? Throws `NOT_ASSIGNED` (APK contract code) with the Indonesian reason otherwise. Replaces the
 * assignment / home-site rule of ADR 0023 Q-S5 for the check-in itself (assignments keep driving the PM team views).
 */
async function assertEligible(req: PayloadRequest, employee: number, loc: Location, locationCompany: number | undefined, field: string): Promise<void> {
  const emp = await employeeAttendance(req, employee)
  if (!emp || emp.company !== locationCompany) reject('NOT_ASSIGNED', NOT_ELIGIBLE_OTHER_PT, field)
  if (!kindAllowedFor(emp!.type, loc.type)) reject('NOT_ASSIGNED', NOT_ELIGIBLE_NON_ONSITE, field)
}

/**
 * Current schedule of an employee: own work schedule, else the default schedule of the employee's home site (ADR 0023
 * §3: a branch office can have its own office hours), else the company default, else null.
 */
export async function scheduleOfEmployee(req: PayloadRequest, employee: number, defaultScheduleId?: number | null): Promise<ScheduleSnapshot | null> {
  const emp = (await req.payload.findByID({ collection: 'employees', id: employee, depth: 1, overrideAccess: true /* SYSTEM-READ: schedule of the employee */, req, disableErrors: true })) as {
    workSchedule?: unknown
    homeSite?: unknown
  } | null
  const own = emp?.workSchedule && typeof emp.workSchedule === 'object' ? snapshotOf(emp.workSchedule as Record<string, unknown>) : null
  if (own) return own
  const siteDefault = relId((emp?.homeSite as { defaultWorkSchedule?: unknown } | null | undefined)?.defaultWorkSchedule)
  if (siteDefault !== undefined) {
    const doc = await req.payload.findByID({ collection: 'work-schedules', id: siteDefault, depth: 0, overrideAccess: true /* SYSTEM-READ: home-site schedule */, req, disableErrors: true })
    const snap = snapshotOf(doc as Record<string, unknown> | null)
    if (snap) return snap
  }
  let defId = defaultScheduleId
  if (defId === undefined) {
    const s = await settings(req, relId((emp as { company?: unknown } | null)?.company))
    defId = relId(s.defaultWorkSchedule) ?? null
  }
  if (!defId) return null
  const doc = await req.payload.findByID({ collection: 'work-schedules', id: defId, depth: 0, overrideAccess: true /* SYSTEM-READ: default schedule */, req, disableErrors: true })
  return snapshotOf(doc as Record<string, unknown> | null)
}

/** Account linked to an employee (membership employee, ADR 0016 §2), or null. */
export async function userOfEmployee(req: PayloadRequest, employee: number): Promise<number | null> {
  return userOfEmployeeLink(req, employee)
}

async function loadLocation(req: PayloadRequest, loc: Location, field: string): Promise<GeoDoc> {
  const doc = (await req.payload.findByID({
    collection: LOCATION_COLLECTION[loc.type],
    id: loc.id,
    depth: 0,
    overrideAccess: true, // SYSTEM-READ: geofence of the target location
    req,
    disableErrors: true,
  })) as GeoDoc | null
  // QA-MC4-14 (scope rule): a location of a PT the caller is not mapped to = a missing one
  const mapped = mappedCompanies(req)
  if (!doc || (mapped !== null && !mapped.includes(relId((doc as { company?: unknown }).company) ?? -1))) {
    return reject('NOT_FOUND', loc.type === 'project' ? 'Project tidak ditemukan.' : loc.type === 'site' ? 'Site tidak ditemukan.' : 'Pusat biaya tidak ditemukan.', field)
  }
  if (loc.type === 'project' && doc.status === 'arsip') reject('VALIDATION', 'Project sudah diarsipkan.', field)
  if (loc.type === 'cost_center' && doc.active === false) reject('VALIDATION', 'Pusat biaya sudah dinonaktifkan.', field)
  if (loc.type === 'site' && doc.active === false) reject('VALIDATION', 'Site sudah dinonaktifkan.', field)
  if (typeof doc.lat !== 'number' || typeof doc.lng !== 'number') {
    reject('NO_GEOFENCE', `Titik lokasi ${LABEL[loc.type]} belum diisi Admin. Absensi belum bisa dipakai di ${LABEL[loc.type]} ini.`, field)
  }
  if (typeof doc.radiusM !== 'number') {
    // S3e (US-01, S-19): a point without its own radius uses the company default radius.
    const s = await settings(req, relId((doc as { company?: unknown }).company))
    return { ...doc, radiusM: effectiveRadiusM(null, s.defaultGeofenceRadiusM) }
  }
  return doc
}

type DayRow = { id: number; kind: AttendanceKind; effective_time: string }

/** Rows of this employee at this location on the local date, with the effective (corrected) time. */
export async function dayRowsAt(req: PayloadRequest, employee: number, loc: Location, localDate: string): Promise<DayRow[]> {
  const tx = await getRequestTx(req)
  // ADR 0023: a site check-in = site_id without project / cost center (a project row also carries its project's site)
  const at =
    loc.type === 'project' ? sql`a.project_id = ${loc.id}` : loc.type === 'cost_center' ? sql`a.cost_center_id = ${loc.id}` : sql`a.site_id = ${loc.id} AND a.project_id IS NULL AND a.cost_center_id IS NULL`
  const r = (await tx.execute(sql`
    SELECT a.id, a.kind, coalesce(c.new_time, a.attendance_time) AS effective_time
    FROM attendances a
    LEFT JOIN LATERAL (SELECT new_time FROM attendance_corrections c WHERE c.attendance_id = a.id ORDER BY c.id DESC LIMIT 1) c ON TRUE
    WHERE a.employee_id = ${employee} AND ${at} AND a.local_date = ${localDate}
    ORDER BY effective_time`)) as unknown as { rows: DayRow[] }
  return r.rows
}

/** Records one attendance after every server-side check. Returns the new row id. */
export async function recordAttendance(req: PayloadRequest, input: RecordInput): Promise<{ id: number; localDate: string }> {
  const pre = input.fieldPrefix ?? 'payload.'
  const locField = `${pre}${LOCATION_FIELD[input.location.type]}`
  // ADR 0010 decision 8 / US-01 "Mock location ditolak" (Q-43 proposal: fake GPS always blocked).
  if (input.isMocked) reject('MOCK_LOCATION', 'Lokasi palsu (mock location) terdeteksi. Absensi ditolak.', `${pre}is_mocked`)
  const geo = await loadLocation(req, input.location, locField)
  const localDate = localDateString(input.time, input.timeZone)
  if (input.source === 'pm') {
    // US-14: only for the PM's own team locations (the team scope of the CALLER).
    // ADR 0016 §5: PM role + team scope IN THE LOCATION's PT
    const company = relId((geo as { company?: unknown }).company)
    if (!hasRole(req, 'pk-pm', company)) reject('FORBIDDEN', `Hanya untuk ${LABEL[input.location.type]} tim Anda.`, locField)
    const scope = await resolveScope(req, company ?? null)
    // ADR 0023 Q-S5: at a site = a PM assigned (role PM) to the site or the PM of a project of that site
    const team = input.location.type === 'project' ? scope.teamProjects : input.location.type === 'site' ? scope.teamSites : scope.teamCostCenters
    if (!team.includes(input.location.id)) reject('FORBIDDEN', `Hanya untuk ${LABEL[input.location.type]} tim Anda.`, locField)
  }
  await assertEligible(req, input.employee, input.location, relId((geo as { company?: unknown }).company), locField)
  const distance = Math.round(haversineM(input.lat, input.lng, geo.lat!, geo.lng!))
  if (!insideGeofence(distance, geo.radiusM!, input.accuracyM)) {
    reject('OUTSIDE_GEOFENCE', `Di luar radius ${LABEL[input.location.type]} (${distance} m dari titik, radius ${geo.radiusM} m).`, `${pre}lat`)
  }
  const selfie = (await req.payload.findByID({ collection: 'media-selfies', id: input.selfieId, depth: 0, overrideAccess: true /* SYSTEM-READ: existence + uploader */, req, disableErrors: true })) as {
    uploadedBy?: unknown
  } | null
  if (!selfie) reject('MEDIA_MISSING', 'Selfie belum terunggah (POST /api/v1/media/selfies).', `${pre}selfie_media_id`)
  if (relId(selfie!.uploadedBy) !== input.uploader) reject('FORBIDDEN', 'Selfie bukan unggahan Anda.', `${pre}selfie_media_id`)

  // One check-in and one check-out per employee/location/local date (serialised per day).
  const tx = await getRequestTx(req)
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`att:${input.employee}:${input.location.type}:${input.location.id}:${localDate}`}, 0))`)
  const today = await dayRowsAt(req, input.employee, input.location, localDate)
  const checkIn = today.find((r) => r.kind === 'check_in')
  const where = LABEL[input.location.type]
  if (input.kind === 'check_in' && checkIn) reject('ALREADY_CHECKED_IN', `Sudah absen masuk di ${where} ini hari ini.`)
  if (input.kind === 'check_out') {
    if (!checkIn) reject('NO_CHECK_IN', `Belum ada absen masuk hari ini di ${where} ini.`)
    if (today.some((r) => r.kind === 'check_out')) reject('ALREADY_CHECKED_OUT', `Sudah absen pulang di ${where} ini hari ini.`)
    if (new Date(checkIn!.effective_time).getTime() > input.time.getTime()) reject('VALIDATION', 'Jam pulang lebih awal dari jam masuk.')
  }
  const schedule = await scheduleOfEmployee(req, input.employee)
  const created = await req.payload.create({
    collection: 'attendances',
    data: {
      employee: input.employee,
      user: input.user,
      kind: input.kind,
      project: input.location.type === 'project' ? input.location.id : null,
      costCenter: input.location.type === 'cost_center' ? input.location.id : null,
      // ADR 0023: the DB (pk_attendance_site) fills the project's site for a project check-in; NULL for a cost center
      site: input.location.type === 'site' ? input.location.id : null,
      source: input.source,
      recordedBy: input.recordedBy,
      onBehalfReason: input.onBehalfReason,
      localDate,
      attendanceTime: input.time.toISOString(),
      receivedAt: input.receivedAt.toISOString(),
      deviceTime: new Date(input.deviceTime).toISOString(),
      estimatedTime: input.estimatedTime,
      timeTrust: input.timeTrust,
      offline: input.offline,
      lat: input.lat,
      lng: input.lng,
      accuracyM: input.accuracyM,
      distanceM: distance,
      selfie: input.selfieId,
      device: input.device,
      flags: input.flags,
      schedule,
      clientUuid: input.clientUuid,
    },
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: attendance after the server-side checks above (create is closed for HTTP)
    req,
  })
  // D7: timestamp band burnt into the selfie by the worker (same transaction → no job for a rolled-back row)
  await req.payload.jobs.queue({ task: 'stampSelfie', input: { attendanceId: created.id as number }, req })
  return { id: created.id as number, localDate }
}

export type WebCheckInput = { location: Location; lat: number; lng: number; accuracyM: number | null; selfieId: number }

/**
 * Owner decision 2026-10-09: "Absen bisa dilakukan di web dan juga aplikasi Android" — self
 * check-in/out from the web admin panel, every role. Synchronous counterpart of the APK sync
 * adapter (`domain/sync/service.ts` applyAttendance): same gates (company-settings
 * syncAttendanceEnabled, ADR 0018 privacy ack) and the SAME single write path (recordAttendance
 * above). Unlike the APK: no offline queue (no replay/idempotency table needed — `clientUuid` is
 * generated here, one-shot), no mocked-location signal (browser geolocation has none to report),
 * no "diabsenkan PM" (web self-service only; PM on-behalf stays an APK/sync feature).
 */
export async function recordWebAttendance(req: PayloadRequest, kind: AttendanceKind, input: WebCheckInput): Promise<{ id: number; localDate: string }> {
  const uid = userId(req)
  if (uid === undefined) reject('VALIDATION', 'Tidak terautentikasi.')
  // ADR 0016 D1: the caller's employee IN THE LOCATION's PT (one employee per PT); an unmapped/missing
  // location resolves to no company here too (recordAttendance → NOT_FOUND, QA-MC4-14).
  const locRaw = await companyOf(req, LOCATION_COLLECTION[input.location.type], input.location.id)
  const mapped = mappedCompanies(req)
  const locCompany = locRaw !== undefined && (mapped === null || mapped.includes(locRaw)) ? locRaw : undefined
  const own = locCompany !== undefined ? employeeIn(req, locCompany) : await employeeOfUser(req, uid!)
  if (own === undefined) reject('VALIDATION', 'Akun Anda belum terhubung ke data karyawan. Hubungi Admin.')
  const company = locCompany ?? (await companyOf(req, 'employees', own))

  const s = (await settings(req, company)) as { syncAttendanceEnabled?: boolean | null; timezone?: string | null }
  if (s.syncAttendanceEnabled !== true) reject('FEATURE_DISABLED', 'Absensi dari web belum diaktifkan server (Setting perusahaan).')

  const check = await privacyAckCheck(req, uid!)
  if (check.required) {
    await auditPrivacyDenied(req, check, { docType: 'attendance', field: `attendance.${kind}`, companyId: company ?? null })
    reject(PRIVACY_ACK_REQUIRED, PRIVACY_ACK_REQUIRED_DETAIL)
  }

  const now = new Date()
  return recordAttendance(req, {
    kind,
    employee: own!,
    user: uid!,
    location: input.location,
    lat: input.lat,
    lng: input.lng,
    accuracyM: input.accuracyM,
    isMocked: false,
    selfieId: input.selfieId,
    uploader: uid!,
    time: now,
    timeTrust: 'server',
    estimatedTime: null,
    receivedAt: now,
    deviceTime: now.toISOString(),
    offline: false,
    flags: [],
    clientUuid: randomUUID(),
    device: null,
    source: 'self',
    recordedBy: null,
    onBehalfReason: null,
    timeZone: s.timezone || DEFAULT_TZ,
  })
}
