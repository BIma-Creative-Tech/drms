import { hasRoleAny, relId } from '@/access/roles'
import { settings as companySettings } from '@/domain/companies'
import { attendanceContext, attendanceScope } from '@/domain/attendance/queries'
import { withReqTransaction } from '@/lib/system-tx'

import { HttpError, json, v1 } from '../http'
import { AttendanceDefaultScheduleBody } from '../schemas-attendance'

/**
 * User 2026-10-19 (APK ↔ web parity, phase 6): the web "Jadwal & hari libur" page (admin/views/Absensi.tsx
 * AbsensiJadwal) as JSON — same gate (attendanceScope), same reads with the caller's access, same PT (the context PT of
 * the selection, companySettings). Writes:
 * - work schedules / holidays / an employee's `workSchedule` / a cost center's lat-lng-radius → the generic
 *   POST / PATCH /data/{collection} (Payload access + audit, like the web widgets' REST calls);
 * - the PT's default schedule → PATCH /attendance/default-schedule (the web widget patches companies.defaultWorkSchedule).
 */
const READ_LIMIT: [number, number] = [60, 60_000]
const WRITE_LIMIT: [number, number] = [30, 60_000]
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

export const attendanceScheduleEndpoint = v1({
  path: '/attendance/schedule',
  method: 'get',
  rateLimit: READ_LIMIT,
  handler: async ({ req }) => {
    const scope = await withReqTransaction(req, () => attendanceScope(req)).catch(() => null)
    if (!scope) throw new HttpError(403, 'Forbidden', { detail: 'Jadwal & hari libur hanya untuk Admin, Direktur, Finance, Owner dan PM.' })
    const raw = req.searchParams.get('tahun') ?? ''
    if (raw !== '' && !/^\d{4}$/.test(raw)) throw new HttpError(400, 'Bad Request', { errors: [{ path: 'tahun', message: 'tahun harus YYYY.' }] })
    // web: collection update access Admin + Owner (Direktur); create Admin only
    const canWrite = hasRoleAny(req, 'pk-admin', 'pk-owner')
    const canCreate = hasRoleAny(req, 'pk-admin')
    const d = await withReqTransaction(req, async () => {
      const ctx = await attendanceContext(req)
      const year = raw || ctx.today.slice(0, 4)
      const p = req.payload
      const user = req.user
      const ws = await p.find({ collection: 'work-schedules', limit: 200, depth: 0, sort: 'name', user, overrideAccess: false, req })
      const emps = await p.find({ collection: 'employees', where: { active: { equals: true } }, limit: 500, depth: 0, sort: 'name', select: { code: true, name: true, workSchedule: true }, user, overrideAccess: false, req })
      const hol = await p.find({ collection: 'holidays', where: { and: [{ date: { greater_than_equal: `${year}-01-01` } }, { date: { less_than_equal: `${year}-12-31` } }] }, limit: 400, depth: 0, sort: 'date', user, overrideAccess: false, req })
      const cc = await p.find({ collection: 'cost-centers', limit: 300, depth: 0, sort: 'code', user, overrideAccess: false, req })
      const s = await companySettings(req)
      const employees = emps.docs.map((e) => {
        const x = e as unknown as { id: number; code: string; name: string; workSchedule?: unknown }
        return { id: x.id, code: x.code, name: x.name, scheduleId: relId(x.workSchedule) ?? null }
      })
      const defaultScheduleId = relId(s.defaultWorkSchedule) ?? null
      const used = new Map<number, number>()
      for (const e of employees) {
        const k = e.scheduleId ?? defaultScheduleId
        if (k) used.set(k, (used.get(k) ?? 0) + 1)
      }
      return {
        year,
        today: ctx.today,
        companyId: s.companyId,
        defaultScheduleId,
        defaultRadius: (s.defaultGeofenceRadiusM as number | null | undefined) ?? 100,
        schedules: ws.docs.map((w) => {
          const x = w as unknown as { id: number; name: string; startTime: string; endTime: string; lateToleranceMin?: number | null; active?: boolean | null; workDays?: Record<string, boolean | null> | null }
          return {
            id: x.id,
            name: x.name,
            start: x.startTime,
            end: x.endTime,
            tol: x.lateToleranceMin ?? 15,
            // web: a missing flag = a work day, Sunday excepted (1 = Monday … 7 = Sunday)
            days: WEEK.map((k, i) => ((x.workDays?.[k] ?? k !== 'sun') ? i + 1 : 0)).filter((v) => v > 0),
            active: x.active !== false,
            used: used.get(x.id) ?? 0,
          }
        }),
        holidays: hol.docs.map((h) => ({ id: h.id as number, date: (h as { date: string }).date, name: (h as { name: string }).name })),
        costCenters: cc.docs.map((c) => {
          const x = c as unknown as { id: number; code: string; name: string; lat?: number | null; lng?: number | null; radiusM?: number | null; active?: boolean | null }
          return { id: x.id, code: x.code, name: x.name, lat: x.lat ?? null, lng: x.lng ?? null, radiusM: x.radiusM ?? null, active: x.active !== false }
        }),
        employees,
      }
    })
    return json({ ...d, canWrite, canCreate })
  },
})

/** PATCH /api/v1/attendance/default-schedule {companyId, scheduleId|null} — companies.defaultWorkSchedule (Admin/Direktur of that PT). */
export const attendanceDefaultScheduleEndpoint = v1({
  path: '/attendance/default-schedule',
  method: 'patch',
  body: AttendanceDefaultScheduleBody,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body }) => {
    // collection + field access of companies (Admin / Direktur of that PT, group admin); filterOptions = same PT
    const doc = (await req.payload.update({
      collection: 'companies',
      id: body.companyId,
      data: { defaultWorkSchedule: body.scheduleId },
      depth: 0,
      user: req.user,
      overrideAccess: false,
      req,
    })) as { id: number; defaultWorkSchedule?: unknown }
    return json({ companyId: doc.id, defaultScheduleId: relId(doc.defaultWorkSchedule) ?? null })
  },
})

export const ATTENDANCE_SCHEDULE_ENDPOINTS = [attendanceScheduleEndpoint, attendanceDefaultScheduleEndpoint]
