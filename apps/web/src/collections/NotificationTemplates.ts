import type { CollectionConfig } from 'payload'

import { denyAll, isGroupAdmin } from '@/access/roles'
import { byRoleAny } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField } from '@/fields/common'

/**
 * Template notifikasi (event, judul, isi, channel). Plain text only. The templates are APP-WIDE (one
 * row per event, shared by every PT — ADR 0016 §4 "App-wide / system"), so a PT Admin editing them
 * would change the texts of every other PT. MC4 decision (default, the owner may override — ADR 0016
 * "Implementation notes (MC4)"): create/update = group admin (`users.groupAdmin`) only; Admin and
 * Direktur of any PT read them (and the group admin). Delete: nobody (G4).
 */
export const NotificationTemplates: CollectionConfig = withAudit(
  {
    slug: 'notification-templates',
    labels: { singular: 'Template notifikasi', plural: 'Template notifikasi' },
    admin: {
      useAsTitle: 'event',
      group: 'Sistem',
      defaultColumns: ['event', 'title', 'channel', 'active'],
      description: 'Berlaku untuk semua PT. Hanya Admin grup yang dapat membuat atau mengubah template; Admin/Direktur PT dapat melihat.',
    },
    access: {
      read: (args) => (isGroupAdmin(args.req) ? true : byRoleAny({ 'pk-admin': true, 'pk-owner': true })(args)),
      create: ({ req }) => isGroupAdmin(req),
      update: ({ req }) => isGroupAdmin(req),
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
