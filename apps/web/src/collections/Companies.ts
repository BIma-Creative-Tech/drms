import { sql } from '@payloadcms/db-postgres'
import { APIError, type CollectionAfterChangeHook, type CollectionBeforeChangeHook, type CollectionConfig, type Field, type FieldAccess } from 'payload'

import { companiesWithRole, denyAll, isGroupAdmin, memberCompanies, relId } from '@/access/roles'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { percentField, rupiahField, uuidField } from '@/fields/common'
import { SELFIE_RETENTION_DEFAULT_MONTHS } from '@/domain/attendance/retention-policy'
import { copyCompanyDefaults, ensureDefaultUrgencyLevels, ensureSystemCashInSources, SKIP_COMPANY_DEFAULTS } from '@/domain/company-defaults'
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
const shortCodeGuard: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
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

/** req.context key: the create's "copy defaults" choice (virtual fields, read before they are dropped). */
const COPY_DEFAULTS_CTX = 'pkCopyDefaults'

/** Virtual create-only fields → context (the DB write drops virtual fields). */
const captureCopyDefaults: CollectionBeforeChangeHook = ({ data, operation, req }) => {
  if (operation !== 'create') return data
  const d = data as { copyDefaults?: unknown; copyDefaultsFrom?: unknown }
  req.context[COPY_DEFAULTS_CTX] = { enabled: d.copyDefaults !== false, from: relId(d.copyDefaultsFrom) ?? null }
  delete d.copyDefaults
  delete d.copyDefaultsFrom
  return data
}

/**
 * MC4 (US-MC-01, wireframe §3 "Saat dibuat (sekali)"): a PT created by the group admin gets the
 * default numbering, approval rules, work schedule and settings of the source PT (#1 DRMS unless
 * "Salin dari PT" names another) IN THE SAME TRANSACTION — a PT never exists without numbering.
 * Seed and go-live import apply their own built-in defaults (`SKIP_COMPANY_DEFAULTS`).
 */
const copyDefaultsOnCreate: CollectionAfterChangeHook = async ({ doc, operation, req }) => {
  if (operation !== 'create' || req.context[SKIP_COMPANY_DEFAULTS] === true) return doc
  const choice = req.context[COPY_DEFAULTS_CTX] as { enabled: boolean; from: number | null } | undefined
  delete req.context[COPY_DEFAULTS_CTX]
  if (choice && !choice.enabled) {
    // QA-11: even a bare PT gets the system cash-in source "Pengembalian LPJ" (the LPJ refund needs it)
    await ensureSystemCashInSources(req, doc.id as number)
    await ensureDefaultUrgencyLevels(req, doc.id as number)
    return doc
  }
  await copyCompanyDefaults(req, doc.id as number, { from: choice?.from ?? null })
  await ensureDefaultUrgencyLevels(req, doc.id as number)
  return doc
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
  // QA-06 / ADR 0019 (owner decision 2026-10-08): LPJ shortfall up to this % above the approved amount is paid
  // as today; above it the new total needs the approval flow (Direktur → Finance) before the shortfall transfer.
  {
    ...percentField('shortfallTolerancePct', 'Toleransi kekurangan LPJ di atas nominal disetujui (%)'),
    defaultValue: 10,
    required: true,
    admin: { description: 'Kekurangan LPJ yang membuat total transfer melebihi nominal disetujui + toleransi ini harus disetujui ulang (Direktur → Finance) sebelum ditransfer.' },
  },
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
  // E6 (Q-33, UU PDP): selfie retention per PT (the batch size stays app-wide in the global). Default 6 months =
  // owner decision 2026-10-05 (migration 20261005_090100_selfie_retention_6m moved untouched PTs from 12 to 6).
  {
    ...intField('selfieRetentionMonths', 'Retensi selfie absensi (bulan)', SELFIE_RETENTION_DEFAULT_MONTHS, 1, 120),
    admin: {
      description:
        'Selfie lebih tua dari ini dihapus dari penyimpanan saat penghapusan otomatis aktif (data absensi tetap). Default 6 bulan = keputusan owner 2026-10-05 (Q-33), sama dengan pemberitahuan privasi karyawan; nilai lain berarti pemberitahuan harus diperbarui.',
    },
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
  {
    name: 'fieldReportsEnabled',
    type: 'checkbox',
    label: 'Laporan lapangan per jenis project aktif (servis unit, timesheet unit, aktivitas aftersales)',
    defaultValue: false,
    admin: {
      description:
        'FR1 (ADR 0020): Staff yang ditugaskan, PM, dan Direktur membuat laporan lapangan sesuai jenis project. Nonaktif → pembuatan laporan baru ditolak FEATURE_DISABLED (web, API, APK); data lama tetap terbaca.',
    },
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

/** Top-level field names / labels of a setting field (rows/collapsibles are grouped by their first named field). */
function settingKey(f: Field): string {
  if ('name' in f && typeof f.name === 'string') return f.name
  if ('fields' in f && Array.isArray(f.fields)) return f.fields.map(settingKey).find(Boolean) ?? ''
  return ''
}
const OPERATIONAL = ['defaultGeofenceRadiusM', 'lateReportDays', 'budgetWarnPct', 'progressWarnGapPct', 'receiptRoundingTolerance', 'shortfallTolerancePct', 'receiptMaxAgeDays', 'reimburseAutoCloseDays', 'lpjDueDays', 'syncExpenseDraftsEnabled', 'syncProgressReportsEnabled', 'fieldReportsEnabled', 'defaultWorkSchedule']
const ATTENDANCE = ['syncAttendanceEnabled', 'selfieRetentionMonths', 'selfieRetentionDeleteEnabled']
const REMINDERS = ['remindersEnabled', 'notifyRequesterStatusEnabled']
/** COMPANY_SETTING_FIELDS in tab order; every field lands in exactly one tab (unit test). */
export function settingFields(keys: readonly string[]): Field[] {
  return COMPANY_SETTING_FIELDS.filter((f) => keys.includes(settingKey(f)))
}
export const COMPANY_SETTING_TABS = { OPERATIONAL, ATTENDANCE, REMINDERS } as const
export const companySettingKey = settingKey

/**
 * Perusahaan / PT (ADR 0016 §1, US-MC-01). Company #1 = DRMS (created by migration
 * `*_mc1_companies` from the former global). Read: members of the PT (+ group admin); create and
 * (de)activate: group admin; update: Admin/Direktur of that PT (+ group admin). Never deleted.
 */
export const Companies: CollectionConfig = withAudit(
  {
    slug: 'companies',
    defaultSort: 'shortCode',
    labels: { singular: 'Perusahaan (PT)', plural: 'Perusahaan (PT)' },
    admin: {
      useAsTitle: 'name',
      group: 'Sistem',
      // MC2-4 (wireframe §3): Kode · Nama · Zona waktu · Anggota · Status · Dibuat
      defaultColumns: ['shortCode', 'name', 'timezone', 'memberCount', 'active', 'createdAt'],
      listSearchableFields: ['shortCode', 'name', 'legalName'],
      description: 'Satu baris per PT. Admin grup membuat dan menonaktifkan PT; Admin/Direktur PT itu mengubah identitas dan pengaturan operasionalnya.',
    },
    access: {
      read: ({ req }) => (isGroupAdmin(req) ? true : { id: { in: memberCompanies(req, { all: true }) } }),
      create: ({ req }) => isGroupAdmin(req),
      // QA-20(c): no Admin/Direktur PT → false (an empty `id IN ()` Where still counted as "may update"
      // in the admin permissions and showed the Pengaturan module to PM/Finance/Staff)
      update: ({ req }) => {
        if (isGroupAdmin(req)) return true
        const ids = companiesWithRole(req, ['pk-admin', 'pk-owner'], { all: true })
        return ids.length > 0 ? { id: { in: ids } } : false
      },
      delete: denyAll,
    },
    hooks: { beforeChange: [shortCodeGuard, captureCopyDefaults], afterChange: [copyDefaultsOnCreate] },
    fields: [
      // MC2-4 (wireframe §3): tabs = the groups moved from "Setting perusahaan" (unnamed tabs: no schema change)
      {
        type: 'tabs',
        tabs: [
          {
            label: 'Identitas',
            fields: [
              {
                type: 'row',
                fields: [
                  {
                    name: 'shortCode',
                    type: 'text',
                    label: 'Kode singkat',
                    required: true,
                    unique: true,
                    index: true,
                    maxLength: 16,
                    admin: {
                      width: '30%',
                      description: 'Token {COMPANY} di nomor dokumen (mis. 1/PB-CS1/27/IX/2026): huruf besar/angka, 2–16 karakter. Terkunci setelah PT ini punya dokumen bernomor.',
                    },
                    validate: (v: unknown) => (typeof v === 'string' && SHORT_CODE_RE.test(v) ? true : 'Huruf besar/angka, 2–16 karakter (token {COMPANY}).'),
                  },
                  { name: 'name', type: 'text', label: 'Nama perusahaan', required: true, maxLength: 160, admin: { width: '70%' } },
                ],
              },
              { name: 'legalName', type: 'text', label: 'Nama legal', maxLength: 200 },
              { name: 'logo', type: 'upload', relationTo: 'media-company', label: 'Logo', admin: { description: 'PNG/JPG, dipakai di kop PDF dan ekspor PT ini.' } },
              { name: 'pdfHeader', type: 'textarea', label: 'Kop PDF', maxLength: 1000, admin: { description: 'Teks kop surat PDF PT ini (alamat, kontak).' } },
              {
                type: 'row',
                fields: [
                  { name: 'address', type: 'textarea', label: 'Alamat', maxLength: 500, admin: { width: '65%' } },
                  { name: 'phone', type: 'text', label: 'Telepon', maxLength: 32, admin: { width: '35%' } },
                ],
              },
              {
                name: 'timezone',
                type: 'text',
                label: 'Zona waktu',
                required: true,
                defaultValue: DEFAULT_TZ,
                validate: validateTimezone,
                admin: { description: 'Rilis ini: harus sama dengan zona waktu server (ADR 0016 §9, Q-59).' },
              },
            ],
          },
          { label: 'Operasional', fields: settingFields(OPERATIONAL) },
          { label: 'Absensi & retensi', fields: settingFields(ATTENDANCE) },
          { label: 'Pengingat & notifikasi', fields: settingFields(REMINDERS) },
        ],
      },
      {
        name: 'active',
        type: 'checkbox',
        label: 'Aktif',
        defaultValue: true,
        index: true,
        access: groupAdminOnly,
        admin: { position: 'sidebar', description: 'Hanya Admin grup yang dapat membuat atau menonaktifkan PT (alasan wajib).', components: { Cell: '@/admin/components/companies/ActiveCell#ActiveCell' } },
      },
      // MC4 (US-MC-01, wireframe §3): create-only choice, never stored (virtual)
      {
        name: 'copyDefaults',
        type: 'checkbox',
        label: 'Salin default saat dibuat',
        defaultValue: true,
        virtual: true,
        access: { create: ({ req }) => isGroupAdmin(req), update: () => false, read: ({ req }) => isGroupAdmin(req) }, // read: Payload hides unreadable fields in the create form (MC4-02)
        admin: {
          position: 'sidebar',
          readOnly: false, // Payload makes `virtual` fields readOnly by default (sanitize.js) → disabled in the create form (UAT UI-CO)
          condition: (data) => !data?.id,
          description: 'Sekali saat PT dibuat: penomoran dokumen (mulai dari 1), aturan approval tanpa user/project tertentu, jadwal kerja default, dan pengaturan operasional yang masih default.',
        },
      },
      {
        name: 'copyDefaultsFrom',
        type: 'relationship',
        relationTo: 'companies',
        label: 'Salin dari PT',
        virtual: true,
        access: { create: ({ req }) => isGroupAdmin(req), update: () => false, read: ({ req }) => isGroupAdmin(req) }, // read: Payload hides unreadable fields in the create form (MC4-02)
        admin: { position: 'sidebar', readOnly: false /* virtual → readOnly by default, see copyDefaults */, condition: (data) => !data?.id && data?.copyDefaults !== false, description: 'Kosong = PT #1 (DRMS).' },
      },
      // list-only column (MC2-4): active members of the PT
      { name: 'memberCount', type: 'ui', label: 'Anggota', admin: { disableListColumn: false, components: { Cell: '@/admin/components/companies/MemberCountCell#MemberCountCell' } } },
      uuidField(),
    ],
  },
  { docType: 'company', reasonRules: [reasonOnDeactivate] },
)

export const noCompanyError = () => new APIError('PT wajib dipilih.', 400, null, true)
