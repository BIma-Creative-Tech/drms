import type { Access, Field } from 'payload'

import { anyOf, assignedProjects, byRole, ownUser, teamProjects } from '@/access/policies'
import { uuidField } from '@/fields/common'

import { ro } from './fields-f2'
import { USER_NAME_VIEW } from '@/fields/users'

/**
 * FR1 (ADR 0020): fields + read rule shared by the field reports (service-reports, unit-timesheets,
 * aftersales-activities). Written ONLY by the domain services (domain/field/*): HTTP create/update/
 * delete are closed; the DB (migration fr1_security) sets received_at / editable_until, rejects
 * DELETE, UPDATE after the 24 h window (except corrections / system status writes) and identity changes.
 */

/** Read-only JSON without Monaco (CSP, config-guards.test.ts). */
export const jsonView = { readOnly: true, components: { Field: '@/components/ReadOnlyJson#ReadOnlyJson' } }

/** Admin/Direktur/Finance: all of the PT; PM: team projects + own; Staff: assigned projects + own. */
export const fieldReportRead: Access = byRole({
  'pk-admin': true,
  'pk-owner': true,
  'pk-finance': true,
  'pk-pm': anyOf(teamProjects('project'), ownUser('reporter')),
  'pk-staff': anyOf(assignedProjects('project'), ownUser('reporter')),
})

const dt = { ...ro, date: { pickerAppearance: 'dayAndTime' as const } }

/** Server/sync bookkeeping (same shape as progress reports, ADR 0010) + correction marker. */
export function fieldSystemFields(): Field[] {
  return [
    { name: 'photoCount', type: 'number', label: 'Jumlah foto', defaultValue: 0, admin: ro },
    { name: 'receivedAt', type: 'date', label: 'Diterima server', admin: dt },
    { name: 'editableUntil', type: 'date', label: 'Bisa diedit sampai', admin: dt },
    { name: 'deviceTime', type: 'date', label: 'Jam HP', admin: dt },
    {
      name: 'timeTrust',
      type: 'select',
      label: 'Sumber jam',
      options: [
        { label: 'Server (online)', value: 'server' },
        { label: 'Perkiraan server', value: 'estimated' },
        { label: 'Jam HP saja', value: 'device_only' },
      ],
      admin: ro,
    },
    { name: 'offline', type: 'checkbox', label: 'Offline', defaultValue: false, index: true, admin: ro },
    { name: 'source', type: 'select', label: 'Sumber', options: ['web', 'apk'].map((s) => ({ label: s, value: s })), admin: ro },
    { name: 'flags', type: 'json', label: 'Tanda', admin: jsonView },
    { name: 'correctedAt', type: 'date', label: 'Dikoreksi pada', admin: dt },
    { name: 'correctedBy', type: 'relationship', relationTo: 'users', label: 'Dikoreksi oleh', admin: { ...ro, components: USER_NAME_VIEW } },
    { name: 'syncRev', type: 'number', label: 'Revisi', defaultValue: 1, admin: { ...ro, hidden: true } },
    { name: 'clientUuid', type: 'text', label: 'ID offline', unique: true, index: true, admin: { ...ro, hidden: true } },
    uuidField(),
  ]
}

export const FIELD_AUDIT_EXCLUDE = ['syncRev', 'receivedAt', 'editableUntil', 'photoCount']
