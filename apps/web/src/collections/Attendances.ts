import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { anyOf, byRole, ownEmployee, ownUser, teamCostCenters, teamProjects } from '@/access/policies'
import { withAudit } from '@/audit/hooks'

import { ro } from './fields-f2'
import { companyField, companyHook } from '@/fields/company'
import { USER_NAME_VIEW } from '@/fields/users'

/** Read-only JSON without Monaco (CSP, config-guards.test.ts). */
const jsonView = { readOnly: true, components: { Field: '@/components/ReadOnlyJson#ReadOnlyJson' } }

/**
 * Attendance check-in / check-out from the APK (US-01/US-02/US-14; ADR 0010 decisions 7/8).
 * Written ONLY by the sync service (`POST /api/v1/sync/batch`, items `attendance.check_in` /
 * `attendance.check_out` / `attendance.on_behalf`) after the server-side checks
 * (domain/attendance/record.ts): assigned project OR cost center (E6, Q-40) OR site (ADR 0023) with a geofence,
 * distance ≤ radius + GPS accuracy (capped), no mocked location, selfie uploaded by the caller, one
 * check-in and one check-out per employee/location/local date. `source = pm` = "diabsenkan oleh PM"
 * (US-14): `recordedBy` = the PM, selfie + GPS from the PM's phone, reason mandatory; `source = admin` (ADR 0032) =
 * "diabsenkan oleh Admin Staff" (any employee of the PT, web or APK; same fields). Nothing is
 * editable (create/update/delete are closed for HTTP; the DB role cannot UPDATE/DELETE either —
 * migration f4b_attendance_security): a correction (T10, US-15) is an `attendance-corrections` row
 * whose `newTime` supersedes `attendanceTime` in every recap/report. `schedule` = snapshot of the
 * employee's work schedule at check-in (late minutes stay stable when the master changes later).
 *
 * Times: `receivedAt` = DB/server clock (authoritative, audit). `attendanceTime` = the time that
 * counts (QM-3 proposal): server time online, else the server estimate from the monotonic clock,
 * else the device clock flagged `DEVICE_TIME_ONLY` for PM review.
 */
export const Attendances: CollectionConfig = withAudit(
  {
    slug: 'attendances',
    labels: { singular: 'Absensi', plural: 'Absensi' },
    admin: {
      group: 'Proyek',
      useAsTitle: 'localDate',
      defaultColumns: ['employee', 'kind', 'project', 'costCenter', 'outsideArea', 'localDate', 'attendanceTime', 'source', 'offline', 'distanceM'],
    },
    access: {
      read: byRole({
        'pk-admin': true,
        'pk-owner': true,
        'pk-finance': true,
        'pk-pm': anyOf(teamProjects('project'), teamCostCenters('costCenter'), ownUser('user'), ownEmployee('employee')),
        'pk-staff': anyOf(ownUser('user'), ownEmployee('employee')),
        // Operator/Anggota (owner decision 2026-10-09): own attendance only, same as Staff.
        'pk-operator': anyOf(ownUser('user'), ownEmployee('employee')),
        // ADR 0032: Admin Staff reads every attendance of its PT (selfie views audited by GET /attendance/{id}/selfie)
        'pk-admin-staff': true,
      }),
      create: denyAll,
      update: denyAll,
      delete: denyAll,
    },
    hooks: { beforeChange: [companyHook('attendances', { derive: [{ field: 'employee', collection: 'employees' }], check: [{ field: 'project', collection: 'projects' }, { field: 'costCenter', collection: 'cost-centers' }, { field: 'site', collection: 'sites' }] })] },
    fields: [
      companyField({ derived: true }),
      { name: 'employee', type: 'relationship', relationTo: 'employees', label: 'Karyawan', required: true, index: true, admin: ro },
      // E6: empty for "diabsenkan PM" of an employee without an account (US-14, Q-29).
      { name: 'user', type: 'relationship', relationTo: 'users', label: 'Akun', index: true, admin: { ...ro, components: USER_NAME_VIEW } },
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
      // Location: project OR costCenter OR (both empty) site — DB CHECK attendances_one_location (d1010_sites_guard).
      { name: 'project', type: 'relationship', relationTo: 'projects', label: 'Project', index: true, admin: ro },
      { name: 'costCenter', type: 'relationship', relationTo: 'cost-centers', label: 'Pusat biaya', index: true, admin: ro },
      // ADR 0023: the site of the location, filled by the server (DB trigger pk_attendance_site): the site itself for
      // a site check-in (then project and cost center are empty), the project's site for a project check-in, empty
      // for a cost-center check-in. ADR 0032: no new site check-in; kept read-only for the history rows (no column /
      // filter any more).
      { name: 'site', type: 'relationship', relationTo: 'sites', label: 'Site', index: true, admin: ro },
      {
        name: 'source',
        type: 'select',
        label: 'Sumber',
        required: true,
        defaultValue: 'self',
        index: true,
        options: [
          { label: 'Sendiri (APK)', value: 'self' },
          { label: 'Diabsenkan oleh PM', value: 'pm' },
          // ADR 0032: recorded by an Admin Staff of the PT (any employee of the PT, also without an account)
          { label: 'Diabsenkan oleh Admin Staff', value: 'admin' },
        ],
        admin: ro,
      },
      { name: 'recordedBy', type: 'relationship', relationTo: 'users', label: 'Diabsenkan oleh', index: true, admin: { ...ro, components: USER_NAME_VIEW } },
      { name: 'onBehalfReason', type: 'text', label: 'Alasan diabsenkan', maxLength: 500, admin: ro },
      { name: 'localDate', type: 'text', label: 'Tanggal (zona perusahaan)', required: true, index: true, admin: ro },
      { name: 'attendanceTime', type: 'date', label: 'Jam absensi', required: true, admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'receivedAt', type: 'date', label: 'Diterima server', required: true, admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'deviceTime', type: 'date', label: 'Jam HP', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'estimatedTime', type: 'date', label: 'Perkiraan server', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      {
        name: 'timeTrust',
        type: 'select',
        label: 'Sumber jam',
        required: true,
        options: [
          { label: 'Server (online)', value: 'server' },
          { label: 'Perkiraan server', value: 'estimated' },
          { label: 'Jam HP saja', value: 'device_only' },
        ],
        admin: ro,
      },
      { name: 'offline', type: 'checkbox', label: 'Offline', defaultValue: false, index: true, admin: ro },
      { name: 'lat', type: 'number', label: 'Latitude', required: true, admin: ro },
      { name: 'lng', type: 'number', label: 'Longitude', required: true, admin: ro },
      { name: 'accuracyM', type: 'number', label: 'Akurasi GPS (m)', admin: ro },
      { name: 'distanceM', type: 'number', label: 'Jarak ke titik lokasi (m)', required: true, admin: ro },
      // DRMS 13/10 A2 (owner 2026-10-14): Non-OnSite attendance outside every registered location of the PT — "Di luar
      // area". The location above is then the reference (home site, else head office; a check-out: the open check-in's
      // location) and `distanceM` the distance to its point.
      { name: 'outsideArea', type: 'checkbox', label: 'Di luar area', defaultValue: false, admin: ro },
      { name: 'selfie', type: 'upload', relationTo: 'media-selfies', label: 'Selfie', required: true, admin: ro },
      { name: 'device', type: 'relationship', relationTo: 'devices', label: 'Perangkat', admin: ro },
      { name: 'flags', type: 'json', label: 'Tanda', admin: jsonView },
      { name: 'schedule', type: 'json', label: 'Jadwal kerja (snapshot)', admin: jsonView },
      { name: 'clientUuid', type: 'text', label: 'ID offline', required: true, unique: true, index: true, admin: { ...ro, hidden: true } },
    ],
  },
  { docType: 'attendance' },
)
