import type { CollectionConfig, Where } from 'payload'

import { denyAll, mappedCompanies } from '@/access/roles'
import { byRoleAny, ownUser } from '@/access/policies'
import { uuidField } from '@/fields/common'

import { ro } from './fields-f2'
import { USER_NAME_VIEW } from '@/fields/users'

/**
 * In-app notifications (requirements v1.1 M12/US-05, architecture §4.4 `notifications`, ADR 0011 §5:
 * "in-app is the source of truth; push only wakes the app"). One row per recipient and event,
 * written by the domain service in the SAME transaction as the status change. Each user reads only
 * their own rows (GET /api/v1/notifications); only `readAt` / push delivery columns change later
 * (DB: identity columns immutable once set, no DELETE for the app role).
 * `pushStatus`: `skipped` while push is disabled (F2), `pending` for the F4 FCM dispatcher.
 */
export const Notifications: CollectionConfig = {
  slug: 'notifications',
  labels: { singular: 'Notifikasi', plural: 'Notifikasi' },
  admin: { group: 'Sistem', useAsTitle: 'title', defaultColumns: ['user', 'event', 'title', 'docNo', 'readAt', 'createdAt'] },
  access: {
    // Own rows only; scope rule 2026-10-02 (QA-MC4-14): rows about a PT the user is no longer mapped
    // to (membership ended / PT deactivated) are not readable any more; rows without a PT stay.
    read: async (args) => {
      const own = await byRoleAny({ 'pk-staff': ownUser('user'), 'pk-pm': ownUser('user'), 'pk-finance': ownUser('user'), 'pk-owner': ownUser('user'), 'pk-admin': ownUser('user'), 'pk-operator': ownUser('user') })(args)
      if (own === false) return false
      const mapped = mappedCompanies(args.req) ?? []
      const pt: Where = { or: [{ company: { exists: false } }, ...(mapped.length ? [{ company: { in: mapped } }] : [])] }
      return own === true ? pt : { and: [own, pt] }
    },
    create: denyAll,
    update: denyAll,
    delete: denyAll,
  },
  lockDocuments: false,
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', label: 'Penerima', required: true, index: true, admin: { ...ro, components: USER_NAME_VIEW } },
    // ADR 0016 §4: PT of the document the notification is about (nullable; reminders and the late-progress job set it too)
    { name: 'company', type: 'relationship', relationTo: 'companies', label: 'PT', index: true, admin: ro },
    { name: 'event', type: 'text', label: 'Event', required: true, maxLength: 64, index: true, admin: ro },
    { name: 'title', type: 'text', label: 'Judul', required: true, maxLength: 160, admin: ro },
    { name: 'body', type: 'textarea', label: 'Isi', required: true, maxLength: 1000, admin: ro },
    { name: 'docType', type: 'text', label: 'Jenis dokumen', maxLength: 64, admin: ro },
    { name: 'docId', type: 'text', label: 'ID dokumen', maxLength: 64, index: true, admin: ro },
    { name: 'docNo', type: 'text', label: 'No. dokumen', maxLength: 64, admin: ro },
    { name: 'readAt', type: 'date', label: 'Dibaca', index: true, admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
    {
      name: 'pushStatus',
      type: 'select',
      label: 'Status push',
      required: true,
      defaultValue: 'skipped',
      options: ['skipped', 'pending', 'sent', 'failed'].map((v) => ({ label: v, value: v })),
      admin: ro,
    },
    uuidField(),
  ],
}
