import type { OpenAPIRegistry, RouteConfig } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

import * as A from './schemas-attendance'

type Helpers = {
  security: Array<Record<string, string[]>>
  deviceHeader: z.ZodObject
  idem: z.ZodObject
  res: (code: number, description: string, schema: z.ZodType, errors: number[]) => RouteConfig['responses']
  problemResponses: (...codes: number[]) => RouteConfig['responses']
}

/** E6 attendance paths (US-09/13/15, Q-33). Pure (bundled by scripts/gen-openapi.mjs). */
export function registerAttendancePaths(registry: OpenAPIRegistry, h: Helpers): void {
  const idParam = z.object({ id: z.string().regex(/^\d+$/) })
  registry.registerPath({
    method: 'get',
    path: '/attendance/me',
    summary: 'US-09 own monthly attendance recap (every day of the month up to today: check-in/out, duration, late / early minutes, holiday/off-day flags, PM on-behalf, corrections)',
    security: h.security,
    request: { headers: h.deviceHeader, query: A.AttendanceMonthQuery },
    responses: h.res(200, 'Recap', A.AttendanceRecap, [400, 401, 409, 426, 429]),
  })
  registry.registerPath({
    method: 'get',
    path: '/attendance/recap',
    summary: 'Monthly recap of one employee: PM for team members (team locations only), Admin/Direktur/Finance all',
    security: h.security,
    request: { headers: h.deviceHeader, query: A.AttendanceRecapQuery },
    responses: h.res(200, 'Recap', A.AttendanceRecap, [400, 401, 403, 404, 426, 429]),
  })
  registry.registerPath({
    method: 'get',
    path: '/attendance/team-today',
    summary: 'US-13 team presence for a date (belum absen / hadir / selesai per member): PM team, Admin/Direktur/Finance all',
    security: h.security,
    request: { headers: h.deviceHeader, query: A.TeamTodayQuery },
    responses: h.res(200, 'Team presence', A.TeamToday, [400, 401, 403, 426, 429]),
  })
  registry.registerPath({
    method: 'get',
    path: '/attendance/team-month',
    summary: 'DRMS 26/10 #3: monthly summary per employee of the caller\'s attendance scope (same list and numbers as the web team grid /admin/absensi/rekap): PM team, Admin/Admin Staff/Direktur/Finance all of the PT; day detail via /attendance/recap',
    security: h.security,
    request: { headers: h.deviceHeader, query: A.TeamMonthQuery },
    responses: h.res(200, 'Team month', A.TeamMonth, [400, 401, 403, 426, 429]),
  })
  registry.registerPath({
    method: 'get',
    path: '/attendance/locations',
    summary:
      'DRMS 13/10 A2: registered check-in locations of the caller (own employee per selected PT): every location of the PT with a point (projects, cost centers — ADR 0032: no site; no assignment needed). OnSite must check in inside the chosen one; Non-OnSite anywhere (DRMS 26/10: the one containing the fix, picked automatically; outside all → recorded "Di luar area" at the nearest one). Coordinates and radius only (no money). The APK matches the GPS fix against this list (auto-detect) and caches it for offline check-ins; the server re-validates each check-in',
    security: h.security,
    request: { headers: h.deviceHeader, query: A.AttendanceLocationsQuery },
    responses: h.res(200, 'Eligible locations', A.AttendanceLocations, [400, 401, 403, 426, 429]),
  })
  registry.registerPath({
    method: 'post',
    path: '/attendance/check-in',
    summary: 'Owner decision 2026-10-09: web self check-in, every role. Selfie first with POST /media/selfies. Synchronous counterpart of the APK sync item attendance.check_in — same gates (company-settings.syncAttendanceEnabled, else FEATURE_DISABLED; ADR 0018 privacy ack, else PRIVACY_ACK_REQUIRED) and rejection codes (MOCK_LOCATION never applies on web; NOT_FOUND, VALIDATION, NO_GEOFENCE, NOT_ASSIGNED = location outside the PT of the employee, OUTSIDE_GEOFENCE (OnSite: outside the chosen location; DRMS 26/10: a Non-OnSite check-in outside every registered location is recorded "Di luar area", see the result), MEDIA_MISSING, FORBIDDEN, ALREADY_CHECKED_IN)',
    security: h.security,
    request: { headers: h.deviceHeader, body: { content: { 'application/json': { schema: A.AttendanceCheckBody } } } },
    responses: h.res(201, 'Recorded', A.AttendanceCheckResult, [400, 401, 403, 404, 409, 426, 429]),
  })
  registry.registerPath({
    method: 'post',
    path: '/attendance/check-out',
    summary: 'Owner decision 2026-10-09: web self check-out, every role. Same gates/codes as /attendance/check-in, plus NO_CHECK_IN and ALREADY_CHECKED_OUT',
    security: h.security,
    request: { headers: h.deviceHeader, body: { content: { 'application/json': { schema: A.AttendanceCheckBody } } } },
    responses: h.res(201, 'Recorded', A.AttendanceCheckResult, [400, 401, 403, 404, 409, 426, 429]),
  })
  registry.registerPath({
    method: 'get',
    path: '/attendance/on-behalf/options',
    summary: 'ADR 0032: Admin Staff (pk-admin-staff) — per PT of the selection where the caller holds the role: the active employees (own excluded; also those without an account, hasAccount false) and the registered check-in locations with their point. Names, codes and points only. The APK caches it for offline on-behalf items. DRMS 24/10: a PM (not Admin Staff of the PT) gets its TEAM only — employees assigned today to its team projects / cost centers and those team locations (web Absenkan karyawan)',
    security: h.security,
    request: { headers: h.deviceHeader, query: A.AttendanceOnBehalfOptionsQuery },
    responses: h.res(200, 'On-behalf options', A.AttendanceOnBehalfOptions, [400, 401, 403, 426, 429]),
  })
  registry.registerPath({
    method: 'post',
    path: '/attendance/on-behalf',
    summary: 'ADR 0032: Admin Staff check-in / check-out ON BEHALF of an employee of its PT (also without an account) from the web. Photo of the employee first with POST /media/selfies (the caller\'s camera), GPS = the caller\'s; the employee\'s attendance-type rule is evaluated against that fix. Recorded with source admin ("diabsenkan oleh Admin Staff"), recorded_by = caller, reason. DRMS 24/10: a PM may record too, team-scoped (source pm; the employee assigned today to a team project / cost center, a team location — else FORBIDDEN). Gates and codes as /attendance/check-in, plus FORBIDDEN (no Admin Staff of the PT / own employee), COMPANY_MISMATCH (employee of another PT), NO_CHECK_IN, ALREADY_CHECKED_OUT',
    security: h.security,
    request: { headers: h.deviceHeader, body: { content: { 'application/json': { schema: A.AttendanceOnBehalfBody } } } },
    responses: h.res(201, 'Recorded', A.AttendanceCheckResult, [400, 401, 403, 404, 409, 426, 429]),
  })
  registry.registerPath({
    method: 'post',
    path: '/attendance/{id}/correct',
    summary: 'US-15 T10 correction of one attendance time (PM of the team location, Admin or — ADR 0032 — Admin Staff of the PT; never own attendance; reason required; same local date). Creates an append-only correction; audit old → new',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: { content: { 'application/json': { schema: A.AttendanceCorrectBody } } } },
    responses: h.res(201, 'Correction', A.AttendanceCorrection, [400, 401, 403, 404, 409, 422, 426, 429]),
  })
  registry.registerPath({
    method: 'get',
    path: '/attendance/{id}/selfie',
    summary: 'Selfie of a visible attendance (own, PM team, Admin/Direktur/Finance). Viewing another person’s selfie is audited view_sensitive. 404 once removed by retention (Q-33)',
    security: h.security,
    request: { headers: h.deviceHeader, params: idParam },
    responses: {
      200: { description: 'JPEG', content: { 'image/jpeg': { schema: z.string().meta({ format: 'binary' }) } } },
      ...h.problemResponses(401, 404, 426, 429),
    },
  })
  // User 2026-10-19 (APK phase 6): the web "Jadwal & hari libur" page + its default-schedule widget
  registry.registerPath({
    method: 'get',
    path: '/attendance/schedule',
    summary: 'The web "Jadwal & hari libur" page as JSON (attendance scope: Admin / Direktur / Finance / Owner / PM): work schedules (+ usage), holidays of `tahun`, cost-center geofences, active employees with their schedule, the context PT\'s default schedule and radius. Writes: POST/PATCH /data/{work-schedules|holidays|employees|cost-centers}',
    security: h.security,
    request: { headers: h.deviceHeader, query: A.AttendanceScheduleQuery },
    responses: h.res(200, 'Schedule', A.AttendanceSchedule, [400, 401, 403, 426, 429]),
  })
  registry.registerPath({
    method: 'patch',
    path: '/attendance/default-schedule',
    summary: 'Set companies.defaultWorkSchedule of a PT (Admin / Direktur of that PT or group admin; the schedule must belong to that PT). Audited by the companies collection',
    security: h.security,
    request: { headers: h.idem, body: { content: { 'application/json': { schema: A.AttendanceDefaultScheduleBody } } } },
    responses: h.res(200, 'Saved', A.AttendanceDefaultScheduleResult, [400, 401, 403, 404, 409, 426, 429]),
  })
}
