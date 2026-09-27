import type { CollectionConfig } from 'payload'

import { anyRole, denyAll } from '@/access/roles'
import { byRole, rolesAllowed } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { WEEKDAY_KEYS } from '@/domain/attendance/schedule'
import { activeField } from '@/fields/common'

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
const hhmm = (v: unknown) => (typeof v === 'string' && HHMM.test(v) ? true : 'Format jam HH:MM (00:00–23:59).')

/** Labels in ISO weekday order (1 = Senin … 7 = Minggu) of the `workDays` group. */
const DAY_LABELS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']

/**
 * Jadwal kerja (rekap absensi, Q-30 default 08:00–17:00 WITA, Senin–Sabtu, toleransi 15 menit).
 * Admin C/R/U, Owner R/U, all R. E6: `workDays` (a group of checkboxes, no child table) decides
 * which weekdays are working days; attendance on another day or on a holiday is flagged, never
 * counted as late. An employee uses `employees.workSchedule`, else company-settings.defaultWorkSchedule.
 */
export const WorkSchedules: CollectionConfig = withAudit(
  {
    slug: 'work-schedules',
    labels: { singular: 'Jadwal kerja', plural: 'Jadwal kerja' },
    admin: { useAsTitle: 'name', group: 'Master Data', defaultColumns: ['name', 'startTime', 'endTime', 'lateToleranceMin', 'active'] },
    access: {
      read: anyRole,
      create: rolesAllowed('pk-admin'),
      update: byRole({ 'pk-admin': true, 'pk-owner': true }),
      delete: denyAll,
    },
    fields: [
      { name: 'name', type: 'text', label: 'Nama', required: true, unique: true, maxLength: 64 },
      { name: 'startTime', type: 'text', label: 'Jam masuk', required: true, validate: hhmm },
      {
        name: 'endTime',
        type: 'text',
        label: 'Jam pulang',
        required: true,
        // E6: shifts across midnight are not supported (the working day = one local calendar date).
        validate: (v: unknown, { siblingData }: { siblingData?: Record<string, unknown> }) => {
          const base = hhmm(v)
          if (base !== true) return base
          const start = siblingData?.startTime
          return typeof start === 'string' && HHMM.test(start) && (v as string) <= start ? 'Jam pulang harus setelah jam masuk (tanpa lewat tengah malam).' : true
        },
      },
      { name: 'lateToleranceMin', type: 'number', label: 'Toleransi terlambat (menit)', min: 0, max: 240, defaultValue: 15 },
      {
        name: 'workDays',
        type: 'group',
        label: 'Hari kerja',
        fields: [
          {
            type: 'row',
            fields: WEEKDAY_KEYS.map((k, i) => ({ name: k, type: 'checkbox' as const, label: DAY_LABELS[i], defaultValue: k !== 'sun' })),
          },
        ],
      },
      activeField(),
    ],
  },
  { docType: 'work_schedule', reasonRules: [reasonOnDeactivate] },
)
