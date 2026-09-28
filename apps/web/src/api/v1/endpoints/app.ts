import type { PayloadRequest } from 'payload'

import { releaseNotesFor } from '@/lib/app-release'
import { getEnv } from '@/lib/env'
import { settingsOf } from '@/domain/companies'
import { DEFAULT_TZ } from '@/lib/time'

import { compareVersions, HttpError, v1 } from '../http'
import { AppConfigQuery, SYNC_MAX_BYTES, SYNC_MAX_ITEMS } from '../schemas-sync'
import { SYNC_RATE_LIMIT } from './sync'

type GateSettings = {
  minAppVersion: string | null
  latestAppVersion: string | null
  appDownloadUrl: string | null
  timezone: string
  syncExpenseDraftsEnabled: boolean
  syncAttendanceEnabled: boolean
  syncProgressReportsEnabled: boolean
  /** Notes of the published APK (media volume `app-release/latest.json`) when it IS latestAppVersion. */
  releaseNotes: string[] | null
}

let cache: { value: GateSettings; at: number } | undefined
/** Test seam. */
export function resetAppConfigCache(): void {
  cache = undefined
}

/** Public endpoint → settings (+ release notes from the manifest) cached 60 s in-process (no DB/disk read per anonymous request). */
async function gateSettings(req: PayloadRequest): Promise<GateSettings> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value
  // App gate = app-wide global; TZ + feature flags are per PT (ADR 0016 §1). Public → no PT known:
  // company #1. MC3: per-PT flags in /me `companies[]` (the APK then decides per selected PT).
  const s = await settingsOf(req.payload, null, req)
  const latestAppVersion = s.latestAppVersion || null
  const value: GateSettings = {
    minAppVersion: s.minAppVersion || null,
    latestAppVersion,
    appDownloadUrl: s.appDownloadUrl || null,
    timezone: s.timezone || DEFAULT_TZ,
    syncExpenseDraftsEnabled: s.syncExpenseDraftsEnabled !== false,
    syncAttendanceEnabled: s.syncAttendanceEnabled === true,
    syncProgressReportsEnabled: s.syncProgressReportsEnabled !== false,
    releaseNotes: await releaseNotesFor(latestAppVersion),
  }
  cache = { value, at: Date.now() }
  return value
}

/**
 * GET /api/v1/app/config — APK version gate + client configuration (ADR 0010 decision 13).
 * PUBLIC: the APK must learn that it is too old BEFORE login, and old versions get 426 on every
 * authenticated call. Returns only non-sensitive values (versions, download URL, company TZ,
 * feature flags, sync limits, release notes of the latest APK). Values: company-settings (admin/owner
 * editable) + env (package) + the /unduh release manifest (notes only when its version = latestVersion).
 */
export const appConfigEndpoint = v1({
  path: '/app/config',
  method: 'get',
  auth: 'public',
  handler: async ({ req }) => {
    const q = AppConfigQuery.safeParse(Object.fromEntries(req.searchParams.entries()))
    if (!q.success) throw new HttpError(400, 'Bad Request', { detail: 'version harus x.y.z.' })
    const s = await gateSettings(req)
    const v = q.data.version
    const body = {
      minSupportedVersion: s.minAppVersion,
      latestVersion: s.latestAppVersion,
      downloadUrl: s.appDownloadUrl,
      ...(s.releaseNotes ? { releaseNotes: s.releaseNotes } : {}),
      updateRequired: v ? (s.minAppVersion ? compareVersions(v, s.minAppVersion) < 0 : false) : null,
      updateAvailable: v ? (s.latestAppVersion ? compareVersions(v, s.latestAppVersion) < 0 : false) : null,
      timezone: s.timezone,
      serverTime: new Date().toISOString(),
      android: { packageName: getEnv().ANDROID_APP_PACKAGE },
      features: {
        // Env PUSH_FCM_ENABLED (refused while there is no FCM project/dispatcher, ADR 0011):
        // until then the APK polls GET /notifications.
        pushEnabled: getEnv().PUSH_FCM_ENABLED,
        syncExpenseDrafts: s.syncExpenseDraftsEnabled,
        syncAttendance: s.syncAttendanceEnabled, // F4 slice: own check-in/out (company-settings)
        syncProgressReports: s.syncProgressReportsEnabled, // E4: progress_report.draft_upsert (company-settings, default on)
      },
      sync: { maxItemsPerBatch: SYNC_MAX_ITEMS, maxBatchBytes: SYNC_MAX_BYTES, rateLimitPerMinute: SYNC_RATE_LIMIT[0] },
    }
    return Response.json(body, { status: 200, headers: { 'Cache-Control': 'public, max-age=60' } })
  },
})
