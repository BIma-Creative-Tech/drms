import { sql } from '@payloadcms/db-postgres'
import { APIError, type PayloadRequest } from 'payload'

import { hasRole, relId, userId } from '@/access/roles'
import { resolveScope } from '@/access/scope'
import { writeAudit, writeAuditDetached } from '@/audit/writer'
import { settings } from '@/domain/expense/common'
import { localDateString } from '@/domain/sync/attendance'
import { DEFAULT_TZ } from '@/lib/time'
import { getRequestTx } from '@/lib/tx'

import { dayRowsAt, type Location } from './record'

/**
 * T10 koreksi absensi (US-15; requirements v1.1 §4 "Absensi": PM "U koreksi team", Admin "R/U";
 * §8 T10 "Jam lama → baru … Wajib alasan"). DIRECT correction, no approval step: the plan
 * (fase1-golive E6) and the requirements define T10 as "oleh PM" with a mandatory reason, and ADR 0013
 * ("PM monitors only") is about expense approvals, not attendance.
 *
 * Who: the PM whose TEAM scope contains the attendance's project/cost center, or an Admin. Nobody
 * corrects their OWN attendance (403, audited `access_denied`). Owner/Finance: read only.
 * What: the time of ONE attendance row (check-in or check-out), on the same local date; a check-in
 * may not move after the effective check-out of that location/day and vice versa; not in the future.
 * How: an append-only `attendance-corrections` row (old = current effective time, new, reason) + an
 * audit row on the attendance (`update`, field attendanceTime, old → new, reason). The newest
 * correction is the effective time everywhere (recap, team today, report).
 */
export type CorrectionResult = {
  id: number
  attendanceId: number
  kind: 'check_in' | 'check_out'
  localDate: string
  oldTime: string
  newTime: string
  reason: string
}

type AttendanceRaw = {
  id: number
  employee?: unknown
  user?: unknown
  kind: 'check_in' | 'check_out'
  project?: unknown
  costCenter?: unknown
  localDate: string
  attendanceTime: string
}

/** Current effective time (newest correction, else the recorded time). */
async function effectiveTime(req: PayloadRequest, attendanceId: number, recorded: string): Promise<string> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`SELECT new_time FROM attendance_corrections WHERE attendance_id = ${attendanceId} ORDER BY id DESC LIMIT 1`)) as unknown as {
    rows: Array<{ new_time: string | Date }>
  }
  const v = r.rows[0]?.new_time
  return v ? new Date(v).toISOString() : new Date(recorded).toISOString()
}

async function deny(req: PayloadRequest, attendanceId: number, message: string): Promise<never> {
  await writeAuditDetached(req, [{ action: 'access_denied', docType: 'attendance', docId: String(attendanceId), field: 'attendanceTime', reason: message }])
  throw new APIError(message, 403, null, true)
}

export async function correctAttendance(req: PayloadRequest, attendanceId: number, newTimeIso: string, reasonRaw: string): Promise<CorrectionResult> {
  const uid = userId(req)
  if (uid === undefined) throw new APIError('Unauthorized', 401)
  const reason = reasonRaw.trim()
  if (reason.length < 3) throw new APIError('Alasan koreksi wajib diisi (min. 3 karakter).', 400, null, true)
  const tx = await getRequestTx(req)
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`attcorr:${attendanceId}`}, 0))`)
  const att = (await req.payload.findByID({ collection: 'attendances', id: attendanceId, depth: 0, overrideAccess: true /* SYSTEM-READ: authorised below (team scope / admin) */, req, disableErrors: true })) as AttendanceRaw | null
  if (!att) throw new APIError('Absensi tidak ditemukan.', 404, null, true)

  const project = relId(att.project)
  const costCenter = relId(att.costCenter)
  const ownEmployee = relId((req.user as { employee?: unknown } | null)?.employee)
  const isOwn = relId(att.user) === uid || (ownEmployee !== undefined && relId(att.employee) === ownEmployee)
  if (isOwn) await deny(req, attendanceId, 'Tidak dapat mengoreksi absensi Anda sendiri.')
  if (!hasRole(req, 'pk-admin')) {
    const scope = hasRole(req, 'pk-pm') ? await resolveScope(req) : null
    const inTeam = !!scope && ((project !== undefined && scope.teamProjects.includes(project)) || (costCenter !== undefined && scope.teamCostCenters.includes(costCenter)))
    if (!inTeam) {
      // Readable (office roles) → 403 + audit; not readable at all (other team, staff) → 404, no existence leak.
      if (hasRole(req, 'pk-owner', 'pk-finance')) await deny(req, attendanceId, 'Koreksi absensi hanya oleh PM tim atau Admin.')
      throw new APIError('Absensi tidak ditemukan.', 404, null, true)
    }
  }

  const s = await settings(req)
  const tz = s.timezone || process.env.TZ || DEFAULT_TZ
  const newTime = new Date(newTimeIso)
  if (Number.isNaN(newTime.getTime())) throw new APIError('Jam baru tidak valid.', 400, null, true)
  if (newTime.getTime() > Date.now() + 60_000) throw new APIError('Jam baru tidak boleh di masa depan.', 400, null, true)
  if (localDateString(newTime, tz) !== att.localDate) {
    throw new APIError(`Jam baru harus pada tanggal absensi yang sama (${att.localDate}, zona ${tz}).`, 400, null, true)
  }
  const oldTime = await effectiveTime(req, att.id, att.attendanceTime)
  if (new Date(oldTime).getTime() === newTime.getTime()) throw new APIError('Jam baru sama dengan jam saat ini.', 400, null, true)

  const loc: Location = project !== undefined ? { type: 'project', id: project } : { type: 'cost_center', id: costCenter! }
  const day = await dayRowsAt(req, relId(att.employee)!, loc, att.localDate)
  const other = day.find((r) => r.kind !== att.kind)
  if (other) {
    const t = new Date(other.effective_time).getTime()
    if (att.kind === 'check_in' && newTime.getTime() > t) throw new APIError('Jam masuk tidak boleh setelah jam pulang.', 400, null, true)
    if (att.kind === 'check_out' && newTime.getTime() < t) throw new APIError('Jam pulang tidak boleh sebelum jam masuk.', 400, null, true)
  }

  const created = await req.payload.create({
    collection: 'attendance-corrections',
    data: {
      attendance: att.id,
      employee: relId(att.employee)!,
      project: project ?? null,
      costCenter: costCenter ?? null,
      kind: att.kind,
      localDate: att.localDate,
      oldTime,
      newTime: newTime.toISOString(),
      reason,
      correctedBy: uid,
      correctedAt: new Date().toISOString(), // replaced by the DB clock (trigger, migration e6_attendance)
    },
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: T10 correction after the checks above (create is closed for HTTP)
    req,
  })
  await writeAudit(req, [
    { action: 'update', docType: 'attendance', docId: String(att.id), field: 'attendanceTime', oldValue: oldTime, newValue: newTime.toISOString(), reason },
  ])
  return { id: created.id as number, attendanceId: att.id, kind: att.kind, localDate: att.localDate, oldTime, newTime: newTime.toISOString(), reason }
}
