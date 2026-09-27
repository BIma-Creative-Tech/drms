import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { anyOf, byRole, ownEmployee, teamCostCenters, teamProjects } from '@/access/policies'
import { withAudit } from '@/audit/hooks'

import { ro } from './fields-f2'

const dt = { ...ro, date: { pickerAppearance: 'dayAndTime' as const } }

/**
 * T10 Koreksi absensi (US-15, requirements v1.1 §7 T10 / §8 "Jam lama → baru, project; alasan
 * wajib"). Append-only: written ONLY by POST /api/v1/attendance/{id}/correct
 * (domain/attendance/corrections.ts) — PM of the attendance's project/cost center, or Admin
 * (requirements §4 "Absensi": PM "U koreksi team", Admin "R/U"); never one's own attendance. The
 * attendance row itself is never edited (f4b_attendance_security): the NEWEST correction's
 * `newTime` is the effective time in every recap/report. No UPDATE/DELETE for the app role
 * (migration e6_attendance); `correctedAt` = DB clock.
 */
export const AttendanceCorrections: CollectionConfig = withAudit(
  {
    slug: 'attendance-corrections',
    labels: { singular: 'Koreksi absensi', plural: 'Koreksi absensi' },
    admin: {
      group: 'Proyek',
      useAsTitle: 'localDate',
      defaultColumns: ['attendance', 'employee', 'kind', 'localDate', 'oldTime', 'newTime', 'correctedBy', 'correctedAt'],
    },
    access: {
      read: byRole({
        'pk-admin': true,
        'pk-owner': true,
        'pk-finance': true,
        'pk-pm': anyOf(teamProjects('project'), teamCostCenters('costCenter'), ownEmployee('employee')),
        'pk-staff': ownEmployee('employee'),
      }),
      create: denyAll,
      update: denyAll,
      delete: denyAll,
    },
    fields: [
      { name: 'attendance', type: 'relationship', relationTo: 'attendances', label: 'Absensi', required: true, index: true, admin: ro },
      { name: 'employee', type: 'relationship', relationTo: 'employees', label: 'Karyawan', required: true, index: true, admin: ro },
      { name: 'project', type: 'relationship', relationTo: 'projects', label: 'Project', index: true, admin: ro },
      { name: 'costCenter', type: 'relationship', relationTo: 'cost-centers', label: 'Pusat biaya', index: true, admin: ro },
      {
        name: 'kind',
        type: 'select',
        label: 'Jenis',
        required: true,
        options: [
          { label: 'Masuk', value: 'check_in' },
          { label: 'Pulang', value: 'check_out' },
        ],
        admin: ro,
      },
      { name: 'localDate', type: 'text', label: 'Tanggal (zona perusahaan)', required: true, index: true, admin: ro },
      { name: 'oldTime', type: 'date', label: 'Jam lama', required: true, admin: dt },
      { name: 'newTime', type: 'date', label: 'Jam baru', required: true, admin: dt },
      { name: 'reason', type: 'text', label: 'Alasan', required: true, maxLength: 500, admin: ro },
      { name: 'correctedBy', type: 'relationship', relationTo: 'users', label: 'Dikoreksi oleh', required: true, index: true, admin: ro },
      { name: 'correctedAt', type: 'date', label: 'Waktu koreksi (server)', required: true, admin: dt },
    ],
  },
  { docType: 'attendance_correction' },
)
