import { assetLinks } from '@/lib/assetlinks'
import { getEnv } from '@/lib/env'

// Runtime env (container), never baked in at build time.
export const dynamic = 'force-dynamic'

/**
 * GET /.well-known/assetlinks.json — public, no auth, cacheable (Android verifies App Links
 * without credentials). Package + fingerprints from ANDROID_APP_PACKAGE / ANDROID_APP_CERT_SHA256.
 * Served by the Next app through the catch-all Traefik router of the ProyekKas host.
 */
export function GET(): Response {
  const env = getEnv()
  return new Response(JSON.stringify(assetLinks(env.ANDROID_APP_PACKAGE, env.ANDROID_APP_CERT_SHA256)), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
