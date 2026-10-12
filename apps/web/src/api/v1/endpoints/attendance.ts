import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'

import type { PayloadRequest } from 'payload'
import type { z } from 'zod'

import { ownEmployees, relId, userId } from '@/access/roles'
import { writeAudit } from '@/audit/writer'
import { correctAttendance } from '@/domain/attendance/corrections'
import { AttendanceReject, locationOf, recordWebAttendance, type Location } from '@/domain/attendance/record'
import { employeeRecap, myRecap, teamTodayFor } from '@/domain/attendance/service'
import { fileSize, mediaPath } from '@/lib/media-files'
import { withReqTransaction } from '@/lib/system-tx'

import { companyQuery, singleCompanyQuery } from '../company-query'
import { HttpError, json, v1 } from '../http'
import { AttendanceCheckBody, AttendanceCorrectBody, AttendanceMonthQuery, AttendanceRecapQuery, TeamTodayQuery } from '../schemas-attendance'

/**
 * E6 attendance endpoints (APK + web S2). "Diabsenkan PM" is APK/sync-only (POST /sync/batch);
 * everything here is reads + T10 correction + the web self-service check-in/out (owner decision
 * 2026-10-09, every role).
 * - GET  /attendance/me?month=YYYY-MM                 US-09 own monthly recap (any role with an employee)
 * - GET  /attendance/recap?employee_id=&month=        recap of an employee: PM team / Admin, Owner, Finance
 * - GET  /attendance/team-today?date=&project_id=&cost_center_id=&site_id=   US-13 (PM team; office roles all)
 * - POST /attendance/check-in, /attendance/check-out  self-service web absen (every role)
 * - POST /attendance/{id}/correct {new_time, reason}  US-15 T10 (PM team / Admin; never own; idempotent)
 * - GET  /attendance/{id}/selfie                      selfie of a visible attendance; audited view_sensitive
 */
const READ_LIMIT: [number, number] = [60, 60_000]

const params = (req: { searchParams: URLSearchParams }) => Object.fromEntries(req.searchParams.entries())
const badQuery = (issues: Array<{ path: PropertyKey[]; message: string }>) =>
  new HttpError(400, 'Bad Request', { errors: issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) })

export const attendanceMeEndpoint = v1({
  path: '/attendance/me',
  method: 'get',
  rateLimit: READ_LIMIT,
  handler: async ({ req }) => {
    const q = AttendanceMonthQuery.safeParse(params(req))
    if (!q.success) throw badQuery(q.error.issues)
    // MC3: ?company= = the PT of the own employee (one employee per PT); default = first selected PT with an employee
    const company = await singleCompanyQuery(req)
    return json(await withReqTransaction(req, () => myRecap(req, q.data.month, company)))
  },
})

export const attendanceRecapEndpoint = v1({
  path: '/attendance/recap',
  method: 'get',
  roles: ['pk-pm', 'pk-finance', 'pk-owner', 'pk-admin'],
  rateLimit: READ_LIMIT,
  handler: async ({ req }) => {
    const q = AttendanceRecapQuery.safeParse(params(req))
    if (!q.success) throw badQuery(q.error.issues)
    return json(await withReqTransaction(req, () => employeeRecap(req, Number(q.data.employee_id), q.data.month)))
  },
})

export const teamTodayEndpoint = v1({
  path: '/attendance/team-today',
  method: 'get',
  roles: ['pk-pm', 'pk-finance', 'pk-owner', 'pk-admin'],
  rateLimit: READ_LIMIT,
  handler: async ({ req }) => {
    const q = TeamTodayQuery.safeParse(params(req))
    if (!q.success) throw badQuery(q.error.issues)
    const companyIds = await companyQuery(req)
    const r = await withReqTransaction(req, () =>
      teamTodayFor(req, {
        date: q.data.date,
        projectId: q.data.project_id ? Number(q.data.project_id) : undefined,
        costCenterId: q.data.cost_center_id ? Number(q.data.cost_center_id) : undefined,
        siteId: q.data.site_id ? Number(q.data.site_id) : undefined,
        companyIds,
      }),
    )
    return json(r)
  },
})

/** Domain error code → HTTP status (domain/attendance/record.ts AttendanceReject.code). */
const ATTENDANCE_REJECT_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  VALIDATION: 400,
  MOCK_LOCATION: 400,
  NO_GEOFENCE: 409,
  NOT_ASSIGNED: 403,
  OUTSIDE_GEOFENCE: 409,
  MEDIA_MISSING: 400,
  FORBIDDEN: 403,
  ALREADY_CHECKED_IN: 409,
  NO_CHECK_IN: 409,
  ALREADY_CHECKED_OUT: 409,
  FEATURE_DISABLED: 403,
  PRIVACY_ACK_REQUIRED: 403,
}

/** Shared handler of /attendance/check-in and /attendance/check-out (owner decision 2026-10-09). */
function webCheckHandler(kind: 'check_in' | 'check_out') {
  return async ({ req, body }: { req: PayloadRequest; body: z.infer<typeof AttendanceCheckBody> }) => {
    const location: Location = locationOf(body)
    try {
      const r = await recordWebAttendance(req, kind, { location, lat: body.lat, lng: body.lng, accuracyM: body.accuracy_m ?? null, selfieId: body.selfie_media_id })
      return json(r, 201)
    } catch (err) {
      if (err instanceof AttendanceReject) {
        throw new HttpError(ATTENDANCE_REJECT_STATUS[err.code] ?? 400, err.message, {
          code: err.code,
          ...(err.field ? { errors: [{ path: err.field, message: err.message }] } : {}),
        })
      }
      throw err
    }
  }
}

export const attendanceCheckInEndpoint = v1({
  path: '/attendance/check-in',
  method: 'post',
  body: AttendanceCheckBody,
  rateLimit: [30, 60_000],
  transactional: true,
  handler: webCheckHandler('check_in'),
})

export const attendanceCheckOutEndpoint = v1({
  path: '/attendance/check-out',
  method: 'post',
  body: AttendanceCheckBody,
  rateLimit: [30, 60_000],
  transactional: true,
  handler: webCheckHandler('check_out'),
})

export const correctAttendanceEndpoint = v1({
  path: '/attendance/:id/correct',
  method: 'post',
  roles: ['pk-pm', 'pk-admin', 'pk-owner', 'pk-finance'],
  body: AttendanceCorrectBody,
  rateLimit: [30, 60_000],
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params: p }) => {
    if (!/^\d{1,10}$/.test(p.id ?? '')) throw new HttpError(404, 'Not Found')
    return json(await correctAttendance(req, Number(p.id), body.new_time, body.reason), 201)
  },
})

/** view_sensitive throttle (ADR 0006 §4: 1 row per user/doc/10 min). In-process: one web instance. */
const lastView = new Map<string, number>()
function shouldAudit(key: string, now = Date.now()): boolean {
  const prev = lastView.get(key)
  if (prev !== undefined && now - prev < 10 * 60_000) return false
  lastView.set(key, now)
  if (lastView.size > 5000) for (const [k, t] of lastView) if (now - t >= 10 * 60_000) lastView.delete(k)
  return true
}

/**
 * Selfie of an attendance (Q-33: PM tim, Finance, Direktur, Admin; the employee sees their own).
 * Visibility = read access of the ATTENDANCE (collection rules: staff own, PM team/own, office all),
 * else 404. Viewing someone else's selfie is audited `view_sensitive` (throttled).
 */
export const attendanceSelfieEndpoint = v1({
  path: '/attendance/:id/selfie',
  method: 'get',
  rateLimit: [120, 60_000],
  handler: async ({ req, params: p }) => {
    if (!/^\d{1,10}$/.test(p.id ?? '')) throw new HttpError(404, 'Not Found')
    const id = Number(p.id)
    const att = (await req.payload
      .findByID({ collection: 'attendances', id, depth: 0, user: req.user, overrideAccess: false, req })
      .catch(() => null)) as { id: number; user?: unknown; employee?: unknown; selfie?: unknown } | null
    if (!att) throw new HttpError(404, 'Not Found')
    const selfieId = relId(att.selfie)
    const doc = selfieId
      ? ((await req.payload.findByID({ collection: 'media-selfies', id: selfieId, depth: 0, overrideAccess: true /* SYSTEM-READ: visibility = attendance read access (checked above) */, req }).catch(() => null)) as {
          filename?: string | null
          mimeType?: string | null
        } | null)
      : null
    const file = doc ? mediaPath(req.payload, 'media-selfies', doc.filename) : null
    const size = file ? await fileSize(file) : null
    // Missing file = removed by the retention job (Q-33) or never stored → 404 (the row stays).
    if (!file || size === null) throw new HttpError(404, 'Not Found', { detail: 'Selfie tidak tersedia (mungkin sudah melewati masa retensi).' })
    const uid = userId(req)
    // MC3: own = the attendance of ANY of the caller's employees (one per PT), not only the first PT's
    const attEmployee = relId(att.employee)
    const isOwn = relId(att.user) === uid || (attEmployee !== undefined && ownEmployees(req).includes(attEmployee))
    if (!isOwn && shouldAudit(`${uid}:attendance-selfie:${id}`)) {
      await withReqTransaction(req, () => writeAudit(req, [{ action: 'view_sensitive', docType: 'attendance', docId: String(id), field: 'selfie' }]))
    }
    const stream = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream<Uint8Array>
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': doc!.mimeType ?? 'image/jpeg',
        'Content-Length': String(size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `inline; filename="selfie-${id}.jpg"`,
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    })
  },
})

export const ATTENDANCE_ENDPOINTS = [
  attendanceMeEndpoint,
  attendanceRecapEndpoint,
  teamTodayEndpoint,
  attendanceCheckInEndpoint,
  attendanceCheckOutEndpoint,
  correctAttendanceEndpoint,
  attendanceSelfieEndpoint,
]
