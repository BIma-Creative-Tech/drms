import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { byRoleAny, rolesAllowedAny } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField } from '@/fields/common'

/** Template notifikasi (event, judul, isi, channel). Admin C/R/U, Owner R. Plain text only. */
export const NotificationTemplates: CollectionConfig = withAudit(
  {
    slug: 'notification-templates',
    labels: { singular: 'Template notifikasi', plural: 'Template notifikasi' },
    admin: { useAsTitle: 'event', group: 'Sistem', defaultColumns: ['event', 'title', 'channel', 'active'] },
    access: {
      read: byRoleAny({ 'pk-admin': true, 'pk-owner': true }),
      create: rolesAllowedAny('pk-admin'),
      update: byRoleAny({ 'pk-admin': true }),
      delete: denyAll,
    },
    fields: [
      {
        name: 'event',
        type: 'text',
        label: 'Event',
        required: true,
        unique: true,
        maxLength: 64,
        validate: (v: unknown) => (typeof v === 'string' && /^[a-z0-9_.]{3,64}$/.test(v) ? true : 'Event: huruf kecil, angka, titik, garis bawah.'),
      },
      { name: 'title', type: 'text', label: 'Judul', required: true, maxLength: 128 },
      { name: 'body', type: 'textarea', label: 'Isi', required: true, maxLength: 1000 },
      {
        name: 'channel',
        type: 'select',
        label: 'Channel',
        required: true,
        defaultValue: 'both',
        options: [
          { label: 'Push', value: 'push' },
          { label: 'In-app', value: 'inapp' },
          { label: 'Push + in-app', value: 'both' },
        ],
      },
      activeField(),
    ],
  },
  { docType: 'notification_template', reasonRules: [reasonOnDeactivate] },
)
