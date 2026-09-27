import { sql } from '@payloadcms/db-postgres'
import { APIError, type CollectionBeforeChangeHook, type CollectionConfig, type Field, type FieldAccess } from 'payload'

import { companiesWithRole, denyAll, isGroupAdmin, memberCompanies } from '@/access/roles'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { percentField, rupiahField, uuidField } from '@/fields/common'
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

export const SHORT_CODE_RE = /^[A-Z0-9]{2,16}$/

/** Group-admin only field (create/deactivate a company, ADR 0016 §2). */
const groupAdminOnly: { create: FieldAccess; update: FieldAccess } = { create: ({ req }) => isGroupAdmin(req), update: ({ req }) => isGroupAdmin(req) }

/**
 * ADR 0016 §9: every PT runs on the PROCESS timezone in MC1 (14 call sites use `process.env.TZ`); a
 * different value would silently disagree with cron / business dates.
 */
function validateTimezone(v: unknown): true | string {
  if (typeof v !== 'string' || !isValidTimeZone(v)) return 'Zona waktu IANA tidak valid.'
  const proc = process.env.TZ || DEFAULT_TZ
  return v === proc ? true : `MC1: semua PT memakai zona waktu server (${proc}).`
}

/**
 * `shortCode` is the `{COMPANY}` token of issued document numbers → immutable once this PT has a
 * numbered document (a counter row exists, MC1-5).
 */
export const shortCodeGuard: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  if (operation !== 'update' || !originalDoc || data.shortCode === undefined || data.shortCode === originalDoc.shortCode) return data
  const res = await req.payload.db.drizzle.execute(
    // raw: counters are not a collection (ADR 0007); bound parameter only
    sql`SELECT 1 FROM document_sequence_counters WHERE company_id = ${originalDoc.id} LIMIT 1`,
  )
  if ((res as unknown as { rows: unknown[] }).rows.length > 0) {
    throw new APIError('Kode singkat tidak dapat diubah: PT ini sudah punya dokumen bernomor.', 409, null, true)
  }
  return data
}

/** Per-PT identity + operational settings (moved from the `company-settings` global, ADR 0016 §1). */
export const COMPANY_SETTING_FIELDS: Field[] = [
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
  // F3 (Q-F3-1, user 2026-09-24: default 7): an Uang Muka without LPJ is "LPJ terlambat" (K-12b).
  {
    ...intField('lpjDueDays', 'Batas LPJ uang muka (hari setelah transfer)', 7, 1, 365),
    admin: { description: 'Uang muka tanpa LPJ lebih lama dari ini tampil sebagai "LPJ terlambat" di dashboard/laporan.' },
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
    filterOptions: ({ id }) => (id ? { company: { equals: id } } : false),
    admin: { description: 'Dipakai untuk karyawan tanpa jadwal sendiri. Kosong = keterlambatan tidak dihitung.' },
  },
  // E6 (Q-33, UU PDP): selfie retention per PT (the batch size stays app-wide in the global).
  {
    ...intField('selfieRetentionMonths', 'Retensi selfie absensi (bulan)', 12, 1, 120),
    admin: { description: 'Selfie lebih tua dari ini dihapus dari penyimpanan saat penghapusan otomatis aktif (data absensi tetap). Default 12 bulan; menunggu keputusan klien (Q-33).' },
  },
  {
    name: 'selfieRetentionDeleteEnabled',
    type: 'checkbox',
    label: 'Hapus otomatis selfie melewati retensi (aktif)',
    defaultValue: false,
    admin: { description: 'Nonaktif = job hanya menghitung (dry run). Aktif = file selfie dihapus permanen setiap malam (02:30), tercatat di audit log.' },
  },
  {
    name: 'syncProgressReportsEnabled',
    type: 'checkbox',
    label: 'Laporan progress dari APK (termasuk offline) aktif',
    defaultValue: true,
    admin: { description: 'E4: laporan progress harian + foto dari APK. Nonaktif → item laporan ditolak FEATURE_DISABLED (rollback).' },
  },
  // E7 (M12, US-11): daily reminders, per PT.
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
  // S3e (US-05, US-41, S-04): status notifications outside the scheduled reminders.
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
]

/**
 * Perusahaan / PT (ADR 0016 §1, US-MC-01). Company #1 = DRMS (created by migration
 * `*_mc1_companies` from the former global). Read: members of the PT (+ group admin); create and
 * (de)activate: group admin; update: Admin/Direktur of that PT (+ group admin). Never deleted.
 */
export const Companies: CollectionConfig = withAudit(
  {
    slug: 'companies',
    labels: { singular: 'Perusahaan (PT)', plural: 'Perusahaan (PT)' },
    admin: { useAsTitle: 'name', group: 'Sistem', defaultColumns: ['shortCode', 'name', 'active'] },
    access: {
      read: ({ req }) => (isGroupAdmin(req) ? true : { id: { in: memberCompanies(req, { all: true }) } }),
      create: ({ req }) => isGroupAdmin(req),
      update: ({ req }) => (isGroupAdmin(req) ? true : { id: { in: companiesWithRole(req, ['pk-admin', 'pk-owner'], { all: true }) } }),
      delete: denyAll,
    },
    // MC1-5: shortCodeGuard (immutable once a counter of this PT exists)
    hooks: { beforeChange: [] },
    fields: [
      { name: 'name', type: 'text', label: 'Nama perusahaan', required: true, maxLength: 160 },
      {
        name: 'shortCode',
        type: 'text',
        label: 'Kode singkat',
        required: true,
        unique: true,
        index: true,
        maxLength: 16,
        admin: { description: 'Token {COMPANY} di nomor dokumen. Tidak dapat diubah setelah ada dokumen bernomor.' },
        validate: (v: unknown) => (typeof v === 'string' && SHORT_CODE_RE.test(v) ? true : 'Huruf besar/angka, 2–16 karakter (token {COMPANY}).'),
      },
      { name: 'legalName', type: 'text', label: 'Nama legal', maxLength: 200 },
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
        validate: validateTimezone,
        admin: { description: 'MC1: harus sama dengan zona waktu server (ADR 0016 §9).' },
      },
      ...COMPANY_SETTING_FIELDS,
      { name: 'active', type: 'checkbox', label: 'Aktif', defaultValue: true, index: true, access: groupAdminOnly, admin: { position: 'sidebar' } },
      uuidField(),
    ],
  },
  { docType: 'company', reasonRules: [reasonOnDeactivate] },
)

export const noCompanyError = () => new APIError('PT wajib dipilih.', 400, null, true)
