/**
 * Admin wiring of the F2 custom views (architecture §8, phase plan F2): paths are strings resolved
 * through the generated import map (payload generate:importmap). No React import here — collection
 * configs are also loaded by the worker and the OpenAPI generator.
 */
import type { PayloadRequest } from 'payload'

import { MONEY_ROLES } from '@/access/money'
import { hasRoleAny } from '@/access/roles'

export const RIWAYAT_TAB = {
  riwayat: {
    Component: '@/admin/views/RiwayatView#RiwayatView',
    path: '/riwayat' as const,
    tab: { label: 'Riwayat', href: '/riwayat', order: 900 },
  },
}

/**
 * DRMS 10/10 point 7: project detail tabs — "Proyek" (the form = default view, renamed), "RAP" (plan vs realisation,
 * D4) and "Pengajuan" (the project's expense requests). Document views of the Projects collection.
 */
export const PROJECT_TABS = {
  default: { tab: { label: 'Proyek' } },
  rap: {
    Component: '@/admin/views/ProjectTabs#ProjectRapTab',
    path: '/rap' as const,
    tab: { label: 'RAP', href: '/rap', order: 200 },
  },
  pengajuan: {
    Component: '@/admin/views/ProjectTabs#ProjectRequestsTab',
    path: '/pengajuan' as const,
    tab: { label: 'Pengajuan', href: '/pengajuan', order: 300 },
  },
  // ADR 0022 §8: "Pinjaman antar project" of this project (as lender and as borrower). Owner 2026-10-11: no tab for
  // Staff (loans are money; the view itself re-checks the roles and shows nothing without them).
  pinjaman: {
    Component: '@/admin/views/Loans#ProjectLoansTab',
    path: '/pinjaman' as const,
    tab: { label: 'Pinjaman', href: '/pinjaman', order: 400, condition: ({ req }: { req: Pick<PayloadRequest, 'user'> }) => hasRoleAny(req, ...MONEY_ROLES) },
  },
}

export const F2_ADMIN_VIEWS = {
  approvalInbox: { Component: '@/admin/views/ApprovalInbox#ApprovalInbox', path: '/persetujuan' as const, meta: { title: 'Persetujuan' } },
  transferQueue: { Component: '@/admin/views/TransferQueue#TransferQueue', path: '/antrian-transfer' as const, meta: { title: 'Antrian Transfer' } },
  lpjVerification: { Component: '@/admin/views/LpjVerification#LpjVerification', path: '/verifikasi-lpj' as const, meta: { title: 'Verifikasi LPJ' } },
}

/**
 * F3 (wireframes §0): `dashboard` replaces the admin homepage (Payload 3.90.1
 * admin.components.views.dashboard, rendered inside the default template) — since the Odoo-style
 * navigation (2026-09-27) that homepage is the module launcher and the role dashboard is its own
 * module at `/dashboard` (exact; custom root view wrapped in PageTemplate). The other views are
 * custom root views wrapped by Shell. `/laporan` must be exact, else it prefix-matches
 * `/laporan/<kode>` (isPathMatchingRoute: non-exact = prefix).
 */
export const F3_ADMIN_VIEWS = {
  dashboard: { Component: '@/admin/views/Launcher#Launcher' },
  dashboardPage: { Component: '@/admin/views/Dashboard#DashboardPage', path: '/dashboard' as const, exact: true, meta: { title: 'Dashboard' } },
  reports: { Component: '@/admin/views/Reports#ReportsIndex', path: '/laporan' as const, exact: true, meta: { title: 'Laporan' } },
  report: { Component: '@/admin/views/Reports#ReportView', path: '/laporan/:kode' as const, meta: { title: 'Laporan' } },
  auditLog: { Component: '@/admin/views/Reports#AuditLogView', path: '/audit-log' as const, exact: true, meta: { title: 'Audit Log' } },
}

/**
 * E2 (fase1-golive §E2): Finance cash views. `/kas` exact (else it prefix-matches `/kas/baru`);
 * `/kas/:id/ubah` = edit before period close. Role checks inside the views + the /api/v1 endpoints.
 */
export const E2_ADMIN_VIEWS = {
  kasBook: { Component: '@/admin/views/Kas#KasBook', path: '/kas' as const, exact: true, meta: { title: 'Kas' } },
  kasNew: { Component: '@/admin/views/Kas#KasNew', path: '/kas/baru' as const, exact: true, meta: { title: 'Catat kas' } },
  kasEdit: { Component: '@/admin/views/Kas#KasEdit', path: '/kas/:id/ubah' as const, exact: true, meta: { title: 'Edit transaksi kas' } },
  periodClose: { Component: '@/admin/views/Kas#TutupBuku', path: '/tutup-buku' as const, exact: true, meta: { title: 'Tutup buku' } },
}

/**
 * E6 web (fase1-golive §E6, S2): attendance views — "Tim hari ini" (US-13), monthly recap + team grid
 * (US-09, T10 correction US-15, selfie viewer Q-33), work schedules / holidays / cost-center geofence
 * (Q-30/Q-40). All exact (else `/absensi` prefix-matches the sub-pages). Scope checks inside the views
 * and the /api/v1 endpoints.
 */
export const E6_ADMIN_VIEWS = {
  absensiToday: { Component: '@/admin/views/Absensi#AbsensiToday', path: '/absensi' as const, exact: true, meta: { title: 'Absensi' } },
  absensiAbsen: { Component: '@/admin/views/Absensi#AbsensiAbsen', path: '/absensi/absen' as const, exact: true, meta: { title: 'Absen' } },
  absensiRekap: { Component: '@/admin/views/Absensi#AbsensiRekap', path: '/absensi/rekap' as const, exact: true, meta: { title: 'Rekap absensi' } },
  absensiJadwal: { Component: '@/admin/views/Absensi#AbsensiJadwal', path: '/absensi/jadwal' as const, exact: true, meta: { title: 'Jadwal & hari libur' } },
}

/**
 * Sprint S2 web A — E4 progress (K-09 overview, project stages + editor, progress reports) and
 * E5 Addendum RAB. All exact (a prefix match would swallow the deeper paths).
 */
export const S2A_ADMIN_VIEWS = {
  progressOverview: { Component: '@/admin/views/Progress#ProgressOverview', path: '/progress' as const, exact: true, meta: { title: 'Progress project' } },
  progressProject: { Component: '@/admin/views/Progress#ProjectProgressView', path: '/progress/project/:id' as const, exact: true, meta: { title: 'Progress project' } },
  progressReports: { Component: '@/admin/views/Progress#ProgressReportList', path: '/progress/laporan' as const, exact: true, meta: { title: 'Laporan progress' } },
  progressReport: { Component: '@/admin/views/Progress#ProgressReportDetail', path: '/progress/laporan/:id' as const, exact: true, meta: { title: 'Laporan progress' } },
  addendumList: { Component: '@/admin/views/Addendum#AddendumList', path: '/addendum' as const, exact: true, meta: { title: 'Addendum RAB' } },
  addendumNew: { Component: '@/admin/views/Addendum#AddendumNew', path: '/addendum/baru' as const, exact: true, meta: { title: 'Ajukan addendum RAB' } },
  addendumDetail: { Component: '@/admin/views/Addendum#AddendumDetail', path: '/addendum/detail/:id' as const, exact: true, meta: { title: 'Addendum RAB' } },
}

/** S3e (US-05, S-04): the caller's notifications (bell in the top module bar, src/admin/shell/ModuleNav.tsx). */
export const S3E_ADMIN_VIEWS = {
  notifications: { Component: '@/admin/views/Notifikasi#NotificationsView', path: '/notifikasi' as const, exact: true, meta: { title: 'Notifikasi' } },
}

/** ADR 0017: "Keamanan akun" — optional self-service 2FA of the caller's own account (avatar menu). */
export const ACCOUNT_ADMIN_VIEWS = {
  accountSecurity: { Component: '@/admin/views/KeamananAkun#KeamananAkunView', path: '/keamanan-akun' as const, exact: true, meta: { title: 'Keamanan akun' } },
  // QA-24: Payload's built-in /unauthorized (key = admin.routes.unauthorized) → the uniform no-access page
  unauthorized: { Component: '@/admin/views/NoAccess#UnauthorizedView' },
}

/**
 * MC2-4 (ADR 0016 §11, wireframe mc/wireframes.md §2): role matrix "Pengguna & akses PT" (user × PT ×
 * roles, employee of that PT). Admin of a PT / group admin; checks inside the view + REST access.
 */
export const MC2_ADMIN_VIEWS = {
  accessMatrix: { Component: '@/admin/views/AksesPt#AksesPtView', path: '/akses-pt' as const, exact: true, meta: { title: 'Pengguna & akses PT' } },
}

/**
 * DRMS 13/10 Wave 3: "Pengguna" — ONE tabbed form (account, access per PT, employee, bank accounts) for create
 * (`/pengguna/baru`, also the menu item) and edit (`/pengguna/<id>`). Both routes render the same view (it reads the
 * segment), so whichever matches first is right. Admin of a PT / group admin; checks inside the view +
 * /api/v1/user-onboarding.
 */
export const USER_ONBOARDING_ADMIN_VIEWS = {
  userOnboardingNew: { Component: '@/admin/views/Pengguna#PenggunaView', path: '/pengguna/baru' as const, exact: true, meta: { title: 'Pengguna baru' } },
  userOnboarding: { Component: '@/admin/views/Pengguna#PenggunaView', path: '/pengguna/:id' as const, exact: true, meta: { title: 'Pengguna' } },
}

/**
 * FR1 (ADR 0020, plan "Web"): field reports per project kind — "Unit & kontrak" (contract list,
 * contract detail with tabs Timesheet/Rekap/Unit/Timeline, unit detail, timesheet input/detail),
 * "Laporan servis" (list/input/detail) and "Aftersales" (weekly recap, activity list/input/detail).
 * All exact; static segments (`baru`, `detail`, `kontrak`, `unit`, `timesheet`) never collide with an
 * id segment. Role + per-PT flag (companies.fieldReportsEnabled) checks inside the views; /api/v1
 * re-checks every write.
 */
export const FR1_ADMIN_VIEWS = {
  fieldContracts: { Component: '@/admin/views/FieldUnits#FieldContracts', path: '/unit-kontrak' as const, exact: true, meta: { title: 'Unit & kontrak' } },
  fieldContract: { Component: '@/admin/views/FieldUnits#FieldContractDetail', path: '/unit-kontrak/kontrak/:id' as const, exact: true, meta: { title: 'Kontrak unit' } },
  fieldUnit: { Component: '@/admin/views/FieldUnits#FieldUnitDetail', path: '/unit-kontrak/unit/:id' as const, exact: true, meta: { title: 'Unit' } },
  fieldTimesheetNew: { Component: '@/admin/views/FieldUnits#FieldTimesheetNew', path: '/unit-kontrak/timesheet/baru' as const, exact: true, meta: { title: 'Isi timesheet' } },
  fieldTimesheet: { Component: '@/admin/views/FieldUnits#FieldTimesheetDetail', path: '/unit-kontrak/timesheet/detail/:id' as const, exact: true, meta: { title: 'Timesheet unit' } },
  fieldServiceList: { Component: '@/admin/views/FieldService#FieldServiceList', path: '/laporan-servis' as const, exact: true, meta: { title: 'Laporan servis' } },
  fieldServiceNew: { Component: '@/admin/views/FieldService#FieldServiceNew', path: '/laporan-servis/baru' as const, exact: true, meta: { title: 'Laporan servis baru' } },
  fieldService: { Component: '@/admin/views/FieldService#FieldServiceDetail', path: '/laporan-servis/detail/:id' as const, exact: true, meta: { title: 'Laporan servis' } },
  fieldAftersales: { Component: '@/admin/views/FieldAftersales#FieldAftersalesRecap', path: '/aftersales' as const, exact: true, meta: { title: 'Aftersales' } },
  fieldActivities: { Component: '@/admin/views/FieldAftersales#FieldActivityList', path: '/aftersales/aktivitas' as const, exact: true, meta: { title: 'Aktivitas aftersales' } },
  fieldActivityNew: { Component: '@/admin/views/FieldAftersales#FieldActivityNew', path: '/aftersales/aktivitas/baru' as const, exact: true, meta: { title: 'Catat aktivitas' } },
  fieldActivity: { Component: '@/admin/views/FieldAftersales#FieldActivityDetail', path: '/aftersales/aktivitas/detail/:id' as const, exact: true, meta: { title: 'Aktivitas aftersales' } },
  // P3 konstruksi: Laporan harian (list / input / detail incl. ?ubah=1 / ?koreksi=1) + RAP & weekly recap of a project
  fieldDailyList: { Component: '@/admin/views/FieldDaily#FieldDailyList', path: '/laporan-harian' as const, exact: true, meta: { title: 'Laporan harian' } },
  fieldDailyNew: { Component: '@/admin/views/FieldDaily#FieldDailyNew', path: '/laporan-harian/baru' as const, exact: true, meta: { title: 'Laporan harian baru' } },
  fieldDaily: { Component: '@/admin/views/FieldDaily#FieldDailyDetail', path: '/laporan-harian/detail/:id' as const, exact: true, meta: { title: 'Laporan harian' } },
  fieldDailyRap: { Component: '@/admin/views/FieldDaily#FieldDailyRap', path: '/laporan-harian/rap/:id' as const, exact: true, meta: { title: 'RAP project' } },
}

/**
 * DRMS 10/10 D9: module landing page (tiles of the module's visible sub-menus, registry
 * `moduleLandingHref`). Exact: `/modul/<id>` only; the view resolves visibility itself.
 */
export const D1010_ADMIN_VIEWS = {
  moduleLanding: { Component: '@/admin/views/ModuleLanding#ModuleLanding', path: '/modul/:id' as const, exact: true, meta: { title: 'Modul' } },
}

/**
 * ADR 0022: inter-project loans ("Pinjaman antar project") — list (D8), new Draft (PM of the borrower project), detail
 * with decision bar (Direktur), repayments (borrower PM / Finance) and void (Direktur / Finance). All exact.
 */
export const LOAN_ADMIN_VIEWS = {
  loanList: { Component: '@/admin/views/Loans#LoanList', path: '/pinjaman' as const, exact: true, meta: { title: 'Pinjaman antar project' } },
  loanNew: { Component: '@/admin/views/Loans#LoanNew', path: '/pinjaman/baru' as const, exact: true, meta: { title: 'Ajukan pinjaman antar project' } },
  loanDetail: { Component: '@/admin/views/Loans#LoanDetail', path: '/pinjaman/detail/:id' as const, exact: true, meta: { title: 'Pinjaman antar project' } },
}

/**
 * DRMS 13/10 Wave 3 — "Proyek › RAP" (own sub-menu under Proyek): RAP index of the visible projects and the RAP form +
 * Excel upload of one project. Both exact (`/rap` would prefix-match `/rap/<id>`). Role / project checks inside the
 * views; every write goes through /api/v1 (projects/{id}/rap/items, rap-items/{id}, rap import / templates).
 */
export const RAP_ADMIN_VIEWS = {
  rapIndex: { Component: '@/admin/views/Rap#RapIndex', path: '/rap' as const, exact: true, meta: { title: 'RAP proyek' } },
  rapProject: { Component: '@/admin/views/Rap#RapProject', path: '/rap/:id' as const, exact: true, meta: { title: 'RAP project' } },
}
