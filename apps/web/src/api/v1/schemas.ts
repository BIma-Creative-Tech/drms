import { z } from 'zod'

import { PrivacyStatus } from './schemas-privacy'

/**
 * /api/v1 contract (zod → OpenAPI 3.1 via @asteasolutions/zod-to-openapi, architecture §6.4).
 * Schema names come from zod `.meta({ id })` (supported since zod-to-openapi v8 / zod 4, README).
 */
export const Problem = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    minAppVersion: z.string().optional(),
    code: z.string().optional().meta({ description: 'Machine-readable reason. 401 DEVICE_REVOKED = the token is valid but X-Device-Id was revoked/marked lost: the APK ends the session without a refresh. 403 PRIVACY_ACK_REQUIRED = attendance capture (selfie upload) while company-settings.minAppVersion ≥ 0.3.3 and the caller has not acknowledged the current privacy notice (ADR 0018): show the notice, POST /me/privacy-ack, then capture again.' }),
  })
  .meta({ id: 'Problem', description: 'RFC 9457 problem details' })

export const Health = z.object({ status: z.literal('ok') }).meta({ id: 'Health' })

export const Ready = z
  .object({
    status: z.enum(['ok', 'degraded']),
    checks: z.object({ db: z.boolean(), media: z.boolean() }),
  })
  .meta({ id: 'Ready' })

export const RoleEnum = z
  .enum(['pk-staff', 'pk-pm', 'pk-finance', 'pk-owner', 'pk-principal', 'pk-admin', 'pk-operator', 'pk-admin-staff'])
  .meta({ id: 'Role', description: 'pk-owner = "Direktur"; pk-principal = "Owner" (ADR 0026: the approval level above the Direktur); pk-operator = "Operator/Anggota"; pk-admin-staff = "Admin Staff" (ADR 0032). Effective roles: an Owner is also listed with pk-owner (same view and permissions as the Direktur); only the approval flow differs.' })

export const ImageTargets = z
  .object({
    receiptsMaxPx: z.number().int(),
    selfiesMaxPx: z.number().int(),
    transferProofsMaxPx: z.number().int(),
    progressPhotosMaxPx: z.number().int(),
    jpegQuality: z.number().int(),
  })
  .meta({ id: 'ImageTargets' })

export const Capabilities = z
  .object({
    approvalInbox: z.boolean().meta({ description: 'ADR 0013/0021/0026: holds pk-owner (label "Direktur"), pk-principal (label "Owner"), pk-finance or pk-pm (Persetujuan PM) → show the approval inbox.' }),
    teamMonitor: z.boolean().meta({ description: 'Holds pk-pm → team list/dashboard (monitoring only, no decisions).' }),
    progressReportCreate: z.boolean().meta({ description: 'E4: holds pk-pm (team projects), pk-owner or pk-admin (all) → may create progress reports.' }),
    serviceReportCreate: z.boolean().meta({ description: 'FR1 (ADR 0020): field reports on for the PT (companies.fieldReportsEnabled) and holds pk-staff (assigned projects), pk-pm (team) or pk-owner → may create service reports on projects of kind kontrak_unit / aftersales.' }),
    unitTimesheetCreate: z.boolean().meta({ description: 'FR1: same rule → unit timesheets on projects of kind kontrak_unit.' }),
    aftersalesActivityCreate: z.boolean().meta({ description: 'FR1: same rule → aftersales activities on projects of kind aftersales.' }),
    dailyReportCreate: z.boolean().meta({ description: 'P3: same rule → Laporan harian on projects of kind konstruksi.' }),
    intercompanyPayment: z.boolean().meta({
      description:
        'ADR 0028: may file a "PT grup" payment (Pembayaran antar-PT) — holds Finance, PM or Direktur (pk-owner) AS STORED (the server\'s filer rule). Unlike the effective `roles`, false for an Owner (pk-principal) without one of those roles. Absent on servers before this field (APK fallback: the payee directory).',
    }),
    instructIntercompanyLoan: z.boolean().meta({
      description:
        'ADR 0029: Owner (pk-principal AS STORED) — may instruct a "Pinjaman antar-PT" (POST /intercompany-loans; the lender list GET /intercompany-loans/lenders) and sees `instruct_loan` on a short request. The server re-checks the Owner role in BOTH PTs.',
    }),
    disburseIntercompanyLoan: z.boolean().meta({
      description: 'ADR 0029: Finance (stored) — the "Pencairan pinjaman antar-PT" queue (GET /intercompany-loans/queue) and the disbursement of loans whose LENDER is this PT (never one the caller instructed, G1).',
    }),
    attendanceOnBehalf: z.boolean().meta({
      description: 'ADR 0032: may record check-in / check-out on behalf of an employee — PM (team members at team locations, APK) or Admin Staff (any employee of the PT incl. those without an account; web POST /attendance/on-behalf and APK). The server re-checks.',
    }),
    attendanceAdminStaff: z.boolean().meta({
      description: 'ADR 0032: holds pk-admin-staff ("Admin Staff") — reads every attendance + correction of the PT, corrects (never own), on-behalf for any employee (GET /attendance/on-behalf/options).',
    }),
    fundCheckEnabled: z.boolean().meta({
      description: 'ADR 0029: companies.fundCheckEnabled of this PT (top level: any selected PT) — the final approval / the Owner\'s own submit is refused (409 FUND_INSUFFICIENT) when the PT\'s available funds are short. Off = the fund panel is information only.',
    }),
  })
  .meta({ id: 'Capabilities', description: 'UI hints for the APK (E1); the server guards stay authoritative.' })

const EmployeeRef = z
  .object({
    id: z.number().int(),
    code: z.string(),
    name: z.string(),
  })
  .meta({ id: 'EmployeeRef', description: 'ADR 0032: no `homeSite` any more (sites removed from the product).' })

export const MeCompany = z
  .object({
    id: z.number().int(),
    code: z.string().meta({ description: 'PT short code ({COMPANY} token of document numbers), e.g. DRMS.' }),
    name: z.string(),
    timezone: z.string().meta({ description: 'IANA; this release: equals the server TZ for every PT (ADR 0016 §9).' }),
    selected: z.boolean().meta({ description: 'In the effective selection of THIS request (X-Company-Ids / cookie ∩ memberships; default all).' }),
    roles: z.array(RoleEnum).meta({ description: 'Roles IN this PT (company_memberships), effective: an Owner (pk-principal) is listed with pk-owner too (ADR 0026).' }),
    employeeId: z.number().int().nullable().meta({ description: 'Employee record of the caller in this PT (ADR 0016 D1: one per PT).' }),
    employee: EmployeeRef.nullable(),
    capabilities: Capabilities,
    ownRequestNoApproval: z.boolean().meta({
      description:
        'ADR 0024 / 0026: the caller is Owner (pk-principal) in this PT and the PT has an active rule "Pengajuan Owner" (Peran pemohon = Owner, no approval level) — the APK shows "Pengajuan Anda langsung ke antrian transfer Finance" on the request form. Since ADR 0026 a Direktur\'s own request is approved by the Owner (false for a Direktur). Hint only; the rule is chosen at submit.',
    }),
    settings: z
      .object({
        defaultGeofenceRadiusM: z.number().int(),
        receiptRoundingTolerance: z.number().int(),
        receiptMaxAgeDays: z.number().int(),
        budgetWarnPct: z.number(),
        syncExpenseDraftsEnabled: z.boolean(),
        syncAttendanceEnabled: z.boolean(),
        syncProgressReportsEnabled: z.boolean(),
        fieldReportsEnabled: z.boolean().meta({ description: 'FR1 (ADR 0020): field reports per project kind switched on for this PT (default false).' }),
      })
      .meta({ description: 'Per-PT settings the APK needs (feature flags are applied per item PT: sync FEATURE_DISABLED).' }),
  })
  .meta({ id: 'MeCompany' })

export const Me = z
  .object({
    id: z.number().int(),
    email: z.string(),
    name: z.string().nullable(),
    displayName: z.string().min(1).meta({
      description: 'DRMS 10/10 WA-14: label to greet/show the caller (never empty): users.name → employee name of the membership in a selected PT (lowest PT id first, then other memberships) → email local part → "Pengguna". `name` stays the stored account name.',
    }),
    roles: z.array(RoleEnum).meta({ description: 'DEPRECATED (MC3, kept for mobile-v0.2.0): union of the roles over the SELECTED PTs. Use companies[].roles.' }),
    capabilities: Capabilities.meta({ description: 'DEPRECATED (MC3): derived from the top-level `roles` (union over the selected PTs). Use companies[].capabilities.' }),
    employee: EmployeeRef.nullable().meta({ description: 'DEPRECATED (MC3): employee of the PT `legacyCompanyId`. Use companies[].employee.' }),
    authMethod: z.enum(['oidcSession', 'mobileBearer']),
    device: z.object({ id: z.number().int(), deviceId: z.string() }).nullable(),
    settings: z
      .object({
        companyName: z.string(),
        shortCode: z.string(),
        timezone: z.string(),
        minAppVersion: z.string().nullable(),
        offlineMaxAgeDays: z.number().int(),
        defaultGeofenceRadiusM: z.number().int(),
        receiptRoundingTolerance: z.number().int(),
        receiptMaxAgeDays: z.number().int(),
        imageTargets: ImageTargets,
      })
      .meta({ description: 'DEPRECATED (MC3): per-PT values of `legacyCompanyId` + app-wide values. Use companies[].settings + appSettings.' }),
    companies: z.array(MeCompany).meta({ description: 'MC3: every active membership of the caller (active PTs), ascending id.' }),
    activeCompanyIds: z.array(z.number().int()).meta({ description: 'MC3: effective selection of this request (ascending).' }),
    legacyCompanyId: z
      .number()
      .int()
      .nullable()
      .meta({ description: 'MC3: PT of the deprecated single-PT fields = first selected membership (ascending id) with an employee, else the first selected one. One PT → that PT.' }),
    appSettings: z
      .object({ minAppVersion: z.string().nullable(), latestAppVersion: z.string().nullable(), offlineMaxAgeDays: z.number().int(), imageTargets: ImageTargets })
      .meta({ description: 'MC3: app-wide settings (one APK for all PTs).' }),
    privacy: PrivacyStatus,
    serverTime: z.string(),
  })
  .meta({ id: 'Me' })

export const MASTER_TYPES = [
  'projects',
  'project-stages',
  'cost-centers',
  'expense-categories',
  'uoms',
  'vehicles',
  'employees',
  'banks',
  'bank-accounts',
  'work-schedules',
  'holidays',
  'team-assignments',
  'vendors',
  'cash-in-sources',
  // owner decision 2026-10-09: "Tingkat urgensi" picker of the expense draft
  'urgency-levels',
  // FR1 (ADR 0020 §2): customer picker of the aftersales activity log (Staff only on aftersales projects)
  'clients',
  // ADR 0023 sites — ADR 0032: removed from the product; kept so an APK ≤ 0.11.1 still gets an answer (always empty)
  'sites',
  // ADR 0027: vendor accounts — destination picker of a vendor payment (Finance / PM / Direktur / Admin read; Staff read
  // since the owner request 2026-10-16)
  'vendor-bank-accounts',
  // ADR 0028: payee directory of a "PT grup" payment per paying PT (Finance / PM / Direktur of that PT; others: none)
  'intercompany-payees',
] as const
export type MasterType = (typeof MASTER_TYPES)[number]

/** ADR 0016 D2: masters shared by every PT (no `company`). */
export const SHARED_MASTER_TYPES = ['uoms', 'banks', 'holidays'] as const satisfies readonly MasterType[]

/** `?company=1,3` of list / queue endpoints (MC3-1): narrows the effective selection; a PT outside it → 403 COMPANY_NOT_ALLOWED. */
export const companyFilterParam = z
  .string()
  .regex(/^[1-9]\d{0,8}(,[1-9]\d{0,8})*$/)
  .optional()
  .meta({ description: 'MC3: PT filter (comma separated ids). Only narrows the effective selection (X-Company-Ids / cookie ∩ memberships); a PT outside it → 403 COMPANY_NOT_ALLOWED.' })

/**
 * MC4 (ADR 0016 §5): optional explicit PT of a create body. Must be an active membership holding the
 * role the create needs IN that PT (else 403 COMPANY_NOT_ALLOWED) and equal the PT of the referenced
 * project / cost center / cash account (else 400 COMPANY_MISMATCH). Absent = PT derived as before.
 * QA-MC4-14: a reference in a PT the caller is not mapped to is answered like a missing one.
 */
export const createCompanyField = z
  .number()
  .int()
  .positive()
  .optional()
  .meta({
    description:
      'MC4: explicit PT (companies id) of the new record. Must be one of your PTs where you hold the role this create needs (else 403 COMPANY_NOT_ALLOWED) and the PT of the referenced project / cost center / cash account (else 400 COMPANY_MISMATCH; a reference in a PT you are not mapped to is answered like a missing one). Omitted = derived from the references, else your only selected PT (unchanged behaviour of APK 0.2.x / 0.3.0).',
  })

export const MastersQuery = z
  .object({
    types: z
      .string()
      .regex(/^[a-z-]+(,[a-z-]+)*$/)
      .optional()
      .meta({ description: `Comma separated subset of: ${MASTER_TYPES.join(', ')}. Default: all.` }),
    since: z.iso.datetime({ offset: true }).optional().meta({ description: 'Only records updated after this instant (delta sync).' }),
    company: companyFilterParam,
  })
  .meta({ id: 'MastersQuery' })

const MasterItem = z
  .record(z.string(), z.unknown())
  .meta({ id: 'MasterItem', description: 'Whitelisted fields per type (id, updatedAt, active, …) plus MC3 `company` (PT id; null for shared masters) and `shared` (true for banks, uoms, holidays). ADR 0024: `employees` items carry `direktur` (bool: the account holds Direktur — or, ADR 0026, Owner — in that PT; not offered as requester to others). ADR 0028: `intercompany-payees` items = the receiving PTs a request of PT `company` may pay (id = the RECEIVING PT id — unique per (company, id) —, payeeCompanyId, shortCode, name, bankName, accountNoMasked, accountHolder, active); only for Finance / PM / Direktur of `company`. D1610 (ADR 0030): soft-deleted rows are never in a full read; a delta read (`since`) lists rows soft-deleted since then with `deleted: true, active: false` (drop them); a cancelled project (`status: dibatalkan`) has `active: false`.' })

export const Masters = z
  .object({
    serverTime: z.string(),
    companies: z
      .array(
        z.object({
          id: z.number().int(),
          code: z.string(),
          defaultGeofenceRadiusM: z.number().int(),
          version: z.string().meta({ description: 'Hash of this PT\'s items of the requested types in this answer (same types → same version = nothing changed).' }),
        }),
      )
      .meta({ description: 'MC3: PTs covered by this answer (selection narrowed by ?company=), ascending id.' }),
    sharedVersion: z.string().meta({ description: 'MC3: hash of the shared masters in this answer.' }),
    types: z.record(z.string(), z.object({ items: z.array(MasterItem), hasMore: z.boolean() })),
  })
  .meta({ id: 'Masters', description: 'Response header ETag (weak); send it back as If-None-Match → 304 without a body when nothing changed. Cache per PT: request with X-Company-Ids (or ?company=) = one PT.' })

/**
 * Client-side integrity signals (ADR 0010 decision 10, QM-4): bypassable by root-hiding tools, so the
 * server records them (devices + audit) and does not block. `mockLocation` is only known with a GPS
 * fix (per-fix `isMocked`, attendance — F5): null = not measured.
 */
export const DeviceIntegrity = z
  .object({
    rooted: z.boolean(),
    emulator: z.boolean(),
    developerMode: z.boolean(),
    adbEnabled: z.boolean(),
    mockLocation: z.boolean().nullable().optional(),
  })
  .strict()
  .meta({ id: 'DeviceIntegrity', description: 'Best-effort device signals (ADR 0010 decision 10), sent at register. Recorded and audited, never blocking; omitted keeps the stored values. mockLocation null = not measured (needs a GPS fix, F5).' })

export const DeviceRegister = z
  .object({
    deviceId: z.uuid().meta({ description: 'Install id generated by the APK (UUID); must equal X-Device-Id.' }),
    platform: z.literal('android'),
    model: z.string().max(128).optional(),
    appVersion: z.string().regex(/^[0-9A-Za-z.+-]{1,32}$/).optional(),
    fcmToken: z.string().min(1).max(4096).nullable().optional().meta({ description: 'FCM token (ADR 0011); null clears it, omitted keeps it. Push is not enabled yet (GET /app/config features.pushEnabled).' }),
    integrity: DeviceIntegrity.optional(),
  })
  .strict()
  .meta({ id: 'DeviceRegister' })

export const Device = z
  .object({
    id: z.number().int(),
    deviceId: z.string(),
    status: z.enum(['active', 'revoked', 'lost']),
    model: z.string().nullable(),
    appVersion: z.string().nullable(),
    registeredAt: z.string().nullable(),
    lastSeenAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    integrityRisk: z.boolean().meta({ description: 'Any integrity signal set at the last check (rooted, emulator, mock location).' }),
    integrityCheckedAt: z.string().nullable(),
  })
  .meta({ id: 'Device' })

export const DeviceRevoke = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict()
  .meta({ id: 'DeviceRevoke' })

export const TestEmailQueued = z
  .object({
    queued: z.literal(true),
    jobId: z.string().meta({ description: 'payload_jobs id of the sendEmail job (sent by the worker)' }),
  })
  .meta({ id: 'TestEmailQueued' })
