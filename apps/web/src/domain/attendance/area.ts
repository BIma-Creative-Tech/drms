/**
 * DRMS 13/10 A2 (ADR 0023 amendment 2026-10-13) — attendance type of an employee (Karyawan OnSite / Non-OnSite) and
 * automatic area detection. PURE (no Payload, no Node APIs): shared by the server (domain/attendance/record.ts,
 * domain/attendance/eligibility.ts), the web self check-in form (client component) and the unit tests. The APK has
 * the same rules in Dart (apps/mobile/lib/features/attendance/domain/attendance.dart).
 *
 * - OnSite: may check in at ANY registered location of the own PT that has a point (site — incl. the head office —,
 *   project, cost center); no team assignment / home site needed.
 * - Non-OnSite (office staff): only at the PT's sites (head office "Kantor pusat" and branch offices).
 * The server stays authoritative (record.ts): eligible kind for the type, same PT, inside the geofence.
 */

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

export const ATTENDANCE_TYPES = ['onsite', 'non_onsite'] as const
export type AttendanceType = (typeof ATTENDANCE_TYPES)[number]

/**
 * Default of new and existing employees: `onsite`. OnSite allows a superset of what the assignment rule allowed
 * before (every assigned project / cost center / site and the home site are registered locations of the own PT), so
 * no check-in that worked before is refused after the migration. The Admin sets office staff to Non-OnSite.
 */
export const DEFAULT_ATTENDANCE_TYPE: AttendanceType = 'onsite'

export const ATTENDANCE_TYPE_LABEL: Record<AttendanceType, string> = { onsite: 'Karyawan OnSite', non_onsite: 'Karyawan Non-OnSite' }

export type LocationKind = 'project' | 'cost_center' | 'site'

/** Stored value → type (anything unknown / missing = the default). */
export function attendanceTypeOf(v: unknown): AttendanceType {
  return v === 'non_onsite' ? 'non_onsite' : DEFAULT_ATTENDANCE_TYPE
}

/** May an employee of `type` check in at a location of `kind` (same PT, with a point — checked separately)? */
export function kindAllowedFor(type: AttendanceType, kind: LocationKind): boolean {
  return type === 'onsite' || kind === 'site'
}

/** Rejection text (APK contract code `NOT_ASSIGNED`, kept for old APKs) of a location the type does not allow. */
export const NOT_ELIGIBLE_NON_ONSITE = 'Lokasi ini tidak termasuk area absen untuk karyawan Non-OnSite (hanya kantor pusat dan kantor cabang).'

/** Rejection text of a location outside the employee's PT (normally caught earlier as NOT_FOUND / COMPANY_MISMATCH). */
export const NOT_ELIGIBLE_OTHER_PT = 'Lokasi ini bukan lokasi terdaftar PT karyawan.'

export type AreaCandidate = { lat?: number | null; lng?: number | null; radiusM?: number | null }
export type AreaMatch<T> = T & { distanceM: number }
export type AreaDetection<T> = {
  /** Locations whose geofence contains the fix, nearest first (ties keep the input order: home site first). */
  inside: Array<AreaMatch<T>>
  /** Nearest location with a point (inside or not); null when none has a point. */
  nearest: AreaMatch<T> | null
}

/**
 * Automatic area detection: matches a GPS fix against the eligible locations. One location inside → it is the
 * area; several inside (overlapping geofences) → the nearest is proposed and the user picks; none → manual choice
 * (fallback) with the nearest one as a hint. Same distance / allowance rule as the server check.
 */
export function detectArea<T extends AreaCandidate>(items: readonly T[], fix: { lat: number; lng: number; accuracyM?: number | null }): AreaDetection<T> {
  const measured: Array<AreaMatch<T>> = []
  for (const it of items) {
    if (typeof it.lat !== 'number' || typeof it.lng !== 'number' || typeof it.radiusM !== 'number') continue
    measured.push({ ...it, distanceM: Math.round(haversineM(fix.lat, fix.lng, it.lat, it.lng)) })
  }
  // Array.prototype.sort is stable: equal distances keep the input order
  measured.sort((a, b) => a.distanceM - b.distanceM)
  return { inside: measured.filter((m) => insideGeofence(m.distanceM, m.radiusM as number, fix.accuracyM)), nearest: measured[0] ?? null }
}

/** Order of an eligible-location list: home site, head office, other sites, projects, cost centers; then by code. */
const KIND_RANK: Record<LocationKind, number> = { site: 2, project: 3, cost_center: 4 }
export function compareEligible(a: { kind: LocationKind; code: string; home?: boolean; isHeadOffice?: boolean }, b: { kind: LocationKind; code: string; home?: boolean; isHeadOffice?: boolean }): number {
  const rank = (x: typeof a) => (x.home ? 0 : x.kind === 'site' && x.isHeadOffice ? 1 : KIND_RANK[x.kind])
  return rank(a) - rank(b) || a.code.localeCompare(b.code)
}
