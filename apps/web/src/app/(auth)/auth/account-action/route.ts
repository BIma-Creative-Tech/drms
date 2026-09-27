import type { NextRequest } from 'next/server'

import { startAccountAction } from '@/auth/two-factor'

export const dynamic = 'force-dynamic'

/**
 * Optional self-service 2FA (ADR 0017): starts the Keycloak application-initiated action for the
 * logged-in user (enable = CONFIGURE_TOTP, disable = delete_credential:<own id>). POST only,
 * same-origin (CSRF); the flow and its checks live in src/auth/two-factor.ts.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return startAccountAction(request)
}
