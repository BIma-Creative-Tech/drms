import type { GlobalConfig } from 'payload'

import { anyRole, isGroupAdmin } from '@/access/roles'
import { withGlobalAudit } from '@/audit/hooks'

const intField = (name: string, label: string, def: number, min: number, max: number) => ({
  name,
  type: 'number' as const,
  label,
  defaultValue: def,
  min,
  max,
  required: true,
  validate: (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? true : `Bilangan bulat ${min}–${max}.`),
})

/**
 * Setting aplikasi (app-wide, ADR 0016 §1): APK gate, device image targets, selfie retention batch
 * size and the group letterhead of consolidated reports. Identity + operational settings are PER PT
 * (`companies`). Read by every role (the APK gets a subset via /api/v1/me); updated by the group
 * admin only. Server-side resize targets are code config per media collection (ADR 0004 §2).
 */
export const CompanySettings: GlobalConfig = withGlobalAudit(
  {
    slug: 'company-settings',
    label: 'Setting aplikasi',
    admin: { group: 'Sistem' },
    access: { read: anyRole, update: ({ req }) => isGroupAdmin(req) },
    fields: [
      // ADR 0016 §6: letterhead of consolidated (multi-PT) reports / exports.
      { name: 'groupName', type: 'text', label: 'Nama grup (kop laporan konsolidasi)', maxLength: 160 },
      { name: 'groupLogo', type: 'upload', relationTo: 'media-company', label: 'Logo grup' },
      { name: 'groupPdfHeader', type: 'textarea', label: 'Kop PDF grup', maxLength: 1000 },
      {
        name: 'minAppVersion',
        type: 'text',
        label: 'Versi APK minimum',
        maxLength: 32,
        validate: (v: unknown) => (v === null || v === undefined || v === '' || (typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v)) ? true : 'Format x.y.z'),
      },
      // F4 app version gate (GET /api/v1/app/config, ADR 0010 decision 13): shown by the APK
      // before login; minAppVersion is also enforced on every authenticated call (426).
      {
        name: 'latestAppVersion',
        type: 'text',
        label: 'Versi APK terbaru',
        maxLength: 32,
        validate: (v: unknown) => (v === null || v === undefined || v === '' || (typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v)) ? true : 'Format x.y.z'),
      },
      {
        name: 'appDownloadUrl',
        type: 'text',
        label: 'URL unduh APK',
        maxLength: 500,
        admin: { description: 'https://… (APK side-load). Kosong = aplikasi menampilkan "hubungi admin".' },
        validate: (v: unknown) => (v === null || v === undefined || v === '' || (typeof v === 'string' && /^https:\/\/[^\s"'<>]+$/.test(v)) ? true : 'Harus URL https://'),
      },
      // app-wide (protects the server): max selfie files deleted per nightly retention run.
      { ...intField('selfieRetentionBatch', 'Maks. selfie dihapus per malam', 200, 10, 2000) },
      intField('offlineMaxAgeDays', 'Umur maksimal sesi offline APK (hari)', 30, 1, 30),
      {
        name: 'imageTargets',
        type: 'group',
        label: 'Target resize foto di perangkat (px, sisi terpanjang)',
        fields: [
          intField('receiptsMaxPx', 'Nota', 1600, 640, 4000),
          intField('selfiesMaxPx', 'Selfie', 720, 320, 2000),
          intField('transferProofsMaxPx', 'Bukti transfer', 1600, 640, 4000),
          intField('progressPhotosMaxPx', 'Foto progress', 1600, 640, 4000),
          intField('jpegQuality', 'Kualitas JPEG', 80, 50, 95),
        ],
      },
    ],
  },
  { docType: 'company_settings' },
)
