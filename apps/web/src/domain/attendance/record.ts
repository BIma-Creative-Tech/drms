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
import { CHECK_OUT_ELSEWHERE_FLAG, geofenceRequired, NON_ONSITE_OUTSIDE, NOT_ELIGIBLE_OTHER_PT, pickContaining } from './area'
import { eligibleLocations, employeeAttendance, type EmployeeAttendance } from './eligibility'
import { companyOf, settings, userOfEmployee as userOfEmployeeLink } from '@/domain/companies'
import { closedProjectMessage, isClosedProjectStatus } from '@/domain/projects/status'

/**
 * E6 — the ONE write path of `attendances` (sync items attendance.check_in / check_out / on_behalf,
 * US-01/02/14, Q-40). A location is a project or a cost center (ADR 0032: no site any more — a `site` stays only in
 * the history rows of ADR 0023). WHERE an employee may check in follows the employee's attendance type, no team
 * assignment needed (DRMS 13/10 A2) — OnSite: inside the CHOSEN registered location of the own PT; Non-OnSite
 * (ADR 0032): inside ANY registered location of the own PT, picked by the server (`resolveNonOnsite`), outside every
 * one → refused OUTSIDE_GEOFENCE. A PM on-behalf still needs the requested location in the PM's team. Server-side
 * checks, in this order (error codes are part of the APK contract; `NOT_ASSIGNED` = a location outside the employee's PT):
 * MOCK_LOCATION → NOT_FOUND/VALIDATION (location) → NO_GEOFENCE (OnSite) → NOT_ASSIGNED → OUTSIDE_GEOFENCE →
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

/** ADR 0032: refusal of a check-in at a site (sites are no longer attendance locations). */
export const SITE_REMOVED = 'Site tidak lagi dipakai sebagai lokasi absen. Pilih lokasi project (atau pusat biaya).'

/**
 * Current schedule of an employee: own work schedule, else the company default, else null (ADR 0032: the home-site
 * default of ADR 0023 §3 is gone with the sites).
 */
export async function scheduleOfEmployee(req: PayloadRequest, employee: number, defaultScheduleId?: number | null): Promise<ScheduleSnapshot | null> {
  const emp = (await req.payload.findByID({ collection: 'employees', id: employee, depth: 1, overrideAccess: true /* SYSTEM-READ: schedule of the employee */, req, disableErrors: true })) as {
    workSchedule?: unknown
  } | null
  const own = emp?.workSchedule && typeof emp.workSchedule === 'object' ? snapshotOf(emp.workSchedule as Record<string, unknown>) : null
  if (own) return own
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

/** The location document (NOT_FOUND for a missing / unmapped PT's one, VALIDATION when archived / inactive). */
async function loadLocationDoc(req: PayloadRequest, loc: Location, field: string): Promise<GeoDoc> {
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
  if (loc.type === 'project' && isClosedProjectStatus(doc.status)) reject('VALIDATION', closedProjectMessage(doc.status), field)
  if (loc.type === 'cost_center' && doc.active === false) reject('VALIDATION', 'Pusat biaya sudah dinonaktifkan.', field)
  if (loc.type === 'site' && doc.active === false) reject('VALIDATION', 'Site sudah dinonaktifkan.', field)
  return doc
}

/** The geofence of a location document: NO_GEOFENCE without a point; empty radius → the PT default. */
async function withGeofence(req: PayloadRequest, doc: GeoDoc, loc: Location, field: string): Promise<GeoDoc> {
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

/**
 * DRMS 13/10 A2: the location of the employee's open check-in (no check-out yet) on `localDate`, latest first; null
 * when none. PT-bound (`company_id`).
 */
async function openCheckIn(req: PayloadRequest, company: number, employee: number, localDate: string): Promise<Location | null> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT a.project_id, a.cost_center_id, CASE WHEN a.project_id IS NULL AND a.cost_center_id IS NULL THEN a.site_id END AS site_id
    FROM attendances a
    WHERE a.company_id = ${company} AND a.employee_id = ${employee} AND a.local_date = ${localDate}
    GROUP BY 1, 2, 3
    HAVING bool_or(a.kind = 'check_in') AND NOT bool_or(a.kind = 'check_out')
    ORDER BY max(a.attendance_time) DESC
    LIMIT 1`)) as unknown as { rows: Array<{ project_id: number | null; cost_center_id: number | null; site_id: number | null }> }
  const x = r.rows[0]
  if (!x) return null
  return x.project_id !== null ? { type: 'project', id: Number(x.project_id) } : x.cost_center_id !== null ? { type: 'cost_center', id: Number(x.cost_center_id) } : { type: 'site', id: Number(x.site_id) }
}

type Resolved = { location: Location; distance: number; outsideArea: boolean; flags: string[] }

const measure = (input: Pick<RecordInput, 'lat' | 'lng'>, doc: { lat?: number | null; lng?: number | null }) =>
  typeof doc.lat === 'number' && typeof doc.lng === 'number' ? Math.round(haversineM(input.lat, input.lng, doc.lat, doc.lng)) : null

/** Point of a location row (no status checks: the open check-in of the day may sit at a since-closed location). */
async function pointOf(req: PayloadRequest, loc: Location): Promise<{ lat?: number | null; lng?: number | null }> {
  const doc = await req.payload.findByID({ collection: LOCATION_COLLECTION[loc.type], id: loc.id, depth: 0, overrideAccess: true /* SYSTEM-READ: point of the open check-in's location */, req, disableErrors: true })
  return (doc as { lat?: number | null; lng?: number | null } | null) ?? {}
}

/**
 * Non-OnSite (ADR 0032, user decision 2026-10-24): check-in AND check-out only inside the geofence of ANY registered
 * location of the own PT (no assignment). WHERE the record belongs:
 * - the requested location when the fix lies inside it, else the nearest registered location containing the fix;
 *   none → OUTSIDE_GEOFENCE (no "Di luar area" record any more);
 * - a check-out with an open check-in today closes that pair: recorded at the open check-in's location; when the fix
 *   lies inside ANOTHER registered location the row carries the flag CHECK_OUT_ELSEWHERE and `distance_m` = the
 *   distance to the open location.
 */
async function resolveNonOnsite(req: PayloadRequest, emp: EmployeeAttendance, input: RecordInput, localDate: string, pre: string): Promise<Resolved> {
  const fix = { lat: input.lat, lng: input.lng, accuracyM: input.accuracyM }
  const candidates = (await eligibleLocations(req, [emp])).map((l) => ({ ...l, key: `${l.kind}:${l.id}` }))
  const hit = pickContaining(`${input.location.type}:${input.location.id}`, candidates, fix)
  if (!hit) return reject('OUTSIDE_GEOFENCE', NON_ONSITE_OUTSIDE, `${pre}lat`)
  if (input.kind === 'check_out') {
    const open = await openCheckIn(req, emp.company, emp.id, localDate)
    if (open && `${open.type}:${open.id}` !== hit.key) {
      // the open check-in itself contains the fix too (overlapping geofences) → no flag
      const own = candidates.find((x) => x.key === `${open.type}:${open.id}`)
      const inOwn = own ? pickContaining(own.key, [own], fix) : null
      if (inOwn) return { location: open, distance: inOwn.distanceM, outsideArea: false, flags: [] }
      const d = measure(input, await pointOf(req, open))
      return { location: open, distance: d ?? 0, outsideArea: false, flags: [CHECK_OUT_ELSEWHERE_FLAG] }
    }
  }
  return { location: { type: hit.kind, id: hit.id }, distance: hit.distanceM, outsideArea: false, flags: [] }
}

export type RecordResult = { id: number; localDate: string; location: Location; outsideArea: boolean; distanceM: number }

/** Records one attendance after every server-side check. Returns the new row id. */
export async function recordAttendance(req: PayloadRequest, input: RecordInput): Promise<RecordResult> {
  const pre = input.fieldPrefix ?? 'payload.'
  const locField = `${pre}${LOCATION_FIELD[input.location.type]}`
  // ADR 0010 decision 8 / US-01 "Mock location ditolak" (Q-43 proposal: fake GPS always blocked).
  if (input.isMocked) reject('MOCK_LOCATION', 'Lokasi palsu (mock location) terdeteksi. Absensi ditolak.', `${pre}is_mocked`)
  const doc = await loadLocationDoc(req, input.location, locField)
  const company = relId((doc as { company?: unknown }).company)
  const emp = await employeeAttendance(req, input.employee)
  const onsite = !emp || geofenceRequired(emp.type)
  // ADR 0032: a site is no longer a check-in location (old APKs may still send `site_id`)
  if (input.location.type === 'site' && onsite) reject('VALIDATION', SITE_REMOVED, locField)
  // OnSite: the requested location needs a point (Non-OnSite: the server picks a registered location containing the fix)
  const geo = onsite ? await withGeofence(req, doc, input.location, locField) : doc
  const localDate = localDateString(input.time, input.timeZone)
  if (input.source === 'pm') {
    // US-14: only for the PM's own team locations (the team scope of the CALLER).
    // ADR 0016 §5: PM role + team scope IN THE LOCATION's PT
    if (!hasRole(req, 'pk-pm', company)) reject('FORBIDDEN', `Hanya untuk ${LABEL[input.location.type]} tim Anda.`, locField)
    const scope = await resolveScope(req, company ?? null)
    // ADR 0032: no site in a PM's team any more
    const team = input.location.type === 'project' ? scope.teamProjects : input.location.type === 'site' ? [] : scope.teamCostCenters
    if (!team.includes(input.location.id)) reject('FORBIDDEN', `Hanya untuk ${LABEL[input.location.type]} tim Anda.`, locField)
  }
  // DRMS 13/10 A2: own PT only (normally caught earlier as NOT_FOUND / COMPANY_MISMATCH; the DB trigger too)
  if (!emp || emp.company !== company) reject('NOT_ASSIGNED', NOT_ELIGIBLE_OTHER_PT, locField)
  let resolved: Resolved
  if (onsite) {
    const d = Math.round(haversineM(input.lat, input.lng, geo.lat!, geo.lng!))
    if (!insideGeofence(d, geo.radiusM!, input.accuracyM)) {
      reject('OUTSIDE_GEOFENCE', `Di luar radius ${LABEL[input.location.type]} (${d} m dari titik, radius ${geo.radiusM} m).`, `${pre}lat`)
    }
    resolved = { location: input.location, distance: d, outsideArea: false, flags: [] }
  } else {
    resolved = await resolveNonOnsite(req, emp!, input, localDate, pre)
  }
  const location = resolved.location
  const distance = resolved.distance
  const selfie = (await req.payload.findByID({ collection: 'media-selfies', id: input.selfieId, depth: 0, overrideAccess: true /* SYSTEM-READ: existence + uploader */, req, disableErrors: true })) as {
    uploadedBy?: unknown
  } | null
  if (!selfie) reject('MEDIA_MISSING', 'Selfie belum terunggah (POST /api/v1/media/selfies).', `${pre}selfie_media_id`)
  if (relId(selfie!.uploadedBy) !== input.uploader) reject('FORBIDDEN', 'Selfie bukan unggahan Anda.', `${pre}selfie_media_id`)

  // One check-in and one check-out per employee/location/local date (serialised per day).
  const tx = await getRequestTx(req)
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`att:${input.employee}:${location.type}:${location.id}:${localDate}`}, 0))`)
  const today = await dayRowsAt(req, input.employee, location, localDate)
  const checkIn = today.find((r) => r.kind === 'check_in')
  const where = LABEL[location.type]
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
      project: location.type === 'project' ? location.id : null,
      costCenter: location.type === 'cost_center' ? location.id : null,
      // ADR 0023: the DB (pk_attendance_site) fills the project's site for a project check-in; NULL for a cost center
      site: location.type === 'site' ? location.id : null,
      // DRMS 13/10 A2 "Di luar area" — ADR 0032: never set for a new row (Non-OnSite outside every location is refused)
      outsideArea: resolved.outsideArea,
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
      flags: [...input.flags, ...resolved.flags],
      schedule,
      clientUuid: input.clientUuid,
    },
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: attendance after the server-side checks above (create is closed for HTTP)
    req,
  })
  // D7: timestamp band burnt into the selfie by the worker (same transaction → no job for a rolled-back row)
  await req.payload.jobs.queue({ task: 'stampSelfie', input: { attendanceId: created.id as number }, req })
  return { id: created.id as number, localDate, location, outsideArea: resolved.outsideArea, distanceM: distance }
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
export async function recordWebAttendance(req: PayloadRequest, kind: AttendanceKind, input: WebCheckInput): Promise<RecordResult> {
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
