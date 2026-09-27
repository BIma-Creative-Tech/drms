import type { Endpoint } from 'payload'

import { ADDENDUM_ENDPOINTS } from './endpoints/addenda'
import { testEmailEndpoint } from './endpoints/admin'
import { ATTENDANCE_ENDPOINTS } from './endpoints/attendance'
import { registerDeviceEndpoint, revokeDeviceEndpoint } from './endpoints/devices'
import { healthEndpoint, healthHeadEndpoint, readyEndpoint, readyHeadEndpoint } from './endpoints/health'
import { CASH_ENDPOINTS } from './endpoints/cash'
import { EXPENSE_ENDPOINTS } from './endpoints/expense-requests'
import { mastersEndpoint } from './endpoints/masters'
import { mediaFileEndpoint, mediaSignedUrlEndpoint, uploadMediaEndpoint } from './endpoints/media'
import { NOTIFICATION_ENDPOINTS } from './endpoints/notifications'
import { meEndpoint } from './endpoints/me'
import { openapiEndpoint } from './endpoints/openapi'
import { PROGRESS_ENDPOINTS } from './endpoints/progress'
import { REPORT_ENDPOINTS } from './endpoints/reports'
import { appConfigEndpoint } from './endpoints/app'
import { syncBatchEndpoint } from './endpoints/sync'

/** Root custom endpoints served at /api/v1/* (architecture §6.1/§6.3). */
export const v1Endpoints: Endpoint[] = [
  healthEndpoint,
  healthHeadEndpoint,
  readyEndpoint,
  readyHeadEndpoint,
  meEndpoint,
  mastersEndpoint,
  registerDeviceEndpoint,
  revokeDeviceEndpoint,
  testEmailEndpoint,
  openapiEndpoint,
  // F2a expense-request flow (T1–T4, T6–T8, period closing)
  ...EXPENSE_ENDPOINTS,
  ...CASH_ENDPOINTS,
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
]
