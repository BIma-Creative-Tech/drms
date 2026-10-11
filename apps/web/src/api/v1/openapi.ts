import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

import { registerAddendumPaths } from './openapi-addendum'
import { registerAttendancePaths } from './openapi-attendance'
import { registerCompanyPaths } from './openapi-companies'
import { registerDailyPaths } from './openapi-daily'
import { registerFieldPaths } from './openapi-field'
import { registerShortfallPaths } from './openapi-shortfall'
import { Device, DeviceRegister, DeviceRevoke, Health, Masters, MastersQuery, Me, Problem, Ready, TestEmailQueued } from './schemas'
import * as F from './schemas-flow'
import { PrivacyAck, PrivacyAckBody, PrivacyNotice } from './schemas-privacy'
import * as P from './schemas-progress'
import * as R from './schemas-reports'
import * as S from './schemas-sync'

/**
 * Builds the /api/v1 OpenAPI 3.1 document from the zod schemas (architecture §6.4). Pure module
 * (no Payload import) so scripts/gen-openapi.mjs can bundle and run it at build time; the output
 * is committed at packages/api-contract/openapi.json (CI drift check) and served by
 * GET /api/v1/openapi.json.
 */
export function buildOpenApiDocument(version: string) {
  // registerParameter (reusable header component) needs `.openapi()`; build-time only module.
  extendZodWithOpenApi(z)
  const registry = new OpenAPIRegistry()
  const bearer = registry.registerComponent('securitySchemes', 'bearer', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'Keycloak access token of client proyekkas-mobile (realm drms). Requires header X-Device-Id of a registered active device.',
  })
  const cookie = registry.registerComponent('securitySchemes', 'session', {
    type: 'apiKey',
    in: 'cookie',
    name: '__Host-pk_session',
    description: 'Admin web session (OIDC login via /auth/login).',
  })
  const security = [{ [bearer.name]: [] }, { [cookie.name]: [] }]
  // MC3-1 (ADR 0016 §5): the read selection of every authenticated /api/v1 call (one component).
  const companyIds = registry.registerParameter(
    'CompanyIds',
    z
      .string()
      .regex(/^[1-9]\d{0,8}([, ]+[1-9]\d{0,8})*$/)
      .optional()
      .meta({
        param: {
          name: 'X-Company-Ids',
          in: 'header',
          description:
            'PTs to read (comma separated company ids, e.g. "1,3"). Only NARROWS the caller\'s active memberships; absent = all memberships (web: the switcher cookie). A PT without an active membership (or a malformed value) → 403 code COMPANY_NOT_ALLOWED (audited). Mutations are checked against the role in the DOCUMENT\'s PT; sync items carry their own company_id.',
        },
      }),
  )
  const deviceHeader = z.object({
    'X-Device-Id': z.uuid().meta({ description: 'Registered install id (APK).' }),
    'X-App-Version': z.string().optional().meta({ description: 'APK version; below company minimum → 426.' }),
    'X-Company-Ids': companyIds,
  })
  const problemResponses = (...codes: number[]) =>
    Object.fromEntries(
      codes.map((c) => [c, { description: 'Problem', content: { 'application/problem+json': { schema: Problem } } }]),
    )

  registry.registerPath({
    method: 'get',
    path: '/health',
    summary: 'Liveness',
    responses: { 200: { description: 'Process up', content: { 'application/json': { schema: Health } } } },
  })
  registry.registerPath({
    method: 'get',
    path: '/health/ready',
    summary: 'Readiness (DB + media volume)',
    responses: {
      200: { description: 'Ready', content: { 'application/json': { schema: Ready } } },
      503: { description: 'Degraded', content: { 'application/json': { schema: Ready } } },
    },
  })
  // HEAD is documented (not left implicit): uptime monitors rely on it, and it is a real
  // endpoint (headOf() in http.ts) — same status as GET, no body.
  registry.registerPath({
    method: 'head',
    path: '/health',
    summary: 'Liveness (HEAD: status only, no body)',
    responses: { 200: { description: 'Process up' } },
  })
  registry.registerPath({
    method: 'head',
    path: '/health/ready',
    summary: 'Readiness (HEAD: status only, no body)',
    responses: { 200: { description: 'Ready' }, 503: { description: 'Degraded' } },
  })
  registry.registerPath({
    method: 'get',
    path: '/me',
    summary: 'Current user + company context: companies[] (roles, employee, capabilities, settings per PT), activeCompanyIds; deprecated single-PT fields for the released APK (legacyCompanyId)',
    security,
    request: { headers: deviceHeader },
    responses: { 200: { description: 'Profile', content: { 'application/json': { schema: Me } } }, ...problemResponses(401, 426) },
  })
  // Q-46 / ASVS 8.3.3 (ADR 0018): employee privacy notice + acknowledgement
  registry.registerPath({
    method: 'get',
    path: '/privacy-notice',
    summary: 'Employee privacy notice (public, cacheable 5 min): version, title, safe HTML, markdown — bundled at build time',
    responses: { 200: { description: 'Notice', content: { 'application/json': { schema: PrivacyNotice } } } },
  })
  registry.registerPath({
    method: 'post',
    path: '/me/privacy-ack',
    summary: 'Acknowledge the CURRENT privacy notice (own account; version must equal the current one, else 409 PRIVACY_VERSION_MISMATCH); audited privacy_ack',
    security,
    request: {
      headers: deviceHeader.extend({
        'Idempotency-Key': z.uuid().optional().meta({ description: 'Required from the APK; a retry with the same key and body returns the stored response.' }),
      }),
      body: { content: { 'application/json': { schema: PrivacyAckBody } } },
    },
    responses: {
      200: { description: 'Acknowledged (or already acknowledged: unchanged)', content: { 'application/json': { schema: PrivacyAck } } },
      ...problemResponses(400, 401, 409, 422, 426, 429),
    },
  })
  registry.registerPath({
    method: 'get',
    path: '/masters',
    summary: 'Master data for the APK per PT (access-filtered, delta sync, company on each item, shared masters marked, per-PT version + ETag)',
    security,
    request: { headers: deviceHeader.extend({ 'If-None-Match': z.string().optional().meta({ description: 'ETag of a previous answer → 304 when unchanged.' }) }), query: MastersQuery },
    responses: {
      200: { description: 'Masters (header ETag)', content: { 'application/json': { schema: Masters } } },
      304: { description: 'Not modified (If-None-Match matched the ETag)' },
      ...problemResponses(400, 401, 403, 426),
    },
  })
  registry.registerPath({
    method: 'post',
    path: '/devices/register',
    summary: 'Register (or refresh) this APK install; bearer only',
    security: [{ [bearer.name]: [] }],
    request: { headers: deviceHeader, body: { content: { 'application/json': { schema: DeviceRegister } } } },
    responses: {
      200: { description: 'Refreshed', content: { 'application/json': { schema: Device } } },
      201: { description: 'Registered', content: { 'application/json': { schema: Device } } },
      ...problemResponses(400, 401, 403, 409, 426, 429),
    },
  })
  registry.registerPath({
    method: 'post',
    path: '/devices/{id}/revoke',
    summary: 'Revoke a device (own device, or any as Admin/Owner) — ends its Keycloak session',
    security,
    request: {
      headers: deviceHeader,
      params: z.object({ id: z.string().meta({ description: 'Device record id or deviceId (UUID)' }) }),
      body: { content: { 'application/json': { schema: DeviceRevoke } } },
    },
    responses: { 200: { description: 'Revoked', content: { 'application/json': { schema: Device } } }, ...problemResponses(400, 401, 404, 426, 429) },
  })
  registry.registerPath({
    method: 'post',
    path: '/admin/test-email',
    summary: 'Admin only: queue one test email to the caller\'s own address (audited; 3/hour per admin + mailbox budget)',
    security,
    responses: {
      202: { description: 'Queued; sent by the worker', content: { 'application/json': { schema: TestEmailQueued } } },
      ...problemResponses(401, 403, 409, 429, 503),
    },
  })
  registry.registerPath({
    method: 'get',
    path: '/openapi.json',
    summary: 'This document (authentication required outside development)',
    security,
    responses: { 200: { description: 'OpenAPI 3.1 document' }, ...problemResponses(401) },
  })

  // ---- F2a expense-request flow (T1–T4, T6–T8, period closing) ----
  const idem = z.object({
    'X-Company-Ids': companyIds,
    'X-Device-Id': z.uuid().optional().meta({ description: 'Registered install id (APK).' }),
    'Idempotency-Key': z.uuid().optional().meta({ description: 'Required from the APK; a retry with the same key and body returns the stored response (header Idempotent-Replayed: true); another body → 422.' }),
  })
  const idParams = (...names: string[]) => z.object(Object.fromEntries(names.map((n) => [n, z.string().regex(/^\d+$/)])))
  const jsonBody = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } })
  const res = (code: number, description: string, schema: z.ZodType, errors: number[]) => ({
    [code]: { description, content: { 'application/json': { schema } } },
    ...problemResponses(...errors),
  })
  const detailOk = (errors: number[] = [400, 401, 403, 404, 409, 422, 426, 429]) => res(200, 'Request after the action', F.ExpenseRequestDetail, errors)
  const post = (path: string, summary: string, body: z.ZodType, params: string[], responses: ReturnType<typeof res>) =>
    registry.registerPath({ method: 'post', path, summary, security, request: { headers: idem, params: idParams(...params), body: jsonBody(body) }, responses })

  registry.registerPath({
    method: 'get',
    path: '/expense-requests',
    summary: 'List expense requests in the caller scope (mine | team | inbox | all), cursor paging',
    security,
    request: { headers: deviceHeader, query: F.ListQuery },
    responses: res(200, 'Page', F.ExpenseRequestList, [400, 401, 426]),
  })
  registry.registerPath({
    method: 'post',
    path: '/expense-requests',
    summary: 'Create a Draft (Uang Muka / Reimburse); creator, status and grand total are server-set',
    security,
    request: { headers: idem, body: jsonBody(F.ExpenseRequestCreate) },
    responses: { ...res(201, 'Created', F.ExpenseRequestDetail, [400, 401, 403, 409, 422, 426, 429]), 200: { description: 'Existing draft for this clientUuid', content: { 'application/json': { schema: F.ExpenseRequestDetail } } } },
  })
  registry.registerPath({
    method: 'get',
    path: '/expense-requests/{id}',
    summary: 'Detail: lines, requesters, signatures/approvals, receipts, flags, transfers, budget impact, allowed actions',
    security,
    request: { headers: deviceHeader, params: idParams('id') },
    responses: res(200, 'Detail', F.ExpenseRequestDetail, [401, 404, 426]),
  })
  registry.registerPath({
    method: 'patch',
    path: '/expense-requests/{id}',
    summary: 'Edit a Draft (Reimburse "Revisi Nota": lines only) — creator/requesters only',
    security,
    request: { headers: deviceHeader, params: idParams('id'), body: jsonBody(F.ExpenseRequestUpdate) },
    responses: detailOk(),
  })
  registry.registerPath({
    method: 'get',
    path: '/expense-requests/{id}/history',
    summary: 'Audit history of the request ("Riwayat", US-35)',
    security,
    request: { headers: deviceHeader, params: idParams('id') },
    responses: res(200, 'History', F.History, [401, 404, 426]),
  })
  post('/expense-requests/{id}/submit', 'Submit (number, rule snapshot, signatures Diajukan/Dibuat, flags)', F.SignBody, ['id'], detailOk())
  post('/expense-requests/{id}/withdraw', 'Withdraw to Draft before any decision (reason)', F.ReasonBody, ['id'], detailOk())
  post('/expense-requests/{id}/cancel', 'Cancel (reason)', F.ReasonBody, ['id'], detailOk())
  post('/expense-requests/{id}/resubmit', 'Clone a rejected request into a new Draft (US-06)', F.EmptyBody, ['id'], res(201, 'New draft', F.ExpenseRequestDetail, [401, 403, 404, 409, 422, 426, 429]))
  post('/expense-requests/{id}/acknowledge', '"Diketahui Oleh" = Direktur approval (US-42, ADR 0013); PM/Staff/Admin → 403 (audited)', F.SignBody, ['id'], detailOk())
  post('/expense-requests/{id}/approve', 'Approve the current level — Finance by default (G1/G2, ADR 0013; budget % before → after); PM/Staff/Admin → 403 (audited)', F.SignBody, ['id'], detailOk())
  post('/expense-requests/{id}/reject', 'Reject (reason) at "Diketahui" (Direktur) or an approval level (Finance); PM/Staff/Admin → 403 (audited)', F.RejectBody, ['id'], detailOk())
  post('/expense-requests/{id}/complete', 'Reimburse: Ditransfer → Selesai', F.EmptyBody, ['id'], detailOk())
  post('/expense-requests/{id}/receipts', 'Add a receipt to a line (image from POST /media/receipts); receiptDate after today (PT timezone) → 400 "Tanggal nota tidak boleh di masa depan" (QA-07)', F.ReceiptCreate, ['id'], res(201, 'Request with receipts and flags', F.ExpenseRequestDetail, [400, 401, 403, 404, 409, 422, 426, 429]))
  registry.registerPath({
    method: 'patch',
    path: '/expense-requests/{id}/receipts/{rid}',
    summary: 'Edit a receipt inside the receipt window; future receiptDate → 400 (QA-07); a valid receipt is locked → 409 (QA-27)',
    security,
    request: { headers: deviceHeader, params: idParams('id', 'rid'), body: jsonBody(F.ReceiptUpdate) },
    responses: detailOk(),
  })
  post('/expense-requests/{id}/receipts/{rid}/remove', 'Remove a receipt (status removed, reason); a receipt Finance marked valid is locked → 409 "Nota sudah divalidasi Finance" (QA-27)', F.ReasonBody, ['id', 'rid'], detailOk())
  post('/expense-requests/{id}/receipts/{rid}/verify', 'Finance: receipt valid', F.EmptyBody, ['id', 'rid'], detailOk())
  post('/expense-requests/{id}/receipts/{rid}/reject', 'Finance: receipt rejected (reason) → Revisi Nota', F.ReasonBody, ['id', 'rid'], detailOk())
  post('/expense-requests/{id}/receipts-resubmit', 'Requester: receipts fixed (grand total changed → re-approval)', F.EmptyBody, ['id'], detailOk())
  post('/expense-requests/{id}/verify-receipts', 'Finance: all receipts valid + warnings reviewed → Nota Terverifikasi', F.EmptyBody, ['id'], detailOk())
  post('/expense-requests/{id}/flags/{fid}/review', 'Finance: mark a flag "sudah diperiksa"', F.FlagReviewBody, ['id', 'fid'], detailOk())
  post(
    '/expense-requests/{id}/transfer',
    'Finance: record the transfer (amount = approved amount, proof, bank ref) → KK posted. QA-17: destination account not verified → 409 code BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED (bankAccountId, verificationStatus, bankName, accountNo, accountHolder) unless confirmUnverifiedAccount (audited bank_unverified_confirmed); QA-04: cash account balance would go below 0 → 409 code CASH_OVERDRAFT_CONFIRM_REQUIRED (cashAccountId, balance, after) unless confirmOverdraft (audited overdraft_confirmed); QA-05: date before the account opening-balance date → 400',
    F.TransferCreate, ['id'], res(201, 'Transferred', F.TransferResult, [400, 401, 403, 404, 409, 422, 426, 429]))
  post('/expense-requests/{id}/transfers/{tid}/void', 'Finance: void a transfer (reversal entry, reason)', F.ReasonBody, ['id', 'tid'], detailOk())
  registry.registerPath({
    method: 'get',
    path: '/transfer-queue',
    summary: 'Finance/Owner: Uang Muka "Disetujui" + Reimburse "Nota Terverifikasi", by needed date (US-19); PTs where the caller is Finance/Direktur, ?company= narrows',
    security,
    request: { headers: deviceHeader, query: F.CompanyFilterQuery },
    responses: res(200, 'Queue', F.ExpenseRequestList, [400, 401, 403]),
  })
  registry.registerPath({
    method: 'get',
    path: '/lpj-queue',
    summary: 'MC3 Finance/Owner: LPJ verification list (Uang Muka "LPJ Diajukan" / "LPJ Terverifikasi", US-21) of the PTs where the caller is Finance/Direktur, with company refs; ?company= narrows',
    security,
    request: { headers: deviceHeader, query: F.CompanyFilterQuery },
    responses: res(200, 'Queue', F.LpjQueue, [400, 401, 403, 426]),
  })
  registry.registerPath({
    method: 'post',
    path: '/media/{kind}',
    summary: 'Upload a file (multipart field "file"); server resizes images (receipts ≤ 1600 px, original discarded); image resizing is queued — queue full → 503 + Retry-After (code UPLOAD_BUSY), retry later. kind=selfies: while company-settings.minAppVersion ≥ 0.3.3 a caller without an acknowledgement of the current privacy notice → 403 code PRIVACY_ACK_REQUIRED (ADR 0018; audited access_denied; show the notice, do not retry)',
    security,
    request: {
      headers: deviceHeader,
      params: z.object({ kind: F.MediaKindEnum }),
      body: { content: { 'multipart/form-data': { schema: z.object({ file: z.string().meta({ format: 'binary' }) }) } } },
    },
    responses: res(201, 'Uploaded', F.MediaUploaded, [400, 401, 403, 404, 413, 426, 429, 503]),
  })
  registry.registerPath({
    method: 'get',
    path: '/cash-entries',
    summary: 'Finance/Direktur (pk-owner)/Admin: cash ledger (KM/KK, reversals)',
    security,
    request: { headers: deviceHeader, query: F.CashListQuery },
    responses: res(200, 'Page', F.CashEntryList, [400, 401, 403]),
  })
  registry.registerPath({
    method: 'post',
    path: '/cash-entries',
    summary:
      'Finance: manual cash in/out (US-23); closed period → 409 (DB-enforced). QA-05: date before the account opening-balance date → 400 (errors[].path entryDate). QA-04: cash-out that makes the balance < 0 → 409 code CASH_OVERDRAFT_CONFIRM_REQUIRED (cashAccountId, balance, after) unless confirmOverdraft: true (audited overdraft_confirmed)',
    security,
    request: { headers: idem, body: jsonBody(F.CashEntryCreate) },
    responses: res(201, 'Posted', F.CashEntry, [400, 401, 403, 409, 422, 429]),
  })
  registry.registerPath({
    method: 'patch',
    path: '/cash-entries/{id}',
    summary: 'Finance: edit descriptive fields of a manual entry in an open period (reason)',
    security,
    request: { headers: idem, params: idParams('id'), body: jsonBody(F.CashEntryUpdate) },
    responses: res(200, 'Updated', F.CashEntry, [400, 401, 403, 404, 409, 429]),
  })
  post('/cash-entries/{id}/void', 'Finance: void = reversal entry + original void (T8, reason)', F.ReasonBody, ['id'], res(200, 'Voided', F.VoidResult, [400, 401, 403, 404, 409, 422, 429]))
  registry.registerPath({
    method: 'get',
    path: '/cash-accounts/balances',
    summary: 'Finance/Direktur (pk-owner): balance per cash account (opening — QA-14: only from its openingBalanceDate on — + in − out) of the selected PTs where the caller is Finance/Direktur; ?company= narrows (outside the selection → 403 COMPANY_NOT_ALLOWED)',
    security,
    request: { headers: deviceHeader, query: z.object({ asOf: z.string().optional(), company: F.CompanyFilterQuery.shape.company }) },
    responses: res(200, 'Balances', F.Balances, [400, 401, 403]),
  })
  post(
    '/company-memberships/batch',
    'MC2 role matrix: save many memberships atomically (all-or-nothing); each item needs Admin of ITS PT or the group admin; reason → audit (role_change)',
    F.MembershipBatchBody,
    [],
    res(200, 'Saved', F.MembershipBatchResult, [400, 401, 403, 409, 422, 429]),
  )
  registry.registerPath({
    method: 'get',
    path: '/period-closings',
    summary: 'Closed periods and the lock date per PT (`company` narrows to one selected PT; outside the selection → 403 COMPANY_NOT_ALLOWED)',
    security,
    request: { headers: deviceHeader, query: z.object({ company: z.string().regex(/^[1-9]\d{0,8}$/).optional() }) },
    responses: res(200, 'Periods', F.PeriodClosingList, [400, 401, 403]),
  })
  post('/period-closings', 'Finance/Direktur (pk-owner): close a past month (DB rejects postings dated ≤ lock date); QA-30: a month before the earliest opening-balance date of the PT cash accounts → 400', F.PeriodCloseBody, [], res(201, 'Closed', F.PeriodClosing, [400, 401, 403, 409, 422, 429]))
  registry.registerPath({
    method: 'post',
    path: '/period-closings/{period}/reopen',
    summary: 'Direktur (role pk-owner): re-open the latest closed period (reason)',
    security,
    request: { headers: idem, params: z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) }), query: z.object({ company: z.string().regex(/^\d+$/).optional() }), body: jsonBody(F.ReasonBody) },
    responses: res(200, 'Re-opened', F.PeriodClosing, [400, 401, 403, 409, 422, 429]),
  })

  // ---- F2b: LPJ & settlement (T5), PDF, approval inbox, notifications, file download ----
  post('/expense-requests/{id}/receipts-complete', 'Uang Muka: receipts complete → "Nota Lengkap" (LPJ draft created)', F.EmptyBody, ['id'], detailOk())
  post('/expense-requests/{id}/lpj/submit', 'Uang Muka: submit / resubmit the LPJ (usage description; LPJ number at first submit)', F.LpjSubmitBody, ['id'], detailOk())
  post('/expense-requests/{id}/lpj/request-revision', 'Finance: LPJ revision with a required note → "LPJ Revisi"', F.RevisionBody, ['id'], detailOk())
  post('/expense-requests/{id}/lpj/verify', 'Finance: verify the LPJ (all receipts decided; verified total = Σ valid); difference 0 → Selesai', F.EmptyBody, ['id'], detailOk())
  post(
    '/expense-requests/{id}/settle',
    'Finance: settle the verified LPJ — surplus → KM "Pengembalian LPJ", shortfall → transfer + KK (bank ref + proof) → Selesai. QA-06 / ADR 0019: total transfer above approved × (1 + shortfallTolerancePct/100) without an approved shortfall re-approval → 409 code SHORTFALL_REAPPROVAL_REQUIRED (approvedAmount, transferredTotal, tolerancePct, limit, shortfallApprovalStatus); shortfall transfer: same 409 confirmations as /transfer (BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED, CASH_OVERDRAFT_CONFIRM_REQUIRED)',
    F.SettleBody,
    ['id'],
    res(200, 'Settled', F.SettleResult, [400, 401, 403, 404, 409, 422, 426, 429]),
  )
  registry.registerPath({
    method: 'get',
    path: '/expense-requests/{id}/settle/precheck',
    summary:
      'QA-11 Finance: read-only check BEFORE uploading the settlement proof — may settle now (403/409), refund needs the PT\'s cash-in source "Pengembalian LPJ" (code LPJ) → else 409, shortfall needs the bank snapshot → else 409',
    security,
    request: { headers: deviceHeader, params: idParams('id') },
    responses: res(200, 'Ready', F.SettlePrecheckResult, [401, 403, 404, 409, 426, 429]),
  })
  post(
    '/expense-requests/{id}/settle/reverse',
    'E9 Finance: reverse a settlement — void the refund KM / shortfall transfer (+ KK reversal) → LPJ "Terverifikasi" again (reason; closed period → 409)',
    F.ReasonBody,
    ['id'],
    res(200, 'Reversed', F.SettleReverseResult, [400, 401, 403, 404, 409, 422, 426, 429]),
  )
  registry.registerPath({
    method: 'get',
    path: '/expense-requests/{id}/pdf',
    summary: 'PDF "Pengajuan Biaya" (client form replica + receipt photos); any status after submit; audited as export',
    security,
    request: { headers: deviceHeader, params: idParams('id'), query: F.PdfQuery },
    responses: {
      200: { description: 'PDF (attachment)', content: { 'application/pdf': { schema: z.string().meta({ format: 'binary' }) } } },
      ...problemResponses(400, 401, 403, 404, 409, 426, 429, 503),
    },
  })
  registry.registerPath({
    method: 'get',
    path: '/approvals/inbox',
    summary: 'Requests waiting for the caller\'s "Diketahui"/approval, with budget impact % before → after, open flags and the PT (US-26, US-59); ?company= narrows',
    security,
    request: { headers: deviceHeader, query: F.CompanyFilterQuery },
    responses: res(200, 'Inbox', F.ApprovalInbox, [401, 426]),
  })
  registry.registerPath({
    method: 'get',
    path: '/notifications',
    summary: 'Own in-app notifications, newest first (cursor paging); unreadCount',
    security,
    request: { headers: deviceHeader, query: F.NotificationQuery },
    responses: res(200, 'Page', F.NotificationList, [400, 401, 426]),
  })
  registry.registerPath({
    method: 'get',
    path: '/notifications/{id}',
    summary: 'One own notification by id or uuid (FCM data message carries the uuid, ADR 0011)',
    security,
    request: { headers: deviceHeader, params: z.object({ id: z.string().meta({ description: 'Numeric id or uuid' }) }) },
    responses: res(200, 'Notification', F.Notification, [401, 404, 426]),
  })
  registry.registerPath({
    method: 'post',
    path: '/notifications/{id}/read',
    summary: 'Mark one own notification read (idempotent)',
    security,
    request: { headers: deviceHeader, params: z.object({ id: z.string().meta({ description: 'Numeric id or uuid' }) }) },
    responses: res(200, 'Notification', F.Notification, [401, 404, 426, 429]),
  })
  registry.registerPath({
    method: 'post',
    path: '/notifications/read-all',
    summary: 'Mark all own notifications read',
    security,
    request: { headers: deviceHeader },
    responses: res(200, 'Updated', F.ReadAllResult, [401, 426, 429]),
  })
  registry.registerPath({
    method: 'get',
    path: '/media/{collection}/{id}/file',
    summary:
      'Download a stored file the caller may read (owner-document scope; else 404); private, no-store. E9: alternatively a SIGNED URL from GET …/signed-url (query exp, uid, sig; no bearer/cookie needed) — expired/invalid → 403 (code URL_EXPIRED / URL_INVALID), valid signature but the user may not read the file → 403 (code FORBIDDEN)',
    security: [...security, {}],
    request: {
      headers: deviceHeader,
      params: z.object({ collection: F.FileCollectionEnum, id: z.string().regex(/^\d+$/) }),
      query: z.object({
        variant: z.enum(['thumb']).optional(),
        exp: z.string().regex(/^\d+$/).optional().meta({ description: 'Signed URL: expiry (unix seconds)' }),
        uid: z.string().regex(/^\d+$/).optional().meta({ description: 'Signed URL: user the URL was minted for' }),
        sig: z.string().optional().meta({ description: 'Signed URL: base64url HMAC-SHA256 (ADR 0004 §4)' }),
      }),
    },
    responses: {
      200: { description: 'File bytes (image/jpeg, image/png, image/webp thumb, application/pdf)', content: { 'application/octet-stream': { schema: z.string().meta({ format: 'binary' }) } } },
      ...problemResponses(400, 401, 403, 404, 426, 429),
    },
  })
  registry.registerPath({
    method: 'get',
    path: '/media/{collection}/{id}/signed-url',
    summary: 'E9 (ADR 0004 §4): mint a signed, 5-minute URL of the file endpoint for the caller (same visibility as the download; else 404). The URL is relative to the API origin',
    security,
    request: {
      headers: deviceHeader,
      params: z.object({ collection: F.FileCollectionEnum, id: z.string().regex(/^\d+$/) }),
      query: z.object({ variant: z.enum(['thumb']).optional() }),
    },
    responses: res(200, 'Signed URL', F.SignedMediaUrl, [400, 401, 404, 426, 429]),
  })

  // ---- F4: APK backend (ADR 0010) ----
  registry.registerPath({
    method: 'get',
    path: '/app/config',
    summary: 'PUBLIC app gate: min/latest APK version, download URL, company timezone, feature flags, sync limits (call before login and on start)',
    request: { query: S.AppConfigQuery },
    responses: res(200, 'Config (Cache-Control: public, max-age=60)', S.AppConfig, [400]),
  })
  registry.registerPath({
    method: 'post',
    path: '/sync/batch',
    summary:
      'APK offline queue replay (bearer + registered device = device_id). Items in order, one transaction each; always 200 with one result per item (applied | duplicate | rejected | conflict | deferred | unsupported). Rate limit 12/min.',
    description:
      'Item types: expense_request.draft_upsert (payload SyncDraftUpsertPayload), expense_request.draft_delete (payload SyncDraftDeletePayload), attendance.check_in / attendance.check_out (payload SyncAttendancePayload: project_id OR cost_center_id; selfie first with POST /media/selfies; company-settings.syncAttendanceEnabled, else rejected FEATURE_DISABLED; rejection codes MOCK_LOCATION, OUTSIDE_GEOFENCE, NOT_ASSIGNED, NO_GEOFENCE, ALREADY_CHECKED_IN, NO_CHECK_IN, ALREADY_CHECKED_OUT, MEDIA_MISSING, FORBIDDEN), attendance.on_behalf (payload SyncOnBehalfPayload, US-14: PM only, team location, not own, reason required; GPS + photo from the PM phone); attendance items (all three) are rejected PRIVACY_ACK_REQUIRED (final) while company-settings.minAppVersion ≥ 0.3.3 and the caller (on_behalf: the PM) has not acknowledged the current privacy notice (ADR 0018; audited access_denied); progress_report.draft_upsert (payload SyncProgressReportPayload; photos first with POST /media/progress-photos, ≤ 5; new report = PM of a team project or Direktur; edit = reporter within 24 h with base_rev + reason, else conflict/NOT_EDITABLE with server_report; company-settings.syncProgressReportsEnabled, else FEATURE_DISABLED; codes WEIGHTS_INCOMPLETE, PROGRESS_DECREASED, PHOTO_LIMIT, MEDIA_IN_USE, MEDIA_MISSING, FORBIDDEN). Receipt images are uploaded first with POST /media/receipts and referenced by media_id. Replaying a client_uuid returns the stored result as duplicate. Edits of an existing draft need base_rev = server rev, else conflict + server_copy (server wins). MC3 (ADR 0016 §8): every item carries company_id (an active membership) and is processed under that PT whatever X-Company-Ids says (feature flags, timezone, own employee of that PT); the PT derived from the references must match (else rejected COMPANY_MISMATCH; a reference in a PT the caller is not mapped to is answered like a missing one; a foreign company_id → COMPANY_NOT_ALLOWED). Items WITHOUT company_id (released APK ≤ 0.2.x) are accepted only for an account with exactly one PT; otherwise the whole batch answers 409 code COMPANY_REQUIRED (errors[].path = items.<i>.company_id, nothing processed).',
    security: [{ [bearer.name]: [] }],
    request: {
      headers: z.object({
        'X-Device-Id': z.uuid().meta({ description: 'Registered install id; must equal body.device_id.' }),
        'X-App-Version': z.string().optional().meta({ description: 'APK version; below company minimum → 426.' }),
        'Idempotency-Key': z.uuid().optional().meta({ description: 'Optional (= batch_id); items are idempotent by client_uuid.' }),
        'X-Company-Ids': companyIds,
      }),
      body: jsonBody(S.SyncBatch),
    },
    responses: res(200, 'Per-item results', S.SyncBatchResponse, [400, 401, 403, 409, 413, 426, 429]),
  })

  // ---- E4: project stages (G11), progress reports (T11, US-10/US-31), K-09 (US-12) ----
  registry.registerPath({
    method: 'get',
    path: '/projects/progress',
    summary: 'K-09 progress fisik vs anggaran per project (Finance/Direktur all, PM team): K-08 % vs Σ(weight × stage %), selisih + colour',
    security,
    request: { headers: deviceHeader, query: P.ProjectProgressQuery },
    responses: res(200, 'Projects', P.ProjectProgressList, [400, 401, 403, 426, 429]),
  })
  registry.registerPath({
    method: 'get',
    path: '/projects/{id}/stages',
    summary: 'Stage set of a readable project: weights, stage %, active total and project progress',
    security,
    request: { headers: deviceHeader, params: idParams('id') },
    responses: res(200, 'Stages', P.StageSet, [401, 404, 426]),
  })
  registry.registerPath({
    method: 'put',
    path: '/projects/{id}/stages',
    summary: 'Stage editor: save the whole active set (total weight = 100 %, G11); Direktur any project (add/deactivate), PM team projects (rename/reorder/re-weight); reason for weight changes (G7)',
    security,
    request: { headers: idem, params: idParams('id'), body: jsonBody(P.StageSetBody) },
    responses: res(200, 'Saved set', P.StageSet, [400, 401, 403, 404, 409, 422, 426, 429]),
  })
  registry.registerPath({
    method: 'get',
    path: '/progress-reports',
    summary: 'Progress reports in the caller scope (PM team, Direktur/Finance all), newest first (US-31), filter project/stage/date, cursor paging',
    security,
    request: { headers: deviceHeader, query: P.ProgressReportListQuery },
    responses: res(200, 'Page', P.ProgressReportList, [400, 401, 426]),
  })
  registry.registerPath({
    method: 'post',
    path: '/progress-reports',
    summary: 'Create a progress report (US-10): PM of the project or Direktur; photos from POST /media/progress-photos (≤ 5); stage % before → after and project progress in the same transaction. Replayed clientUuid → 200',
    description: 'Problem `code`: FORBIDDEN (not PM of the project / Staff), WEIGHTS_INCOMPLETE (active stage weights ≠ 100 %), PROGRESS_DECREASED, PHOTO_LIMIT, MEDIA_MISSING, MEDIA_IN_USE, VALIDATION, STATE_CONFLICT (archived project / inactive stage).',
    security,
    request: { headers: idem, body: jsonBody(P.ProgressReportCreate) },
    responses: {
      ...res(201, 'Created', P.ProgressReport, [400, 401, 403, 404, 409, 422, 426, 429]),
      200: { description: 'Existing report for this clientUuid', content: { 'application/json': { schema: P.ProgressReport } } },
    },
  })
  registry.registerPath({
    method: 'get',
    path: '/progress-reports/{id}',
    summary: 'Report detail with photos (file URLs under /media/progress-photos/{id}/file)',
    security,
    request: { headers: deviceHeader, params: idParams('id') },
    responses: res(200, 'Report', P.ProgressReport, [401, 404, 426]),
  })
  registry.registerPath({
    method: 'patch',
    path: '/progress-reports/{id}',
    summary: 'Edit within 24 h by the reporter (reason required): work/issues, add photos (total ≤ 5), correct pctAfter on the latest report of the stage',
    security,
    request: { headers: idem, params: idParams('id'), body: jsonBody(P.ProgressReportUpdate) },
    responses: res(200, 'Report after the edit', P.ProgressReport, [400, 401, 403, 404, 409, 422, 426, 429]),
  })

  // ---- F3 dashboards & reports (docs/proyekkas/f3) ----------------------------------------------
  const dash = (name: string, summary: string, schema: z.ZodType) =>
    registry.registerPath({ method: 'get', path: `/dashboard/${name}`, summary, security, request: { headers: deviceHeader }, responses: res(200, 'Dashboard', schema, [401, 403, 426, 429]) })
  dash('owner', 'Owner home: cash (K-01, K-02b), budgets (K-07/K-08), completeness (K-12), approvals (K-10), cost centers (K-15), transfer queue (K-11)', R.OwnerDashboard)
  dash('finance', 'Finance home: work queues (K-11, K-12c/d/e), balances per account (K-01), advances without LPJ (K-12a/b), cash flow (K-02a)', R.FinanceDashboard)
  dash('pm', 'PM home (team scope): waiting for my "Diketahui", team month (K-13), LPJ (K-12a/b), project budgets (K-08), cost centers (K-15); attendance/progress = F5', R.PmDashboard)
  dash('admin', 'Admin home: master-data gaps and latest audit rows', R.AdminDashboard)
  dash('me', 'Own requests: "Perlu tindakan saya" and latest (any role)', R.StaffDashboard)
  registry.registerPath({
    method: 'get',
    path: '/reports/{code}',
    summary: 'One report page as JSON (same filters/scope as /admin/laporan/{code}); audit-log: Owner/Admin/Finance',
    security,
    request: { headers: deviceHeader, params: z.object({ code: R.ReportCode }), query: R.ReportQuery },
    responses: res(200, 'Report', R.ReportResponse, [400, 401, 403, 404, 426, 429]),
  })
  registry.registerPath({
    method: 'get',
    path: '/reports/{code}/{format}',
    summary: 'Download (CSV streamed UTF-8 BOM ";"; XLSX ≤ 10 000 rows; PDF ≤ 500 rows for rekap-kas, pengeluaran-kategori, anggaran-project). Audited `export`; 10/min per user',
    security,
    request: { headers: deviceHeader, params: z.object({ code: R.ReportCode, format: R.ReportFormat }), query: R.ReportQuery },
    responses: {
      200: {
        description: 'File (Content-Disposition: attachment)',
        content: {
          'text/csv': { schema: z.string() },
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: z.string().meta({ format: 'binary' }) },
          'application/pdf': { schema: z.string().meta({ format: 'binary' }) },
        },
      },
      ...problemResponses(400, 401, 403, 404, 413, 426, 429, 503),
    },
  })

  // ---- E6 attendance (US-09/13/15, Q-33) -------------------------------------------------------
  registerAttendancePaths(registry, { security, deviceHeader, idem, res, problemResponses })
  // ---- E5 addendum RAB (T12, US-18/US-30) ------------------------------------------------------
  registerAddendumPaths(registry, { security, deviceHeader, idem, res })
  // MC2-4: web PT switcher
  registerCompanyPaths(registry, { security, res })
  // ---- QA-06 / ADR 0019: LPJ shortfall re-approval (web) -------------------------------------
  registerShortfallPaths(registry, { security, idem, res, detail: F.ExpenseRequestDetail })
  // ---- FR1 field reports per project kind (ADR 0020) -----------------------------------------
  registerFieldPaths(registry, { security, deviceHeader, idem, res })
  // ---- P3 konstruksi RAP + Laporan Harian -----------------------------------------------------
  registerDailyPaths(registry, { security, deviceHeader, idem, res })

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'RR Teams API v1',
      version,
      description: 'Versioned contract for the Android APK and admin custom views (architecture §6). Errors: RFC 9457.',
    },
    servers: [{ url: '/api/v1' }],
  })
}
