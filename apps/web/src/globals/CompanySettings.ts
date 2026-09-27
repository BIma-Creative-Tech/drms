import type { GlobalConfig } from 'payload'

import { anyRole } from '@/access/roles'
import { rolesAllowed } from '@/access/policies'
import { withGlobalAudit } from '@/audit/hooks'
import { percentField, rupiahField } from '@/fields/common'
import { DEFAULT_TZ, isValidTimeZone } from '@/lib/time'

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
 * Setting perusahaan (requirements v1.1 §6, architecture §4.2). Read by every role (the APK gets a
 * subset via /api/v1/me); updated by Admin and Owner. Server-side resize targets are code config
 * per media collection (ADR 0004 §2); `imageTargets` here are the DEVICE-side targets for the APK.
 */
export const CompanySettings: GlobalConfig = withGlobalAudit(
  {
    slug: 'company-settings',
    label: 'Setting perusahaan',
    admin: { group: 'Sistem' },
    access: { read: anyRole, update: rolesAllowed('pk-admin', 'pk-owner') },
    fields: [
      { name: 'name', type: 'text', label: 'Nama perusahaan', required: true, defaultValue: 'PT Double Rezki Makmur Sejahtera', maxLength: 160 },
      {
        name: 'shortCode',
        type: 'text',
        label: 'Kode singkat',
        required: true,
        defaultValue: 'DRMS',
        maxLength: 16,
        validate: (v: unknown) => (typeof v === 'string' && /^[A-Z0-9]{2,16}$/.test(v) ? true : 'Huruf besar/angka, 2–16 karakter (token {COMPANY}).'),
      },
      { name: 'logo', type: 'upload', relationTo: 'media-company', label: 'Logo' },
      { name: 'pdfHeader', type: 'textarea', label: 'Kop PDF', maxLength: 1000 },
      { name: 'address', type: 'textarea', label: 'Alamat', maxLength: 500 },
      { name: 'phone', type: 'text', label: 'Telepon', maxLength: 32 },
      {
        name: 'timezone',
        type: 'text',
        label: 'Zona waktu',
        required: true,
        defaultValue: DEFAULT_TZ,
        validate: (v: unknown) => (typeof v === 'string' && isValidTimeZone(v) ? true : 'Zona waktu IANA tidak valid.'),
        admin: { description: 'Proses server memakai env TZ (cron, tanggal bisnis); ubah keduanya bersamaan.' },
      },
      {
        ...intField('defaultGeofenceRadiusM', 'Radius geofence default (m)', 100, 10, 5000),
        // S3e (US-01, S-19): used for attendance when a project / cost center has a point but no own radius.
        admin: { description: 'Dipakai untuk absensi bila project/pusat biaya punya titik lokasi tetapi radiusnya kosong.' },
      },
      intField('lateReportDays', 'Batas hari laporan progress terlambat', 3, 1, 60),
      {
        type: 'row',
        fields: [
          { ...percentField('budgetWarnPct', 'Ambang anggaran kuning (%)'), defaultValue: 85, required: true },
          { ...intField('budgetOverPct', 'Ambang anggaran merah (%)', 100, 1, 1000) },
        ],
      },
      {
        type: 'row',
        fields: [
          { ...percentField('progressWarnGapPct', 'Selisih progress vs anggaran kuning (%)'), defaultValue: 0, required: true },
          { ...percentField('progressBadGapPct', 'Selisih progress vs anggaran merah (%)'), defaultValue: 8, required: true },
        ],
      },
      { ...rupiahField('receiptRoundingTolerance', 'Toleransi pembulatan nota per baris (Rp)', { required: true }), defaultValue: 1000 },
      intField('receiptMaxAgeDays', 'Batas umur nota (hari)', 30, 1, 365),
      intField('reimburseAutoCloseDays', 'Tutup otomatis reimburse (hari)', 30, 1, 365),
      // F3 (Q-F3-1, user 2026-09-24: default 7): an Uang Muka without LPJ is "LPJ terlambat" (K-12b)
      // when the first posted advance transfer is older than this many calendar days.
      {
        ...intField('lpjDueDays', 'Batas LPJ uang muka (hari setelah transfer)', 7, 1, 365),
        admin: { description: 'Uang muka tanpa LPJ lebih lama dari ini tampil sebagai "LPJ terlambat" di dashboard/laporan.' },
      },
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
      {
        name: 'syncExpenseDraftsEnabled',
        type: 'checkbox',
        label: 'Sinkronisasi draft pengajuan dari APK (offline) aktif',
        defaultValue: true,
        admin: { description: 'Nonaktif → item offline ditolak FEATURE_DISABLED (ADR 0010 rollback).' },
      },
      {
        name: 'syncAttendanceEnabled',
        type: 'checkbox',
        label: 'Absensi dari APK (termasuk offline) aktif',
        defaultValue: false,
        admin: {
          description:
            'Absen masuk/pulang sendiri di project/pusat biaya yang ditugaskan (geofence, selfie, lokasi palsu ditolak) dan "diabsenkan PM". Nonaktif → item absensi ditolak FEATURE_DISABLED. Nyalakan di prod setelah checklist go-live.',
        },
      },
      // E6 (Q-30): schedule for employees without their own `workSchedule` (terlambat / pulang cepat).
      {
        name: 'defaultWorkSchedule',
        type: 'relationship',
        relationTo: 'work-schedules',
        label: 'Jadwal kerja default',
        admin: { description: 'Dipakai untuk karyawan tanpa jadwal sendiri. Kosong = keterlambatan tidak dihitung.' },
      },
      // E6 (Q-33, UU PDP): selfie retention. The daily job `selfieRetention` (jobs/tasks.ts) deletes the
      // selfie FILES older than this many months when `selfieRetentionDeleteEnabled` is on (default
      // OFF = dry run: count only); attendance rows stay, the media row becomes a tombstone (removedAt).
      {
        ...intField('selfieRetentionMonths', 'Retensi selfie absensi (bulan)', 12, 1, 120),
        admin: { description: 'Selfie lebih tua dari ini dihapus dari penyimpanan saat penghapusan otomatis aktif (data absensi tetap). Default 12 bulan; menunggu keputusan klien (Q-33).' },
      },
      {
        type: 'row',
        fields: [
          {
            name: 'selfieRetentionDeleteEnabled',
            type: 'checkbox',
            label: 'Hapus otomatis selfie melewati retensi (aktif)',
            defaultValue: false,
            admin: { description: 'Nonaktif = job hanya menghitung (dry run). Aktif = file selfie dihapus permanen setiap malam (02:30), tercatat di audit log.' },
          },
          { ...intField('selfieRetentionBatch', 'Maks. selfie dihapus per malam', 200, 10, 2000) },
        ],
      },
      {
        name: 'syncProgressReportsEnabled',
        type: 'checkbox',
        label: 'Laporan progress dari APK (termasuk offline) aktif',
        defaultValue: true,
        admin: { description: 'E4: laporan progress harian + foto dari APK. Nonaktif → item laporan ditolak FEATURE_DISABLED (rollback).' },
      },
      // E7 (M12, US-11, plan fase1-golive §E7): daily reminders. Run once per business day at/after
      // `reminderHour` (company timezone; the worker checks hourly). Exactly one notification per
      // recipient, rule, subject and day (budget: once per threshold per project). In-app always,
      // email when `reminderEmailEnabled` (FCM later, ADR 0011).
      {
        type: 'collapsible',
        label: 'Pengingat terjadwal (E7)',
        admin: { initCollapsed: false },
        fields: [
          {
            type: 'row',
            fields: [
              { name: 'remindersEnabled', type: 'checkbox', label: 'Pengingat aktif', defaultValue: true, admin: { description: 'Nonaktif = job pengingat tidak mengirim apa pun (rollback).' } },
              { ...intField('reminderHour', 'Jam kirim (0–23, zona perusahaan)', 7, 0, 23) },
              {
                name: 'reminderEmailEnabled',
                type: 'checkbox',
                label: 'Juga kirim email',
                defaultValue: false,
                admin: { description: 'Selain notifikasi in-app. Batas SMTP 30 email/jam per mailbox — aktifkan setelah alamat email pengguna benar.' },
              },
            ],
          },
          {
            type: 'row',
            fields: [
              { name: 'reminderLateProgressEnabled', type: 'checkbox', label: 'Laporan progress terlambat → PM + Direktur', defaultValue: true, admin: { description: 'Batas hari = "Batas hari laporan progress terlambat".' } },
              { name: 'reminderLpjOverdueEnabled', type: 'checkbox', label: 'Nota/LPJ uang muka terlambat → pemohon + Finance', defaultValue: true, admin: { description: 'Batas hari = "Batas LPJ uang muka".' } },
            ],
          },
          {
            type: 'row',
            fields: [
              { name: 'reminderRevisionEnabled', type: 'checkbox', label: 'Revisi nota/LPJ menggantung → pemohon', defaultValue: true },
              { ...intField('reminderRevisionDays', 'Revisi menggantung setelah (hari)', 3, 1, 60) },
            ],
          },
          {
            name: 'reminderBudgetEnabled',
            type: 'checkbox',
            label: 'Komitmen anggaran project lewat ambang → Direktur + Finance + PM',
            defaultValue: true,
            admin: { description: 'Ambang = "Ambang anggaran kuning" dan "merah" di atas; sekali per ambang per project.' },
          },
        ],
      },
      // S3e (US-05, US-41, S-04): status notifications outside the scheduled reminders. In-app rows are
      // written in the same transaction as the status change; email goes through the sendEmail queue
      // (same mailer + SMTP rate guard as the E7 reminders).
      {
        type: 'collapsible',
        label: 'Notifikasi status pengajuan',
        admin: { initCollapsed: false },
        fields: [
          {
            type: 'row',
            fields: [
              {
                name: 'notifyRequesterStatusEnabled',
                type: 'checkbox',
                label: 'Beri tahu pemohon saat diajukan, ditarik, atau dibuat atas namanya (in-app)',
                defaultValue: true,
                admin: { description: 'Pemohon lain dan pembuat diberi tahu; pelaku aksi tidak diberi tahu tentang aksinya sendiri.' },
              },
              {
                name: 'approvalEmailEnabled',
                type: 'checkbox',
                label: 'Email ke Direktur/Finance saat pengajuan menunggu keputusannya',
                defaultValue: false,
                admin: { description: 'Selain notifikasi in-app. Isi email tanpa nominal/nama pemohon. Batas SMTP 30 email/jam per mailbox.' },
              },
            ],
          },
        ],
      },
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
