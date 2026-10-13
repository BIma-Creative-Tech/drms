import { APIError, type PayloadRequest } from 'payload'

import { KeycloakAdminError } from '@/auth/keycloak-admin'
import { compensateKeycloak } from '@/domain/users-sync'
import { loadUserOnboarding, mayOnboard, OnboardingError, saveUserOnboarding, type SaveResult } from '@/domain/user-onboarding/service'
import { withReqTransaction } from '@/lib/system-tx'

import { HttpError, json, v1 } from '../http'
import { UserOnboardingCreate, UserOnboardingUpdate } from '../schemas-users'

/**
 * DRMS 13/10 Wave 3 — "Pengguna" tabbed onboarding (ADR 0003 revision 2026-10-13). Admin of a PT / group admin only
 * (the Akses PT matrix rule); every write goes through the collections with the caller's access
 * (domain/user-onboarding/service.ts).
 *
 * Transaction + compensation: the save runs in ONE DB transaction opened here (not by the v1 wrapper — the
 * compensation must run AFTER the rollback). Keycloak is written first inside the Users hooks (create user,
 * temporary password, login role; identity / enabled flag on edit) and recorded on `req.context`; when anything of
 * the save fails — a collection rule, a DB guard, the commit — the transaction is rolled back and
 * `compensateKeycloak(req)` undoes the Keycloak writes (new user deleted, enabled flag / roles reverted), best effort
 * and logged like the REST path. No Idempotency-Key (web only): a retried create answers 409 (email taken).
 */
const notOnboarder = () => new HttpError(403, 'Forbidden', { detail: 'Hanya Admin PT (atau Admin grup) yang dapat mengelola pengguna.' })

function userIdParam(params: Record<string, string>): number {
  const raw = params.userId ?? ''
  if (!/^[1-9]\d{0,9}$/.test(raw)) throw new HttpError(404, 'Not Found', { detail: 'Pengguna tidak ditemukan.' })
  return Number(raw)
}

function toHttp(err: unknown): never {
  if (err instanceof OnboardingError) {
    const title = err.status === 403 ? 'Forbidden' : err.status === 404 ? 'Not Found' : err.status === 409 ? 'Conflict' : 'Bad Request'
    throw new HttpError(err.status, title, { detail: err.detail, ...(err.errors.length ? { errors: err.errors } : {}) })
  }
  // Keycloak refused / unreachable (users-sync runs first): nothing saved, the compensation already ran
  if (err instanceof KeycloakAdminError) {
    throw new HttpError(502, 'Bad Gateway', { code: 'KEYCLOAK_FAILED', detail: 'Sistem login (Keycloak) menolak atau tidak dapat dihubungi — tidak ada yang disimpan. Coba lagi atau hubungi tim teknis.' })
  }
  if (err instanceof APIError && err.status === 503 && err.isPublic) throw new HttpError(503, 'Service Unavailable', { detail: err.message })
  throw err
}

async function save(req: PayloadRequest, body: Parameters<typeof saveUserOnboarding>[1], userId: number | null): Promise<SaveResult> {
  try {
    return await withReqTransaction(req, () => saveUserOnboarding(req, body, userId))
  } catch (err) {
    // after the rollback (withReqTransaction): undo the Keycloak side of the failed save
    await compensateKeycloak(req)
    return toHttp(err)
  }
}

export const userOnboardingGetEndpoint = v1({
  path: '/user-onboarding/:userId',
  method: 'get',
  handler: async ({ req, params }) => {
    if (!mayOnboard(req)) throw notOnboarder()
    const id = userIdParam(params)
    const detail = await loadUserOnboarding(req, id).catch(toHttp)
    return json(detail)
  },
})

export const userOnboardingCreateEndpoint = v1({
  path: '/user-onboarding',
  method: 'post',
  body: UserOnboardingCreate,
  rateLimit: [20, 60_000],
  maxBodyBytes: 256 * 1024,
  handler: async ({ req, body }) => {
    if (!mayOnboard(req)) throw notOnboarder()
    const r = await save(req, body, null)
    const detail = await loadUserOnboarding(req, r.userId)
    return json({ ...r, detail }, 201)
  },
})

export const userOnboardingUpdateEndpoint = v1({
  path: '/user-onboarding/:userId',
  method: 'patch',
  body: UserOnboardingUpdate,
  rateLimit: [30, 60_000],
  maxBodyBytes: 256 * 1024,
  handler: async ({ req, body, params }) => {
    if (!mayOnboard(req)) throw notOnboarder()
    const id = userIdParam(params)
    const r = await save(req, body, id)
    const detail = await loadUserOnboarding(req, r.userId)
    return json({ ...r, detail })
  },
})

export const USER_ONBOARDING_ENDPOINTS = [userOnboardingCreateEndpoint, userOnboardingGetEndpoint, userOnboardingUpdateEndpoint]
