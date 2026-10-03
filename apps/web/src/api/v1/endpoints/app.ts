import type { PayloadRequest } from 'payload'

import { releaseNotesFor } from '@/lib/app-release'
import { getEnv } from '@/lib/env'
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

type FlagRow = { syncExpenseDraftsEnabled?: boolean | null; syncAttendanceEnabled?: boolean | null; syncProgressReportsEnabled?: boolean | null }

/**
 * MC4 (ADR 0016 "Implementation notes (MC4)"): the PUBLIC flags are the OR over the ACTIVE PTs — a
 * feature is advertised when at least one PT has it on. The per-PT truth is `GET /me`
 * `companies[].settings.sync*Enabled` (APK 0.3.0 reads those), and the server enforces the flag of
 * the ITEM's PT on every sync item (`FEATURE_DISABLED`), so an advertised feature never lets a write
 * through in a PT that switched it off. No PT id / name / count leaves this public endpoint; one PT
 * = exactly that PT's values (the pre-MC4 answer). Pure for the unit test.
 */
export function publicFlags(rows: readonly FlagRow[]): { syncExpenseDraftsEnabled: boolean; syncAttendanceEnabled: boolean; syncProgressReportsEnabled: boolean } {
  return {
    syncExpenseDraftsEnabled: rows.some((r) => r.syncExpenseDraftsEnabled !== false),
    syncAttendanceEnabled: rows.some((r) => r.syncAttendanceEnabled === true),
    syncProgressReportsEnabled: rows.some((r) => r.syncProgressReportsEnabled !== false),
  }
}

/** Public endpoint → settings (+ release notes from the manifest) cached 60 s in-process (no DB/disk read per anonymous request). */
async function gateSettings(req: PayloadRequest): Promise<GateSettings> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value
  // App gate = app-wide global. TZ = the process TZ every PT must use (ADR 0016 §9, validated on
  // `companies.timezone`). Feature flags: OR over the active PTs (see publicFlags).
  const [app, companies] = await Promise.all([
    req.payload.findGlobal({ slug: 'company-settings', depth: 0, overrideAccess: true /* SYSTEM-READ: public app gate (non-sensitive values only) */, req }),
    req.payload.find({
      collection: 'companies',
      where: { active: { equals: true } },
      depth: 0,
      pagination: false,
      select: { syncExpenseDraftsEnabled: true, syncAttendanceEnabled: true, syncProgressReportsEnabled: true },
      overrideAccess: true, // SYSTEM-READ: public feature flags (only the OR of three booleans leaves the server)
      req,
    }),
  ])
  const latestAppVersion = app.latestAppVersion || null
  const value: GateSettings = {
    minAppVersion: app.minAppVersion || null,
    latestAppVersion,
    appDownloadUrl: app.appDownloadUrl || null,
    timezone: process.env.TZ || DEFAULT_TZ,
    ...publicFlags(companies.docs as unknown as FlagRow[]),
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
        // MC4: OR over the active PTs (per-PT truth: GET /me companies[].settings; enforced per sync item)
        syncExpenseDrafts: s.syncExpenseDraftsEnabled,
        syncAttendance: s.syncAttendanceEnabled, // F4 slice: own check-in/out
        syncProgressReports: s.syncProgressReportsEnabled, // E4: progress_report.draft_upsert (default on)
      },
      sync: { maxItemsPerBatch: SYNC_MAX_ITEMS, maxBatchBytes: SYNC_MAX_BYTES, rateLimitPerMinute: SYNC_RATE_LIMIT[0] },
    }
    return Response.json(body, { status: 200, headers: { 'Cache-Control': 'public, max-age=60' } })
  },
})
