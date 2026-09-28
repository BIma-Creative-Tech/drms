import type { CollectionConfig } from 'payload'

import { denyAll, hasRoleAny } from '@/access/roles'
import { byRoleAny } from '@/access/policies'

/**
 * Browser sessions of the admin (ADR 0003 §3): opaque 256-bit id in an HttpOnly cookie, stored
 * as SHA-256 only. Written by the auth routes (SYSTEM-WRITE); Admin reads. Not audited through
 * the field-diff factory: login/logout/session_revoked rows are written explicitly.
 */
export const WebSessions: CollectionConfig = {
  slug: 'web-sessions',
  labels: { singular: 'Sesi web', plural: 'Sesi web' },
  admin: {
    group: 'Pengguna & Akses',
    defaultColumns: ['user', 'createdAt', 'expiresAt', 'revokedAt', 'revokeReason', 'ip'],
    hidden: ({ user }) => !hasRoleAny({ user } as never, 'pk-admin'),
  },
  access: { read: byRoleAny({ 'pk-admin': true }), create: denyAll, update: denyAll, delete: denyAll },
  lockDocuments: false,
  fields: [
    { name: 'idHash', type: 'text', required: true, unique: true, index: true, access: { read: () => false } },
    { name: 'user', type: 'relationship', relationTo: 'users', label: 'Pengguna', required: true, index: true },
    { name: 'keycloakSid', type: 'text', index: true },
    { name: 'idTokenHint', type: 'text', access: { read: () => false } },
    { name: 'expiresAt', type: 'date', label: 'Kedaluwarsa', required: true },
    { name: 'revokedAt', type: 'date', label: 'Dicabut pada' },
    { name: 'revokeReason', type: 'text', label: 'Alasan' },
    { name: 'ip', type: 'text', label: 'IP' },
    { name: 'userAgent', type: 'text', label: 'User agent' },
  ],
}
