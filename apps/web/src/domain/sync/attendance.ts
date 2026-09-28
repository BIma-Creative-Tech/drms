import type { PayloadRequest } from 'payload'

import { DEFAULT_TZ, localDateInTz } from '@/lib/time'

import type { TimeVerdict } from './clock'
import { displayEmployeeByUser } from '@/domain/companies'

/**
 * Attendance helpers of the sync service (US-01/US-02, ADR 0010 decision 8). Pure helpers are
 * exported for unit tests; the checks + the write live in domain/attendance/record.ts (E6).
 */

export type AttendanceKind = 'check_in' | 'check_out'

/** GPS accuracy added to the geofence radius is capped (a 2 km "accuracy" must not widen the fence). */
export const ACCURACY_ALLOWANCE_CAP_M = 50

/** Great-circle distance in metres (haversine, mean Earth radius 6 371 008.8 m). */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_008.8
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Inside when distance ≤ radius + min(accuracy, cap). */
export function insideGeofence(distanceM: number, radiusM: number, accuracyM: number | null | undefined): boolean {
  const allowance = Math.min(Math.max(accuracyM ?? 0, 0), ACCURACY_ALLOWANCE_CAP_M)
  return distanceM <= radiusM + allowance
}

/**
 * The time that counts (QM-3 proposal): online → server receive time; offline with a trusted monotonic
 * estimate → the estimate; otherwise the device clock, flagged DEVICE_TIME_ONLY for PM review.
 */
export function attendanceTimeOf(verdict: TimeVerdict, deviceTime: string, receivedAt: Date): { time: Date; flags: string[] } {
  if (verdict.timeTrust === 'server') return { time: receivedAt, flags: [] }
  if (verdict.timeTrust === 'estimated' && verdict.estimatedTime) return { time: new Date(verdict.estimatedTime), flags: [] }
  return { time: new Date(deviceTime), flags: ['DEVICE_TIME_ONLY'] }
}

export function localDateString(instant: Date, timeZone: string = DEFAULT_TZ): string {
  const d = localDateInTz(instant, timeZone)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.year}-${two(d.month)}-${two(d.day)}`
}

/**
 * Employee linked to the user account (membership employee, ADR 0016 §2) in `companyId` when given
 * (a person in two PTs has two employees — the sync service passes the location's PT), else the
 * first membership with an employee; undefined when none.
 */
export async function employeeOfUser(req: PayloadRequest, uid: number, companyId?: number): Promise<number | undefined> {
  return (await displayEmployeeByUser(req, [uid], companyId)).get(uid)
}
