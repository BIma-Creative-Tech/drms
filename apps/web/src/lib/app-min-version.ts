import type { PayloadRequest } from 'payload'

/**
 * App-wide "Versi APK minimum" (`company-settings.minAppVersion`, ADR 0010 decision 13), cached 60 s per process.
 * Read by the /api/v1 version gate (426) and by the privacy-notice enforcement (ADR 0018, owner decision
 * 2026-10-05). No Payload collection import: safe to use from collection hooks.
 */
let minVersionCache: { value: string | null; at: number } | undefined

/** Test seam (re-exported by api/v1/http). */
export function resetMinVersionCache(): void {
  minVersionCache = undefined
}

export async function cachedMinAppVersion(req: PayloadRequest): Promise<string | null> {
  if (minVersionCache && Date.now() - minVersionCache.at < 60_000) return minVersionCache.value
  const s = await req.payload.findGlobal({ slug: 'company-settings', depth: 0, overrideAccess: true /* SYSTEM-READ: app gate (version strings only) */, req })
  minVersionCache = { value: s.minAppVersion || null, at: Date.now() }
  return minVersionCache.value
}

export type AppVersion = readonly [major: number, minor: number, patch: number]

/**
 * STRICT `x.y.z` (digits only, each part ≤ 9 digits). Anything else — null, '', '0.3', '0.3.3-beta', ' 0.3.3',
 * '0.3.x' — is null: callers that switch something ON at a version treat an unreadable value as "not set".
 */
export function parseAppVersion(v: unknown): AppVersion | null {
  if (typeof v !== 'string') return null
  const m = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/.exec(v)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** Numeric, part by part (0.3.10 > 0.3.9 > 0.3.3). */
export function compareAppVersions(a: AppVersion, b: AppVersion): number {
  for (let i = 0; i < 3; i++) {
    const d = a[i]! - b[i]!
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}
