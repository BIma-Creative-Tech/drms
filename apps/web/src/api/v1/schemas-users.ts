import { z } from 'zod'

/**
 * DRMS 13/10 Wave 3 — "Pengguna" tabbed onboarding (ADR 0003 revision 2026-10-13): ONE save of the account (Keycloak),
 * its access per PT (roles), the employee record per PT, the employee's bank accounts and (DRMS 15/10) its team
 * assignments.
 * `POST /user-onboarding` (create) · `PATCH /user-onboarding/{userId}` (edit) · `GET /user-onboarding/{userId}`.
 * Pure module (bundled by scripts/gen-openapi.mjs). Messages are Indonesian (shown as-is by the web form).
 */
const id = z.number().int().positive()
const businessDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Tanggal harus berformat YYYY-MM-DD.')

/** Same set as `ROLES` (access/roles.ts) — inlined: this module is bundled without Payload. */
export const OnboardingRole = z
  .enum(['pk-staff', 'pk-pm', 'pk-finance', 'pk-owner', 'pk-principal', 'pk-admin', 'pk-operator'])
  .meta({ id: 'OnboardingRole', description: 'Role in ONE PT (pk-owner = Direktur, pk-principal = Owner (ADR 0026), pk-operator = Operator/Anggota).' })

const optText = (max: number, label: string) => z.string().trim().max(max, `${label} maksimal ${max} karakter.`)

export const OnboardingUserInput = z
  .object({
    email: z.email({ error: 'Email tidak valid.' }).max(254, 'Email maksimal 254 karakter.'),
    name: z.string({ error: 'Nama wajib diisi.' }).trim().min(1, 'Nama wajib diisi.').max(128, 'Nama maksimal 128 karakter.'),
    phone: optText(32, 'No. HP').nullable().optional(),
    active: z.boolean().optional().meta({ description: 'Default true. false = account disabled in Keycloak, sessions + devices revoked (edit: reason required).' }),
  })
  .strict()

export const OnboardingEmployeeInput = z
  .object({
    id: id.optional().meta({ description: 'Existing employee of THIS PT: linked to the account (must not be linked to another account) and the given fields are updated. Omitted = a NEW employee of this PT (code + name required).' }),
    code: optText(32, 'Kode karyawan').optional(),
    name: optText(128, 'Nama karyawan').optional(),
    nickname: optText(64, 'Nama panggilan').nullable().optional(),
    position: optText(128, 'Jabatan').nullable().optional(),
    phone: optText(32, 'No. HP karyawan').nullable().optional(),
    attendanceType: z.enum(['onsite', 'non_onsite']).optional().meta({ description: 'DRMS 13/10 A2 "Tipe absensi": onsite (default for a new employee) = any registered location of the PT; non_onsite = head office + branch offices only.' }),
    active: z.boolean().optional(),
  })
  .strict()

export const OnboardingBankAccountInput = z
  .object({
    id: id.optional().meta({ description: 'Existing account of this PT\'s employee (update). Omitted = new account (bank, accountNo, accountHolder required).' }),
    bank: id.optional(),
    accountNo: optText(40, 'Nomor rekening').optional().meta({ description: 'Digits only after removing spaces, dots and dashes (5–34).' }),
    accountHolder: optText(128, 'Atas nama').optional(),
    isDefault: z.boolean().optional(),
    verificationStatus: z.enum(['unverified', 'verified']).optional().meta({ description: 'Admin / Finance only (collection field access).' }),
    active: z.boolean().optional(),
  })
  .strict()

/** DRMS 15/10: team assignment of THIS PT's employee (collection `team-assignments`, its hooks stay the guard). */
export const OnboardingAssignmentInput = z
  .object({
    id: id.optional().meta({ description: 'Existing assignment of this PT\'s employee: only roleInProject and endDate change (reason required). Omitted = a NEW assignment (exactly one of project / costCenter; ADR 0032: `site` is refused).' }),
    project: id.optional(),
    costCenter: id.optional(),
    site: id.optional(),
    roleInProject: z.enum(['pm', 'staff', 'mandor']).meta({ description: 'Role in the assignment (PM / Staff / Mandor). A PM caller cannot assign pm.' }),
    startDate: businessDate.nullable().optional(),
    endDate: businessDate.nullable().optional().meta({ description: 'Not before startDate. Set on an existing assignment = the assignment ends (reason required).' }),
  })
  .strict()

export const OnboardingCompanyInput = z
  .object({
    company: id,
    roles: z.array(OnboardingRole).max(7).meta({ description: 'Roles in this PT. Empty on an existing membership = membership inactive (history kept); a PT without membership needs ≥ 1 role.' }),
    employee: OnboardingEmployeeInput.nullable().optional().meta({ description: 'null = unlink the employee of this PT (the employee record stays). Omitted = unchanged.' }),
    bankAccounts: z.array(OnboardingBankAccountInput).max(20).optional().meta({ description: 'Bank accounts of THIS PT\'s employee (rows omitted = unchanged; never deleted — deactivate instead).' }),
    assignments: z.array(OnboardingAssignmentInput).max(50).optional().meta({ description: 'Team assignments of THIS PT\'s employee, written after the employee (a new employee gets them). Rows omitted = unchanged; never deleted — set endDate instead. Locations: active records of this PT readable by the caller.' }),
  })
  .strict()

const reason = z.string().trim().max(1000, 'Alasan maksimal 1000 karakter.').optional().meta({
  description: 'Change reason for the audit rows. Required (≥ 3 characters) whenever a collection rule asks for it: deactivating the account / an employee / a bank account, changing a bank account\'s number, holder or bank, changing the role or end date of a team assignment.',
})

export const UserOnboardingCreate = z
  .object({
    user: OnboardingUserInput,
    companies: z.array(OnboardingCompanyInput).min(1, 'Pilih minimal satu PT dan peran.').max(50),
    reason,
  })
  .strict()
  .meta({ id: 'UserOnboardingCreate' })

export const UserOnboardingUpdate = z
  .object({
    user: OnboardingUserInput.partial().strict().optional().meta({ description: 'Only the identity fields to change (Keycloak-first).' }),
    companies: z.array(OnboardingCompanyInput).max(50).optional(),
    reason,
  })
  .strict()
  .meta({ id: 'UserOnboardingUpdate' })

const Employee = z.object({
  id,
  code: z.string(),
  name: z.string(),
  nickname: z.string().nullable(),
  position: z.string().nullable(),
  phone: z.string().nullable(),
  attendanceType: z.enum(['onsite', 'non_onsite']),
  active: z.boolean(),
})

const BankAccount = z.object({
  id,
  bank: id.nullable(),
  bankName: z.string().nullable(),
  accountNo: z.string(),
  accountHolder: z.string(),
  isDefault: z.boolean(),
  verificationStatus: z.enum(['unverified', 'verified']),
  active: z.boolean(),
})

const Choice = z.object({ id, code: z.string(), name: z.string() })

export const UserOnboardingDetail = z
  .object({
    user: z
      .object({
        id,
        email: z.string(),
        name: z.string().nullable(),
        phone: z.string().nullable(),
        active: z.boolean(),
        groupAdmin: z.boolean(),
        identityEditable: z.boolean().meta({ description: 'false: the account also belongs to a PT the caller does not administer (or is a group admin) — identity read-only (Users update access).' }),
      })
      .nullable(),
    companies: z.array(
      z.object({
        id,
        shortCode: z.string(),
        name: z.string(),
        canManageEmployees: z.boolean().meta({ description: 'Admin role IN this PT (employee + bank-account writes); a group admin without it edits access only.' }),
        membership: z.object({ id, roles: z.array(OnboardingRole), active: z.boolean() }).nullable(),
        employee: Employee.nullable(),
        bankAccounts: z.array(BankAccount),
        employeeChoices: z.array(z.object({ id, code: z.string(), name: z.string(), active: z.boolean() })).meta({ description: 'Employees of this PT not linked to another account (the linked one included).' }),
        canManageAssignments: z.boolean().meta({ description: 'Admin or PM role IN this PT (team-assignments create rule; a PM only for its team and never role pm).' }),
        assignments: z
          .array(z.object({ id, kind: z.enum(['project', 'costCenter', 'site']).nullable(), label: z.string(), roleInProject: z.string(), startDate: z.string().nullable(), endDate: z.string().nullable() }))
          .meta({ description: 'Team assignments of the linked employee.' }),
        assignmentChoices: z
          .object({ projects: z.array(Choice), costCenters: z.array(Choice), sites: z.array(Choice).meta({ description: 'ADR 0032: always empty (sites removed; kept for APK ≤ 0.11.1).' }) })
          .meta({ description: 'Selectable locations of a NEW assignment: active projects (not selesai / arsip) and cost centers of this PT, read with the caller\'s access.' }),
      }),
    ),
    banks: z.array(z.object({ id, name: z.string() })),
  })
  .meta({ id: 'UserOnboardingDetail' })

export const UserOnboardingResult = z
  .object({
    userId: id,
    created: z.boolean(),
    temporaryPassword: z.string().nullable().meta({
      description: 'Create only, shown ONCE: temporary password of a NEW Keycloak user (Keycloak requires a new password at the first login, UPDATE_PASSWORD). null when an existing Keycloak account with that email was linked (its password is unchanged) and on edit. Never stored or logged.',
    }),
    linkedExistingAccount: z.boolean(),
    detail: UserOnboardingDetail,
  })
  .meta({ id: 'UserOnboardingResult' })

export type UserOnboardingCreateBody = z.infer<typeof UserOnboardingCreate>
export type UserOnboardingUpdateBody = z.infer<typeof UserOnboardingUpdate>
export type UserOnboardingDetailBody = z.infer<typeof UserOnboardingDetail>
export type OnboardingCompanyBody = z.infer<typeof OnboardingCompanyInput>
export type OnboardingAssignmentBody = z.infer<typeof OnboardingAssignmentInput>
