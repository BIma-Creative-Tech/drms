import type { Endpoint } from 'payload'

import { ADDENDUM_ENDPOINTS } from './endpoints/addenda'
import { testEmailEndpoint } from './endpoints/admin'
import { ATTENDANCE_ENDPOINTS } from './endpoints/attendance'
import { registerDeviceEndpoint, revokeDeviceEndpoint } from './endpoints/devices'
import { healthEndpoint, healthHeadEndpoint, readyEndpoint, readyHeadEndpoint } from './endpoints/health'
import { CASH_ENDPOINTS } from './endpoints/cash'
import { DAILY_ENDPOINTS } from './endpoints/daily'
import { EXPENSE_ENDPOINTS } from './endpoints/expense-requests'
import { FIELD_ENDPOINTS } from './endpoints/field'
import { LOAN_ENDPOINTS } from './endpoints/loans'
import { mastersEndpoint } from './endpoints/masters'
import { membershipBatchEndpoint } from './endpoints/memberships'
import { mediaFileEndpoint, mediaSignedUrlEndpoint, uploadMediaEndpoint } from './endpoints/media'
import { NOTIFICATION_ENDPOINTS } from './endpoints/notifications'
import { meEndpoint } from './endpoints/me'
import { meCompaniesEndpoint } from './endpoints/me-companies'
import { openapiEndpoint } from './endpoints/openapi'
import { privacyAckEndpoint, privacyNoticeEndpoint } from './endpoints/privacy'
import { PROGRESS_ENDPOINTS } from './endpoints/progress'
import { PROJECT_ENDPOINTS } from './endpoints/projects'
import { REPORT_ENDPOINTS } from './endpoints/reports'
import { SHORTFALL_ENDPOINTS } from './endpoints/shortfall'
import { appConfigEndpoint } from './endpoints/app'
import { syncBatchEndpoint } from './endpoints/sync'

/** Root custom endpoints served at /api/v1/* (architecture §6.1/§6.3). */
export const v1Endpoints: Endpoint[] = [
  healthEndpoint,
  healthHeadEndpoint,
  readyEndpoint,
  readyHeadEndpoint,
  meEndpoint,
  // MC2-4: web PT switcher (cookie pk-company-ids)
  meCompaniesEndpoint,
  mastersEndpoint,
  registerDeviceEndpoint,
  revokeDeviceEndpoint,
  testEmailEndpoint,
  openapiEndpoint,
  // F2a expense-request flow (T1–T4, T6–T8, period closing)
  ...EXPENSE_ENDPOINTS,
  ...CASH_ENDPOINTS,
  // MC2: atomic role-matrix save
  membershipBatchEndpoint,
  uploadMediaEndpoint,
  // F2b: scoped file download (APK), in-app notifications
  mediaFileEndpoint,
  mediaSignedUrlEndpoint,
  ...NOTIFICATION_ENDPOINTS,
  // F4: APK backend (ADR 0010): app version gate (public) + offline queue replay
  appConfigEndpoint,
  syncBatchEndpoint,
  // F3: role dashboards, reports + CSV/XLSX/PDF exports, global audit log (Q-F3-1…8)
  ...REPORT_ENDPOINTS,
  // E6: attendance recap (US-09), team today (US-13), T10 correction (US-15), selfie viewer (Q-33)
  ...ATTENDANCE_ENDPOINTS,
  // E4: project stages (G11 editor), progress reports (T11), K-09 progress vs budget
  ...PROGRESS_ENDPOINTS,
  // E5: budget addenda (T12, US-18/US-30) — web + APK approve
  ...ADDENDUM_ENDPOINTS,
  // Q-46 / ASVS 8.3.3 (ADR 0018): employee privacy notice (public) + own acknowledgement
  privacyNoticeEndpoint,
  privacyAckEndpoint,
  // QA-06 / ADR 0019: LPJ shortfall above approved + tolerance → re-approval (web)
  ...SHORTFALL_ENDPOINTS,
  // FR1 (ADR 0020): field reports per project kind — service reports, unit timesheets, aftersales log, units
  ...FIELD_ENDPOINTS,
  // P3: konstruksi RAP (Excel import, templates) + Laporan Harian (ledger, corrections, weekly recap)
  ...DAILY_ENDPOINTS,
  // DRMS 10/10 Phase C: project list / detail (APK Proyek) + cost-center picker (D2) — after /projects/progress
  ...PROJECT_ENDPOINTS,
  // ADR 0022: inter-project loans (PM submits, Direktur decides, repayments) — web + APK
  ...LOAN_ENDPOINTS,
]
