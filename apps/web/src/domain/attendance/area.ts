/**
 * DRMS 13/10 A2 (ADR 0023 amendment 2026-10-13) — attendance type of an employee (Karyawan OnSite / Non-OnSite) and
 * automatic area detection. PURE (no Payload, no Node APIs): shared by the server (domain/attendance/record.ts,
 * domain/attendance/eligibility.ts), the web self check-in form (client component) and the unit tests. The APK has
 * the same rules in Dart (apps/mobile/lib/features/attendance/domain/attendance.dart).
 *
 * ADR 0032 (DRMS 24/10, user decision; sites removed — registered locations = projects, plus cost centers with a point):
 * - OnSite: may check in at ANY registered location of the own PT that has a point; the fix must lie inside the CHOSEN
 *   location; no team assignment needed; outside the radius → refused.
 * - Non-OnSite (amendment 2026-10-26, DRMS 26/10, user decision — restores the rule of 14/10): check-in AND check-out
 *   ANYWHERE, no assignment needed. Inside the geofence of an active registered location of the own PT → recorded
 *   there (the containing one, the nearest when several); outside every location → NOT refused: recorded
 *   "Di luar area" (`outside_area`) referenced to the NEAREST registered location of the PT with the distance to it.
 * Both: own PT only, GPS fix required and stored, mock location refused, selfie / privacy rules unchanged. The server
 * stays authoritative (record.ts).
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
 * Default of new and existing employees: `onsite` (the chosen location must contain the fix). The Admin sets office
 * staff to Non-OnSite (any registered location of the PT, picked automatically).
 */
export const DEFAULT_ATTENDANCE_TYPE: AttendanceType = 'onsite'

export const ATTENDANCE_TYPE_LABEL: Record<AttendanceType, string> = { onsite: 'Karyawan OnSite', non_onsite: 'Karyawan Non-OnSite' }

/** ADR 0032: a registered check-in location (no site any more). */
export type LocationKind = 'project' | 'cost_center'

/** Stored value → type (anything unknown / missing = the default). */
export function attendanceTypeOf(v: unknown): AttendanceType {
  return v === 'non_onsite' ? 'non_onsite' : DEFAULT_ATTENDANCE_TYPE
}

/**
 * Does the type require the fix inside the CHOSEN location's geofence? OnSite yes; Non-OnSite no — the server picks the
 * registered location containing the fix, else records "Di luar area" (record.ts resolveNonOnsite, DRMS 26/10).
 */
export function geofenceRequired(type: AttendanceType): boolean {
  return type === 'onsite'
}

/**
 * Label of a Non-OnSite attendance recorded outside every registered location (ADR 0023 revision 2026-10-14; withdrawn
 * 24–26/10 by ADR 0032, back since its amendment 2026-10-26) — reports, recaps, APK history, web.
 */
export const OUTSIDE_AREA_LABEL = 'Di luar area'

/**
 * DRMS 26/10: note of a Non-OnSite check-in / check-out outside every registered location of the PT (web + APK show it
 * before the confirmation popup; the server records the row "Di luar area"). Until 26/10 this was a refusal text.
 */
export const NON_ONSITE_OUTSIDE = 'Di luar lokasi terdaftar — absen dicatat "Di luar area"'

/**
 * DRMS 26/10: refusal of a Non-OnSite attendance when the PT has no registered location with a point at all (nothing
 * to reference a "Di luar area" record to).
 */
export const NON_ONSITE_NO_LOCATION = 'Absen belum bisa dicatat: PT Anda belum punya lokasi terdaftar (project / pusat biaya) dengan titik koordinat. Hubungi Admin.'

/**
 * ADR 0032: flag of a Non-OnSite check-out recorded at the day's open check-in while the fix lies inside ANOTHER
 * registered location of the PT (the check-out closes the pair; `distance_m` = distance to the open location).
 */
export const CHECK_OUT_ELSEWHERE_FLAG = 'CHECK_OUT_ELSEWHERE'

/** Fact / recap flag of an outside-area attendance (`attendances.outside_area`). */
export const OUTSIDE_AREA_FLAG = 'OUTSIDE_AREA'

/** Rejection text of a location outside the employee's PT (normally caught earlier as NOT_FOUND / COMPANY_MISMATCH). */
export const NOT_ELIGIBLE_OTHER_PT = 'Lokasi ini bukan lokasi terdaftar PT karyawan.'

export type AreaCandidate = { lat?: number | null; lng?: number | null; radiusM?: number | null }
export type AreaMatch<T> = T & { distanceM: number }
export type AreaDetection<T> = {
  /** Locations whose geofence contains the fix, nearest first (ties keep the input order). */
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

/** Order of an eligible-location list: projects, then cost centers; then by code. */
const KIND_RANK: Record<LocationKind, number> = { project: 0, cost_center: 1 }
export function compareEligible(a: { kind: LocationKind; code: string }, b: { kind: LocationKind; code: string }): number {
  return KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.code.localeCompare(b.code)
}

/**
 * Non-OnSite resolution (server and clients): the requested location when the fix lies inside it, else the nearest
 * registered location containing the fix, else null (= "Di luar area", DRMS 26/10). `key` identifies a candidate
 * (`kind:id`).
 */
export function pickContaining<T extends AreaCandidate & { key: string }>(requestedKey: string | null, candidates: readonly T[], fix: { lat: number; lng: number; accuracyM?: number | null }): AreaMatch<T> | null {
  const d = detectArea(candidates, fix)
  return d.inside.find((m) => m.key === requestedKey) ?? d.inside[0] ?? null
}
