import { z } from 'zod'

/**
 * E6 — attendance read/correct contract (US-09, US-13, US-15). Pure module (bundled by
 * scripts/gen-openapi.mjs). Writes of check-in/out and PM on-behalf go through POST /sync/batch
 * (schemas-sync.ts); this file covers the online endpoints.
 */
const id = z.number().int().positive()
const businessDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'YYYY-MM-DD')
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM')
const iso = z.string().meta({ description: 'UTC ISO-8601 instant.' })

export const AttendanceMonthQuery = z.object({ month: month.optional().meta({ description: 'Default: current month (company TZ).' }) }).meta({ id: 'AttendanceMonthQuery' })
export const AttendanceRecapQuery = z
  .object({ employee_id: z.string().regex(/^\d{1,10}$/).meta({ description: 'employees id' }), month: month.optional() })
  .meta({ id: 'AttendanceRecapQuery' })
export const TeamTodayQuery = z
  .object({
    date: businessDate.optional().meta({ description: 'Default: today (company TZ); not in the future.' }),
    project_id: z.string().regex(/^\d{1,10}$/).optional(),
    cost_center_id: z.string().regex(/^\d{1,10}$/).optional(),
  })
  .meta({ id: 'TeamTodayQuery' })

export const AttendanceCorrectBody = z
  .object({
    new_time: z.iso.datetime({ offset: true }).meta({ description: 'Corrected time (same local date as the attendance; not in the future).' }),
    reason: z.string({ error: 'Alasan wajib diisi.' }).trim().min(3, 'Alasan wajib diisi, minimal 3 karakter.').max(500, 'Alasan maksimal 500 karakter.').meta({ description: 'Mandatory (T10).' }),
  })
  .strict()
  .meta({ id: 'AttendanceCorrectBody' })

const LocationRef = z
  .object({ type: z.enum(['project', 'cost_center']), id, code: z.string(), name: z.string() })
  .meta({ id: 'AttendanceLocationRef' })

const Stamp = z.object({ id, time: iso, source: z.enum(['self', 'pm']), corrected: z.boolean() }).nullable()

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
    onBehalf: z.boolean().meta({ description: 'At least one row "diabsenkan oleh PM" (US-14).' }),
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
