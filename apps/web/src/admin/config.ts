/**
 * Admin wiring of the F2 custom views (architecture §8, phase plan F2): paths are strings resolved
 * through the generated import map (payload generate:importmap). No React import here — collection
 * configs are also loaded by the worker and the OpenAPI generator.
 */
export const RIWAYAT_TAB = {
  riwayat: {
    Component: '@/admin/views/RiwayatView#RiwayatView',
    path: '/riwayat' as const,
    tab: { label: 'Riwayat', href: '/riwayat', order: 900 },
  },
}

export const F2_ADMIN_VIEWS = {
  approvalInbox: { Component: '@/admin/views/ApprovalInbox#ApprovalInbox', path: '/persetujuan' as const, meta: { title: 'Persetujuan' } },
  transferQueue: { Component: '@/admin/views/TransferQueue#TransferQueue', path: '/antrian-transfer' as const, meta: { title: 'Antrian Transfer' } },
  lpjVerification: { Component: '@/admin/views/LpjVerification#LpjVerification', path: '/verifikasi-lpj' as const, meta: { title: 'Verifikasi LPJ' } },
}

/**
 * F3 (wireframes §0): `dashboard` replaces the admin homepage (Payload 3.90.1
 * admin.components.views.dashboard, rendered inside the default template); the other views are
 * custom root views wrapped by Shell. `/laporan` must be exact, else it prefix-matches
 * `/laporan/<kode>` (isPathMatchingRoute: non-exact = prefix).
 */
export const F3_ADMIN_VIEWS = {
  dashboard: { Component: '@/admin/views/Dashboard#Dashboard' },
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

/** S3e (US-05, S-04): the caller's notifications (bell in the nav, admin.components.beforeNavLinks). */
export const S3E_ADMIN_VIEWS = {
  notifications: { Component: '@/admin/views/Notifikasi#NotificationsView', path: '/notifikasi' as const, exact: true, meta: { title: 'Notifikasi' } },
}
