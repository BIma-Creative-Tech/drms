import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { id } from '@payloadcms/translations/languages/id'
import { buildConfig } from 'payload'
import sharp from 'sharp'

import { withStaffHiddenGlobals, withStaffPanelVisibility } from './access/panel-visibility'
import { withDisplayCells } from './admin/display-cells'
import { withCompanyListUi } from './admin/company-list'
import { withRowActions } from './admin/row-actions'
import { withoutApiTab, withoutGlobalApiTab } from './admin/edit-view'
import { withListSearch } from './admin/list-search'
import { withPkListView } from './admin/pk-list/wire'
import { ACCOUNT_ADMIN_VIEWS, D1010_ADMIN_VIEWS, E2_ADMIN_VIEWS, E6_ADMIN_VIEWS, F2_ADMIN_VIEWS, F3_ADMIN_VIEWS, FR1_ADMIN_VIEWS, IC_LOAN_ADMIN_VIEWS, LOAN_ADMIN_VIEWS, MC2_ADMIN_VIEWS, RAP_ADMIN_VIEWS, S2A_ADMIN_VIEWS, S3E_ADMIN_VIEWS, USER_ONBOARDING_ADMIN_VIEWS } from './admin/config'
import { v1Endpoints } from './api/v1'
import { Attendances } from './collections/Attendances'
import { AttendanceCorrections } from './collections/AttendanceCorrections'
import { ApprovalRules } from './collections/ApprovalRules'
import { Approvals } from './collections/Approvals'
import { AuditLogs } from './collections/AuditLogs'
import { Banks } from './collections/Banks'
import { BudgetAddenda } from './collections/BudgetAddenda'
import { ProjectLoanRepayments } from './collections/ProjectLoanRepayments'
import { ProjectLoans } from './collections/ProjectLoans'
import { BudgetLines } from './collections/BudgetLines'
import { CashAccounts } from './collections/CashAccounts'
import { CashEntries } from './collections/CashEntries'
import { CashInSources } from './collections/CashInSources'
import { Companies } from './collections/Companies'
import { AftersalesActivities } from './collections/AftersalesActivities'
import { ContractUnits } from './collections/ContractUnits'
import { CompanyMemberships } from './collections/CompanyMemberships'
import { Clients } from './collections/Clients'
import { CostCenters } from './collections/CostCenters'
import { Devices } from './collections/Devices'
import { DocumentSequences } from './collections/DocumentSequences'
import { EmployeeBankAccounts } from './collections/EmployeeBankAccounts'
import { VendorBankAccounts } from './collections/VendorBankAccounts'
import { Employees } from './collections/Employees'
import { ExpenseCategories } from './collections/ExpenseCategories'
import { ExpenseLineSnapshots } from './collections/ExpenseLineSnapshots'
import { ExpenseRequests } from './collections/ExpenseRequests'
import { Holidays } from './collections/Holidays'
import { MEDIA_COLLECTIONS } from './collections/media'
import { NotificationTemplates } from './collections/NotificationTemplates'
import { Notifications } from './collections/Notifications'
import { PeriodClosings } from './collections/PeriodClosings'
import { ProgressReports } from './collections/ProgressReports'
import { Projects } from './collections/Projects'
import { ProjectStages } from './collections/ProjectStages'
import { ReceiptFlags } from './collections/ReceiptFlags'
import { ServiceReports } from './collections/ServiceReports'
import { Receipts } from './collections/Receipts'
import { Settlements } from './collections/Settlements'
import { Sites } from './collections/Sites'
import { StageTemplates } from './collections/StageTemplates'
import { TeamAssignments } from './collections/TeamAssignments'
import { Transfers } from './collections/Transfers'
import { UnitTimesheets } from './collections/UnitTimesheets'
import { Uoms } from './collections/Uoms'
import { DailyReportLines } from './collections/DailyReportLines'
import { DailyReports } from './collections/DailyReports'
import { RapItems } from './collections/RapItems'
import { RapTemplates } from './collections/RapTemplates'
import { ResourceTypes } from './collections/ResourceTypes'
import { UrgencyLevels } from './collections/UrgencyLevels'
import { Users } from './collections/Users'
import { Vehicles } from './collections/Vehicles'
import { Vendors } from './collections/Vendors'
import { WebSessions } from './collections/WebSessions'
import { WorkSchedules } from './collections/WorkSchedules'
import { CompanySettings } from './globals/CompanySettings'
import { tasks } from './jobs/tasks'
import { smtpEmailAdapter } from './email/adapter'
import { getEnv, parseSmtpEnv, readSecret } from './lib/env'
import { loggerOptions } from './lib/logger'
import { MAX_UPLOAD_BYTES } from './collections/media/factory'
import { withBodyGuard, withGlobalBodyGuard } from './lib/body-guard'
import { gateSharp, setImageQueueLogger } from './lib/image-queue'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Outbound SMTP only when SMTP_* is fully configured (all-or-nothing, validated here because the
// adapter is built with the config); otherwise Payload's console adapter (dev/tests/migrate).
const smtp = parseSmtpEnv(process.env)

// ADR 0004: one sharp instance (the one passed to buildConfig), concurrency 1 (RAM budget): one
// libvips thread per pipeline. E9 P-1: no libvips operation cache (every upload is a new image, the
// cache only holds RAM), and every pipeline runs through the bounded image queue (lib/image-queue:
// max IMAGE_RESIZE_CONCURRENCY jobs, the v1 upload endpoint queues whole uploads → 503 when full).
sharp.concurrency(1)
sharp.cache(false)
const queuedSharp = gateSharp(sharp)

export const MASTER_COLLECTIONS = [
  Employees,
  EmployeeBankAccounts,
  Banks,
  Clients,
  Vendors,
  // ADR 0027: rekening vendor (destination of a vendor payment)
  VendorBankAccounts,
  Projects,
  ProjectStages,
  StageTemplates,
  BudgetLines,
  ExpenseCategories,
  CashInSources,
  CashAccounts,
  TeamAssignments,
  WorkSchedules,
  Holidays,
  ApprovalRules,
  NotificationTemplates,
  Uoms,
  UrgencyLevels,
  Vehicles,
  CostCenters,
  // ADR 0023: kantor cabang per PT
  Sites,
  DocumentSequences,
]

/** FR1 (ADR 0020): field reports per project kind — contract units + the DRMS reports. */
export const FIELD_COLLECTIONS = [ContractUnits, ServiceReports, UnitTimesheets, AftersalesActivities, RapItems, RapTemplates, ResourceTypes, DailyReports, DailyReportLines]

/** F2 business documents (T1–T8, period closing). */
export const FLOW_COLLECTIONS = [
  ExpenseRequests,
  ExpenseLineSnapshots,
  Approvals,
  Receipts,
  ReceiptFlags,
  Transfers,
  Settlements,
  CashEntries,
  PeriodClosings,
]

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
    components: {
      // Web-starter retheme: DRMS mark/name instead of the Payload graphics (src/theme/graphics.tsx).
      graphics: { Icon: '@/theme/graphics#Icon', Logo: '@/theme/graphics#Logo' },
      beforeLogin: ['@/components/SsoLoginButton#SsoLoginButton'],
      logout: { Button: '@/components/LogoutButton#LogoutButton' },
      // Odoo-style navigation (2026-09-27): the left sidebar is replaced by a top module bar on every
      // DefaultTemplate page (launcher ⊞, module menu from src/admin/modules/registry.ts, notification
      // bell S3e/US-05, avatar menu with profile/theme/logout). Replacing Nav drops before/afterNavLinks
      // (F2 work-view links + badges now live in the registry).
      Nav: '@/admin/shell/ModuleNav#ModuleNav',
      // Loader (Uiverse "thin-lionfish-5" dots) on module navigation and every create/update/delete:
      // one client provider around every admin page (built-in views included), see src/admin/loading.
      // DRMS 10/10 12c: one image lightbox for every thumbnail link `a[data-pk-lightbox]` (src/admin/components/lightbox).
      providers: ['@/admin/loading/LoadingProvider#LoadingProvider', '@/admin/components/lightbox/LightboxProvider#LightboxProvider'],
      // F3: module launcher at /admin, role dashboards at /admin/dashboard, reports, global audit log.
      views: { ...F2_ADMIN_VIEWS, ...F3_ADMIN_VIEWS, ...E2_ADMIN_VIEWS, ...E6_ADMIN_VIEWS, ...S2A_ADMIN_VIEWS, ...S3E_ADMIN_VIEWS, ...ACCOUNT_ADMIN_VIEWS, ...MC2_ADMIN_VIEWS, ...FR1_ADMIN_VIEWS, ...D1010_ADMIN_VIEWS, ...LOAN_ADMIN_VIEWS, ...IC_LOAN_ADMIN_VIEWS, ...RAP_ADMIN_VIEWS, ...USER_ONBOARDING_ADMIN_VIEWS },
    },
    timezones: { defaultTimezone: 'Asia/Makassar' },
    // QA-29: "8 Okt 2026 14:30" instead of the default "Oktober ke-8 2026, 2:30 PM" (date-fns, id locale)
    dateFormat: 'd MMM yyyy HH:mm',
    // Default 'gravatar' sends md5(email) to www.gravatar.com (privacy + CSP img-src), spike f.
    avatar: 'default',
    meta: { titleSuffix: ' — RR Teams' },
  },
  // F2c: staff-only users see only their requests, receipts, notifications and profile.
  // E9 B-1 (G-21): non-object REST bodies (form/text, JSON arrays) → 400 before any hook runs.
  // MC2-4: PT column (short-code chip) + PT filter chips on every list with a `company` column.
  // QA-29 / QA-25: boolean cells "Aktif/Nonaktif" / "Ya/Tidak", server timestamps as fixed WITA text.
  // DRMS 13/10 Umum #3–#8: the generic list view PkListView (filter bar, Kolom ▾, pager, clickable rows, no bulk edit).
  collections: withoutApiTab(withListSearch(withBodyGuard(withStaffPanelVisibility(withPkListView(withCompanyListUi(withRowActions(withDisplayCells([Users, Companies, CompanyMemberships, ...MASTER_COLLECTIONS, ...FLOW_COLLECTIONS, ...FIELD_COLLECTIONS, Attendances, AttendanceCorrections, ProgressReports, BudgetAddenda, ProjectLoans, ProjectLoanRepayments, Notifications, Devices, WebSessions, AuditLogs, ...MEDIA_COLLECTIONS])))))))),
  globals: withoutGlobalApiTab(withGlobalBodyGuard(withStaffHiddenGlobals([CompanySettings]))),
  // Admin UI in Bahasa Indonesia (ADR 0001 §5; @payloadcms/translations/languages/id @3.90.1).
  // empty list cells: "—" (as in the custom views) instead of Payload's "<Tidak ada Klien>" in every row
  // DRMS 10/10 8d (WA-15): neutral select fallback "Pilih…" instead of "Pilih nilai" (fields set their own admin.placeholder)
  i18n: { supportedLanguages: { id }, fallbackLanguage: 'id', translations: { id: { general: { noLabel: '—', selectValue: 'Pilih…' } } } },
  graphQL: { disable: true },
  maxDepth: 3,
  defaultDepth: 1,
  telemetry: false,
  logger: { options: loggerOptions() },
  // Build-time placeholder only; the runtime value is validated by getEnv() in onInit.
  secret: readSecret('PAYLOAD_SECRET'),
  db: postgresAdapter({
    pool: {
      connectionString: readSecret('DATABASE_URL'),
      max: Number(process.env.DATABASE_POOL_MAX ?? 6),
      idleTimeoutMillis: 30_000,
    },
    // ADR 0001 §7 / 0006 §6: never push; migrations run as the owner role in a one-shot container.
    push: false,
    migrationDir: path.resolve(dirname, 'migrations'),
  }),
  sharp: queuedSharp,
  // ADR 0004 §2: ≤ 8 MiB per file, 5 files, request ≤ 10 MiB (Traefik buffering-pk/AppSec 10 MiB).
  upload: { limits: { fileSize: MAX_UPLOAD_BYTES, files: 5, fields: 30 }, requestSizeLimit: 10 * 1024 * 1024 },
  endpoints: v1Endpoints,
  email: smtp ? smtpEmailAdapter(smtp) : undefined,
  jobs: {
    tasks,
    // The worker process (dist/worker.mjs) calls handleSchedules() + run(); no autoRun in web.
    deleteJobOnComplete: false,
    // REST /api/payload-jobs/{run,handle-schedules,cancel} default to "any logged-in user": jobs
    // are queued by server code and run ONLY by the worker via the Local API (which bypasses
    // this access), so the HTTP surface is closed (e.g. no sendEmail runs inside the web process).
    access: { run: () => false, queue: () => false, cancel: () => false },
  },
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  onInit: async (payload) => {
    if (process.env.PK_SKIP_ENV_CHECK !== 'true') getEnv() // fail fast on invalid env
    setImageQueueLogger(payload.logger)
    payload.logger.info({ msg: 'payload initialised', pid: process.pid, tz: Intl.DateTimeFormat().resolvedOptions().timeZone })
  },
})
