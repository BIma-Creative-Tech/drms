import { z } from 'zod'

import { companyFilterParam } from './schemas'

/**
 * E6 — attendance read/correct contract (US-09, US-13, US-15). Pure module (bundled by
 * scripts/gen-openapi.mjs). Writes of check-in/out and PM on-behalf go through POST /sync/batch
 * (schemas-sync.ts); this file covers the online endpoints.
 */
const id = z.number().int().positive()
const businessDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'YYYY-MM-DD')
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM')
const iso = z.string().meta({ description: 'UTC ISO-8601 instant.' })

export const AttendanceMonthQuery = z
  .object({
    month: month.optional().meta({ description: 'Default: current month (company TZ).' }),
    company: companyFilterParam.meta({ description: 'MC3: ONE PT = whose own employee (one employee per PT); default: the first selected PT with an employee. Outside the selection → 403 COMPANY_NOT_ALLOWED.' }),
  })
  .meta({ id: 'AttendanceMonthQuery' })
export const AttendanceRecapQuery = z
  .object({ employee_id: z.string().regex(/^\d{1,10}$/).meta({ description: 'employees id' }), month: month.optional() })
  .meta({ id: 'AttendanceRecapQuery' })
export const TeamTodayQuery = z
  .object({
    date: businessDate.optional().meta({ description: 'Default: today (company TZ); not in the future.' }),
    project_id: z.string().regex(/^\d{1,10}$/).optional(),
    cost_center_id: z.string().regex(/^\d{1,10}$/).optional(),
    company: companyFilterParam,
  })
  .meta({ id: 'TeamTodayQuery' })
export const TeamMonthQuery = z
  .object({
    month: month.optional().meta({ description: 'Default: current month (company TZ); not in the future.' }),
    project_id: z.string().regex(/^\d{1,10}$/).optional(),
    cost_center_id: z.string().regex(/^\d{1,10}$/).optional(),
    company: companyFilterParam,
  })
  .meta({ id: 'TeamMonthQuery' })

export const AttendanceCorrectBody = z
  .object({
    new_time: z.iso.datetime({ offset: true }).meta({ description: 'Corrected time (same local date as the attendance; not in the future).' }),
    reason: z.string({ error: 'Alasan wajib diisi.' }).trim().min(3, 'Alasan wajib diisi, minimal 3 karakter.').max(500, 'Alasan maksimal 500 karakter.').meta({ description: 'Mandatory (T10).' }),
  })
  .strict()
  .meta({ id: 'AttendanceCorrectBody' })

/** Exactly one of project_id / cost_center_id (ADR 0032: no site_id on the web). */
const oneLocation = (v: { project_id?: number; cost_center_id?: number }) => [v.project_id, v.cost_center_id].filter((x) => x !== undefined).length === 1
const oneLocationError = { message: 'Isi salah satu: project_id ATAU cost_center_id.', path: ['project_id'] }

/**
 * Web self-check-in/out (owner decision 2026-10-09, every role). The selfie is uploaded first with
 * POST /api/v1/media/selfies, same as the APK. No `is_mocked` (browser geolocation has no such
 * signal) and no on-behalf (PM "diabsenkan" stays APK/sync-only, POST /sync/batch).
 */
export const AttendanceCheckBody = z
  .object({
    project_id: id.optional().meta({ description: 'Project (exactly one of project_id / cost_center_id). OnSite: the fix must be inside it; Non-OnSite (ADR 0032): a hint — recorded at the registered location containing the fix (outside all → 409 OUTSIDE_GEOFENCE).' }),
    cost_center_id: id.optional().meta({ description: 'Cost center / operational location (E6, Q-40).' }),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy_m: z.number().min(0).max(10_000).nullable().optional().meta({ description: 'Browser GPS accuracy radius (m); up to 50 m is added to the geofence radius.' }),
    selfie_media_id: id.meta({ description: 'media-selfies id uploaded by the caller (POST /api/v1/media/selfies).' }),
  })
  .strict()
  .refine(oneLocation, oneLocationError)
  .meta({ id: 'AttendanceCheckBody' })

/**
 * ADR 0032 (DRMS 24/10): web on-behalf check-in / check-out by an Admin Staff of the employee's PT (Absensi ·
 * Absenkan karyawan) — any active employee of that PT, also one without an account. The selfie (photo of the employee)
 * is taken with the Admin Staff's device camera and uploaded first (POST /media/selfies); the GPS fix is the Admin
 * Staff's; the location rules of the EMPLOYEE's attendance type apply to that fix. Recorded with source `admin`,
 * recorded_by = the caller and the reason.
 */
export const AttendanceOnBehalfBody = z
  .object({
    employee_id: id.meta({ description: 'employees id of the Admin Staff\'s PT (may have no user account); never the caller\'s own.' }),
    kind: z.enum(['check_in', 'check_out']),
    project_id: id.optional().meta({ description: 'Project (exactly one of project_id / cost_center_id; a Non-OnSite employee: a hint, the registered location containing the fix is used).' }),
    cost_center_id: id.optional(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy_m: z.number().min(0).max(10_000).nullable().optional(),
    selfie_media_id: id.meta({ description: 'media-selfies id uploaded by the caller (photo of the employee).' }),
    reason: z.string({ error: 'Alasan wajib diisi.' }).trim().min(3, 'Alasan wajib diisi, minimal 3 karakter.').max(500, 'Alasan maksimal 500 karakter.').meta({ description: 'Why the Admin Staff records it (e.g. "tukang harian tanpa HP"). Required.' }),
  })
  .strict()
  .refine(oneLocation, oneLocationError)
  .meta({ id: 'AttendanceOnBehalfBody' })

/** ADR 0032: GET /attendance/on-behalf/options (`?company=` narrows, like the masters). */
export const AttendanceOnBehalfOptionsQuery = z.object({ company: companyFilterParam }).meta({ id: 'AttendanceOnBehalfOptionsQuery' })

export const AttendanceOnBehalfOptions = z
  .object({
    companies: z.array(z.object({ id, attendanceEnabled: z.boolean().meta({ description: 'company-settings.syncAttendanceEnabled of the PT.' }) })).meta({ description: 'PTs (of the selection) where the caller is Admin Staff.' }),
    employees: z
      .array(
        z.object({
          id,
          company: id,
          code: z.string(),
          name: z.string(),
          attendanceType: z.enum(['onsite', 'non_onsite']),
          hasAccount: z.boolean().meta({ description: 'false = an employee without a user account (e.g. tukang harian).' }),
        }),
      )
      .meta({ description: 'Active employees of those PTs, the caller\'s own excluded (by name).' }),
    locations: z
      .array(z.object({ kind: z.enum(['project', 'cost_center']), id, company: id, code: z.string(), name: z.string(), lat: z.number(), lng: z.number(), radiusM: z.number() }))
      .meta({ description: 'Registered check-in locations of those PTs with a point (projects, cost centers).' }),
  })
  .meta({ id: 'AttendanceOnBehalfOptions', description: 'ADR 0032: what an Admin Staff may record on behalf of. Names, codes and points only (no money, no bank data, no phone).' })

export const AttendanceCheckResult = z
  .object({
    id,
    localDate: businessDate,
    location: z.object({ type: z.enum(['project', 'cost_center', 'site']), id }).meta({ description: 'Where the record belongs (a Non-OnSite check-in: the registered location containing the fix; a check-out: the open check-in of the day). `site` = history only (ADR 0032).' }),
    outsideArea: z.boolean().meta({ description: 'DRMS 13/10 A2 "Di luar area" — ADR 0032: always false for a new record (Non-OnSite outside every location is refused).' }),
    distanceM: z.number().int().meta({ description: 'Distance to the point of `location` (m).' }),
  })
  .meta({ id: 'AttendanceCheckResult' })

const LocationRef = z
  .object({ type: z.enum(['project', 'cost_center', 'site']), id, code: z.string(), name: z.string() })
  .meta({ id: 'AttendanceLocationRef' })

const Stamp = z
  .object({ id, time: iso, source: z.enum(['self', 'pm', 'admin']).meta({ description: 'pm = diabsenkan PM, admin = diabsenkan Admin Staff (ADR 0032).' }), corrected: z.boolean(), outsideArea: z.boolean().optional().meta({ description: 'DRMS 13/10 A2: true = "Di luar area" (Non-OnSite outside every registered location; the location is the reference).' }) })
  .nullable()

const LocationDay = z.object({ location: LocationRef, checkIn: Stamp, checkOut: Stamp }).meta({ id: 'AttendanceLocationDay' })

export const ScheduleSnapshotSchema = z
  .object({
    id: id.nullable(),
    name: z.string(),
    start: z.string().meta({ description: 'HH:MM local' }),
    end: z.string(),
    toleranceMin: z.number().int(),
    workDays: z.array(z.number().int().min(1).max(7)).meta({ description: 'ISO weekdays (1 = Monday … 7 = Sunday).' }),
  })
  .nullable()
  .meta({ id: 'WorkScheduleSnapshot' })

export const AttendanceDay = z
  .object({
    date: businessDate,
    weekday: z.number().int().min(1).max(7),
    kind: z.enum(['workday', 'holiday', 'off', 'unscheduled']),
    holidayName: z.string().nullable(),
    status: z.enum(['selesai', 'hadir', 'belum_absen', 'tidak_hadir', 'libur', 'tanpa_jadwal']).meta({
      description: 'selesai = every check-in has a check-out; hadir = a location still open; tidak_hadir = past working day without check-in; libur = holiday/off day without attendance.',
    }),
    checkIn: iso.nullable().meta({ description: 'First effective check-in (corrections applied).' }),
    checkOut: iso.nullable().meta({ description: 'Last effective check-out, null while a location is still open.' }),
    checkInLocal: z.string().nullable().meta({ description: 'HH:MM company TZ' }),
    checkOutLocal: z.string().nullable(),
    workMinutes: z.number().int().nullable().meta({ description: 'Sum of closed check-in → check-out pairs.' }),
    lateMinutes: z.number().int().meta({ description: 'Minutes after the schedule start when above the tolerance; 0 on holidays/off days.' }),
    earlyLeaveMinutes: z.number().int(),
    onBehalf: z.boolean().meta({ description: 'At least one row "diabsenkan" — by the PM (US-14) or an Admin Staff (ADR 0032); names in onBehalfBy.' }),
    onBehalfBy: z.array(z.string()),
    corrected: z.boolean().meta({ description: 'At least one row corrected (T10).' }),
    flags: z.array(z.string()),
    locations: z.array(LocationDay),
  })
  .meta({ id: 'AttendanceDay' })

export const AttendanceSummary = z
  .object({
    presentDays: z.number().int(),
    workingDays: z.number().int().meta({ description: 'Scheduled working days up to today (holidays excluded).' }),
    absentDays: z.number().int(),
    lateDays: z.number().int(),
    lateMinutes: z.number().int(),
    earlyLeaveDays: z.number().int(),
    earlyLeaveMinutes: z.number().int(),
    workMinutes: z.number().int(),
    holidayWorkDays: z.number().int(),
    offDayWorkDays: z.number().int(),
    incompleteDays: z.number().int().meta({ description: 'Past days with a check-in but without check-out.' }),
    onBehalfDays: z.number().int(),
    correctedDays: z.number().int(),
  })
  .meta({ id: 'AttendanceSummary' })

export const AttendanceRecap = z
  .object({
    employee: z.object({ id, code: z.string(), name: z.string() }),
    month,
    from: businessDate,
    to: businessDate,
    timezone: z.string(),
    schedule: ScheduleSnapshotSchema,
    days: z.array(AttendanceDay).meta({ description: 'Every date of the month up to today.' }),
    summary: AttendanceSummary,
  })
  .meta({ id: 'AttendanceRecap' })

export const TeamToday = z
  .object({
    date: businessDate,
    timezone: z.string(),
    holidayName: z.string().nullable(),
    scope: z.enum(['all', 'team']),
    counts: z.object({ total: z.number().int(), belum_absen: z.number().int(), hadir: z.number().int(), selesai: z.number().int() }),
    members: z.array(
      z.object({
        employee: z.object({ id, code: z.string(), name: z.string() }),
        companyId: z.number().int().nullable().meta({ description: 'PT of the employee (MC2).' }),
        assigned: z.array(LocationRef),
        status: z.enum(['belum_absen', 'hadir', 'selesai']),
        checkIn: iso.nullable(),
        checkOut: iso.nullable(),
        checkInLocal: z.string().nullable(),
        checkOutLocal: z.string().nullable(),
        lateMinutes: z.number().int(),
        onBehalf: z.boolean(),
        corrected: z.boolean(),
        locations: z.array(LocationDay),
      }),
    ),
  })
  .meta({ id: 'TeamToday' })

export const TeamMonth = z
  .object({
    month,
    from: businessDate,
    to: businessDate,
    timezone: z.string(),
    scope: z.enum(['all', 'team']),
    employees: z.array(
      z.object({
        employee: z.object({ id, code: z.string(), name: z.string() }),
        companyId: z.number().int().nullable().meta({ description: 'PT of the employee (MC2).' }),
        summary: AttendanceSummary,
      }),
    ),
  })
  .meta({ id: 'TeamMonth' })

export const AttendanceCorrection = z
  .object({
    id,
    attendanceId: id,
    kind: z.enum(['check_in', 'check_out']),
    localDate: businessDate,
    oldTime: iso,
    newTime: iso,
    reason: z.string(),
  })
  .meta({ id: 'AttendanceCorrection' })

/** DRMS 13/10 A2: GET /attendance/locations (`?company=` narrows the selection, like the masters). */
export const AttendanceLocationsQuery = z.object({ company: companyFilterParam }).meta({ id: 'AttendanceLocationsQuery' })

/**
 * DRMS 13/10 A2 (ADR 0023 amendment 2026-10-13): the caller's eligible check-in locations — only what the APK needs to
 * recognise the area (id, kind, name, point, radius); no money, no budgets. Cached by the APK for offline check-ins;
 * the server re-validates every check-in (eligible for the type, same PT, inside the geofence).
 */
export const AttendanceLocations = z
  .object({
    employees: z
      .array(
        z.object({
          id,
          company: id,
          attendanceType: z.enum(['onsite', 'non_onsite']).meta({ description: 'onsite = inside the chosen registered location of the PT (outside the radius refused); non_onsite (ADR 0032) = inside ANY registered location of the PT (picked automatically; outside all → refused).' }),
          homeSiteId: id.nullable().meta({ description: 'ADR 0032: always null (sites removed; kept for APK ≤ 0.11.1).' }),
          referenceSite: z
            .object({ id, code: z.string(), name: z.string(), lat: z.number().nullable(), lng: z.number().nullable() })
            .nullable()
            .meta({ description: 'ADR 0032: always null — no "Di luar area" check-in any more (kept for APK ≤ 0.11.1).' }),
        }),
      )
      .meta({ description: "The caller's active employees in the selected PTs (one per PT)." }),
    items: z
      .array(
        z.object({
          kind: z.enum(['project', 'cost_center', 'site']),
          id,
          company: id,
          employeeId: id.meta({ description: "The caller's employee in that PT." }),
          code: z.string(),
          name: z.string(),
          lat: z.number(),
          lng: z.number(),
          radiusM: z.number().meta({ description: 'Own radius, else the PT default (the radius the server checks).' }),
          isHeadOffice: z.boolean().meta({ description: 'ADR 0032: always false (kept for APK ≤ 0.11.1).' }),
          home: z.boolean().meta({ description: 'ADR 0032: always false (kept for APK ≤ 0.11.1).' }),
        }),
      )
      .meta({ description: 'Eligible locations with a point: projects, then cost centers (by code). Locations without a point are never listed.' }),
  })
  .meta({ id: 'AttendanceLocations' })

// ---------------------------------------------------------------- phase 6 (APK): Jadwal & hari libur

/** User 2026-10-19 (APK): the web "Jadwal & hari libur" page (GET /attendance/schedule). */
export const AttendanceSchedule = z
  .object({
    year: z.string(),
    today: z.string(),
    companyId: z.number().int().meta({ description: 'Context PT of the selection (its settings: default schedule, default radius).' }),
    canWrite: z.boolean().meta({ description: 'Admin / Direktur: edit schedules, holidays, assignments, geofences, the default schedule.' }),
    canCreate: z.boolean().meta({ description: 'Admin: new schedule / holiday.' }),
    defaultScheduleId: z.number().int().nullable(),
    defaultRadius: z.number(),
    schedules: z.array(
      z.object({
        id: z.number().int(),
        name: z.string(),
        start: z.string(),
        end: z.string(),
        tol: z.number(),
        days: z.array(z.number().int().min(1).max(7)).meta({ description: '1 = Monday … 7 = Sunday.' }),
        active: z.boolean(),
        used: z.number().int().meta({ description: 'Active employees on it (own or via the default).' }),
      }),
    ),
    holidays: z.array(z.object({ id: z.number().int(), date: z.string(), name: z.string() })),
    costCenters: z.array(
      z.object({ id: z.number().int(), code: z.string(), name: z.string(), lat: z.number().nullable(), lng: z.number().nullable(), radiusM: z.number().nullable(), active: z.boolean() }),
    ),
    employees: z.array(z.object({ id: z.number().int(), code: z.string(), name: z.string(), scheduleId: z.number().int().nullable() })),
  })
  .meta({ id: 'AttendanceSchedule' })

export const AttendanceScheduleQuery = z.object({ tahun: z.string().regex(/^\d{4}$/).optional() }).meta({ id: 'AttendanceScheduleQuery' })

export const AttendanceDefaultScheduleBody = z
  .object({ companyId: z.number().int().positive(), scheduleId: z.number().int().positive().nullable() })
  .strict()
  .meta({ id: 'AttendanceDefaultScheduleBody' })

export const AttendanceDefaultScheduleResult = z
  .object({ companyId: z.number().int(), defaultScheduleId: z.number().int().nullable() })
  .meta({ id: 'AttendanceDefaultScheduleResult' })
