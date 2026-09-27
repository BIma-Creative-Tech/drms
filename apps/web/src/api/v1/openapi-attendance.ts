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
    method: 'post',
    path: '/attendance/{id}/correct',
    summary: 'US-15 T10 correction of one attendance time (PM of the team location or Admin; never own attendance; reason required; same local date). Creates an append-only correction; audit old → new',
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
}
