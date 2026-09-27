import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { recapRange, type DayRecap, type RecapSummary } from '@/domain/attendance/aggregate'
import { currentSchedules, loadFacts, loadHolidays, teamMembers, type AttScope } from '@/domain/attendance/queries'

import { reportContext, rows } from './kpi'
import type { FilterField, Option, ReportDef, Table } from './registry'
import { firstDay, lastDay, PERIOD_RE, periodLabel } from './rules'
import { attendanceOfficeScope, costCenterScopeSql, idList, projectScopeSql, type ReportScope } from './scope'

/**
 * E6 / M13 "Laporan absensi" (requirements v1.1 §5 M13, plan fase1-golive E6): per employee and
 * month — working days, present, absent, late (days / minutes), early leave, work minutes, attendance
 * on holidays / off days, days without check-out, "diabsenkan PM", corrected; plus the day detail.
 * Same numbers as GET /api/v1/attendance/recap (one aggregation: domain/attendance/aggregate.ts);
 * corrections (T10) applied. Scope: Finance/Direktur all, PM team projects/cost centers
 * (requirements §4 "Laporan & export"). Employees assigned to a location in scope appear even
 * without attendance (absent days count).
 */
const idOf = (sp: URLSearchParams, name: string): number | undefined => {
  const v = sp.get(name) ?? ''
  return /^\d{1,10}$/.test(v) && Number(v) > 0 ? Number(v) : undefined
}

function monthOf(sp: URLSearchParams, today: string): string {
  const m = sp.get('bulan') ?? ''
  return PERIOD_RE.test(m) && m <= today.slice(0, 7) ? m : today.slice(0, 7)
}

/** Report scope → attendance scope, narrowed by the project / cost-center filter (PM: team only). */
export function attendanceReportScope(scope: ReportScope, projectId?: number, costCenterId?: number): AttScope {
  const base: AttScope = scope.kind === 'all' ? { kind: 'all' } : scope.kind === 'team' ? { kind: 'team', projects: scope.projects, costCenters: scope.costCenters } : { kind: 'team', projects: [], costCenters: [] }
  if (!projectId && !costCenterId) return base
  const allowed = (ids: number[], id?: number) => id !== undefined && (base.kind === 'all' || ids.includes(id))
  return {
    kind: 'team',
    projects: allowed(base.kind === 'team' ? base.projects : [], projectId) ? [projectId!] : [],
    costCenters: allowed(base.kind === 'team' ? base.costCenters : [], costCenterId) ? [costCenterId!] : [],
  }
}

export type EmployeeMonth = { id: number; code: string; name: string; days: DayRecap[]; summary: RecapSummary }

/** Per-employee recap of a month in the scope (shared by the report and its reconciliation test). */
export async function attendanceMonth(req: PayloadRequest, scope: AttScope, month: string, employeeId?: number): Promise<EmployeeMonth[]> {
  const ctx = await reportContext(req)
  const s = (await req.payload.findGlobal({ slug: 'company-settings', depth: 0, overrideAccess: true /* SYSTEM-READ: default schedule */, req })) as { defaultWorkSchedule?: unknown }
  const defaultId = typeof s.defaultWorkSchedule === 'number' ? s.defaultWorkSchedule : null
  const from = firstDay(month)
  const to = lastDay(month)
  const members = await teamMembers(req, scope, from, to, employeeId)
  const facts = await loadFacts(req, { from, to, scope, employeeIds: employeeId !== undefined ? [employeeId] : undefined })
  const people = new Map<number, { code: string; name: string }>(members.map((m) => [m.employeeId, { code: m.code, name: m.name }]))
  const missing = [...new Set(facts.map((f) => f.employeeId))].filter((id) => !people.has(id))
  if (missing.length) {
    const r = await rows(req, sql`SELECT id, code, name FROM employees WHERE id IN (${idList(missing)})`)
    for (const x of r) people.set(Number(x.id), { code: String(x.code), name: String(x.name) })
  }
  const ids = [...people.keys()]
  const holidays = await loadHolidays(req, from, to)
  const schedules = await currentSchedules(req, ids, defaultId)
  return ids
    .map((id) => {
      const p = people.get(id)!
      const r = recapRange({ from, to, today: ctx.today, facts: facts.filter((f) => f.employeeId === id), holidays, fallbackSchedule: schedules.get(id) ?? null, timeZone: ctx.tz })
      return { id, code: p.code, name: p.name, ...r }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'id'))
}

async function locationOptions(req: PayloadRequest, scope: ReportScope): Promise<{ projects: Option[]; costCenters: Option[] }> {
  const p = await rows(req, sql`SELECT p.id, p.code, p.name FROM projects p WHERE ${projectScopeSql(scope)} ORDER BY p.code`)
  const c = await rows(req, sql`SELECT cc.id, cc.code, cc.name FROM cost_centers cc WHERE ${costCenterScopeSql(scope)} ORDER BY cc.code`)
  return {
    projects: p.map((x) => ({ value: String(x.id), label: `${x.code} ${x.name}` })),
    costCenters: c.map((x) => ({ value: String(x.id), label: `${x.code} ${x.name}` })),
  }
}

const STATUS_LABEL: Record<string, string> = {
  selesai: 'Hadir',
  hadir: 'Tanpa absen pulang',
  belum_absen: 'Belum absen',
  tidak_hadir: 'Tidak hadir',
  libur: 'Libur',
  tanpa_jadwal: '—',
}

export const absensiReport: ReportDef = {
  code: 'absensi',
  title: 'Laporan Absensi',
  kpi: 'M13',
  description: 'Rekap absensi per karyawan per bulan: hari kerja, hadir, tidak hadir, terlambat, pulang cepat, jam kerja, hadir di hari libur, diabsenkan PM, koreksi.',
  // S3e (S-23): Admin reads + exports attendance (requirements §4 matrix), scope all.
  roles: ['pk-finance', 'pk-owner', 'pk-pm', 'pk-admin'],
  scope: attendanceOfficeScope,
  formats: ['csv', 'xlsx'],
  paged: false,
  pageSize: 5000,
  async run(req, scope, sp) {
    const ctx = await reportContext(req)
    const month = monthOf(sp, ctx.today)
    const att = attendanceReportScope(scope, idOf(sp, 'project'), idOf(sp, 'pusat'))
    const list = await attendanceMonth(req, att, month)
    const sum = (k: keyof RecapSummary) => list.reduce((s, e) => s + e.summary[k], 0)
    const detail: Table = {
      key: 'harian',
      title: `Rincian harian — ${periodLabel(month)}`,
      columns: [
        { key: 'tanggal', label: 'Tanggal', type: 'date', primary: true },
        { key: 'karyawan', label: 'Karyawan', type: 'text', primary: true },
        { key: 'status', label: 'Status', type: 'text' },
        { key: 'lokasi', label: 'Lokasi', type: 'text' },
        { key: 'masuk', label: 'Masuk', type: 'text' },
        { key: 'pulang', label: 'Pulang', type: 'text' },
        { key: 'durasi', label: 'Durasi (menit)', type: 'int' },
        { key: 'terlambat', label: 'Terlambat (menit)', type: 'int' },
        { key: 'pulangCepat', label: 'Pulang cepat (menit)', type: 'int' },
        { key: 'ket', label: 'Keterangan', type: 'text', width: 40 },
      ],
      rows: list.flatMap((e) =>
        e.days
          .filter((d) => d.checkIn || d.status === 'tidak_hadir')
          .map((d) => ({
            cells: {
              tanggal: d.date,
              karyawan: `${e.name} (${e.code})`,
              status: STATUS_LABEL[d.status] ?? d.status,
              lokasi: d.locations.map((l) => `${l.location.code} ${l.location.name}`).join('; '),
              masuk: d.checkInLocal,
              pulang: d.checkOutLocal,
              durasi: d.workMinutes,
              terlambat: d.lateMinutes,
              pulangCepat: d.earlyLeaveMinutes,
              ket: [
                d.holidayName ? `Hari libur: ${d.holidayName}` : d.kind === 'off' && d.checkIn ? 'Hari non-kerja' : '',
                d.onBehalf ? `Diabsenkan PM${d.onBehalfBy.length ? ` (${d.onBehalfBy.join(', ')})` : ''}` : '',
                d.corrected ? 'Dikoreksi' : '',
              ]
                .filter(Boolean)
                .join('; '),
            },
          })),
      ),
      empty: 'Tidak ada absensi.',
    }
    return {
      main: {
        key: 'karyawan',
        title: `Rekap absensi ${periodLabel(month)}`,
        columns: [
          { key: 'karyawan', label: 'Karyawan', type: 'text', primary: true },
          { key: 'hariKerja', label: 'Hari kerja', type: 'int' },
          { key: 'hadir', label: 'Hadir', type: 'int', primary: true },
          { key: 'tidakHadir', label: 'Tidak hadir', type: 'int', primary: true },
          { key: 'terlambatHari', label: 'Terlambat (hari)', type: 'int', primary: true },
          { key: 'terlambatMenit', label: 'Terlambat (menit)', type: 'int' },
          { key: 'pulangCepatHari', label: 'Pulang cepat (hari)', type: 'int' },
          { key: 'pulangCepatMenit', label: 'Pulang cepat (menit)', type: 'int' },
          { key: 'jamKerja', label: 'Jam kerja (menit)', type: 'int' },
          { key: 'hariLibur', label: 'Hadir hari libur', type: 'int' },
          { key: 'nonKerja', label: 'Hadir hari non-kerja', type: 'int' },
          { key: 'tanpaPulang', label: 'Tanpa absen pulang', type: 'int' },
          { key: 'olehPm', label: 'Diabsenkan PM (hari)', type: 'int' },
          { key: 'koreksi', label: 'Dikoreksi (hari)', type: 'int' },
        ],
        rows: list.map((e) => ({
          // E6 web: the employee's calendar, day detail, corrections and selfies (same numbers).
          href: `/admin/absensi/rekap?karyawan=${e.id}&bulan=${month}`,
          cells: {
            karyawan: `${e.name} (${e.code})`,
            hariKerja: e.summary.workingDays,
            hadir: e.summary.presentDays,
            tidakHadir: e.summary.absentDays,
            terlambatHari: e.summary.lateDays,
            terlambatMenit: e.summary.lateMinutes,
            pulangCepatHari: e.summary.earlyLeaveDays,
            pulangCepatMenit: e.summary.earlyLeaveMinutes,
            jamKerja: e.summary.workMinutes,
            hariLibur: e.summary.holidayWorkDays,
            nonKerja: e.summary.offDayWorkDays,
            tanpaPulang: e.summary.incompleteDays,
            olehPm: e.summary.onBehalfDays,
            koreksi: e.summary.correctedDays,
          },
        })),
        totals: {
          karyawan: 'TOTAL',
          hadir: sum('presentDays'),
          tidakHadir: sum('absentDays'),
          terlambatHari: sum('lateDays'),
          terlambatMenit: sum('lateMinutes'),
          pulangCepatHari: sum('earlyLeaveDays'),
          pulangCepatMenit: sum('earlyLeaveMinutes'),
          jamKerja: sum('workMinutes'),
        },
        empty: scope.kind === 'team' ? 'Belum ada anggota tim atau absensi di cakupan Anda.' : 'Belum ada absensi.',
      },
      extra: [detail],
      notes: [
        `Periode ${periodLabel(month)} s/d hari ini; waktu = zona perusahaan (${ctx.tz}). Jam absensi memakai koreksi terakhir (T10).`,
        'Terlambat: menit setelah jam masuk jadwal bila melebihi toleransi (dihitung dari jam masuk). Hari libur/non-kerja tidak dihitung terlambat, hanya ditandai.',
        'Tidak hadir = hari kerja terjadwal yang sudah lewat tanpa absen masuk. Tanpa jadwal kerja → tidak ada hari kerja/terlambat.',
      ],
      next: null,
      count: list.length,
    }
  },
  async filters(req, scope, sp) {
    const ctx = await reportContext(req)
    const opts = await locationOptions(req, scope)
    const month: FilterField = { name: 'bulan', label: 'Bulan', kind: 'month', value: monthOf(sp, ctx.today) }
    const sel = (name: string, label: string, options: Option[]): FilterField => ({ name, label, kind: 'select', options, value: sp.get(name) ?? '' })
    return [month, sel('project', 'Project', opts.projects), sel('pusat', 'Pusat biaya', opts.costCenters)]
  },
  fileStem(ctx, sp) {
    return `absensi_${monthOf(sp, ctx.today)}`
  },
}
