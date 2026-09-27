import { APIError, type CollectionAfterChangeHook, type CollectionBeforeChangeHook, type CollectionConfig } from 'payload'

import { denyAll, relId } from '@/access/roles'
import { byRole, fieldRoles, ownUser } from '@/access/policies'
import { reasonOnChange, withAudit } from '@/audit/hooks'
import { writeAudit } from '@/audit/writer'
import { endKeycloakDeviceSession } from '@/domain/devices'

/**
 * Device registry (ADR 0003 §5). Created only by POST /api/v1/devices/register (SYSTEM-WRITE);
 * Admin/Owner may revoke/mark lost in the admin (status is one-way: never back to active).
 * Users read their own devices (APK "perangkat saya").
 */
const statusGuard: CollectionBeforeChangeHook = ({ data, originalDoc, operation, req }) => {
  if (operation !== 'update' || !originalDoc) return data
  if (data.status && data.status !== originalDoc.status) {
    if (originalDoc.status !== 'active') throw new APIError('Status perangkat yang dicabut tidak dapat diubah.', 400, null, true)
    data.revokedAt = new Date().toISOString()
    data.revokedBy = relId(req.user) ?? null
    data.fcmToken = null
  }
  return data
}

const revokeEffects: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update' || previousDoc?.status !== 'active' || doc.status === 'active') return doc
  // E9 B-2: system tooling that does not talk to Keycloak (go-live import, seed — `skipKeycloakSync`)
  // records the revocation only; the import reports the users whose Keycloak account/sessions the
  // operator must disable + log out (runbook import-data-golive), instead of one warning per device.
  const kc = req.context?.skipKeycloakSync === true ? 'keycloak_skipped' : await endKeycloakDeviceSession(req, doc.keycloakSid)
  await writeAudit(req, [
    {
      action: 'device_revoke',
      docType: 'device',
      docId: String(doc.id),
      field: 'keycloakSession',
      newValue: kc,
      reason: doc.revokeReason ?? undefined,
    },
  ])
  return doc
}

export const Devices: CollectionConfig = withAudit(
  {
    slug: 'devices',
    labels: { singular: 'Perangkat', plural: 'Perangkat' },
    admin: { useAsTitle: 'deviceId', group: 'Pengguna & Akses', defaultColumns: ['deviceId', 'user', 'model', 'appVersion', 'status', 'integrityRisk', 'lastSeenAt'] },
    access: {
      read: byRole({
        'pk-admin': true,
        'pk-owner': true,
        'pk-finance': ownUser('user'),
        'pk-pm': ownUser('user'),
        'pk-staff': ownUser('user'),
      }),
      create: denyAll,
      update: byRole({ 'pk-admin': true, 'pk-owner': true }),
      delete: denyAll,
    },
    hooks: { beforeChange: [statusGuard], afterChange: [revokeEffects] },
    fields: [
      { name: 'deviceId', type: 'text', label: 'ID perangkat', required: true, unique: true, index: true, access: { update: () => false } },
      { name: 'user', type: 'relationship', relationTo: 'users', label: 'Pengguna', required: true, index: true, access: { update: () => false } },
      {
        name: 'platform',
        type: 'select',
        label: 'Platform',
        required: true,
        defaultValue: 'android',
        options: [{ label: 'Android', value: 'android' }],
        access: { update: () => false },
      },
      { name: 'model', type: 'text', label: 'Model', maxLength: 128, access: { update: () => false } },
      { name: 'appVersion', type: 'text', label: 'Versi aplikasi', maxLength: 32, access: { update: () => false } },
      {
        name: 'fcmToken',
        type: 'text',
        label: 'Token FCM',
        maxLength: 4096,
        access: { read: fieldRoles('pk-admin'), update: () => false },
        admin: { hidden: true },
      },
      { name: 'keycloakSid', type: 'text', label: 'Keycloak sid', index: true, access: { update: () => false }, admin: { readOnly: true } },
      {
        name: 'status',
        type: 'select',
        label: 'Status',
        required: true,
        defaultValue: 'active',
        index: true,
        options: [
          { label: 'Aktif', value: 'active' },
          { label: 'Dicabut', value: 'revoked' },
          { label: 'Hilang', value: 'lost' },
        ],
      },
      { name: 'revokeReason', type: 'text', label: 'Alasan pencabutan', maxLength: 500 },
      // ADR 0010 decision 10 / QM-4: best-effort signals reported by the APK at register (every app
      // start and login). Recorded + audited (field diff), never blocking; policy is the client's.
      {
        name: 'integrityRisk',
        type: 'checkbox',
        label: 'Risiko integritas',
        defaultValue: false,
        index: true,
        access: { update: () => false },
        admin: { readOnly: true, description: 'Root, emulator atau lokasi palsu terdeteksi pada pemeriksaan terakhir.' },
      },
      {
        name: 'integrity',
        type: 'group',
        label: 'Integritas perangkat (laporan aplikasi)',
        access: { update: () => false },
        admin: { readOnly: true },
        fields: [
          { name: 'rooted', type: 'checkbox', label: 'Root terdeteksi' },
          { name: 'emulator', type: 'checkbox', label: 'Emulator' },
          { name: 'developerMode', type: 'checkbox', label: 'Opsi pengembang aktif' },
          { name: 'adbEnabled', type: 'checkbox', label: 'USB debugging aktif' },
          { name: 'mockLocation', type: 'checkbox', label: 'Lokasi palsu (dari fix GPS terakhir)' },
        ],
      },
      { name: 'integrityCheckedAt', type: 'date', label: 'Integritas diperiksa', access: { update: () => false }, admin: { readOnly: true } },
      { name: 'registeredAt', type: 'date', label: 'Terdaftar', access: { update: () => false }, admin: { readOnly: true } },
      { name: 'lastSeenAt', type: 'date', label: 'Terakhir aktif', access: { update: () => false }, admin: { readOnly: true } },
      { name: 'revokedAt', type: 'date', label: 'Dicabut pada', access: { update: () => false }, admin: { readOnly: true } },
      { name: 'revokedBy', type: 'relationship', relationTo: 'users', label: 'Dicabut oleh', access: { update: () => false }, admin: { readOnly: true } },
    ],
  },
  { docType: 'device', exclude: ['fcmToken', 'lastSeenAt', 'integrityCheckedAt'], reasonRules: [reasonOnChange(['status'], 'Alasan wajib diisi saat mencabut perangkat.')] },
)
