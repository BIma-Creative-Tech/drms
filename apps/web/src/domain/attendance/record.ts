import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { relId } from '@/access/roles'
import { resolveScope } from '@/access/scope'
import { haversineM, insideGeofence, localDateString, type AttendanceKind } from '@/domain/sync/attendance'
import { getRequestTx } from '@/lib/tx'

import { snapshotOf, type ScheduleSnapshot } from './schedule'
import { effectiveRadiusM } from './calendar'

/**
 * E6 — the ONE write path of `attendances` (sync items attendance.check_in / check_out / on_behalf,
 * US-01/02/14, Q-40). Server-side checks, in this order (error codes are part of the APK contract):
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

export type Location = { type: 'project'; id: number } | { type: 'cost_center'; id: number }

type GeoDoc = { id: number; code?: string | null; name?: string | null; lat?: number | null; lng?: number | null; radiusM?: number | null; status?: string | null; active?: boolean | null }

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

const LABEL: Record<Location['type'], string> = { project: 'project', cost_center: 'pusat biaya' }

/** Is `employee` assigned to the location on `localDate` (team-assignments, start/end inclusive)? */
export async function isAssignedTo(req: PayloadRequest, employee: number, loc: Location, localDate: string): Promise<boolean> {
  const res = await req.payload.find({
    collection: 'team-assignments',
    where: { and: [{ employee: { equals: employee } }, { [loc.type === 'project' ? 'project' : 'costCenter']: { equals: loc.id } }] },
    depth: 0,
    pagination: false,
    overrideAccess: true, // SYSTEM-READ: assignment check of the attendance's employee
    req,
  })
  return (res.docs as Array<{ startDate?: string | null; endDate?: string | null }>).some((a) => {
    const start = a.startDate ? a.startDate.slice(0, 10) : null
    const end = a.endDate ? a.endDate.slice(0, 10) : null
    return (!start || start <= localDate) && (!end || end >= localDate)
  })
}

/** Current schedule of an employee: own work schedule, else the company default, else null. */
export async function scheduleOfEmployee(req: PayloadRequest, employee: number, defaultScheduleId?: number | null): Promise<ScheduleSnapshot | null> {
  const emp = (await req.payload.findByID({ collection: 'employees', id: employee, depth: 1, overrideAccess: true /* SYSTEM-READ: schedule of the employee */, req, disableErrors: true })) as {
    workSchedule?: unknown
  } | null
  const own = emp?.workSchedule && typeof emp.workSchedule === 'object' ? snapshotOf(emp.workSchedule as Record<string, unknown>) : null
  if (own) return own
  let defId = defaultScheduleId
  if (defId === undefined) {
    const s = (await req.payload.findGlobal({ slug: 'company-settings', depth: 0, overrideAccess: true /* SYSTEM-READ: default schedule */, req })) as { defaultWorkSchedule?: unknown }
    defId = relId(s.defaultWorkSchedule) ?? null
  }
  if (!defId) return null
  const doc = await req.payload.findByID({ collection: 'work-schedules', id: defId, depth: 0, overrideAccess: true /* SYSTEM-READ: default schedule */, req, disableErrors: true })
  return snapshotOf(doc as Record<string, unknown> | null)
}

/** Account linked to an employee (users.employee), or null. */
export async function userOfEmployee(req: PayloadRequest, employee: number): Promise<number | null> {
  const res = await req.payload.find({
    collection: 'users',
    where: { employee: { equals: employee } },
    depth: 0,
    limit: 1,
    select: { email: true },
    overrideAccess: true, // SYSTEM-READ: account of the attendance's employee
    req,
  })
  return (res.docs[0]?.id as number | undefined) ?? null
}

async function loadLocation(req: PayloadRequest, loc: Location, field: string): Promise<GeoDoc> {
  const doc = (await req.payload.findByID({
    collection: loc.type === 'project' ? 'projects' : 'cost-centers',
    id: loc.id,
    depth: 0,
    overrideAccess: true, // SYSTEM-READ: geofence of the target location
    req,
    disableErrors: true,
  })) as GeoDoc | null
  if (!doc) return reject('NOT_FOUND', loc.type === 'project' ? 'Project tidak ditemukan.' : 'Pusat biaya tidak ditemukan.', field)
  if (loc.type === 'project' && doc.status === 'arsip') reject('VALIDATION', 'Project sudah diarsipkan.', field)
  if (loc.type === 'cost_center' && doc.active === false) reject('VALIDATION', 'Pusat biaya sudah dinonaktifkan.', field)
  if (typeof doc.lat !== 'number' || typeof doc.lng !== 'number') {
    reject('NO_GEOFENCE', `Titik lokasi ${LABEL[loc.type]} belum diisi Admin. Absensi belum bisa dipakai di ${LABEL[loc.type]} ini.`, field)
  }
  if (typeof doc.radiusM !== 'number') {
    // S3e (US-01, S-19): a point without its own radius uses the company default radius.
    const s = (await req.payload.findGlobal({ slug: 'company-settings', depth: 0, overrideAccess: true /* SYSTEM-READ: default geofence radius */, req })) as { defaultGeofenceRadiusM?: number | null }
    return { ...doc, radiusM: effectiveRadiusM(null, s.defaultGeofenceRadiusM) }
  }
  return doc
}

type DayRow = { id: number; kind: AttendanceKind; effective_time: string }

/** Rows of this employee at this location on the local date, with the effective (corrected) time. */
export async function dayRowsAt(req: PayloadRequest, employee: number, loc: Location, localDate: string): Promise<DayRow[]> {
  const tx = await getRequestTx(req)
  const col = loc.type === 'project' ? sql`a.project_id` : sql`a.cost_center_id`
  const r = (await tx.execute(sql`
    SELECT a.id, a.kind, coalesce(c.new_time, a.attendance_time) AS effective_time
    FROM attendances a
    LEFT JOIN LATERAL (SELECT new_time FROM attendance_corrections c WHERE c.attendance_id = a.id ORDER BY c.id DESC LIMIT 1) c ON TRUE
    WHERE a.employee_id = ${employee} AND ${col} = ${loc.id} AND a.local_date = ${localDate}
    ORDER BY effective_time`)) as unknown as { rows: DayRow[] }
  return r.rows
}

/** Records one attendance after every server-side check. Returns the new row id. */
export async function recordAttendance(req: PayloadRequest, input: RecordInput): Promise<{ id: number; localDate: string }> {
  const pre = input.fieldPrefix ?? 'payload.'
  const locField = `${pre}${input.location.type === 'project' ? 'project_id' : 'cost_center_id'}`
  // ADR 0010 decision 8 / US-01 "Mock location ditolak" (Q-43 proposal: fake GPS always blocked).
  if (input.isMocked) reject('MOCK_LOCATION', 'Lokasi palsu (mock location) terdeteksi. Absensi ditolak.', `${pre}is_mocked`)
  const geo = await loadLocation(req, input.location, locField)
  const localDate = localDateString(input.time, input.timeZone)
  if (input.source === 'pm') {
    // US-14: only for the PM's own team locations (the team scope of the CALLER).
    const scope = await resolveScope(req)
    const team = input.location.type === 'project' ? scope.teamProjects : scope.teamCostCenters
    if (!team.includes(input.location.id)) reject('FORBIDDEN', `Hanya untuk ${LABEL[input.location.type]} tim Anda.`, locField)
  }
  if (!(await isAssignedTo(req, input.employee, input.location, localDate))) {
    reject(
      'NOT_ASSIGNED',
      input.source === 'pm'
        ? `Karyawan ini tidak ditugaskan di ${LABEL[input.location.type]} ini pada tanggal tersebut.`
        : `Anda tidak ditugaskan di ${LABEL[input.location.type]} ini pada tanggal tersebut.`,
      locField,
    )
  }
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
  const where = input.location.type === 'project' ? 'project' : 'pusat biaya'
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
  return { id: created.id as number, localDate }
}
